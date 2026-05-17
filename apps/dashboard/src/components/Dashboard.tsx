import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  addFavorite,
  buildFolderTree,
  countFlowsInNode,
  createFolder,
  deleteFolder,
  EMPTY_FAVORITES,
  flowEditorUrl,
  formatOwnerUri,
  HomeyClient,
  isFavorite,
  moveFavorite,
  removeFavorite,
  renameFolder,
  toggleFolderCollapsed,
  toggleHomeyFolderCollapsed,
  type AppSettings,
  type FavoritesData,
  type Flow,
  type FlowFolder,
  type FolderNode,
} from "@homey-toolbox/dashboard-shared";
import { FlowRow } from "./FlowRow";
import { ContextMenu, type ContextMenuEntry } from "./ContextMenu";
import { PromptModal } from "./PromptModal";
import { loadFavorites, saveFavorites } from "../lib/favorites-tauri";
import { useI18n } from "../i18n/context";

type Tab = "favorites" | "flows";
type Toast = { id: number; text: string; kind?: "notification" };
type Modal =
  | { kind: "newFolder"; assignFlowId?: string }
  | { kind: "renameFolder"; folderId: string; current: string };

export function Dashboard({
  client,
  settings,
  onOpenSettings,
}: {
  client: HomeyClient;
  settings: AppSettings;
  onLogout: () => void;
  onOpenSettings: () => void;
}) {
  const { t, tf } = useI18n();
  const [tab, setTab] = useState<Tab>("favorites");
  const [flows, setFlows] = useState<Flow[]>([]);
  const [homeyFolders, setHomeyFolders] = useState<FlowFolder[]>([]);
  const [favorites, setFavorites] = useState<FavoritesData>(EMPTY_FAVORITES);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [deviceNames, setDeviceNames] = useState<Map<string, string>>(new Map());
  const [appNames, setAppNames] = useState<Map<string, string>>(new Map());
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
        const [fl, fd, fav, dn, an] = await Promise.all([
          client.listFlows(),
          client.listFolders(),
          loadFavorites(),
          client.listDeviceNames().catch(() => new Map<string, string>()),
          client.listAppNames().catch(() => new Map<string, string>()),
        ]);
        if (cancelled) return;
        setFlows(fl);
        setHomeyFolders(fd);
        setFavorites(fav);
        setDeviceNames(dn);
        setAppNames(an);
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
  useEffect(() => {
    if (!settings.notifications.enabled) return;

    const notifApi = (client.api as unknown as { notifications?: NotificationsManager }).notifications;
    if (!notifApi?.getNotifications) {
      console.warn("[dashboard] notifications.getNotifications missing — toasts disabled");
      return;
    }

    const seen = new Set<string>();
    let cancelled = false;
    let initial = true;

    async function tick() {
      try {
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
        for (const n of entries) {
          if (!n.id || seen.has(n.id)) continue;
          seen.add(n.id);
          if (initial) continue;
          const source = settings.notifications.showSource
            ? formatOwnerUri(n.ownerUri, {
                device: (id) => deviceNames.get(id),
                app: (id) => appNames.get(id),
              })
            : null;
          const text = source
            ? `${source} — ${n.excerpt ?? t.fallback_notification}`
            : (n.excerpt ?? t.fallback_notification);
          invoke("show_toast", {
            text,
            durationMs: settings.notifications.durationMs,
          }).catch((e) => console.warn("[dashboard] show_toast failed:", e));
        }
        initial = false;
      } catch (e) {
        console.warn("[dashboard] notification poll failed:", e);
      }
    }

    tick();
    const id = window.setInterval(tick, settings.notifications.pollIntervalSec * 1000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [
    client,
    deviceNames,
    appNames,
    settings.notifications.enabled,
    settings.notifications.showSource,
    settings.notifications.durationMs,
    settings.notifications.pollIntervalSec,
  ]);

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
      { kind: "item", label: t.ctx_run, onClick: () => runFlow(flow) },
      { kind: "divider" },
      { kind: "header", label: t.ctx_favorites_header },
    ];
    const fav = isFavorite(favorites, flow.id);
    const inQuick = favorites.flowIds.includes(flow.id);
    if (!fav) {
      entries.push({
        kind: "item",
        label: t.ctx_add_to_quick,
        onClick: () => persist(addFavorite(favorites, flow.id)),
      });
    } else if (!inQuick) {
      entries.push({
        kind: "item",
        label: t.ctx_move_to_quick,
        onClick: () => persist(moveFavorite(favorites, flow.id, null)),
      });
    }
    for (const folder of favorites.folders) {
      if (folder.flowIds.includes(flow.id)) continue;
      entries.push({
        kind: "item",
        label: tf("ctx_move_to", { name: folder.name }),
        onClick: () => persist(moveFavorite(favorites, flow.id, folder.id)),
      });
    }
    entries.push({
      kind: "item",
      label: t.ctx_new_folder,
      onClick: () => setModal({ kind: "newFolder", assignFlowId: flow.id }),
    });
    if (fav) {
      entries.push({
        kind: "item",
        label: t.ctx_remove_favorite,
        onClick: () => persist(removeFavorite(favorites, flow.id)),
      });
    }
    entries.push(
      { kind: "divider" },
      {
        kind: "item",
        label: t.ctx_edit_in_browser,
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
        label: t.ctx_rename_folder,
        onClick: () =>
          setModal({ kind: "renameFolder", folderId: folder.id, current: folder.name }),
      },
      {
        kind: "item",
        label: t.ctx_delete_folder,
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
          <button onClick={() => setModal({ kind: "newFolder" })}>{t.fav_new_folder}</button>
        </div>
        {empty && <div className="muted">{t.fav_empty}</div>}
        {!empty && (
          <>
            <div className="section-title">{t.fav_quick_label}</div>
            {quickFlows.length === 0 ? (
              <div className="muted" style={{ padding: "4px 8px" }}>
                {t.fav_folder_empty_marker}
              </div>
            ) : (
              quickFlows.map((f) => renderFlowRow(f))
            )}
            {favorites.folders.map((folder) => {
              const collapsed = !!folder.collapsed;
              return (
                <div key={folder.id}>
                  <div className="folder-header">
                    <button
                      className="folder-chevron"
                      onClick={() => persist(toggleFolderCollapsed(favorites, folder.id))}
                      title={collapsed ? "Expand" : "Collapse"}
                    >
                      {collapsed ? "▶" : "▼"}
                    </button>
                    <span
                      className="name"
                      onClick={() => persist(toggleFolderCollapsed(favorites, folder.id))}
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
                      {collapsed && folder.flowIds.length > 0 && (
                        <span className="folder-count"> ({folder.flowIds.length})</span>
                      )}
                    </span>
                    <button
                      className="folder-action"
                      title={t.rename_btn}
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
                      title={t.delete_btn}
                      onClick={() => persist(deleteFolder(favorites, folder.id))}
                    >
                      ×
                    </button>
                  </div>
                  {!collapsed &&
                    (folder.flowIds.length === 0 ? (
                      <div className="muted" style={{ padding: "4px 8px" }}>
                        {tf("fav_empty_folder", { name: folder.name })}
                      </div>
                    ) : (
                      folder.flowIds
                        .map((id) => flowsById.get(id))
                        .filter((f): f is Flow => !!f && flowMatchesSearch(f))
                        .map((f) => renderFlowRow(f))
                    ))}
                </div>
              );
            })}
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

  function renderFlowsTab() {
    if (flows.length === 0) return <div className="muted">{t.no_flows}</div>;
    const tree = buildFolderTree(filteredAll, homeyFolders);
    const collapsedSet = new Set(favorites.collapsedHomeyFolders ?? []);
    if (tree.flows.length === 0 && tree.children.length === 0) {
      return <div className="muted">{t.no_flows}</div>;
    }
    return <FolderTree node={tree} depth={0} collapsedSet={collapsedSet} />;
  }

  function FolderTree({
    node,
    depth,
    collapsedSet,
  }: {
    node: FolderNode;
    depth: number;
    collapsedSet: Set<string>;
  }) {
    const indentPx = depth * 12;
    return (
      <>
        {node.children.map((child) => {
          const folder = child.folder!;
          const collapsed = collapsedSet.has(folder.id);
          const count = countFlowsInNode(child);
          return (
            <div key={folder.id} style={{ marginLeft: indentPx }}>
              <div className="folder-header">
                <button
                  className="folder-chevron"
                  onClick={() =>
                    persist(toggleHomeyFolderCollapsed(favorites, folder.id))
                  }
                  title={collapsed ? "Expand" : "Collapse"}
                >
                  {collapsed ? "▶" : "▼"}
                </button>
                <span
                  className="name"
                  onClick={() =>
                    persist(toggleHomeyFolderCollapsed(favorites, folder.id))
                  }
                >
                  {folder.name}
                  {collapsed && count > 0 && (
                    <span className="folder-count"> ({count})</span>
                  )}
                </span>
              </div>
              {!collapsed && (
                <FolderTree
                  node={child}
                  depth={depth + 1}
                  collapsedSet={collapsedSet}
                />
              )}
            </div>
          );
        })}
        {node.flows.map((f) => (
          <div key={f.id} style={{ marginLeft: indentPx }}>
            {renderFlowRow(f)}
          </div>
        ))}
      </>
    );
  }

  return (
    <>
      <div className="tabs">
        <button
          className={`tab ${tab === "favorites" ? "active" : ""}`}
          onClick={() => setTab("favorites")}
        >
          {t.tab_favorites}
        </button>
        <button
          className={`tab ${tab === "flows" ? "active" : ""}`}
          onClick={() => setTab("flows")}
        >
          {t.tab_flows}
        </button>
        <div style={{ flex: 1 }} />
        <button
          className="tab"
          onClick={() => refresh(false)}
          title={t.tab_refresh}
          disabled={refreshing}
        >
          {refreshing ? "…" : "↻"}
        </button>
        <button className="tab" onClick={onOpenSettings} title={t.tab_settings}>
          ⚙
        </button>
      </div>

      <div className="screen">
        <input
          className="search"
          type="text"
          placeholder={t.search_placeholder}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />

        {error && <div className="error">{error}</div>}

        {tab === "favorites" && renderFavoritesTab()}
        {tab === "flows" && renderFlowsTab()}
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
          title={t.modal_new_folder_title}
          placeholder={t.modal_new_folder_placeholder}
          confirmLabel={t.modal_new_folder_confirm}
          onCancel={() => setModal(null)}
          onConfirm={(name) => {
            let next = createFolder(favorites, name);
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
          title={t.modal_rename_folder_title}
          initialValue={modal.current}
          confirmLabel={t.modal_rename_folder_confirm}
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
