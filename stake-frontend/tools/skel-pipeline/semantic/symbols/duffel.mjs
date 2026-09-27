/**
 * DUFFEL — semantic layers cut from the existing art (no redraw).
 *
 *   glow · interior (painted dark bag inside) · pop_note_1..2 · pop_coin_1..3
 *   (hidden loot that bursts out) · loot (cash / coins / gems in the opening)
 *   · pocket_in (painted pocket inside) · pocket_loot · bag · zipper_pull ·
 *   handle
 *
 * Everything a moving part can uncover is painted: the bag's dark interior
 * under the loot, the pocket's inside, the bag surface behind the zipper tab.
 * Loot and pocket bills are EXTENDED below the rim they sit behind (smeared
 * into shadow), so lifting them never shows a hard cut. The handle is cut on
 * a HORIZONTAL line and only ever scales about that line, so its join with the
 * bag never opens. (The shoulder strap stays on the bag: it shares the shaded
 * underside's colour with a 5-10px gap, and a clean cut would mean repainting
 * the bag bottom for a few pixels of motion.)
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  load, standardCanvas, glowFrom, pathMask, polyPath, applyMask, alphaMask, maskNew,
  svgRaster, over, blank, diffuseFill, maskDilate, keepLarge,
} from "../img.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, "../../../../public/assets/symbols/duffel.webp");
const INK = "#0b1413";

// source-px geometry (512x502)
const LOOT_POLY = [[62, 168], [70, 146], [100, 127], [124, 120], [150, 126], [168, 119], [195, 110], [232, 102],
  [252, 92], [284, 80], [320, 90], [338, 88], [362, 71], [398, 64], [432, 92], [440, 120], [428, 142],
  [400, 152], [370, 162], [336, 176], [302, 189], [262, 198], [232, 203], [200, 205], [140, 204], [100, 200],
  [75, 195], [62, 186]];
// the three gems (source boxes): white / pale-blue pixels count as loot only here
const GEMS = [[146, 146, 212, 200], [260, 104, 324, 164], [320, 126, 374, 180]];
// front lip of the opening (zipper line), left -> right
const ZIP = [[70, 196], [100, 202], [140, 205], [200, 206], [232, 204], [262, 199], [302, 190], [336, 177], [370, 162], [402, 152], [440, 137]];
// back rim of the opening (hidden behind the loot)
const BACK = [[80, 168], [120, 146], [170, 126], [230, 108], [300, 100], [360, 106], [420, 122], [440, 132]];
const POCKET_POLY = [[278, 290], [284, 240], [340, 212], [352, 203], [376, 206], [404, 226], [406, 264], [340, 277], [300, 287]];
const POCKET_RIM = [[280, 287], [300, 285], [330, 276], [360, 270], [404, 263]];
const PULL_POLY = [[62, 200], [84, 190], [100, 204], [96, 228], [82, 246], [64, 244], [58, 222]];
const HANDLE_CUT = 78, HANDLE_X = [180, 346];

const lumOf = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;
/** Colour classes of this art (dark straps, bright bag teal, bill green…). */
function cls(r, g, b, a) {
  if (a < 40) return "none";
  const L = lumOf(r, g, b), sat = Math.max(r, g, b) - Math.min(r, g, b);
  if (L < 38) return "ink";
  if (g - r > 25 && b - r > 25 && L < 115) return "strap";
  if (g - r > 40 && b - r > 40) return "teal";
  if (g > r + 25 && g > b + 25) return "green";
  if (r > 150 && g > 120 && b < 110 && r >= g - 20) return "gold";
  if (sat < 28 && L > 150) return "white";
  if (L > 150 && b >= r) return "cyan";
  return "other";
}

function lineY(pts, x) {
  if (x <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    if (x <= pts[i][0]) {
      const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
      return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
    }
  }
  return pts[pts.length - 1][1];
}

/** Extend a cut-out's pixels downward below its lowest row per column,
 *  darkening into the bag's shadow — hidden at rest, revealed on a lift. */
function extendDown(r, mask, depth) {
  const out = { w: r.w, h: r.h, data: new Uint8ClampedArray(r.data) };
  const L = (i) => 0.299 * r.data[i] + 0.587 * r.data[i + 1] + 0.114 * r.data[i + 2];
  for (let x = 0; x < r.w; x++) {
    let low = -1;
    for (let y = r.h - 1; y >= 0; y--) if (mask.a[y * r.w + x] > 0.5 && r.data[(y * r.w + x) * 4 + 3] > 200) { low = y; break; }
    if (low < 0) continue;
    // sample the loot's own colour just above its (ink) bottom edge
    let src = low;
    for (let y = low; y >= Math.max(0, low - 9); y--) {
      const i = (y * r.w + x) * 4;
      if (mask.a[y * r.w + x] > 0.5 && L(i) > 55) { src = y; break; }
    }
    for (let k = 1; k <= depth && low + k < r.h; k++) {
      const si = ((src - (k % 4)) * r.w + x) * 4;
      const dst = ((low + k) * r.w + x) * 4;
      const t = Math.pow(1 - k / (depth + 2), 2.4);   // falls off into the bag's shadow
      out.data[dst] = r.data[si] * t * 0.85 + 13 * (1 - t);
      out.data[dst + 1] = r.data[si + 1] * t * 0.9 + 27 * (1 - t);
      out.data[dst + 2] = r.data[si + 2] * t * 0.9 + 28 * (1 - t);
      out.data[dst + 3] = 255;
    }
  }
  return out;
}

function noteSvg(id) {
  return `<g><rect x="0" y="0" width="120" height="56" rx="4" fill="#79c85a" stroke="${INK}" stroke-width="4"/>
    <rect x="7" y="7" width="106" height="42" rx="2" fill="none" stroke="#3f8f33" stroke-width="2.4"/>
    <circle cx="60" cy="28" r="14" fill="#a9e28a" stroke="#3f8f33" stroke-width="2.4"/>
    <circle cx="60" cy="28" r="6" fill="#3f8f33"/>
    <rect x="12" y="11" width="14" height="8" rx="2" fill="#3f8f33"/><rect x="94" y="37" width="14" height="8" rx="2" fill="#3f8f33"/>
    <rect x="44" y="0" width="16" height="56" fill="#f1e6c2" stroke="${INK}" stroke-width="3"/></g>`;
}
function coinSvg() {
  return `<g><ellipse cx="0" cy="0" rx="22" ry="20" fill="#c89a12" stroke="${INK}" stroke-width="4"/>
    <ellipse cx="-2" cy="-2" rx="17" ry="15" fill="#ffd93b"/><ellipse cx="-2" cy="-2" rx="11" ry="9.5" fill="none" stroke="#c89a12" stroke-width="2.5"/>
    <path d="M-12,-9 A14,12 0 0 1 4,-15" stroke="#fff6c0" stroke-width="3" fill="none" stroke-linecap="round"/></g>`;
}
const POPS = [
  { name: "pop_note_1", kind: "note", x: 150, y: 170, ang: -24 },
  { name: "pop_note_2", kind: "note", x: 300, y: 150, ang: 18 },
  { name: "pop_coin_1", kind: "coin", x: 200, y: 175 },
  { name: "pop_coin_2", kind: "coin", x: 262, y: 168 },
  { name: "pop_coin_3", kind: "coin", x: 350, y: 150 },
];
function popSvg(p) {
  if (p.kind === "coin") return `<g transform="translate(${p.x},${p.y})">${coinSvg()}</g>`;
  return `<g transform="translate(${p.x},${p.y}) rotate(${p.ang}) translate(-60,-28)">${noteSvg(p.name)}</g>`;
}

export async function build() {
  const src = await load(SRC);
  const sc = await standardCanvas(src);
  const { body, cw, ch } = sc;
  const [tx, ty] = sc.map(0, 0);
  const S = sc.scale;
  const M = (p) => sc.map(p[0], p[1]);
  const Mp = (arr) => arr.map(M);
  const wrap = (inner) => `<svg xmlns="http://www.w3.org/2000/svg" width="${cw}" height="${ch}" viewBox="0 0 ${cw} ${ch}"><g transform="matrix(${S} 0 0 ${S} ${tx} ${ty})">${inner}</g></svg>`;
  const bodyA = alphaMask(body);
  // canvas-space helpers
  const toSrc = (x, y) => [(x - tx) / S, (y - ty) / S];
  const binary = (m) => ({ w: m.w, h: m.h, a: m.a.map((v) => (v >= 0.5 ? 1 : 0)) });
  const px = (x, y) => { const i = (y * cw + x) * 4; return [body.data[i], body.data[i + 1], body.data[i + 2], body.data[i + 3]]; };

  // class of every canvas pixel
  const klass = new Array(cw * ch);
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) klass[y * cw + x] = cls(...px(x, y));
  // straps = the LARGE dark-teal bands (gem facets have small teal specks)
  const strapRaw = maskNew(cw, ch);
  for (let k = 0; k < strapRaw.a.length; k++) if (klass[k] === "strap") strapRaw.a[k] = 1;
  const straps = maskDilate(keepLarge(strapRaw, 600), 2);
  const inGem = (sx, sy) => GEMS.some(([x0, y0, x1, y1]) => sx >= x0 && sx <= x1 && sy >= y0 && sy <= y1);

  // ── loot: inside the opening outline, above the zipper, not a strap ──
  const lootPoly = binary(await pathMask(polyPath(Mp(LOOT_POLY)), cw, ch));
  let loot = maskNew(cw, ch);
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
    const k = y * cw + x;
    if (!lootPoly.a[k] || bodyA.a[k] < 0.05 || straps.a[k]) continue;
    const [sx, sy] = toSrc(x, y);
    if (sy > lineY(ZIP, sx) - 3) continue;       // zipper + lip belong to the bag
    const c = klass[k];
    if (c === "green" || c === "gold" || c === "other" || c === "ink") loot.a[k] = 1;
    else if ((c === "white" || c === "cyan" || c === "teal") && inGem(sx, sy)) loot.a[k] = 1;
  }
  loot = keepLarge(loot, 60);
  // ── pocket bills ──
  const pocketPoly = binary(await pathMask(polyPath(Mp(POCKET_POLY)), cw, ch));
  let pocket = maskNew(cw, ch);
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
    const k = y * cw + x;
    if (!pocketPoly.a[k] || bodyA.a[k] < 0.05 || straps.a[k]) continue;
    const [sx, sy] = toSrc(x, y);
    if (sy > lineY(POCKET_RIM, sx) - 2) continue;
    const c = klass[k];
    if (c === "green" || c === "other" || c === "ink" || c === "gold") pocket.a[k] = 1;
  }
  pocket = keepLarge(pocket, 60);
  // ── handle: everything above the horizontal cut, between the straps ──
  const handle = maskNew(cw, ch);
  const [hx0] = M([HANDLE_X[0], 0]), [hx1] = M([HANDLE_X[1], 0]);
  const [, hcut] = M([0, HANDLE_CUT]);
  for (let y = 0; y < Math.round(hcut); y++) for (let x = Math.round(hx0); x < Math.round(hx1); x++) {
    const k = y * cw + x;
    if (bodyA.a[k] > 0.01 && !loot.a[k]) handle.a[k] = 1;
  }
  // ── zipper pull ──
  const pull = binary(await pathMask(polyPath(Mp(PULL_POLY)), cw, ch));
  for (let k = 0; k < pull.a.length; k++) if (bodyA.a[k] < 0.05) pull.a[k] = 0;

  const cutAll = maskNew(cw, ch);
  for (let k = 0; k < cutAll.a.length; k++) cutAll.a[k] = Math.max(loot.a[k], pocket.a[k], handle.a[k], pull.a[k]);

  // ── the bag: original minus the cut parts; the zipper tab's footprint is
  //    inpainted from the bag around it (it swings, revealing a sliver) ──
  let bag = applyMask(body, { w: cw, h: ch, a: cutAll.a.map((v) => 1 - v) });
  const pullHole = maskDilate(pull, 1);
  const bagFilled = diffuseFill(body, { w: cw, h: ch, a: pullHole.a.map((v, i) => (v ? 1 : 0)) }, 300);
  const pullUnder = applyMask(bagFilled, pullHole);
  const bagTmp = blank(cw, ch);
  over(bagTmp, pullUnder);
  over(bagTmp, bag);
  bag = bagTmp;

  // ── painted insides: the bag's interior under the loot, the pocket's inside ──
  const opening = [...ZIP.map(([x, y]) => [x, y + 2]).reverse(), ...BACK];
  const interiorSvg = `<defs><linearGradient id="gi" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0d1a1b"/><stop offset="1" stop-color="#1c3436"/></linearGradient></defs>
    <polygon points="${opening.map(([x, y]) => `${x},${y}`).join(" ")}" fill="url(#gi)"/>`;
  let interior = await svgRaster(wrap(interiorSvg), cw, ch);
  const opaque = { w: cw, h: ch, a: bodyA.a.map((v) => (v > 0.98 ? 1 : 0)) };
  interior = applyMask(interior, opaque);
  const pocketInSvg = `<polygon points="${[...POCKET_POLY].map(([x, y]) => `${x},${y}`).join(" ")}" fill="#12292a"/>`;
  let pocketIn = await svgRaster(wrap(pocketInSvg), cw, ch);
  pocketIn = applyMask(pocketIn, { w: cw, h: ch, a: pocket.a.map((v, i) => (opaque.a[i] ? 1 : 0)) });

  // cut-outs, extended into shadow below their rims (hidden at rest)
  const lootR = extendDown(applyMask(body, loot), loot, Math.round(18 * S));
  const pocketR = extendDown(applyMask(body, pocket), pocket, Math.round(14 * S));
  const handleR = applyMask(body, handle);
  const pullR = applyMask(body, pull);

  const pops = [];
  for (const p of POPS) pops.push({ name: p.name, raster: await svgRaster(wrap(popSvg(p)), cw, ch) });

  const glow = await glowFrom(body, [120, 220, 230]);
  const layers = [
    { name: "glow", raster: glow },
    { name: "interior", raster: interior },
    ...pops,
    { name: "loot", raster: lootR },
    { name: "pocket_in", raster: pocketIn },
    { name: "pocket_loot", raster: pocketR },
    { name: "bag", raster: bag },
    { name: "zipper_pull", raster: pullR },
    { name: "handle", raster: handleR },
  ];

  const toSpine = ([x, y]) => [+(x - cw / 2).toFixed(2), +(ch / 2 - y).toFixed(2)];
  const floor = M([256, 470]);          // where the bag sits: squash anchor
  const lootC = M([260, 150]);
  const pivots = {
    glow: [cw / 2, ch / 2],
    interior: lootC, loot: lootC,
    pocket_in: M([345, 262]), pocket_loot: M([345, 262]),
    bag: floor,
    zipper_pull: M([80, 198]),
    handle: M([262, HANDLE_CUT]),
  };
  for (const p of POPS) pivots[p.name] = M([p.x, p.y]);
  const children = ["glow", "interior", "loot", "pocket_in", "pocket_loot", "bag", "zipper_pull", "handle", ...POPS.map((p) => p.name)];
  const rig = {
    groups: [{ name: "bagroot", parent: "symbol_anchor", pivot: floor }],
    parents: Object.fromEntries(children.map((c) => [c, "bagroot"])),
    hidden: POPS.map((p) => p.name),
  };
  const meta = {
    floor: toSpine(floor),
    loot: toSpine(lootC),
    pops: POPS.map((p) => ({ name: p.name, kind: p.kind, at: toSpine(M([p.x, p.y])) })),
  };
  return { canvas: [cw, ch], art: [sc.aw, sc.ah], layers, pivots, rig, meta, checkAgainst: body };
}
