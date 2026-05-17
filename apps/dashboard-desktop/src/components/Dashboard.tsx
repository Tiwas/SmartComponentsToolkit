import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  addFavorite,
  createFolder,
  deleteFolder,
  EMPTY_FAVORITES,
  flowEditorUrl,
  groupByFolder,
  HomeyClient,
  isFavorite,
  moveFavorite,
  removeFavorite,
  renameFolder,
  type FavoritesData,
  type Flow,
  type FlowFolder,
} from "@homey-toolbox/dashboard-shared";
import { FlowRow } from "./FlowRow";
import { ContextMenu, type ContextMenuEntry } from "./ContextMenu";
import { PromptModal } from "./PromptModal";
import { loadFavorites, saveFavorites } from "../lib/favorites-tauri";

type Tab = "favorites" | "folders" | "all";
type Toast = { id: number; text: string; kind?: "notification" };
type Modal =
  | { kind: "newFolder"; assignFlowId?: string }
  | { kind: "renameFolder"; folderId: string; current: string };

export function Dashboard({ client, onLogout }: { client: HomeyClient; onLogout: () => void }) {
  const [tab, setTab] = useState<Tab>("favorites");
  const [flows, setFlows] = useState<Flow[]>([]);
  const [homeyFolders, setHomeyFolders] = useState<FlowFolder[]>([]);
  const [favorites, setFavorites] = useState<FavoritesData>(EMPTY_FAVORITES);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [menu, setMenu] = useState<
    { x: number; y: number } & ({ target: "flow"; flow: Flow } | { target: "folder"; folderId: string })
  | null>(null);
  const [modal, setModal] = useState<Modal | null>(null);

  async function refresh(includeFavorites: boolean) {
    setRefreshing(true);
    setError(null);
    try {
      const [fl, fd, fav] = await Promise.all([
        client.listFlows(),
        client.listFolders(),
        includeFavorites ? loadFavorites() : Promise.resolve<FavoritesData | null>(null),
      ]);
      setFlows(fl);
      setHomeyFolders(fd);
      if (fav) setFavorites(fav);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [fl, fd, fav] = await Promise.all([
          client.listFlows(),
          client.listFolders(),
          loadFavorites(),
        ]);
        if (cancelled) return;
        setFlows(fl);
        setHomeyFolders(fd);
        setFavorites(fav);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client]);

  const flowsById = useMemo(() => new Map(flows.map((f) => [f.id, f])), [flows]);

  function pushToast(text: string, kind?: Toast["kind"]) {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, text, kind }]);
    window.setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4000);
  }

  // Poll Homey for new notifications and surface them as toasts.
  // We poll because the SDK's realtime emitter shape varies between versions
  // and isn't reliably exposed; a 10s poll is more than good enough for a
  // dashboard widget.
  useEffect(() => {
    const notifApi = (client.api as unknown as { notifications?: NotificationsManager }).notifications;
    if (!notifApi?.getNotifications) {
      console.warn("[dashboard] notifications.getNotifications missing — toasts disabled");
      return;
    }

    const seen = new Set<string>();
    let cancelled = false;
    let initial = true;

    async function tick() {
      const t0 = Date.now();
      try {
        // $skipCache forces the SDK to hit the server instead of returning
        // its cached map — required since the manager is not connected to
        // realtime updates (manager.__connected is false in current SDK).
        const map = await notifApi!.getNotifications!({ $skipCache: true });
        if (cancelled) return;
        const entries = Object.values(map ?? {}) as Array<{
          id?: string;
          excerpt?: string;
          ownerUri?: string;
          dateCreated?: string;
        }>;
        entries.sort((a, b) =>
          (a.dateCreated ?? "").localeCompare(b.dateCreated ?? ""),
        );
        let newCount = 0;
        for (const n of entries) {
          if (!n.id || seen.has(n.id)) continue;
          seen.add(n.id);
          if (initial) continue;
          newCount++;
          const source = formatOwnerUri(n.ownerUri);
          const text = source
            ? `${source} — ${n.excerpt ?? "Notification"}`
            : (n.excerpt ?? "Notification");
          invoke("show_toast", { text, durationMs: 6000 }).catch((e) =>
            console.warn("[dashboard] show_toast failed:", e),
          );
        }
        console.log(
          `[dashboard] poll ${initial ? "(initial)" : ""}: total=${entries.length}, new=${newCount}, ms=${Date.now() - t0}`,
        );
        initial = false;
      } catch (e) {
        console.warn("[dashboard] notification poll failed:", e);
      }
    }

    console.log("[dashboard] starting notification poll (10s interval)");
    tick();
    const id = window.setInterval(tick, 10_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [client]);

  async function persist(next: FavoritesData) {
    setFavorites(next);
    try {
      await saveFavorites(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function runFlow(flow: Flow) {
    try {
      await client.triggerFlow(flow);
      pushToast(`▶ ${flow.name}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const filteredAll = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return flows;
    return flows.filter((f) => f.name.toLowerCase().includes(q));
  }, [flows, search]);

  function flowMatchesSearch(f: Flow): boolean {
    const q = search.trim().toLowerCase();
    return !q || f.name.toLowerCase().includes(q);
  }

  function buildFlowMenu(flow: Flow): ContextMenuEntry[] {
    const entries: ContextMenuEntry[] = [
      { kind: "item", label: "Run flow", onClick: () => runFlow(flow) },
      { kind: "divider" },
      { kind: "header", label: "Favorites" },
    ];
    const fav = isFavorite(favorites, flow.id);
    const inQuick = favorites.flowIds.includes(flow.id);
    if (!fav) {
      entries.push({
        kind: "item",
        label: "Add to ★ Quick",
        onClick: () => persist(addFavorite(favorites, flow.id)),
      });
    } else if (!inQuick) {
      entries.push({
        kind: "item",
        label: "Move to ★ Quick",
        onClick: () => persist(moveFavorite(favorites, flow.id, null)),
      });
    }
    for (const folder of favorites.folders) {
      if (folder.flowIds.includes(flow.id)) continue;
      entries.push({
        kind: "item",
        label: `Move to ${folder.name}`,
        onClick: () => persist(moveFavorite(favorites, flow.id, folder.id)),
      });
    }
    entries.push({
      kind: "item",
      label: "+ New folder…",
      onClick: () => setModal({ kind: "newFolder", assignFlowId: flow.id }),
    });
    if (fav) {
      entries.push({
        kind: "item",
        label: "Remove from favorites",
        onClick: () => persist(removeFavorite(favorites, flow.id)),
      });
    }
    entries.push(
      { kind: "divider" },
      {
        kind: "item",
        label: "Edit in browser…",
        onClick: () => openUrl(flowEditorUrl(client.homey.id, flow)),
      },
    );
    return entries;
  }

  function buildFolderMenu(folderId: string): ContextMenuEntry[] {
    const folder = favorites.folders.find((f) => f.id === folderId);
    if (!folder) return [];
    return [
      {
        kind: "item",
        label: "Rename folder",
        onClick: () =>
          setModal({ kind: "renameFolder", folderId: folder.id, current: folder.name }),
      },
      {
        kind: "item",
        label: "Delete folder",
        onClick: () => persist(deleteFolder(favorites, folder.id)),
      },
    ];
  }

  function renderFavoritesTab() {
    const quickFlows = favorites.flowIds
      .map((id) => flowsById.get(id))
      .filter((f): f is Flow => !!f && flowMatchesSearch(f));
    const empty =
      favorites.flowIds.length === 0 &&
      favorites.folders.every((f) => f.flowIds.length === 0);

    return (
      <>
        <div className="fav-toolbar">
          <button onClick={() => setModal({ kind: "newFolder" })}>+ Folder</button>
        </div>
        {empty && (
          <div className="muted">
            No favorites yet. Right-click any flow → Add to ★ Quick, or create folders to organize them.
            (Homey's API doesn't expose mobile-app favorites, so this list is dashboard-local.)
          </div>
        )}
        {!empty && (
          <>
            <div className="section-title">★ Quick</div>
            {quickFlows.length === 0 ? (
              <div className="muted" style={{ padding: "4px 8px" }}>
                (empty)
              </div>
            ) : (
              quickFlows.map((f) => renderFlowRow(f))
            )}
            {favorites.folders.map((folder) => (
              <div key={folder.id}>
                <div className="folder-header">
                  <span
                    className="name"
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setMenu({
                        x: e.clientX,
                        y: e.clientY,
                        target: "folder",
                        folderId: folder.id,
                      });
                    }}
                  >
                    {folder.name}
                  </span>
                  <button
                    className="folder-action"
                    title="Rename"
                    onClick={() =>
                      setModal({
                        kind: "renameFolder",
                        folderId: folder.id,
                        current: folder.name,
                      })
                    }
                  >
                    ✎
                  </button>
                  <button
                    className="folder-action"
                    title="Delete"
                    onClick={() => persist(deleteFolder(favorites, folder.id))}
                  >
                    ×
                  </button>
                </div>
                {folder.flowIds.length === 0 ? (
                  <div className="muted" style={{ padding: "4px 8px" }}>
                    (drag flows here via right-click → Move to {folder.name})
                  </div>
                ) : (
                  folder.flowIds
                    .map((id) => flowsById.get(id))
                    .filter((f): f is Flow => !!f && flowMatchesSearch(f))
                    .map((f) => renderFlowRow(f))
                )}
              </div>
            ))}
          </>
        )}
      </>
    );
  }

  function renderFlowRow(f: Flow) {
    return (
      <FlowRow
        key={f.id}
        flow={f}
        isFavorite={isFavorite(favorites, f.id)}
        onRun={() => runFlow(f)}
        onToggleFavorite={() =>
          persist(
            isFavorite(favorites, f.id)
              ? removeFavorite(favorites, f.id)
              : addFavorite(favorites, f.id),
          )
        }
        onContextMenu={(x, y) => setMenu({ x, y, target: "flow", flow: f })}
      />
    );
  }

  function renderFoldersTab() {
    const grouped = groupByFolder(filteredAll, homeyFolders);
    return [...grouped.entries()].map(([folderName, list]) => (
      <div key={folderName}>
        <div className="section-title">{folderName}</div>
        {list.map((f) => renderFlowRow(f))}
      </div>
    ));
  }

  function renderAllTab() {
    if (filteredAll.length === 0) return <div className="muted">No flows.</div>;
    return filteredAll.map((f) => renderFlowRow(f));
  }

  return (
    <>
      <div className="tabs">
        <button
          className={`tab ${tab === "favorites" ? "active" : ""}`}
          onClick={() => setTab("favorites")}
        >
          ★ Favorites
        </button>
        <button
          className={`tab ${tab === "folders" ? "active" : ""}`}
          onClick={() => setTab("folders")}
        >
          Folders
        </button>
        <button className={`tab ${tab === "all" ? "active" : ""}`} onClick={() => setTab("all")}>
          All
        </button>
        <div style={{ flex: 1 }} />
        <button
          className="tab"
          onClick={() => refresh(false)}
          title="Refresh flows"
          disabled={refreshing}
        >
          {refreshing ? "…" : "↻"}
        </button>
        <button className="tab" onClick={onLogout} title="Sign out">
          ⎋
        </button>
      </div>

      <div className="screen">
        <input
          className="search"
          type="text"
          placeholder="Search flows…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />

        {error && <div className="error">{error}</div>}

        {tab === "favorites" && renderFavoritesTab()}
        {tab === "folders" && renderFoldersTab()}
        {tab === "all" && renderAllTab()}
      </div>

      {menu &&
        (menu.target === "flow" ? (
          <ContextMenu
            x={menu.x}
            y={menu.y}
            items={buildFlowMenu(menu.flow)}
            onClose={() => setMenu(null)}
          />
        ) : (
          <ContextMenu
            x={menu.x}
            y={menu.y}
            items={buildFolderMenu(menu.folderId)}
            onClose={() => setMenu(null)}
          />
        ))}

      {modal?.kind === "newFolder" && (
        <PromptModal
          title="New folder"
          placeholder="Folder name"
          confirmLabel="Create"
          onCancel={() => setModal(null)}
          onConfirm={(name) => {
            let next = createFolder(favorites, name);
            // Last folder is the one we just created; assign the flow to it.
            const created = next.folders[next.folders.length - 1];
            if (modal.assignFlowId && created) {
              next = moveFavorite(next, modal.assignFlowId, created.id);
            }
            persist(next);
            setModal(null);
          }}
        />
      )}
      {modal?.kind === "renameFolder" && (
        <PromptModal
          title="Rename folder"
          initialValue={modal.current}
          confirmLabel="Rename"
          onCancel={() => setModal(null)}
          onConfirm={(name) => {
            persist(renameFolder(favorites, modal.folderId, name));
            setModal(null);
          }}
        />
      )}

      <div className="toast-stack">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind ?? ""}`}>
            {t.text}
          </div>
        ))}
      </div>
    </>
  );
}

interface NotificationsManager {
  getNotifications?(opts?: { $skipCache?: boolean }): Promise<Record<string, {
    id?: string;
    excerpt?: string;
    ownerUri?: string;
    dateCreated?: string;
  }>>;
}

/**
 * Turn a Homey ownerUri like "homey:manager:flow" or "homey:device:abc123"
 * into a short, human-readable source label for notification toasts.
 */
function formatOwnerUri(uri: string | undefined): string | null {
  if (!uri) return null;
  // homey:manager:<name>
  const mgr = uri.match(/^homey:manager:([^:]+)/i);
  if (mgr) {
    const name = mgr[1]!;
    return name.charAt(0).toUpperCase() + name.slice(1);
  }
  // homey:device:<id> — we don't have the device name handy here; fall back to "Device"
  if (/^homey:device:/i.test(uri)) return "Device";
  // homey:app:<id>
  const app = uri.match(/^homey:app:([^:]+)/i);
  if (app) return `App ${app[1]}`;
  return uri;
}
