/**
 * AMMO — re-authored as vector art, one complete cartridge per layer.
 *
 * The old ammo.webp was soft and toy-like next to the rest of the set (no ink
 * outline, blurry pink/cyan rims) and its four overlapping rounds could not be
 * cut apart without holes. Each cartridge here is drawn whole — case, rim,
 * extractor groove, head/primer, nickel bullet — in the set's cel-shaded,
 * heavy-outline style, so every round can hop, rattle and scatter on its own.
 *
 * Also writes the flattened rest pose as the new static symbol art
 * (public/assets/symbols/ammo.webp), which the reel strip and paytable use.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { svgRaster, standardCanvas, glowFrom, blank, over, bbox, crop, saveWebp } from "../img.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STATIC_OUT = path.resolve(HERE, "../../../../public/assets/symbols/ammo.webp");

// Source composition space.
const SW = 560, SH = 480;

const INK = "#0b0806";

/** One 9mm round, authored along +x (base at x=0), centred on y=0. */
function cartridgeSvg(id, { L, r, base = true }) {
  const Lc = L * 0.6;           // case length
  const rim = r * 1.05;
  const grooveA = Lc * 0.075, grooveB = Lc * 0.13;
  const bx = Lc - r * 0.35;     // bullet starts a touch inside the case mouth
  const tip = L;
  const og = `M${bx},${-r * 0.93} C${bx + (tip - bx) * 0.55},${-r * 0.95} ${tip - (tip - bx) * 0.08},${-r * 0.42} ${tip},0 `
    + `C${tip - (tip - bx) * 0.08},${r * 0.42} ${bx + (tip - bx) * 0.55},${r * 0.95} ${bx},${r * 0.93} Z`;
  const brass = `<linearGradient id="br${id}" x1="0" y1="${-rim}" x2="0" y2="${rim}" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#4a2e06"/><stop offset="0.07" stop-color="#8f5f14"/>
      <stop offset="0.1" stop-color="#e3ab42"/><stop offset="0.2" stop-color="#ffe9a6"/>
      <stop offset="0.3" stop-color="#ffe9a6"/><stop offset="0.3" stop-color="#f4c65c"/>
      <stop offset="0.58" stop-color="#d49532"/><stop offset="0.58" stop-color="#b17219"/>
      <stop offset="0.86" stop-color="#8a5310"/><stop offset="1" stop-color="#3f2503"/>
    </linearGradient>`;
  const nickel = `<linearGradient id="ni${id}" x1="0" y1="${-r}" x2="0" y2="${r}" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#2c3338"/><stop offset="0.09" stop-color="#7f8b92"/>
      <stop offset="0.16" stop-color="#ffffff"/><stop offset="0.3" stop-color="#f1f6f8"/>
      <stop offset="0.3" stop-color="#c3cdd3"/><stop offset="0.56" stop-color="#9aa6ad"/>
      <stop offset="0.56" stop-color="#66727a"/><stop offset="0.86" stop-color="#434d54"/>
      <stop offset="0.93" stop-color="#7fb8c9"/><stop offset="1" stop-color="#1c2226"/>
    </linearGradient>`;
  const head = `<radialGradient id="hd${id}" cx="0.42" cy="0.36" r="0.8">
      <stop offset="0" stop-color="#ffe29a"/><stop offset="0.45" stop-color="#e0a33c"/>
      <stop offset="0.8" stop-color="#a86a16"/><stop offset="1" stop-color="#6b420a"/>
    </radialGradient>
    <radialGradient id="pr${id}" cx="0.4" cy="0.35" r="0.8">
      <stop offset="0" stop-color="#fff6d8"/><stop offset="0.5" stop-color="#d7b074"/><stop offset="1" stop-color="#8d6428"/>
    </radialGradient>`;
  const ex = r * 0.44;           // base ellipse half-width (3/4 view of the head)
  let g = `<path d="${og}" fill="url(#ni${id})" stroke="${INK}" stroke-width="5" stroke-linejoin="round"/>`;
  // specular streak along the bullet
  g += `<path d="M${bx + (tip - bx) * 0.12},${-r * 0.56} C${bx + (tip - bx) * 0.5},${-r * 0.6} ${tip - (tip - bx) * 0.25},${-r * 0.38} ${tip - (tip - bx) * 0.12},${-r * 0.2}" fill="none" stroke="#ffffff" stroke-width="${r * 0.12}" stroke-linecap="round" stroke-opacity="0.9"/>`;
  // case body, groove, rim
  g += `<rect x="${grooveB}" y="${-r}" width="${Lc - grooveB}" height="${2 * r}" fill="url(#br${id})" stroke="${INK}" stroke-width="5" stroke-linejoin="round"/>`;
  g += `<line x1="${Lc - 5}" y1="${-r + 4}" x2="${Lc - 5}" y2="${r - 4}" stroke="#6b420a" stroke-width="2.4" stroke-opacity="0.8"/>`;
  g += `<rect x="${grooveA}" y="${-r * 0.86}" width="${grooveB - grooveA}" height="${1.72 * r}" fill="#5b3806" stroke="${INK}" stroke-width="4"/>`;
  g += `<rect x="0" y="${-rim}" width="${grooveA}" height="${2 * rim}" rx="2" fill="url(#br${id})" stroke="${INK}" stroke-width="5"/>`;
  // long brass highlight streak + a cool reflected rim light along the belly
  g += `<line x1="${grooveB + 10}" y1="${-r * 0.5}" x2="${Lc - 16}" y2="${-r * 0.5}" stroke="#fffbe8" stroke-width="${r * 0.1}" stroke-linecap="round" stroke-opacity="0.85"/>`;
  g += `<line x1="${grooveB + 8}" y1="${r * 0.8}" x2="${Lc - 10}" y2="${r * 0.8}" stroke="#ffd98a" stroke-width="${r * 0.07}" stroke-linecap="round" stroke-opacity="0.55"/>`;
  if (base) {
    g += `<ellipse cx="0" cy="0" rx="${ex}" ry="${rim}" fill="url(#hd${id})" stroke="${INK}" stroke-width="5"/>`;
    g += `<ellipse cx="0" cy="0" rx="${ex * 0.78}" ry="${rim * 0.8}" fill="none" stroke="#6b420a" stroke-width="2.2" stroke-opacity="0.8"/>`;
    g += `<ellipse cx="${-ex * 0.05}" cy="0" rx="${ex * 0.34}" ry="${rim * 0.34}" fill="url(#pr${id})" stroke="${INK}" stroke-width="3.2"/>`;
    g += `<path d="M${-ex * 0.55},${-rim * 0.5} A${ex * 0.7},${rim * 0.7} 0 0 1 ${ex * 0.25},${-rim * 0.72}" fill="none" stroke="#fff5cf" stroke-width="3" stroke-linecap="round" stroke-opacity="0.85"/>`;
  }
  return { defs: brass + nickel + head, body: g };
}

// The pile, back to front. x, y = base centre in source space; ang in degrees
// (SVG, clockwise-positive); base = head visible (points away from the viewer).
const ROUNDS = [
  { name: "round_stand", x: 356, y: 352, ang: -101, L: 312, r: 60, base: false },  // standing at the back, tip up
  { name: "round_back", x: 528, y: 336, ang: -172, L: 296, r: 62, base: true },     // lying back right, head to us, tip left
  { name: "round_mid", x: 76, y: 128, ang: 24, L: 318, r: 64, base: true },        // middle, tip down-right
  { name: "round_front", x: 44, y: 318, ang: 11, L: 338, r: 68, base: true },      // front, tip right
];

function roundSvg(rd, i, withShadow = true) {
  const c = cartridgeSvg(i, rd);
  // soft contact shadow beneath each round travels with it (kept subtle)
  const sh = withShadow
    ? `<g transform="translate(${rd.x + 6},${rd.y + 10}) rotate(${rd.ang})" filter="url(#soft)" opacity="0.38">
         <rect x="${-rd.r * 0.2}" y="${-rd.r * 0.9}" width="${rd.L * 0.95}" height="${rd.r * 1.9}" rx="${rd.r * 0.9}" fill="#000"/></g>`
    : "";
  return `<defs>${c.defs}<filter id="soft" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="7"/></filter></defs>
    ${sh}<g transform="translate(${rd.x},${rd.y}) rotate(${rd.ang})">${c.body}</g>`;
}

const svgDoc = (inner, w = SW, h = SH, tf = "") =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><g transform="${tf}">${inner}</g></svg>`;

export async function build() {
  // 1) flattened art in source space -> the standard canvas mapping
  const flatSrc = await svgRaster(svgDoc(ROUNDS.map((rd, i) => roundSvg(rd, i)).join("")), SW, SH);
  const sc = await standardCanvas(flatSrc);
  const { cw, ch } = sc;
  const [tx, ty] = sc.map(0, 0);
  const S = sc.scale;
  const tf = `matrix(${S} 0 0 ${S} ${tx} ${ty})`;
  // 2) every round rendered alone at canvas resolution (complete, no holes)
  const layers = [];
  const rounds = [];
  for (let i = 0; i < ROUNDS.length; i++) {
    const r = await svgRaster(svgDoc(roundSvg(ROUNDS[i], i), cw, ch, tf), cw, ch);
    rounds.push(r);
  }
  const body = blank(cw, ch);
  for (const r of rounds) over(body, r);
  layers.push({ name: "glow", raster: await glowFrom(body, [255, 200, 110]) });
  ROUNDS.forEach((rd, i) => layers.push({ name: rd.name, raster: rounds[i] }));

  // static symbol art (reel strip / paytable) = the rest pose, 512px long edge
  const bb = bbox(body);
  const art = crop(body, bb);
  await saveWebp(art, STATIC_OUT, false);

  const M = (x, y) => sc.map(x, y);
  const centre = (rd) => {
    const a = (rd.ang * Math.PI) / 180;
    return M(rd.x + Math.cos(a) * rd.L * 0.5, rd.y + Math.sin(a) * rd.L * 0.5);
  };
  const pivots = { glow: [cw / 2, ch / 2] };
  for (const rd of ROUNDS) pivots[rd.name] = centre(rd);
  const toSpine = ([x, y]) => [+(x - cw / 2).toFixed(2), +(ch / 2 - y).toFixed(2)];
  const meta = {
    rounds: ROUNDS.map((rd) => ({
      name: rd.name,
      centre: toSpine(centre(rd)),
      // long-axis angle in Spine space (CCW positive, y up)
      axis: -rd.ang,
      length: +(rd.L * S).toFixed(1),
      standing: rd.base === false,
    })),
  };
  return { canvas: [cw, ch], art: [sc.aw, sc.ah], layers, pivots, rig: {}, meta };
}
