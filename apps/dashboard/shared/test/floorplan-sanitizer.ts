import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { normalizeFloorplan, validateSvg } from "../src/floorplan.js";

const window = new JSDOM().window;
Object.assign(globalThis, {
  DOMParser: window.DOMParser,
  XMLSerializer: window.XMLSerializer,
});

function sanitized(input: string): string {
  const result = validateSvg(input);
  assert.equal(result.ok, true, result.ok ? undefined : result.error);
  return result.svg;
}

const safe = sanitized(`
  <svg xmlns="http://www.w3.org/2000/svg">
    <defs><linearGradient id="shade"><stop offset="0"/></linearGradient></defs>
    <rect fill="url(#shade)"/>
    <use href="#room-symbol"/>
  </svg>
`);
assert.match(safe, /fill="url\(#shade\)"/);
assert.match(safe, /href="#room-symbol"/);

const hostile = sanitized(`
  <svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)">
    <script>alert(1)</script>
    <foreignObject><img src="x" onerror="alert(1)"/></foreignObject>
    <image href="https://attacker.example/pixel.svg"/>
    <img srcset="https://attacker.example/pixel 1x"/>
    <use href="javascript:alert(1)"/>
    <rect style="fill: url(data:image/svg+xml,evil)" fill="url(https://attacker.example/paint)" stroke="u\\rl(https://attacker.example/escaped)"/>
  </svg>
`);
assert.doesNotMatch(hostile, /<script\b|<foreignobject\b|onload=|onerror=/i);
assert.doesNotMatch(hostile, /https:|javascript:|data:|style=|srcset=/i);

const commented = sanitized(`<svg><g data-floor="bad"><!--</g><image href="https://attacker.example/pixel"/>--></g></svg>`);
assert.doesNotMatch(commented, /<!--|https:/, "comments cannot be reactivated by floor filtering");

const stored = normalizeFloorplan({ svg: `<svg><script>alert(1)</script><rect/></svg>`, placements: [] });
assert.doesNotMatch(stored.svg, /<script\b/i, "stored SVG is sanitized before rendering");

assert.equal(validateSvg("<svg><rect></svg>").ok, false, "malformed XML is rejected");
assert.equal(validateSvg("<html></html>").ok, false, "non-SVG roots are rejected");
assert.equal(validateSvg("<s:svg xmlns:s=\"http://www.w3.org/2000/svg\"><s:rect/></s:svg>").ok, false, "prefixed SVG roots are rejected");
assert.equal(validateSvg("<!DOCTYPE svg [<!ENTITY x 'large'>]><svg>&x;</svg>").ok, false, "document types are rejected");
assert.doesNotMatch(
  sanitized(`<svg><rect fill="${"url(".repeat(40_000)}"/></svg>`),
  /fill=/,
  "unterminated URL functions are removed without regex backtracking",
);
assert.equal(validateSvg(`<svg>${"<g/>".repeat(10_001)}</svg>`).ok, false, "element limit is enforced");

console.log("OK — floorplan SVG sanitizer assertions passed");
