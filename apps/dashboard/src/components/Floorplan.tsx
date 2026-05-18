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
  type FlowFolder,
  type RoomGeometry,
  type Zone,
} from "@homey-toolbox/dashboard-shared";
import { loadFloorplan, saveFloorplan } from "../lib/floorplan-tauri";
import { useI18n } from "../i18n/context";

const EDITOR_HINT_URL =
  "https://tiwas.github.io/SmartComponentsToolkit/tools/floorplan-editor.html";

interface Device {
  id: string;
  name: string;
  zone: string | null;
  capabilities: Record<string, unknown>;
  capabilityInfo: Record<
    string,
    {
      type?: string;
      min?: number;
      max?: number;
      step?: number;
      units?: string;
      values?: Array<{ id: string; title: string }>;
    }
  >;
}

type ControlKind = "dim" | "temp" | "enum" | "color";
interface ControlPopup {
  deviceId: string;
  capabilityId: string;
  kind: ControlKind;
  clientX: number;
  clientY: number;
}

/** Pick the most interactive capability for tap-action priority. */
function pickControlCapability(
  dev: Device,
): { capabilityId: string; kind: ControlKind | "onoff" } | null {
  // Colour-capable light gets its own popup (hue/sat/temp/dim in one)
  if (
    "light_hue" in dev.capabilities ||
    "light_saturation" in dev.capabilities ||
    "light_temperature" in dev.capabilities
  ) {
    return { capabilityId: "light_hue", kind: "color" };
  }
  // Enum (state, mode, …) — covers State Devices + thermostat modes
  for (const [k, info] of Object.entries(dev.capabilityInfo)) {
    if (info.type === "enum" && info.values && info.values.length > 0) {
      return { capabilityId: k, kind: "enum" };
    }
  }
  if ("target_temperature" in dev.capabilities) {
    return { capabilityId: "target_temperature", kind: "temp" };
  }
  if ("dim" in dev.capabilities) {
    return { capabilityId: "dim", kind: "dim" };
  }
  if ("onoff" in dev.capabilities) {
    return { capabilityId: "onoff", kind: "onoff" };
  }
  return null;
}

/** Convert a (0-1) hue + (0-1) saturation to a CSS HSL fill at 50% lightness. */
function hsToCss(hue: number, saturation: number): string {
  return `hsl(${(hue * 360).toFixed(0)}, ${(saturation * 100).toFixed(0)}%, 50%)`;
}

interface FlowLite {
  id: string;
  name: string;
  kind: "standard" | "advanced";
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
  const [showAdd, setShowAdd] = useState(false);
  const [hiddenFloors, setHiddenFloors] = useState<Set<string>>(new Set());
  const [devices, setDevices] = useState<Device[]>([]);
  const [flows, setFlows] = useState<FlowLite[]>([]);
  const [zones, setZones] = useState<Zone[]>([]);
  const [folders, setFolders] = useState<FlowFolder[]>([]);
  const [popup, setPopup] = useState<ControlPopup | null>(null);
  const overlayRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    Promise.all([
      loadFloorplan(),
      client.listDevices().catch(() => []),
      client.listFlows().catch(() => []),
      client.listZones().catch(() => []),
      client.listFolders().catch(() => []),
    ])
      .then(([fp, devs, fls, zns, fds]) => {
        setData(fp);
        setDevices(devs);
        setFlows(fls.map((f) => ({ id: f.id, name: f.name, kind: f.kind })));
        setZones(zns);
        setFolders(fds);
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

  // Compute effective placements: persisted (devices + flows), plus
  // auto-placed for devices that have a matching zone but no stored
  // placement yet.
  const placements: DevicePlacement[] = useMemo(() => {
    if (!data.svg) return [];
    const storedDevices = new Map(
      data.placements
        .filter((p) => p.kind === "device")
        .map((p) => [p.id, p] as const),
    );
    const storedFlows = new Map(
      data.placements
        .filter((p) => p.kind === "flow")
        .map((p) => [p.id, p] as const),
    );
    const result: DevicePlacement[] = [];
    for (const dev of devices) {
      const existing = storedDevices.get(dev.id);
      if (existing) {
        result.push(existing);
        continue;
      }
      if (dev.zone && roomsByZone.has(dev.zone)) {
        const room = roomsByZone.get(dev.zone)!;
        result.push({ kind: "device", id: dev.id, x: room.cx, y: room.cy });
      }
    }
    for (const flow of flows) {
      const existing = storedFlows.get(flow.id);
      if (existing) result.push(existing);
    }
    // Keep persisted placements for items that no longer exist on the Homey
    // (don't silently delete them — could be transient API failure).
    for (const p of data.placements) {
      if (p.kind === "device" && !devices.find((d) => d.id === p.id)) result.push(p);
      if (p.kind === "flow" && !flows.find((f) => f.id === p.id)) result.push(p);
    }
    return result;
  }, [data.svg, data.placements, devices, flows, roomsByZone]);

  const deviceById = useMemo(() => {
    const m = new Map<string, Device>();
    for (const d of devices) m.set(d.id, d);
    return m;
  }, [devices]);
  const flowById = useMemo(() => {
    const m = new Map<string, FlowLite>();
    for (const f of flows) m.set(f.id, f);
    return m;
  }, [flows]);

  const placedDeviceIds = useMemo(
    () => new Set(placements.filter((p) => p.kind === "device").map((p) => p.id)),
    [placements],
  );
  const placedFlowIds = useMemo(
    () => new Set(placements.filter((p) => p.kind === "flow").map((p) => p.id)),
    [placements],
  );

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

  function viewBoxCenter() {
    const m = /([\-\d.]+)\s+([\-\d.]+)\s+([\-\d.]+)\s+([\-\d.]+)/.exec(viewBox);
    if (!m) return { x: 50, y: 35 };
    return {
      x: parseFloat(m[1]!) + parseFloat(m[3]!) / 2,
      y: parseFloat(m[2]!) + parseFloat(m[4]!) / 2,
    };
  }

  async function addPlacement(kind: "device" | "flow", id: string) {
    const center = viewBoxCenter();
    const others = data.placements.filter((p) => !(p.kind === kind && p.id === id));
    await persist({
      ...data,
      placements: [...others, { kind, id, x: center.x, y: center.y }],
    });
  }

  async function addBulkPlacements(items: Array<{ kind: "device" | "flow"; id: string }>) {
    const center = viewBoxCenter();
    // Lay them out in a 3-column grid around the centre so they don't all
    // overlap at one point. Spacing kept tight (~3 viewBox units).
    const SPACING = 3.5;
    const PER_ROW = 3;
    const newOnes = items.map((it, i) => {
      const col = i % PER_ROW;
      const row = Math.floor(i / PER_ROW);
      const offX = (col - (PER_ROW - 1) / 2) * SPACING;
      const offY = row * SPACING;
      return { kind: it.kind, id: it.id, x: center.x + offX, y: center.y + offY };
    });
    const existingKeys = new Set(newOnes.map((p) => `${p.kind}:${p.id}`));
    const others = data.placements.filter(
      (p) => !existingKeys.has(`${p.kind}:${p.id}`),
    );
    await persist({ ...data, placements: [...others, ...newOnes] });
  }

  async function removePlacement(kind: "device" | "flow", id: string) {
    await persist({
      ...data,
      placements: data.placements.filter((p) => !(p.kind === kind && p.id === id)),
    });
  }

  // SVG drag using pointer events. We convert client coords to viewBox coords
  // via the overlay SVG's CTM.
  const dragRef = useRef<{ id: string; pointerId: number } | null>(null);

  function toViewBox(evt: React.PointerEvent<SVGElement>): { x: number; y: number } | null {
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

  const dragKindRef = useRef<"device" | "flow">("device");
  const dragOriginRef = useRef<{ x: number; y: number } | null>(null);
  const draggedRef = useRef(false);
  const TAP_THRESHOLD = 1.5; // viewBox units; below this, treat as tap not drag

  function onPointerDown(
    e: React.PointerEvent<SVGElement>,
    kind: "device" | "flow",
    id: string,
  ) {
    e.stopPropagation();
    overlayRef.current?.setPointerCapture(e.pointerId);
    dragRef.current = { id, pointerId: e.pointerId };
    dragKindRef.current = kind;
    dragOriginRef.current = toViewBox(e);
    draggedRef.current = false;
  }

  function onPointerMove(e: React.PointerEvent<SVGSVGElement>) {
    if (!dragRef.current) return;
    const coords = toViewBox(e);
    if (!coords) return;
    const id = dragRef.current.id;
    const kind = dragKindRef.current;
    const origin = dragOriginRef.current;
    if (origin) {
      const dx = Math.abs(coords.x - origin.x);
      const dy = Math.abs(coords.y - origin.y);
      if (dx > TAP_THRESHOLD || dy > TAP_THRESHOLD) draggedRef.current = true;
    }
    if (!draggedRef.current) return;
    setData((prev) => {
      const others = prev.placements.filter((p) => !(p.kind === kind && p.id === id));
      return {
        ...prev,
        placements: [...others, { kind, id, x: coords.x, y: coords.y }],
      };
    });
  }

  async function onPointerUp(e: React.PointerEvent<SVGSVGElement>) {
    if (!dragRef.current) return;
    const id = dragRef.current.id;
    const kind = dragKindRef.current;
    const tapClientX = e.clientX;
    const tapClientY = e.clientY;
    overlayRef.current?.releasePointerCapture(dragRef.current.pointerId);
    dragRef.current = null;
    if (draggedRef.current) {
      await saveFloorplan(data).catch((err) =>
        console.warn("[dashboard] saveFloorplan failed:", err),
      );
    } else {
      handleTap(kind, id, tapClientX, tapClientY);
    }
    draggedRef.current = false;
    dragOriginRef.current = null;
    e.stopPropagation();
  }

  function handleTap(
    kind: "device" | "flow",
    id: string,
    clientX: number,
    clientY: number,
  ) {
    if (kind === "flow") {
      const flow = flowById.get(id);
      if (!flow) return;
      client
        .triggerFlow({ id: flow.id, kind: flow.kind })
        .catch((e) => console.warn("[dashboard] triggerFlow failed:", e));
      return;
    }
    const dev = deviceById.get(id);
    if (!dev) return;
    const ctrl = pickControlCapability(dev);
    if (!ctrl) return;

    if (ctrl.kind === "onoff") {
      // Direct toggle, no popup.
      setCapabilityOptimistic(id, "onoff", !dev.capabilities.onoff);
      return;
    }
    // Open popup near the tap.
    setPopup({
      deviceId: id,
      capabilityId: ctrl.capabilityId,
      kind: ctrl.kind,
      clientX,
      clientY,
    });
  }

  function setCapabilityOptimistic(deviceId: string, capId: string, value: unknown) {
    let previous: unknown;
    setDevices((prev) =>
      prev.map((d) => {
        if (d.id !== deviceId) return d;
        previous = d.capabilities[capId];
        return { ...d, capabilities: { ...d.capabilities, [capId]: value } };
      }),
    );
    client.setDeviceCapability(deviceId, capId, value).catch((e) => {
      console.warn("[dashboard] setDeviceCapability failed:", e);
      setDevices((prev) =>
        prev.map((d) =>
          d.id === deviceId
            ? { ...d, capabilities: { ...d.capabilities, [capId]: previous } }
            : d,
        ),
      );
    });
  }

  // Periodic refresh so on-floor icons reflect external state changes
  // (e.g. someone toggling a light from elsewhere).
  useEffect(() => {
    if (!data.svg) return;
    const id = window.setInterval(() => {
      client.listDevices().then(setDevices).catch(() => {});
    }, 15_000);
    return () => window.clearInterval(id);
  }, [client, data.svg]);

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
          <>
            <button className="tab" onClick={() => setShowAdd(true)} title="Add device or flow">
              +
            </button>
            <button
              className="tab"
              onClick={resetPlacements}
              title="Reset device positions to room centers"
            >
              ↺
            </button>
          </>
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
                  // Hide device placements whose zone belongs to a hidden floor.
                  if (!visibleFloors) return true;
                  if (p.kind !== "device") return true;
                  const dev = deviceById.get(p.id);
                  if (!dev || !dev.zone) return true;
                  const room = roomsByZone.get(dev.zone);
                  if (!room || !room.floor) return true;
                  return visibleFloors.has(room.floor);
                })
                .map((p) => {
                  const dev = p.kind === "device" ? deviceById.get(p.id) : null;
                  const flow = p.kind === "flow" ? flowById.get(p.id) : null;
                  const label = dev?.name ?? flow?.name ?? p.id;
                  return (
                    <DevicePlacementIcon
                      key={`${p.kind}-${p.id}`}
                      placement={p}
                      device={dev ?? null}
                      label={label}
                      onPointerDown={(e) => onPointerDown(e, p.kind, p.id)}
                      onRemove={() => {
                        if (confirm(`Remove ${label} from the floorplan?`)) {
                          removePlacement(p.kind, p.id);
                        }
                      }}
                    />
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

      {popup && (() => {
        const dev = deviceById.get(popup.deviceId);
        if (!dev) return null;
        return (
          <DeviceControlPopup
            popup={popup}
            device={dev}
            onClose={() => setPopup(null)}
            onSetCapability={(capId, value) =>
              setCapabilityOptimistic(popup.deviceId, capId, value)
            }
            onPickAndClose={(value) => {
              setCapabilityOptimistic(popup.deviceId, popup.capabilityId, value);
              setPopup(null);
            }}
          />
        );
      })()}

      {showAdd && (
        <AddPlacementModal
          devices={devices.filter((d) => !placedDeviceIds.has(d.id))}
          flows={flows.filter((f) => !placedFlowIds.has(f.id))}
          zones={zones}
          folders={folders}
          onClose={() => setShowAdd(false)}
          onPick={(kind, id) => {
            addPlacement(kind, id);
            setShowAdd(false);
          }}
          onPickGroup={(items) => {
            addBulkPlacements(items);
            setShowAdd(false);
          }}
        />
      )}

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

interface TreeNode<Item, Container> {
  container: Container | null; // null = root
  children: TreeNode<Item, Container>[];
  items: Item[];
}

/** Generic tree builder used for both zone+device and folder+flow trees. */
function buildTree<
  Item extends { id: string; name: string },
  Container extends { id: string; name: string; parent: string | null },
>(
  items: Item[],
  containers: Container[],
  itemContainer: (i: Item) => string | null,
): TreeNode<Item, Container> {
  const itemsByContainer = new Map<string | null, Item[]>();
  for (const it of items) {
    const k = itemContainer(it);
    if (!itemsByContainer.has(k)) itemsByContainer.set(k, []);
    itemsByContainer.get(k)!.push(it);
  }
  const nodeBy = new Map<string, TreeNode<Item, Container>>();
  for (const c of containers) {
    nodeBy.set(c.id, {
      container: c,
      children: [],
      items: itemsByContainer.get(c.id) ?? [],
    });
  }
  const root: TreeNode<Item, Container> = {
    container: null,
    children: [],
    items: itemsByContainer.get(null) ?? [],
  };
  for (const c of containers) {
    const node = nodeBy.get(c.id)!;
    if (c.parent && nodeBy.has(c.parent)) nodeBy.get(c.parent)!.children.push(node);
    else root.children.push(node);
  }
  function sortNode(n: TreeNode<Item, Container>) {
    n.children.sort((a, b) =>
      (a.container?.name ?? "").localeCompare(b.container?.name ?? ""),
    );
    n.items.sort((a, b) => a.name.localeCompare(b.name));
    n.children.forEach(sortNode);
  }
  sortNode(root);
  return root;
}

function countNode<I, C>(node: TreeNode<I, C>): number {
  return (
    node.items.length + node.children.reduce((sum, c) => sum + countNode(c), 0)
  );
}

function nodeMatchesSearch<I extends { name: string }, C extends { name: string }>(
  node: TreeNode<I, C>,
  q: string,
): boolean {
  if (!q) return true;
  if (node.container && node.container.name.toLowerCase().includes(q)) return true;
  if (node.items.some((i) => i.name.toLowerCase().includes(q))) return true;
  return node.children.some((c) => nodeMatchesSearch(c, q));
}

function DeviceControlPopup({
  popup,
  device,
  onClose,
  onSetCapability,
  onPickAndClose,
}: {
  popup: ControlPopup;
  device: Device;
  onClose: () => void;
  onSetCapability: (capabilityId: string, value: unknown) => void;
  onPickAndClose: (value: unknown) => void;
}) {
  const info = device.capabilityInfo[popup.capabilityId] ?? {};
  const currentValue = device.capabilities[popup.capabilityId];

  const POPUP_W = 240;
  const POPUP_H = 130;
  const left = Math.min(
    Math.max(8, popup.clientX - POPUP_W / 2),
    window.innerWidth - POPUP_W - 8,
  );
  const top = Math.min(
    Math.max(40, popup.clientY + 12),
    window.innerHeight - POPUP_H - 8,
  );

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="control-popup"
        onClick={(e) => e.stopPropagation()}
        style={{ left, top }}
      >
        <div className="control-popup-title">{device.name}</div>

        {popup.kind === "dim" && (
          <DimControl
            value={typeof currentValue === "number" ? currentValue : 0}
            isOn={!!device.capabilities.onoff}
            hasOnoff={"onoff" in device.capabilities}
            onChange={(v) => onSetCapability("dim", v)}
            onToggleOnoff={(on) => onSetCapability("onoff", on)}
          />
        )}

        {popup.kind === "temp" && (
          <TempControl
            value={typeof currentValue === "number" ? currentValue : 20}
            min={info.min ?? 5}
            max={info.max ?? 30}
            step={info.step ?? 0.5}
            units={info.units ?? "°C"}
            onChange={(v) => onSetCapability("target_temperature", v)}
          />
        )}

        {popup.kind === "enum" && (
          <EnumControl
            options={info.values ?? []}
            current={typeof currentValue === "string" ? currentValue : ""}
            onPick={onPickAndClose}
          />
        )}

        {popup.kind === "color" && (
          <ColorControl
            device={device}
            onSet={(cap, v) => onSetCapability(cap, v)}
          />
        )}
      </div>
    </div>
  );
}

function ColorControl({
  device,
  onSet,
}: {
  device: Device;
  onSet: (cap: string, value: unknown) => void;
}) {
  const caps = device.capabilities;
  const hasHue = "light_hue" in caps;
  const hasSat = "light_saturation" in caps;
  const hasTemp = "light_temperature" in caps;
  const hasDim = "dim" in caps;
  const hasOnoff = "onoff" in caps;
  const hasMode = "light_mode" in caps;

  const hue = typeof caps.light_hue === "number" ? (caps.light_hue as number) : 0;
  const sat =
    typeof caps.light_saturation === "number" ? (caps.light_saturation as number) : 1;
  const temp =
    typeof caps.light_temperature === "number" ? (caps.light_temperature as number) : 0.5;
  const dim = typeof caps.dim === "number" ? (caps.dim as number) : 1;
  const isOn = !!caps.onoff;
  const mode = typeof caps.light_mode === "string" ? caps.light_mode : null;
  const inTempMode = mode === "temperature";

  return (
    <>
      {hasOnoff && (
        <div className="control-popup-row" style={{ justifyContent: "space-between" }}>
          <span className="muted" style={{ fontSize: 11 }}>Power</span>
          <button
            className="icon-btn"
            onClick={() => onSet("onoff", !isOn)}
            style={{ fontWeight: isOn ? 700 : 400 }}
          >
            {isOn ? "On" : "Off"}
          </button>
        </div>
      )}

      {hasMode && (
        <div className="control-popup-row" style={{ gap: 4 }}>
          <button
            className={`enum-option ${!inTempMode ? "active" : ""}`}
            style={{ flex: 1, textAlign: "center" }}
            onClick={() => onSet("light_mode", "color")}
          >
            Color
          </button>
          <button
            className={`enum-option ${inTempMode ? "active" : ""}`}
            style={{ flex: 1, textAlign: "center" }}
            onClick={() => onSet("light_mode", "temperature")}
          >
            White
          </button>
        </div>
      )}

      {(!inTempMode || !hasTemp) && hasHue && (
        <div>
          <div className="slider-label">Hue</div>
          <input
            type="range"
            min={0}
            max={1}
            step={0.005}
            value={hue}
            onChange={(e) => onSet("light_hue", parseFloat(e.target.value))}
            className="slider hue-slider"
          />
        </div>
      )}

      {(!inTempMode || !hasTemp) && hasSat && (
        <div>
          <div className="slider-label">Saturation</div>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={sat}
            onChange={(e) => onSet("light_saturation", parseFloat(e.target.value))}
            className="slider sat-slider"
            style={{
              background: `linear-gradient(to right, hsl(${(hue * 360).toFixed(0)}, 0%, 50%), hsl(${(hue * 360).toFixed(0)}, 100%, 50%))`,
            }}
          />
        </div>
      )}

      {hasTemp && (!hasMode || inTempMode) && (
        <div>
          <div className="slider-label">Temperature</div>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={temp}
            onChange={(e) => onSet("light_temperature", parseFloat(e.target.value))}
            className="slider temp-slider"
          />
        </div>
      )}

      {hasDim && (
        <div>
          <div className="slider-label">Brightness — {Math.round(dim * 100)}%</div>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={dim}
            onChange={(e) => onSet("dim", parseFloat(e.target.value))}
            className="slider"
          />
        </div>
      )}
    </>
  );
}

function DimControl({
  value,
  isOn,
  hasOnoff,
  onChange,
  onToggleOnoff,
}: {
  value: number;
  isOn: boolean;
  hasOnoff: boolean;
  onChange: (v: number) => void;
  onToggleOnoff: (on: boolean) => void;
}) {
  return (
    <>
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        style={{ width: "100%" }}
      />
      <div className="control-popup-row">
        <span className="muted">{Math.round(value * 100)}%</span>
        {hasOnoff && (
          <button
            className="icon-btn"
            onClick={() => onToggleOnoff(!isOn)}
            style={{ fontWeight: isOn ? 700 : 400 }}
          >
            {isOn ? "On" : "Off"}
          </button>
        )}
      </div>
    </>
  );
}

function TempControl({
  value,
  min,
  max,
  step,
  units,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  units: string;
  onChange: (v: number) => void;
}) {
  const display = `${value.toFixed(step < 1 ? 1 : 0)}${units}`;
  return (
    <div className="control-popup-row" style={{ justifyContent: "space-between" }}>
      <button
        className="icon-btn"
        onClick={() => onChange(Math.max(min, +(value - step).toFixed(2)))}
      >
        −
      </button>
      <span style={{ fontSize: 22, fontWeight: 700 }}>{display}</span>
      <button
        className="icon-btn"
        onClick={() => onChange(Math.min(max, +(value + step).toFixed(2)))}
      >
        +
      </button>
    </div>
  );
}

function EnumControl({
  options,
  current,
  onPick,
}: {
  options: Array<{ id: string; title: string }>;
  current: string;
  onPick: (id: string) => void;
}) {
  if (options.length === 0) return <div className="muted">No options available.</div>;
  return (
    <div className="enum-options">
      {options.map((opt) => (
        <button
          key={opt.id}
          className={`enum-option ${opt.id === current ? "active" : ""}`}
          onClick={() => onPick(opt.id)}
        >
          {opt.title}
        </button>
      ))}
    </div>
  );
}

/**
 * Render the on-floor icon for a placement. The visual is chosen from the
 * device's most informative capability:
 *   - measure_temperature → a square chip with the value
 *   - alarm_motion / alarm_contact → red square when alerting, dim otherwise
 *   - onoff → bright yellow circle when on, dim blue when off
 *   - flow → yellow rounded square
 *   - fallback (unknown device) → plain blue circle
 *
 * Clicks (vs. drags) are dispatched by the parent's handleTap; this component
 * only declares the shape and forwards pointer events.
 */
function DevicePlacementIcon({
  placement: p,
  device: dev,
  label,
  onPointerDown,
  onRemove,
}: {
  placement: DevicePlacement;
  device: Device | null;
  label: string;
  onPointerDown: (e: React.PointerEvent<SVGElement>) => void;
  onRemove: () => void;
}) {
  const shared = {
    onPointerDown,
    onContextMenu: (e: React.MouseEvent) => {
      e.preventDefault();
      onRemove();
    },
  };

  if (p.kind === "flow") {
    return (
      <g className="device-icon flow">
        <rect x={p.x - 2.2} y={p.y - 2.2} width={4.4} height={4.4} rx={0.6} {...shared} />
        <title>{label}</title>
      </g>
    );
  }

  const caps = dev?.capabilities ?? {};

  // Temperature display
  if (typeof caps.measure_temperature === "number") {
    const t = caps.measure_temperature as number;
    return (
      <g className="device-icon device measure">
        <rect x={p.x - 3} y={p.y - 2} width={6} height={4} rx={0.6} fill="rgba(76,179,255,0.85)" {...shared} />
        <text x={p.x} y={p.y + 0.1} textAnchor="middle" dominantBaseline="middle" fontSize="2.2" fontWeight="700" fill="white" pointerEvents="none">
          {t.toFixed(1)}°
        </text>
        <title>{label}: {t}°C</title>
      </g>
    );
  }

  // Motion / contact alarm
  if ("alarm_motion" in caps || "alarm_contact" in caps) {
    const triggered =
      caps.alarm_motion === true ||
      caps.alarm_contact === true;
    const fill = triggered ? "rgba(239, 68, 68, 0.95)" : "rgba(34, 197, 94, 0.6)";
    return (
      <g className="device-icon device alarm">
        <circle cx={p.x} cy={p.y} r={2.2} fill={fill} {...shared} />
        <title>{label}: {triggered ? "alert" : "clear"}</title>
      </g>
    );
  }

  // Coloured light — fill the icon with the device's current colour
  if ("light_hue" in caps || "light_saturation" in caps) {
    const hue = typeof caps.light_hue === "number" ? (caps.light_hue as number) : 0;
    const sat = typeof caps.light_saturation === "number" ? (caps.light_saturation as number) : 1;
    const on = !!caps.onoff;
    const fill = on ? hsToCss(hue, sat) : "rgba(76, 179, 255, 0.4)";
    return (
      <g className={`device-icon device light-color ${on ? "on" : "off"}`}>
        <circle cx={p.x} cy={p.y} r={2.2} fill={fill} {...shared} />
        <title>{label}{on ? "" : " (off)"}</title>
      </g>
    );
  }

  // On/off
  if ("onoff" in caps) {
    const on = !!caps.onoff;
    const fill = on ? "rgba(250, 204, 21, 0.95)" : "rgba(76, 179, 255, 0.4)";
    return (
      <g className={`device-icon device onoff ${on ? "on" : "off"}`}>
        <circle cx={p.x} cy={p.y} r={2.2} fill={fill} {...shared} />
        <title>{label}: {on ? "on" : "off"}</title>
      </g>
    );
  }

  // Fallback
  return (
    <g className="device-icon device">
      <circle cx={p.x} cy={p.y} r={2.2} fill="rgba(76,179,255,0.85)" {...shared} />
      <title>{label}</title>
    </g>
  );
}

function AddPlacementModal({
  devices,
  flows,
  zones,
  folders,
  onClose,
  onPick,
  onPickGroup,
}: {
  devices: Device[];
  flows: FlowLite[];
  zones: Zone[];
  folders: FlowFolder[];
  onClose: () => void;
  onPick: (kind: "device" | "flow", id: string) => void;
  onPickGroup: (items: Array<{ kind: "device" | "flow"; id: string }>) => void;
}) {
  const [tab, setTab] = useState<"device" | "flow">("device");
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const q = search.trim().toLowerCase();

  const deviceTree = useMemo(
    () => buildTree(devices, zones, (d) => d.zone),
    [devices, zones],
  );
  const flowTree = useMemo(
    () => buildTree(flows, folders, (f) => (f as unknown as { folder?: string | null }).folder ?? null),
    [flows, folders],
  );

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function collectAllItems<I extends { id: string; name: string }, C>(
    node: TreeNode<I, C>,
    kind: "device" | "flow",
  ): Array<{ kind: "device" | "flow"; id: string }> {
    const out: Array<{ kind: "device" | "flow"; id: string }> = [];
    for (const i of node.items) out.push({ kind, id: i.id });
    for (const c of node.children) out.push(...collectAllItems(c, kind));
    return out;
  }

  function renderNode<I extends { id: string; name: string }, C extends { id: string; name: string; parent: string | null }>(
    node: TreeNode<I, C>,
    kind: "device" | "flow",
    depth: number,
    forceOpen: boolean,
  ): React.ReactNode {
    const ind = depth * 12;
    return (
      <>
        {node.container && (() => {
          const total = countNode(node);
          const isOpen = forceOpen || expanded.has(node.container.id);
          return (
            <div
              key={`c-${node.container.id}`}
              className="folder-header"
              style={{ marginLeft: ind }}
            >
              <button
                className="folder-chevron"
                onClick={() => toggle(node.container!.id)}
              >
                {isOpen ? "▼" : "▶"}
              </button>
              <span
                className="name"
                onClick={() => toggle(node.container!.id)}
                style={{ flex: 1 }}
              >
                {node.container.name}
                {!isOpen && total > 0 && (
                  <span className="folder-count"> ({total})</span>
                )}
              </span>
              {total > 0 && (
                <button
                  className="folder-action"
                  title={`Add all ${total} item(s) in ${node.container.name}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onPickGroup(collectAllItems(node, kind));
                  }}
                  style={{ opacity: 1, fontSize: 11, padding: "2px 6px" }}
                >
                  + all
                </button>
              )}
            </div>
          );
        })()}
        {(node.container == null || forceOpen || expanded.has(node.container.id)) && (
          <>
            {node.items
              .filter((i) => !q || i.name.toLowerCase().includes(q))
              .map((i) => (
                <div
                  key={`${kind}-${i.id}`}
                  className="flow-row"
                  onClick={() => onPick(kind, i.id)}
                  style={{
                    cursor: "pointer",
                    marginLeft: (depth + (node.container ? 1 : 0)) * 12,
                  }}
                >
                  <span style={{ fontSize: 13 }}>
                    {kind === "device" ? "●" : "▢"} {i.name}
                  </span>
                </div>
              ))}
            {node.children
              .filter((c) => nodeMatchesSearch(c, q))
              .map((c) => (
                <div key={`cc-${c.container?.id}`}>
                  {renderNode(c, kind, depth + (node.container ? 1 : 0), forceOpen)}
                </div>
              ))}
          </>
        )}
      </>
    );
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal"
        onClick={(e) => e.stopPropagation()}
        style={{ minWidth: 380, maxHeight: "80vh" }}
      >
        <div className="modal-title">Add to floorplan</div>
        <div className="tabs" style={{ marginBottom: 8 }}>
          <button
            type="button"
            className={`tab ${tab === "device" ? "active" : ""}`}
            onClick={() => setTab("device")}
          >
            Devices ({devices.length})
          </button>
          <button
            type="button"
            className={`tab ${tab === "flow" ? "active" : ""}`}
            onClick={() => setTab("flow")}
          >
            Flows ({flows.length})
          </button>
        </div>
        <input
          type="text"
          placeholder="Search…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ width: "100%" }}
        />
        <div style={{ overflowY: "auto", maxHeight: "50vh", paddingRight: 4 }}>
          {tab === "device"
            ? renderNode(deviceTree, "device", 0, !!q)
            : renderNode(flowTree, "flow", 0, !!q)}
        </div>
        <div className="muted" style={{ fontSize: 11 }}>
          Items appear at the canvas centre; drag to position. Right-click an icon to remove.
        </div>
      </div>
    </div>
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
