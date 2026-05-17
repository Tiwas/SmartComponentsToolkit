import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  EMPTY_FLOORPLAN,
  extractFloors,
  filterFloors,
  getViewBox,
  HomeyClient,
  parseRooms,
  validateSvg,
  type DevicePlacement,
  type FloorplanData,
  type RoomGeometry,
} from "@homey-toolbox/dashboard-shared";
import { loadFloorplan, saveFloorplan } from "../lib/floorplan-tauri";
import { useI18n } from "../i18n/context";

const EDITOR_HINT_URL =
  "https://tiwas.github.io/SmartComponentsToolkit/tools/floorplan-editor.html";

interface Device {
  id: string;
  name: string;
  zone: string | null;
}

export function Floorplan({
  client,
  onLogout,
  onOpenSettings,
}: {
  client: HomeyClient;
  onLogout: () => void;
  onOpenSettings: () => void;
}) {
  const { t } = useI18n();
  const [data, setData] = useState<FloorplanData>(EMPTY_FLOORPLAN);
  const [loading, setLoading] = useState(true);
  const [showImport, setShowImport] = useState(false);
  const [hiddenFloors, setHiddenFloors] = useState<Set<string>>(new Set());
  const [devices, setDevices] = useState<Device[]>([]);
  const overlayRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    Promise.all([loadFloorplan(), client.listDevices().catch(() => [])])
      .then(([fp, devs]) => {
        setData(fp);
        setDevices(devs);
      })
      .catch((e) => console.warn("[dashboard] floorplan init failed:", e))
      .finally(() => setLoading(false));
  }, [client]);

  const floors = useMemo(() => (data.svg ? extractFloors(data.svg) : []), [data.svg]);
  const rooms: RoomGeometry[] = useMemo(
    () => (data.svg ? parseRooms(data.svg) : []),
    [data.svg],
  );
  const roomsByZone = useMemo(() => {
    const m = new Map<string, RoomGeometry>();
    for (const r of rooms) m.set(r.zone, r);
    return m;
  }, [rooms]);
  const visibleFloors =
    floors.length > 0 ? new Set(floors.filter((f) => !hiddenFloors.has(f))) : null;
  const renderedSvg =
    data.svg && visibleFloors ? filterFloors(data.svg, visibleFloors) : data.svg;
  const viewBox = data.svg ? getViewBox(data.svg) : "0 0 100 70";

  // Compute effective placements: persisted, plus auto-placed for any
  // device that has a matching zone but no stored placement yet.
  const placements: DevicePlacement[] = useMemo(() => {
    if (!data.svg) return [];
    const stored = new Map(
      data.placements
        .filter((p) => p.kind === "device")
        .map((p) => [p.id, p] as const),
    );
    const result: DevicePlacement[] = [];
    for (const dev of devices) {
      const existing = stored.get(dev.id);
      if (existing) {
        result.push(existing);
        continue;
      }
      if (dev.zone && roomsByZone.has(dev.zone)) {
        const room = roomsByZone.get(dev.zone)!;
        result.push({ kind: "device", id: dev.id, x: room.cx, y: room.cy });
      }
    }
    // Keep any persisted placements for devices that no longer exist
    // (so they don't get silently lost if the device API returned a partial list).
    for (const p of data.placements) {
      if (p.kind === "device" && !devices.find((d) => d.id === p.id)) result.push(p);
    }
    return result;
  }, [data.svg, data.placements, devices, roomsByZone]);

  const deviceById = useMemo(() => {
    const m = new Map<string, Device>();
    for (const d of devices) m.set(d.id, d);
    return m;
  }, [devices]);

  async function persist(next: FloorplanData) {
    setData(next);
    try {
      await saveFloorplan(next);
    } catch (e) {
      console.warn("[dashboard] saveFloorplan failed:", e);
    }
  }

  async function resetPlacements() {
    if (!confirm("Reset all device positions to their room centers?")) return;
    await persist({ ...data, placements: [] });
  }

  // SVG drag using pointer events. We convert client coords to viewBox coords
  // via the overlay SVG's CTM.
  const dragRef = useRef<{ id: string; pointerId: number } | null>(null);

  function toViewBox(evt: React.PointerEvent<SVGSVGElement>): { x: number; y: number } | null {
    const svg = overlayRef.current;
    if (!svg) return null;
    const pt = svg.createSVGPoint();
    pt.x = evt.clientX;
    pt.y = evt.clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return null;
    const result = pt.matrixTransform(ctm.inverse());
    return { x: result.x, y: result.y };
  }

  function onPointerDown(e: React.PointerEvent<SVGCircleElement>, id: string) {
    e.stopPropagation();
    overlayRef.current?.setPointerCapture(e.pointerId);
    dragRef.current = { id, pointerId: e.pointerId };
  }

  function onPointerMove(e: React.PointerEvent<SVGSVGElement>) {
    if (!dragRef.current) return;
    const coords = toViewBox(e);
    if (!coords) return;
    const id = dragRef.current.id;
    // Optimistic local update — only persist on release to avoid hammering disk.
    setData((prev) => {
      const others = prev.placements.filter((p) => !(p.kind === "device" && p.id === id));
      return {
        ...prev,
        placements: [...others, { kind: "device", id, x: coords.x, y: coords.y }],
      };
    });
  }

  async function onPointerUp(e: React.PointerEvent<SVGSVGElement>) {
    if (!dragRef.current) return;
    const id = dragRef.current.id;
    overlayRef.current?.releasePointerCapture(dragRef.current.pointerId);
    dragRef.current = null;
    const placement = data.placements.find(
      (p) => p.kind === "device" && p.id === id,
    );
    if (placement) {
      // Save the latest position we have in state to disk.
      await saveFloorplan(data).catch((err) =>
        console.warn("[dashboard] saveFloorplan failed:", err),
      );
    }
    e.stopPropagation();
  }

  return (
    <>
      <div className="tabs">
        <span className="tab active" style={{ cursor: "default" }}>
          {t.floorplan_title}
        </span>
        {data.svg && (
          <button
            className="tab"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(data.svg);
                console.log("[dashboard] copied current floorplan SVG to clipboard");
              } catch (e) {
                console.warn("[dashboard] copy failed:", e);
              }
            }}
            title="Copy current floorplan SVG (paste into the editor to edit it)"
          >
            ⧉
          </button>
        )}
        {floors.map((floor) => {
          const visible = !hiddenFloors.has(floor);
          return (
            <button
              key={floor}
              className={`tab ${visible ? "active" : ""}`}
              onClick={() => {
                setHiddenFloors((prev) => {
                  const next = new Set(prev);
                  if (next.has(floor)) next.delete(floor);
                  else next.add(floor);
                  return next;
                });
              }}
              title={visible ? `Hide ${floor}` : `Show ${floor}`}
              style={{ fontSize: 11 }}
            >
              {floor}
            </button>
          );
        })}
        <div style={{ flex: 1 }} />
        {data.svg && (
          <button
            className="tab"
            onClick={resetPlacements}
            title="Reset device positions to room centers"
          >
            ↺
          </button>
        )}
        <button className="tab" onClick={() => setShowImport(true)} title={t.floorplan_import}>
          ⤓
        </button>
        <button className="tab" onClick={onOpenSettings} title={t.tab_settings}>
          ⚙
        </button>
        <button className="tab" onClick={onLogout} title={t.settings_sign_out}>
          ⎋
        </button>
      </div>

      <div className="floorplan-stage">
        {loading ? (
          <div className="muted">{t.loading}</div>
        ) : data.svg ? (
          <div className="floorplan-canvas">
            <div
              className="floorplan-svg"
              dangerouslySetInnerHTML={{ __html: renderedSvg }}
            />
            <svg
              ref={overlayRef}
              className="floorplan-overlay"
              viewBox={viewBox}
              preserveAspectRatio="xMidYMid meet"
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
            >
              {placements
                .filter((p) => {
                  // Hide placements that belong to a hidden floor.
                  if (!visibleFloors) return true;
                  const dev = deviceById.get(p.id);
                  if (!dev || !dev.zone) return true;
                  const room = roomsByZone.get(dev.zone);
                  if (!room || !room.floor) return true;
                  return visibleFloors.has(room.floor);
                })
                .map((p) => {
                  const dev = deviceById.get(p.id);
                  return (
                    <g key={p.id} className="device-icon">
                      <circle
                        cx={p.x}
                        cy={p.y}
                        r={2.2}
                        onPointerDown={(e) => onPointerDown(e, p.id)}
                      />
                      {dev && (
                        <title>{dev.name}</title>
                      )}
                    </g>
                  );
                })}
            </svg>
          </div>
        ) : (
          <div className="floorplan-empty">
            <h3>{t.floorplan_empty_title}</h3>
            <p className="muted">{t.floorplan_empty_hint}</p>
            <button className="primary" onClick={() => setShowImport(true)}>
              {t.floorplan_import}
            </button>
            <button
              className="link-btn"
              style={{ marginTop: 12 }}
              onClick={() => openUrl(EDITOR_HINT_URL)}
            >
              {t.floorplan_open_editor} →
            </button>
          </div>
        )}
      </div>

      {showImport && (
        <ImportFloorplanModal
          onClose={() => setShowImport(false)}
          onImported={(svg) => {
            persist({ ...data, svg });
            setShowImport(false);
          }}
        />
      )}
    </>
  );
}

function ImportFloorplanModal({
  onClose,
  onImported,
}: {
  onClose: () => void;
  onImported: (svg: string) => void;
}) {
  const { t } = useI18n();
  const [tab, setTab] = useState<"file" | "paste">("file");
  const [pasted, setPasted] = useState("");
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (tab === "paste") {
      const id = window.setTimeout(() => textareaRef.current?.focus(), 30);
      return () => window.clearTimeout(id);
    }
  }, [tab]);

  async function handleFile(e: ChangeEvent<HTMLInputElement>) {
    setError(null);
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const result = validateSvg(text);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onImported(result.svg);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function handlePaste() {
    setError(null);
    const result = validateSvg(pasted);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onImported(result.svg);
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ minWidth: 360 }}>
        <div className="modal-title">{t.floorplan_import}</div>
        <div className="muted" style={{ fontSize: 11, marginBottom: 4 }}>
          {t.floorplan_no_svg_yet}{" "}
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              openUrl(EDITOR_HINT_URL);
            }}
            style={{ color: "var(--accent)" }}
          >
            {t.floorplan_open_editor} →
          </a>
        </div>
        <div className="tabs" style={{ marginBottom: 8 }}>
          <button
            className={`tab ${tab === "file" ? "active" : ""}`}
            onClick={() => setTab("file")}
            type="button"
          >
            {t.floorplan_import_file}
          </button>
          <button
            className={`tab ${tab === "paste" ? "active" : ""}`}
            onClick={() => setTab("paste")}
            type="button"
          >
            {t.floorplan_import_paste}
          </button>
        </div>

        {tab === "file" ? (
          <input
            key="file-input"
            type="file"
            accept=".svg,image/svg+xml"
            onChange={handleFile}
          />
        ) : (
          <>
            <textarea
              key="paste-textarea"
              ref={textareaRef}
              rows={8}
              placeholder="<svg …>…</svg>"
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              style={{
                width: "100%",
                fontFamily: "monospace",
                fontSize: 11,
                background: "rgba(255,255,255,0.04)",
                color: "var(--fg)",
                border: "1px solid var(--border)",
                borderRadius: 6,
                padding: 8,
                resize: "vertical",
                pointerEvents: "auto",
              }}
            />
            <div className="modal-actions">
              <button type="button" className="icon-btn" onClick={onClose}>
                {t.modal_cancel}
              </button>
              <button type="button" className="primary" onClick={handlePaste} disabled={!pasted.trim()}>
                {t.floorplan_import_apply}
              </button>
            </div>
          </>
        )}

        {error && <div className="error">{error}</div>}
      </div>
    </div>
  );
}
