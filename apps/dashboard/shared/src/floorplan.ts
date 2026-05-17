export interface DevicePlacement {
  kind: "device" | "flow";
  /** Homey device id or flow id. */
  id: string;
  /** Position in SVG coordinates (viewBox units, 0–100 typically). */
  x: number;
  y: number;
  /** Optional icon override; uses default if absent. */
  icon?: string;
}

export interface FloorplanData {
  /** Raw SVG document as a string. Validated to contain a single <svg> root. */
  svg: string;
  /** Device/flow placements anchored to SVG coordinates. */
  placements: DevicePlacement[];
}

export const EMPTY_FLOORPLAN: FloorplanData = { svg: "", placements: [] };

export function normalizeFloorplan(raw: unknown): FloorplanData {
  if (raw == null || typeof raw !== "object") return EMPTY_FLOORPLAN;
  const obj = raw as Record<string, unknown>;
  const svg = typeof obj.svg === "string" ? obj.svg : "";
  const placements = Array.isArray(obj.placements)
    ? (obj.placements
        .map(normalizePlacement)
        .filter((p): p is DevicePlacement => p !== null))
    : [];
  return { svg, placements };
}

function normalizePlacement(raw: unknown): DevicePlacement | null {
  if (typeof raw !== "object" || raw === null) return null;
  const obj = raw as Record<string, unknown>;
  if (
    (obj.kind !== "device" && obj.kind !== "flow") ||
    typeof obj.id !== "string" ||
    typeof obj.x !== "number" ||
    typeof obj.y !== "number"
  ) {
    return null;
  }
  return {
    kind: obj.kind,
    id: obj.id,
    x: obj.x,
    y: obj.y,
    icon: typeof obj.icon === "string" ? obj.icon : undefined,
  };
}

/**
 * Cheap validation: does the input look like a single-root SVG document?
 * Doesn't try to parse XML fully — we accept anything that has an opening
 * `<svg` tag and at least one closing `</svg>`. The webview will reject
 * malformed XML at render time anyway.
 */
export function validateSvg(input: string): { ok: true; svg: string } | { ok: false; error: string } {
  const trimmed = input.trim();
  if (!trimmed) return { ok: false, error: "empty input" };
  const openIdx = trimmed.toLowerCase().indexOf("<svg");
  const closeIdx = trimmed.toLowerCase().lastIndexOf("</svg>");
  if (openIdx === -1 || closeIdx === -1 || closeIdx < openIdx) {
    return { ok: false, error: "no <svg>…</svg> root found" };
  }
  return { ok: true, svg: trimmed.slice(openIdx, closeIdx + "</svg>".length) };
}
