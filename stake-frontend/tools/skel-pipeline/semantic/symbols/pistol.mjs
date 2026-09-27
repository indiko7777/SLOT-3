/**
 * PISTOL — semantic layers.
 *
 *   glow · frame (+ painted barrel / guide rod / spring / rail under the slide)
 *   · slide · slide_shine · casing · flash · smoke_a · smoke_b
 *
 * The slide is cut from the art along its seam with the frame (a HARD cut, so
 * the rest pose re-composites to the source pixel-for-pixel). Everything the
 * slide can uncover when it cycles back is painted on the frame layer: the
 * barrel with its crown at the original muzzle, the guide rod and recoil
 * spring, and the dark frame rail. Casing, muzzle flash and smoke are new
 * painted elements, hidden at rest.
 *
 * All geometry is authored in SOURCE pixels of public/assets/symbols/pistol.webp
 * (512x425) and mapped onto the standard 712 canvas.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  load, standardCanvas, glowFrom, shineFrom, pathMask, polyPath, applyMask, alphaMask,
  maskMul, maskErode, svgRaster, over, blank, colorMask,
} from "../img.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, "../../../../public/assets/symbols/pistol.webp");

// Rail direction (rearward along the slide/frame seam), source px, y down.
const AX = [0.961, -0.277];
const NX = [0.277, 0.961]; // perpendicular, pointing down-screen
// Slide/frame seam, rear → front, traced on the slide's bottom outline.
const SEAM = [[478, 89], [450, 95], [400, 109], [350, 123], [300, 137], [250, 151], [215, 167],
  [176, 181], [140, 190], [100, 200], [63, 210]];
const MUZZLE = [26, 156];
const ROD = [31, 221];
const PORT = [252, 70];
const GRIP = [405, 195];
// Slide travel on the recoil stroke, source px (~9% of the slide: reads at
// cell size without looking like the gun is coming apart).
const TRAVEL = 44;

const add = (p, v, k) => [p[0] + v[0] * k, p[1] + v[1] * k];
const pts = (a) => a.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");

/** A steel cylinder lying along the rail axis, cel-shaded, with outline. */
function cylinder(id, c, r, len, stops, crown) {
  const a0 = add(c, NX, -r), b0 = add(c, NX, r);
  const a1 = add(a0, AX, len), b1 = add(b0, AX, len);
  const g = `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${a0[0]}" y1="${a0[1]}" x2="${b0[0]}" y2="${b0[1]}">${stops}</linearGradient>`;
  const body = `<polygon points="${pts([a0, a1, b1, b0])}" fill="url(#${id})" stroke="#050607" stroke-width="3" stroke-linejoin="round"/>`;
  return { defs: g, body: body + (crown || "") };
}

function underPaintSvg() {
  const steel = `<stop offset="0" stop-color="#1c2024"/><stop offset="0.18" stop-color="#3a4248"/>
    <stop offset="0.28" stop-color="#aab6bd"/><stop offset="0.36" stop-color="#6d7a82"/>
    <stop offset="0.62" stop-color="#434c53"/><stop offset="1" stop-color="#15181b"/>`;
  const barrel = cylinder("gBarrel", MUZZLE, 19, 250, steel,
    // crown: steel ring + bore, seen nearly face-on like the art's muzzle
    `<ellipse cx="${MUZZLE[0]}" cy="${MUZZLE[1]}" rx="18" ry="20" fill="url(#gCrown)" stroke="#050607" stroke-width="3"/>
     <ellipse cx="${MUZZLE[0] + 1}" cy="${MUZZLE[1]}" rx="13" ry="14.5" fill="none" stroke="#d7e0e4" stroke-opacity="0.55" stroke-width="1.6"/>
     <ellipse cx="${MUZZLE[0] + 1}" cy="${MUZZLE[1]}" rx="10" ry="11.5" fill="#030303"/>`);
  const rodSteel = `<stop offset="0" stop-color="#2a3035"/><stop offset="0.3" stop-color="#c3ccd1"/>
    <stop offset="0.5" stop-color="#7b878e"/><stop offset="1" stop-color="#1b1f22"/>`;
  const rod = cylinder("gRod", ROD, 6, 160, rodSteel,
    `<ellipse cx="${ROD[0]}" cy="${ROD[1]}" rx="7.5" ry="8.5" fill="#8e9aa1" stroke="#050607" stroke-width="2.5"/>`);
  // recoil spring coiled round the rod
  let spring = "";
  const turns = 15;
  for (let k = 0; k <= turns; k++) {
    const along = 10 + k * 9.2;
    const top = add(add(ROD, AX, along), NX, -10);
    const bot = add(add(ROD, AX, along + 4.6), NX, 10);
    spring += `<line x1="${top[0].toFixed(1)}" y1="${top[1].toFixed(1)}" x2="${bot[0].toFixed(1)}" y2="${bot[1].toFixed(1)}" stroke="#050607" stroke-width="5" stroke-linecap="round"/>`;
    spring += `<line x1="${top[0].toFixed(1)}" y1="${top[1].toFixed(1)}" x2="${bot[0].toFixed(1)}" y2="${bot[1].toFixed(1)}" stroke="#b9c3c8" stroke-width="2.2" stroke-linecap="round"/>`;
  }
  // frame rail: everything under the slide below the barrel's lower edge
  const barrelLow0 = add(MUZZLE, NX, 19);
  const railTop = [add(barrelLow0, AX, 40), add(barrelLow0, AX, 480)];
  const seamUp = SEAM.map((p) => add(p, NX, 3));
  const rail = `<polygon points="${pts([railTop[0], railTop[1], ...seamUp])}" fill="#2c2f33"/>
    <line x1="${railTop[0][0]}" y1="${railTop[0][1]}" x2="${railTop[1][0]}" y2="${railTop[1][1]}" stroke="#5d676c" stroke-width="2"/>`;
  return `<defs>${barrel.defs}${rod.defs}
      <radialGradient id="gCrown" cx="0.4" cy="0.35" r="0.75"><stop offset="0" stop-color="#b8c3c9"/><stop offset="0.55" stop-color="#6f7c84"/><stop offset="1" stop-color="#2a3036"/></radialGradient>
    </defs>${rail}${rod.body}${spring}${barrel.body}`;
}

/** The barrel's protruding tip — crown + the length the slide uncovers. Drawn
 *  ABOVE the slide (the barrel passes through the slide's front opening), and
 *  keyed visible only while the slide is back; at rest the slide's own muzzle
 *  art sits in exactly this spot. */
function barrelTipSvg() {
  const steel = `<stop offset="0" stop-color="#1c2024"/><stop offset="0.18" stop-color="#3a4248"/>
    <stop offset="0.28" stop-color="#aab6bd"/><stop offset="0.36" stop-color="#6d7a82"/>
    <stop offset="0.62" stop-color="#434c53"/><stop offset="1" stop-color="#15181b"/>`;
  const tip = cylinder("gTip", MUZZLE, 19, TRAVEL + 3, steel,
    `<ellipse cx="${MUZZLE[0]}" cy="${MUZZLE[1]}" rx="18" ry="20" fill="url(#gCrownT)" stroke="#050607" stroke-width="3"/>
     <ellipse cx="${MUZZLE[0] + 1}" cy="${MUZZLE[1]}" rx="13" ry="14.5" fill="none" stroke="#d7e0e4" stroke-opacity="0.55" stroke-width="1.6"/>
     <ellipse cx="${MUZZLE[0] + 1}" cy="${MUZZLE[1]}" rx="10" ry="11.5" fill="#030303"/>`);
  return `<defs>${tip.defs}<radialGradient id="gCrownT" cx="0.4" cy="0.35" r="0.75"><stop offset="0" stop-color="#b8c3c9"/><stop offset="0.55" stop-color="#6f7c84"/><stop offset="1" stop-color="#2a3036"/></radialGradient></defs>${tip.body}`;
}

function flashSvg() {
  const fwd = [-AX[0], -AX[1]];
  const ang = (Math.atan2(fwd[1], fwd[0]) * 180) / Math.PI;
  const [mx, my] = add(MUZZLE, fwd, 4);
  // petals along the firing line, authored pointing +x then rotated onto it
  const petal = (len, wid, off) =>
    `<path d="M0,${off - wid} Q${len * 0.45},${off - wid * 0.9} ${len},${off} Q${len * 0.45},${off + wid * 0.9} 0,${off + wid} Z"/>`;
  const side = (len, sgn) =>
    `<path d="M-4,0 Q${6},${sgn * len * 0.5} 2,${sgn * len} Q${12},${sgn * len * 0.45} 8,0 Z"/>`;
  return `<defs>
      <radialGradient id="fOuter" cx="0.35" cy="0.5" r="0.65"><stop offset="0" stop-color="#fff6c8" stop-opacity="0.95"/><stop offset="0.45" stop-color="#ffb52e" stop-opacity="0.55"/><stop offset="1" stop-color="#ff6a00" stop-opacity="0"/></radialGradient>
      <linearGradient id="fPetal" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#ffffff"/><stop offset="0.35" stop-color="#fff1a0"/><stop offset="0.75" stop-color="#ffb42a"/><stop offset="1" stop-color="#ff7a10"/></linearGradient>
    </defs>
    <g transform="translate(${mx.toFixed(1)},${my.toFixed(1)}) rotate(${ang.toFixed(2)}) scale(1.3)">
      <ellipse cx="46" cy="0" rx="66" ry="38" fill="url(#fOuter)"/>
      <g fill="url(#fPetal)" stroke="#ff8a1a" stroke-width="1.2" stroke-opacity="0.6">
        ${petal(104, 13, 0)}${petal(72, 10, -15)}${petal(72, 10, 15)}${petal(46, 8, -27)}${petal(46, 8, 27)}
      </g>
      <g fill="#fff4b0" stroke="#ffa22a" stroke-width="1">${side(30, -1)}${side(30, 1)}</g>
      <circle cx="4" cy="0" r="14" fill="#ffffff"/>
    </g>`;
}

function casingSvg() {
  // brass 9mm case lying across the port, open mouth toward the viewer-left
  const [cx, cy] = PORT;
  return `<defs>
      <linearGradient id="cBrass" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#6b3f0d"/><stop offset="0.16" stop-color="#b87a22"/>
        <stop offset="0.3" stop-color="#ffe7a0"/><stop offset="0.42" stop-color="#e2a441"/>
        <stop offset="0.78" stop-color="#a86a1c"/><stop offset="1" stop-color="#5a3309"/>
      </linearGradient>
    </defs>
    <g transform="translate(${cx},${cy}) rotate(-24)">
      <rect x="-21" y="-9" width="37" height="18" rx="2" fill="url(#cBrass)" stroke="#050505" stroke-width="3"/>
      <rect x="15.5" y="-10.5" width="6" height="21" rx="1.5" fill="url(#cBrass)" stroke="#050505" stroke-width="2.6"/>
      <line x1="12.5" y1="-8.2" x2="12.5" y2="8.2" stroke="#4a2a06" stroke-width="2"/>
      <line x1="-17" y1="-4.8" x2="10" y2="-4.8" stroke="#fff4c8" stroke-width="2" stroke-opacity="0.8" stroke-linecap="round"/>
      <ellipse cx="-21" cy="0" rx="4.4" ry="8.6" fill="#2a1604" stroke="#050505" stroke-width="2.4"/>
    </g>`;
}

function smokeSvg(ox, oy, seed) {
  const blobs = [[0, 0, 20], [17, -9, 15], [-15, -8, 14], [8, 11, 12], [27, 4, 11], [-6, 12, 10]];
  let c = "";
  blobs.forEach(([x, y, r], i) => {
    const j = ((seed * 31 + i * 17) % 7) - 3;
    c += `<circle cx="${ox + x + j}" cy="${oy + y - j * 0.5}" r="${r + (i % 2)}" fill="#d9dfe2"/>`;
  });
  return `<defs><filter id="sb${seed}" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="4.5"/></filter></defs>
    <g filter="url(#sb${seed})" opacity="0.85">${c}</g>`;
}

export async function build() {
  const src = await load(SRC);
  const sc = await standardCanvas(src);
  const { body, cw, ch } = sc;
  const [tx, ty] = sc.map(0, 0);
  const S = sc.scale;
  const M = (p) => sc.map(p[0], p[1]);
  const wrap = (inner) =>
    `<svg xmlns="http://www.w3.org/2000/svg" width="${cw}" height="${ch}" viewBox="0 0 ${cw} ${ch}"><g transform="matrix(${S} 0 0 ${S} ${tx} ${ty})">${inner}</g></svg>`;

  // ── slide: hard cut along the seam (binary, so rest pose == source) ──
  const poly = [[-6, -6], [518, -6], [518, 82], [486, 86], ...SEAM, [63, 258], [-6, 258]].map(M);
  const aa = await pathMask(polyPath(poly), cw, ch);
  const bodyA = alphaMask(body);
  const slideHard = { w: cw, h: ch, a: new Float32Array(cw * ch) };
  for (let i = 0; i < slideHard.a.length; i++) slideHard.a[i] = aa.a[i] >= 0.5 && bodyA.a[i] > 0 ? 1 : 0;
  const slide = applyMask(body, slideHard);
  const frameOnly = applyMask(body, { w: cw, h: ch, a: slideHard.a.map((v) => 1 - v) });

  // ── what the slide uncovers, painted beneath it (never a hole) ──
  const under = await svgRaster(wrap(underPaintSvg()), cw, ch);
  // Only under OPAQUE slide pixels: where the art itself is see-through (the
  // gap behind the slide's rear face) the paint would show at rest.
  const solid = { w: cw, h: ch, a: slideHard.a.map((v, i) => (v && bodyA.a[i] > 0.98 ? 1 : 0)) };
  const inner = maskErode(solid, 1);
  const underClip = applyMask(under, inner);
  const frame = blank(cw, ch);
  over(frame, underClip);
  over(frame, frameOnly);

  // ── FX + highlights ──
  const flash = await svgRaster(wrap(flashSvg()), cw, ch);
  const barrelTip = await svgRaster(wrap(barrelTipSvg()), cw, ch);
  const casing = await svgRaster(wrap(casingSvg()), cw, ch);
  const smokeA = await svgRaster(wrap(smokeSvg(MUZZLE[0] - 30, MUZZLE[1] + 4, 1)), cw, ch);
  const smokeB = await svgRaster(wrap(smokeSvg(MUZZLE[0] - 14, MUZZLE[1] - 8, 2)), cw, ch);
  const slideShine = await shineFrom(body, slideHard);
  const glow = await glowFrom(body, [150, 230, 130]);

  const layers = [
    { name: "glow", raster: glow },
    { name: "frame", raster: frame },
    { name: "slide", raster: slide },
    { name: "slide_shine", raster: slideShine },
    { name: "barrel_tip", raster: barrelTip },
    { name: "casing", raster: casing },
    { name: "flash", raster: flash },
    { name: "smoke_a", raster: smokeA },
    { name: "smoke_b", raster: smokeB },
  ];

  const grip = M(GRIP), muzzle = M(MUZZLE), port = M(PORT);
  const slideC = M([250, 120]);
  const pivots = {
    glow: [cw / 2, ch / 2],
    frame: grip,
    slide: slideC,
    slide_shine: slideC,
    casing: port,
    flash: muzzle,
    barrel_tip: muzzle,
    smoke_a: M([MUZZLE[0] - 30, MUZZLE[1] + 4]),
    smoke_b: M([MUZZLE[0] - 14, MUZZLE[1] - 8]),
  };
  const rig = {
    groups: [{ name: "gun", parent: "symbol_anchor", pivot: grip }],
    parents: { glow: "gun", frame: "gun", slide: "gun", slide_shine: "slide", flash: "gun", barrel_tip: "gun" },
    hidden: ["barrel_tip", "casing", "flash", "smoke_a", "smoke_b"],
  };
  const toSpine = ([x, y]) => [+(x - cw / 2).toFixed(2), +(ch / 2 - y).toFixed(2)];
  const meta = {
    // rearward rail direction in Spine space (y up)
    axis: [AX[0], -AX[1]],
    travel: +(TRAVEL * S).toFixed(2),
    muzzle: toSpine(muzzle),
    port: toSpine(port),
    grip: toSpine(grip),
  };
  return { canvas: [cw, ch], art: [sc.aw, sc.ah], layers, pivots, rig, meta, checkAgainst: body, noRestCheck: ["slide_shine"] };
}
