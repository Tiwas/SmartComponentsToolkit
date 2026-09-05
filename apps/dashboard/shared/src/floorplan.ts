export type LightIconType = "bulb" | "led" | "led-strip";

export interface DevicePlacement {
  kind: "device" | "flow";
  /** Homey device id or flow id. */
  id: string;
  /** Position in SVG coordinates (viewBox units, 0–100 typically). */
  x: number;
  y: number;
  /** Optional icon override; uses default if absent. */
  icon?: string;
  /** For light devices: which kind of bulb/strip to render. */
  lightIconType?: LightIconType;
}

export interface FloorplanData {
  /** Sanitized SVG document, safe to render in the dashboard WebView. */
  svg: string;
  /** Device/flow placements anchored to SVG coordinates. */
  placements: DevicePlacement[];
  /** Device ids the user has explicitly removed from the floorplan,
   *  so auto-placement won't bring them back on the next render. */
  hiddenDevices?: string[];
  /** Flow ids the user has explicitly removed. */
  hiddenFlows?: string[];
}

export const EMPTY_FLOORPLAN: FloorplanData = {
  svg: "",
  placements: [],
  hiddenDevices: [],
  hiddenFlows: [],
};

const MAX_SVG_SIZE = 1_000_000;
const MAX_SVG_ELEMENTS = 10_000;
const MAX_SVG_ATTRIBUTES = 50_000;
const SAFE_SVG_ELEMENTS = new Set([
  "svg", "g", "defs", "view", "switch", "path", "rect", "circle", "ellipse", "line",
  "polyline", "polygon", "text", "tspan", "textpath", "use", "symbol", "marker", "pattern",
  "clippath", "mask", "lineargradient", "radialgradient", "stop", "filter", "feblend",
  "fecolormatrix", "fecomponenttransfer", "fecomposite", "feconvolvematrix", "fediffuselighting",
  "fedisplacementmap", "fedistantlight", "fedropshadow", "feflood", "fefunca", "fefuncb", "fefuncg",
  "fefuncr", "fegaussianblur", "feimage", "femerge", "femergenode", "femorphology", "feoffset",
  "fepointlight", "fespecularlighting", "fespotlight", "fetile", "feturbulence", "image", "a",
]);

function hasOnlyLocalUrlReferences(value: string): boolean {
  const normalized = value.toLowerCase();
  if (
    normalized.includes("image(") ||
    normalized.includes("image-set(") ||
    normalized.includes("cross-fade(") ||
    normalized.includes("element(") ||
    normalized.includes("paint(")
  ) {
    return false;
  }
  let cursor = 0;
  while (true) {
    const start = normalized.indexOf("url(", cursor);
    if (start === -1) return true;

    const end = value.indexOf(")", start + 4);
    if (end === -1) return false;
    let reference = value.slice(start + 4, end).trim();
    const quote = reference[0];
    if ((quote === "'" || quote === '"') && reference.endsWith(quote)) {
      reference = reference.slice(1, -1).trim();
    }
    if (!reference.startsWith("#")) return false;
    cursor = end + 1;
  }
}

function isSafeSvgReference(value: string): boolean {
  return value.trim().startsWith("#");
}

function removeOpaqueNodes(node: Node): void {
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType !== 1 && child.nodeType !== 3) {
      child.remove();
    } else {
      removeOpaqueNodes(child);
    }
  }
}

export function normalizeFloorplan(raw: unknown): FloorplanData {
  if (raw == null || typeof raw !== "object") return EMPTY_FLOORPLAN;
  const obj = raw as Record<string, unknown>;
  const svgInput = typeof obj.svg === "string" ? obj.svg : "";
  const svgResult = svgInput ? validateSvg(svgInput) : null;
  const svg = svgResult?.ok ? svgResult.svg : "";
  const placements = Array.isArray(obj.placements)
    ? (obj.placements
        .map(normalizePlacement)
        .filter((p): p is DevicePlacement => p !== null))
    : [];
  const hiddenDevices = Array.isArray(obj.hiddenDevices)
    ? obj.hiddenDevices.filter((x): x is string => typeof x === "string")
    : [];
  const hiddenFlows = Array.isArray(obj.hiddenFlows)
    ? obj.hiddenFlows.filter((x): x is string => typeof x === "string")
    : [];
  return { svg, placements, hiddenDevices, hiddenFlows };
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
  const validIconTypes = ["bulb", "led", "led-strip"];
  return {
    kind: obj.kind,
    id: obj.id,
    x: obj.x,
    y: obj.y,
    icon: typeof obj.icon === "string" ? obj.icon : undefined,
    lightIconType:
      typeof obj.lightIconType === "string" &&
      validIconTypes.includes(obj.lightIconType)
        ? (obj.lightIconType as LightIconType)
        : undefined,
  };
}

export function validateSvg(input: string): { ok: true; svg: string } | { ok: false; error: string } {
  const trimmed = input.trim();
  if (!trimmed) return { ok: false, error: "empty input" };
  if (trimmed.length > MAX_SVG_SIZE) {
    return { ok: false, error: "SVG exceeds the 1 MB size limit" };
  }
  if (typeof DOMParser === "undefined" || typeof XMLSerializer === "undefined") {
    return { ok: false, error: "SVG validation is unavailable in this environment" };
  }

  const svgDocument = new DOMParser().parseFromString(trimmed, "image/svg+xml");
  if (svgDocument.querySelector("parsererror")) {
    return { ok: false, error: "SVG is not valid XML" };
  }
  if (svgDocument.doctype) {
    return { ok: false, error: "SVG document types are not allowed" };
  }
  if (
    svgDocument.documentElement?.localName.toLowerCase() !== "svg" ||
    svgDocument.documentElement.prefix
  ) {
    return { ok: false, error: "document root must be <svg>" };
  }

  const elements = Array.from(svgDocument.querySelectorAll("*"));
  if (elements.length > MAX_SVG_ELEMENTS) {
    return { ok: false, error: "SVG exceeds the element limit" };
  }

  let attributeCount = 0;
  for (const element of elements) {
    if (element.prefix || !SAFE_SVG_ELEMENTS.has(element.localName.toLowerCase())) {
      element.remove();
      continue;
    }

    for (const attribute of Array.from(element.attributes)) {
      attributeCount += 1;
      if (attributeCount > MAX_SVG_ATTRIBUTES) {
        return { ok: false, error: "SVG exceeds the attribute limit" };
      }

      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim();
      const isUrlAttribute = name === "href" || name === "xlink:href" || name === "src";
      if (
        name.startsWith("on") ||
        name === "style" ||
        name === "srcset" ||
        value.includes("\\") ||
        (isUrlAttribute && !isSafeSvgReference(value)) ||
        !hasOnlyLocalUrlReferences(value)
      ) {
        element.removeAttribute(attribute.name);
      }
    }
  }

  removeOpaqueNodes(svgDocument);
  const svg = new XMLSerializer().serializeToString(svgDocument.documentElement);
  if (svg.length > MAX_SVG_SIZE) {
    return { ok: false, error: "SVG exceeds the 1 MB size limit after parsing" };
  }
  return { ok: true, svg };
}

/**
 * Parse a floorplan SVG and extract the list of floor names it contains.
 * The editor wraps each floor in `<g data-floor="...">`. Returns the
 * floors in the order they appear in the SVG. Empty list if the SVG
 * has no data-floor groups (legacy single-floor SVGs).
 */
export function extractFloors(svg: string): string[] {
  const result: string[] = [];
  const regex = /<g\b[^>]*\bdata-floor\s*=\s*"([^"]*)"/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(svg)) !== null) {
    const name = match[1];
    if (name && !result.includes(name)) result.push(name);
  }
  return result;
}

/**
 * Return a filtered SVG containing only the named floors. If `visibleFloors`
 * is null or the SVG has no data-floor groups, returns the input unchanged.
 */
export function filterFloors(svg: string, visibleFloors: Set<string> | null): string {
  if (!visibleFloors) return svg;
  const floors = extractFloors(svg);
  if (floors.length === 0) return svg;
  // Remove any <g data-floor="X">...</g> whose X isn't in visibleFloors.
  // Need balanced tag matching since groups can contain nested groups.
  return removeFloorsExcept(svg, visibleFloors);
}

export interface RoomGeometry {
  zone: string;
  x: number;
  y: number;
  w: number;
  h: number;
  cx: number;
  cy: number;
  floor: string | null;
}

/**
 * Parse the imported floorplan SVG and return one entry per `<g data-zone>`
 * group with its room rect translated into the SVG root's coordinate system
 * (accounts for parent floor translate offsets).
 */
export function parseRooms(svg: string): RoomGeometry[] {
  if (typeof DOMParser === "undefined") return [];
  const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
  const result: RoomGeometry[] = [];
  doc.querySelectorAll("g[data-zone]").forEach((g) => {
    const zone = g.getAttribute("data-zone");
    if (!zone) return;

    // Prefer data-bbox (editor's compound-room hint); fall back to the
    // first <rect> for simple rectangular rooms.
    let x = 0, y = 0, w = 0, h = 0;
    const bboxAttr = g.getAttribute("data-bbox");
    if (bboxAttr) {
      const parts = bboxAttr.split(",").map(parseFloat);
      if (parts.length === 4 && parts.every(Number.isFinite)) {
        [x, y, w, h] = parts as [number, number, number, number];
      }
    } else {
      const rect = g.querySelector("rect");
      if (!rect) return;
      x = parseFloat(rect.getAttribute("x") ?? "0");
      y = parseFloat(rect.getAttribute("y") ?? "0");
      w = parseFloat(rect.getAttribute("width") ?? "0");
      h = parseFloat(rect.getAttribute("height") ?? "0");
    }
    if (w <= 0 || h <= 0) return;

    let offsetX = 0;
    let offsetY = 0;
    let floor: string | null = null;
    let parent = g.parentElement;
    while (parent) {
      const t = parent.getAttribute("transform");
      if (t) {
        const m = /translate\(\s*(-?\d*\.?\d+)\s*[,\s]\s*(-?\d*\.?\d+)?/.exec(t);
        if (m) {
          offsetX += parseFloat(m[1]!);
          if (m[2]) offsetY += parseFloat(m[2]);
        }
      }
      const dataFloor = parent.getAttribute("data-floor");
      if (dataFloor && !floor) floor = dataFloor;
      parent = parent.parentElement;
    }
    result.push({
      zone,
      x: x + offsetX,
      y: y + offsetY,
      w,
      h,
      cx: x + offsetX + w / 2,
      cy: y + offsetY + h / 2,
      floor,
    });
  });
  return result;
}

/** Extract the viewBox string from an SVG so an overlay can match it. */
export function getViewBox(svg: string): string {
  const m = /<svg\b[^>]*\bviewBox\s*=\s*"([^"]*)"/i.exec(svg);
  return m ? m[1]! : "0 0 100 70";
}

function removeFloorsExcept(svg: string, keep: Set<string>): string {
  let out = svg;
  const openRegex = /<g\b[^>]*\bdata-floor\s*=\s*"([^"]*)"[^>]*>/i;
  while (true) {
    const open = openRegex.exec(out);
    if (!open) break;
    const name = open[1] ?? "";
    const startIdx = open.index;
    const headerEnd = startIdx + open[0].length;
    const isSelfClosing = /\/\s*>$/.test(open[0]);
    if (keep.has(name)) {
      // Replace the attribute so we don't re-match, but keep the group.
      const replaced = open[0].replace(/data-floor="[^"]*"/i, `data-floor-kept="${name}"`);
      out = out.slice(0, startIdx) + replaced + out.slice(headerEnd);
      continue;
    }
    if (isSelfClosing) {
      out = out.slice(0, startIdx) + out.slice(headerEnd);
      continue;
    }
    // Find the matching </g> by counting nesting depth.
    let depth = 1;
    let i = headerEnd;
    const tagRegex = /<g\b[^>]*\/?>|<\/g\s*>/gi;
    tagRegex.lastIndex = headerEnd;
    let tag: RegExpExecArray | null;
    while ((tag = tagRegex.exec(out)) !== null && depth > 0) {
      if (tag[0].startsWith("</")) {
        depth--;
      } else if (!/\/\s*>$/.test(tag[0])) {
        depth++;
      }
      i = tagRegex.lastIndex;
    }
    out = out.slice(0, startIdx) + out.slice(i);
  }
  // Restore the marker attribute name we used to skip the kept groups.
  return out.replace(/data-floor-kept=/gi, "data-floor=");
}
