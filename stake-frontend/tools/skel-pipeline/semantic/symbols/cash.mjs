/**
 * CASH — a fan of real banknotes held in a gold money clip (premium tier).
 *
 * Built from the game's own currency art, public/assets/real_bill.webp (the
 * engraved "United States of Los Santos" $1000 note the cash-rain effects
 * already throw), so the symbol is real money — not a drawn box. Each note is
 * upscaled with a sharpening pass, given a slight paper curl + cylindrical
 * shading, and wrapped in the set's ink outline so it sits with the other
 * cel-shaded symbols.
 *
 *   glow · bill_0..bill_4 (the fan, back to front, pivoting at the clip) ·
 *   throw_0..throw_3 (hidden copies lying exactly on the front note — the ones
 *   peeled off and thrown) · clip
 *
 * Flattened rest pose is written as the static reel art (cash.webp).
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  load, sharp, bbox, crop, blank, over, alphaMask, maskDilate, maskBlur, fillMask, svgRaster,
  standardCanvas, glowFrom, saveWebp,
} from "../img.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BILL_SRC = path.resolve(HERE, "../../../../public/assets/real_bill.webp");
const STATIC_OUT = path.resolve(HERE, "../../../../public/assets/symbols/cash.webp");

// Composition space (source px). The fan pivots at the clip.
const SW = 760, SH = 560;
const PIVOT = [380, 470];
const BILL_L = 360;                      // note length (its long side)
// degrees from vertical; slightly uneven, like a fan spread by hand
const FAN = [-54, -27, 1, 26, 53];
const NUDGE = [[-3, 4], [2, -2], [0, 0], [-2, 3], [3, -1]];   // px: notes never sit perfectly square
const ORDER = [0, 4, 1, 3, 2];           // draw outer notes first, the centre note in front
const THROWS = 4;
const PINCH = 0.09;                      // note end below the pivot (fraction of L) — hidden by the clip

/** The note, prepared once: upscaled, sharpened, curled, shaded, outlined.
 *  Returned as a PNG buffer oriented long-side horizontal. */
async function preparedBill() {
  const raw = await load(BILL_SRC);
  const bill = crop(raw, bbox(raw, 20));
  const S = 3;
  const W = bill.w * S, H = bill.h * S;
  const up = await sharp(Buffer.from(bill.data.buffer), { raw: { width: bill.w, height: bill.h, channels: 4 } })
    .resize(W, H, { kernel: "lanczos3" })
    .sharpen({ sigma: 1.1, m1: 0.6, m2: 1.4 })
    // the scan is a little grey next to the set's saturated palette
    .modulate({ saturation: 1.3, brightness: 1.04 })
    .linear(1.08, -8)
    .raw().toBuffer();
  // paper curl: the long axis bows (centre raised), with cylinder shading and
  // a soft specular band where the curve faces the sun
  const pad = 14 * S, bend = 7 * S;
  const OW = W + pad * 2, OH = H + pad * 2;
  const out = blank(OW, OH);
  for (let y = 0; y < OH; y++) {
    for (let x = 0; x < OW; x++) {
      const u = (x - pad) / W;                         // 0..1 along the note
      if (u < 0 || u > 1) continue;
      const lift = bend * (1 - (2 * u - 1) ** 2);
      const sy = y - pad + lift;
      if (sy < 0 || sy >= H - 1) continue;
      const y0 = Math.floor(sy), t = sy - y0;
      const i0 = (y0 * W + (x - pad)) * 4, i1 = ((y0 + 1) * W + (x - pad)) * 4;
      const shade = 0.86 + 0.14 * Math.sin(Math.PI * u) + 0.1 * Math.exp(-((u - 0.34) ** 2) / 0.006);
      const k = (y * OW + x) * 4;
      for (let c = 0; c < 3; c++) out.data[k + c] = Math.min(255, (up[i0 + c] * (1 - t) + up[i1 + c] * t) * shade);
      out.data[k + 3] = up[i0 + 3] * (1 - t) + up[i1 + 3] * t;
    }
  }
  // ink outline in the set's style, just outside the paper edge
  const edge = maskDilate(alphaMask(out), 5);
  const soft = await maskBlur(edge, 0.8);
  const inked = fillMask(soft, [10, 18, 12], 1);
  over(inked, out);
  const trimmed = crop(inked, bbox(inked, 2));
  const png = await sharp(Buffer.from(trimmed.data.buffer), { raw: { width: trimmed.w, height: trimmed.h, channels: 4 } }).png().toBuffer();
  return { uri: "data:image/png;base64," + png.toString("base64"), w: trimmed.w, h: trimmed.h };
}

/** SVG placing a note in the fan at `deg` from vertical: its bottom end sits
 *  PINCH*L below the pivot, long axis pointing out from the clip. */
function noteAt(B, deg, dx = 0, dy = 0, idx = -1, withShadow = true) {
  if (idx >= 0) { dx += NUDGE[idx][0]; dy += NUDGE[idx][1]; }
  const L = BILL_L, Hh = L * (B.h / B.w);
  const shadow = !withShadow ? "" : `<rect x="${-Hh / 2 + 6}" y="${-L * (1 - PINCH) + 8}" width="${Hh}" height="${L}" rx="6" fill="#051208" opacity="0.28" filter="url(#bs)"/>`;
  // rotate(-90) turns the landscape note so its long side runs up the fan
  return `<g transform="translate(${PIVOT[0] + dx},${PIVOT[1] + dy}) rotate(${deg})">${shadow}
      <g transform="translate(${-Hh / 2},${L * PINCH}) rotate(-90)"><image href="${B.uri}" x="0" y="0" width="${L}" height="${Hh}" preserveAspectRatio="none"/></g></g>`;
}

function clipSvg() {
  const [cx, cy] = PIVOT;
  const w = 176, h = 50, r = 12;
  const x0 = cx - w / 2, y0 = cy - h / 2 + 4;
  return `<defs>
      <linearGradient id="cg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff6cc"/><stop offset="0.18" stop-color="#ffd966"/><stop offset="0.5" stop-color="#d69a22"/><stop offset="0.52" stop-color="#b87c14"/><stop offset="0.8" stop-color="#eab43c"/><stop offset="1" stop-color="#7c4f08"/></linearGradient>
      <linearGradient id="cgs" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#000" stop-opacity="0.28"/><stop offset="0.18" stop-color="#000" stop-opacity="0"/><stop offset="0.82" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.32"/></linearGradient>
      <filter id="cs" x="-20%" y="-40%" width="140%" height="180%"><feGaussianBlur stdDeviation="5"/></filter>
    </defs>
    <rect x="${x0 + 4}" y="${y0 + 8}" width="${w}" height="${h}" rx="${r}" fill="#04100a" opacity="0.45" filter="url(#cs)"/>
    <rect x="${x0}" y="${y0}" width="${w}" height="${h}" rx="${r}" fill="url(#cg)" stroke="#0a0f0b" stroke-width="6"/>
    <rect x="${x0}" y="${y0}" width="${w}" height="${h}" rx="${r}" fill="url(#cgs)"/>
    <line x1="${x0 + 12}" y1="${y0 + h * 0.52}" x2="${x0 + w - 12}" y2="${y0 + h * 0.52}" stroke="#8a5a0c" stroke-width="2" opacity="0.7"/>
    <path d="M${x0 + 14},${y0 + 9} L${x0 + w - 14},${y0 + 9}" stroke="#fffbe8" stroke-width="4.5" stroke-linecap="round" opacity="0.95"/>
    <circle cx="${cx}" cy="${y0 + h / 2 + 1}" r="15" fill="#c98f1c" stroke="#7a4c08" stroke-width="2.5"/>
    <text x="${cx}" y="${y0 + h / 2 + 11}" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-weight="700" font-size="28" fill="#fff0b3" stroke="#6b4206" stroke-width="1.2">$</text>`;
}

const doc = (inner, w = SW, h = SH, tf = "") =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs><filter id="bs" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="7"/></filter></defs><g transform="${tf}">${inner}</g></svg>`;

export async function build() {
  const B = await preparedBill();
  const restSvg = ORDER.map((i) => noteAt(B, FAN[i], 0, 0, i)).join("") + clipSvg();
  const flatSrc = await svgRaster(doc(restSvg), SW, SH);
  const sc = await standardCanvas(flatSrc);
  const { cw, ch } = sc;
  const [tx, ty] = sc.map(0, 0);
  const S = sc.scale;
  const tf = `matrix(${S} 0 0 ${S} ${tx} ${ty})`;
  const R = async (svg) => svgRaster(doc(svg, cw, ch, tf), cw, ch);

  const bills = [];
  for (const i of ORDER) bills.push({ i, raster: await R(noteAt(B, FAN[i], 0, 0, i)) });
  const front = FAN[ORDER[ORDER.length - 1]];
  const throws = [];
  // thrown notes carry no contact shadow (it would fly with them)
  for (let t = 0; t < THROWS; t++) throws.push(await R(noteAt(B, front, 0, 0, ORDER[ORDER.length - 1], false)));
  const clip = await R(clipSvg());

  const body = blank(cw, ch);
  for (const b of bills) over(body, b.raster);
  over(body, clip);
  const layers = [
    { name: "glow", raster: await glowFrom(body, [150, 240, 150]) },
    ...bills.map((b, k) => ({ name: `bill_${k}`, raster: b.raster })),
    ...throws.map((r, t) => ({ name: `throw_${t}`, raster: r })),
    { name: "clip", raster: clip },
  ];
  await saveWebp(crop(body, bbox(body)), STATIC_OUT, false);

  const M = (p) => sc.map(p[0], p[1]);
  const pivot = M(PIVOT);
  // centre of a note at angle deg (source px)
  const centreAt = (deg) => {
    const a = (deg * Math.PI) / 180, d = BILL_L * (0.5 - PINCH);
    return M([PIVOT[0] + d * Math.sin(a), PIVOT[1] - d * Math.cos(a)]);
  };
  const pivots = { glow: [cw / 2, ch / 2], clip: pivot };
  bills.forEach((_, k) => { pivots[`bill_${k}`] = pivot; });
  const frontCentre = centreAt(front);
  throws.forEach((_, t) => { pivots[`throw_${t}`] = frontCentre; });
  const toSpine = ([x, y]) => [+(x - cw / 2).toFixed(2), +(ch / 2 - y).toFixed(2)];
  const meta = {
    pivot: toSpine(pivot),
    // Spine angle convention: CCW positive. Fan degrees are clockwise-from-up.
    bills: bills.map((b, k) => ({ name: `bill_${k}`, fan: -FAN[b.i], centre: toSpine(centreAt(FAN[b.i])) })),
    throws: throws.map((_, t) => `throw_${t}`),
    throwCentre: toSpine(frontCentre),
    length: +(BILL_L * S).toFixed(1),
  };
  return {
    canvas: [cw, ch], art: [sc.aw, sc.ah], layers, pivots,
    rig: {
      groups: [{ name: "fan", parent: "symbol_anchor", pivot }],
      parents: { glow: "fan", clip: "fan", ...Object.fromEntries(bills.map((_, k) => [`bill_${k}`, "fan"])) },
      hidden: throws.map((_, t) => `throw_${t}`),
      lowres: Object.fromEntries(throws.map((_, t) => [`throw_${t}`, 0.6])),
      shipLossy: true,
    },
    meta, checkAgainst: body,
  };
}
