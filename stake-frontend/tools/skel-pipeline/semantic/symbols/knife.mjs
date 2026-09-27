/**
 * KNIFE — material pass + semantic layers.
 *
 * Asset audit: the handle fill sat at ~L60 inside a black outline, so on the
 * near-black reel it read as a hole; the blade was one flat grey. A restrained
 * material pass (not a redraw): the handle is lifted to a cool gunmetal with a
 * brighter top edge, the blade gets a satin-steel ramp (darker at the spine,
 * brighter toward the bevel) and a diagonal mirror streak. The flattened
 * result becomes the new static knife.webp.
 *
 *   glow · handle · blade · glint_0..glint_5 (a flipbook highlight sweep,
 *   clipped to the blade) · tip_flare · slash (arc trail for the flip) ·
 *   edge_flash (the blade seen edge-on, for the destroy)
 *
 * A `knife` group bone is ROTATED onto the knife's long axis, so scaling its
 * local Y turns the knife edge-on instead of squashing it diagonally.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  load, standardCanvas, glowFrom, applyMask, alphaMask, maskNew, svgRaster, over, blank,
  maskDilate, keepLarge, maskBlur, bbox, crop, saveWebp, lum,
} from "../img.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, "../../../../public/assets/symbols/knife.webp");
const STATIC_OUT = SRC;

const TIP = [8, 458];
const BUTT = [500, 26];
const CENTRE = [250, 238];
const HEEL = [214, 262];     // where the blade meets the handle scale

export async function build() {
  // Always read the ORIGINAL art from git history the first time: the build
  // overwrites knife.webp with the material-passed version.
  const original = await load(path.resolve(HERE, "knife.source.webp")).catch(() => null);
  const src = original ?? (await load(SRC));
  const sc = await standardCanvas(src);
  const { cw, ch } = sc;
  let body = sc.body;
  const [tx, ty] = sc.map(0, 0);
  const S = sc.scale;
  const M = (p) => sc.map(p[0], p[1]);
  const toSrc = (x, y) => [(x - tx) / S, (y - ty) / S];
  const wrap = (inner) => `<svg xmlns="http://www.w3.org/2000/svg" width="${cw}" height="${ch}" viewBox="0 0 ${cw} ${ch}"><g transform="matrix(${S} 0 0 ${S} ${tx} ${ty})">${inner}</g></svg>`;
  const A = alphaMask(body);

  // ── classify: blade (orange / steel) vs handle ──
  const sat = (i) => Math.max(body.data[i], body.data[i + 1], body.data[i + 2]) - Math.min(body.data[i], body.data[i + 1], body.data[i + 2]);
  const bladeCore = maskNew(cw, ch);
  const steel = maskNew(cw, ch);
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
    const k = y * cw + x, i = k * 4;
    if (A.a[k] < 0.5) continue;
    const [sx, sy] = toSrc(x, y);
    if (sx > 312 || sy < 168) continue;
    const L = lum(body.data[i], body.data[i + 1], body.data[i + 2]);
    const orange = sat(i) > 60 && body.data[i] > 150;
    const grey = sat(i) < 30 && L > 140;
    if (orange || grey) bladeCore.a[k] = 1;
    if (grey) steel.a[k] = 1;
  }
  const bladeCoreL = keepLarge(bladeCore, 400);
  // the blade's own ink outline comes with it (but never the handle scale)
  const near = maskDilate(bladeCoreL, 5);
  const blade = maskNew(cw, ch);
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
    const k = y * cw + x, i = k * 4;
    if (!near.a[k] || A.a[k] < 0.02) continue;
    const L = lum(body.data[i], body.data[i + 1], body.data[i + 2]);
    const [sx, sy] = toSrc(x, y);
    // the handle scale is mid-dark grey; left of the heel line everything is blade
    const leftOfHeel = (sx - HEEL[0]) * 0.9 + (sy - HEEL[1]) * -0.45 < 0;
    if (bladeCoreL.a[k] || L < 32 || leftOfHeel) blade.a[k] = 1;
  }

  // ── material pass ──
  const out = { w: cw, h: ch, data: new Uint8ClampedArray(body.data) };
  // long axis (tip -> butt), used for the steel ramp and the streak
  const ax = [BUTT[0] - TIP[0], BUTT[1] - TIP[1]];
  const al = Math.hypot(ax[0], ax[1]);
  const ux = ax[0] / al, uy = ax[1] / al;
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
    const k = y * cw + x, i = k * 4;
    if (A.a[k] < 0.5) continue;
    const r = out.data[i], g = out.data[i + 1], b = out.data[i + 2];
    const L = lum(r, g, b);
    const [sx, sy] = toSrc(x, y);
    const along = ((sx - TIP[0]) * ux + (sy - TIP[1]) * uy) / al;       // 0 tip .. 1 butt
    const across = (sx - TIP[0]) * -uy + (sy - TIP[1]) * ux;            // + toward the spine side
    if (steel.a[k] && L < 225) {
      // satin ramp: darker toward the spine, lifting toward the edge bevel
      let d = -0.22 * Math.max(0, Math.min(1, (across - 10) / 70)) * 60 + 10;
      // diagonal mirror streak across the belly
      const s = (along - 0.2) * 3.2 + across / 90;
      d += 34 * Math.exp(-((s - 0.35) ** 2) / 0.012);
      d += 14 * Math.exp(-((s - 0.62) ** 2) / 0.004);
      out.data[i] = Math.max(0, Math.min(255, r + d));
      out.data[i + 1] = Math.max(0, Math.min(255, g + d + 1));
      out.data[i + 2] = Math.max(0, Math.min(255, b + d + 4));
    } else if (!blade.a[k] && sat(i) < 26 && L >= 36 && L < 150) {
      // handle: lift the fill off black, cool gunmetal, brighter top edges
      const lift = L < 90 ? 1.32 : 1.14;
      out.data[i] = Math.min(255, r * lift + 2);
      out.data[i + 1] = Math.min(255, g * lift + 6);
      out.data[i + 2] = Math.min(255, b * lift + 12);
    }
  }
  body = out;

  const bladeR = applyMask(body, blade);
  const handleR = applyMask(body, { w: cw, h: ch, a: blade.a.map((v) => 1 - v) });

  // ── glint flipbook: a soft band sweeping heel -> tip, clipped to the steel ──
  const glints = [];
  const steelSoft = await maskBlur(maskDilate(steel, 1), 0.8);
  const heelAlong = ((HEEL[0] - TIP[0]) * ux + (HEEL[1] - TIP[1]) * uy) / al;
  for (let n = 0; n < 6; n++) {
    const pos = heelAlong - (n / 5) * (heelAlong - 0.03);
    const g = blank(cw, ch);
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
      const k = y * cw + x;
      if (steelSoft.a[k] < 0.02) continue;
      const [sx, sy] = toSrc(x, y);
      const along = ((sx - TIP[0]) * ux + (sy - TIP[1]) * uy) / al;
      const across = (sx - TIP[0]) * -uy + (sy - TIP[1]) * ux;
      // band slightly slanted so it reads as light rolling over a bevel
      const dd = along - pos + across / 1400;
      const v = Math.exp(-(dd * dd) / 0.0022) * steelSoft.a[k];
      if (v < 0.01) continue;
      g.data[k * 4] = 255; g.data[k * 4 + 1] = 255; g.data[k * 4 + 2] = 250; g.data[k * 4 + 3] = Math.round(Math.min(1, v * 1.25) * 250);
    }
    glints.push(g);
  }

  // ── tip flare, slash arc, edge flash (painted) ──
  const [tipX, tipY] = [TIP[0] + 14, TIP[1] - 12];
  const flare = await svgRaster(wrap(`<defs><radialGradient id="tf"><stop offset="0" stop-color="#fff"/><stop offset="0.4" stop-color="#e6f6ff" stop-opacity="0.7"/><stop offset="1" stop-color="#bfe9ff" stop-opacity="0"/></radialGradient></defs>
    <circle cx="${tipX}" cy="${tipY}" r="24" fill="url(#tf)"/>
    <path d="M${tipX - 50},${tipY} L${tipX},${tipY - 3} L${tipX + 50},${tipY} L${tipX},${tipY + 3} Z" fill="#ffffff"/>
    <path d="M${tipX},${tipY - 34} L${tipX + 2.4},${tipY} L${tipX},${tipY + 34} L${tipX - 2.4},${tipY} Z" fill="#ffffff"/>`), cw, ch);
  // slash: a tapered arc around the flip pivot at the tip's radius
  const pr = Math.hypot(TIP[0] - CENTRE[0], TIP[1] - CENTRE[1]);
  const a0 = Math.atan2(TIP[1] - CENTRE[1], TIP[0] - CENTRE[0]);
  let slashPath = "";
  const steps = 28, span = (100 * Math.PI) / 180;
  const outer = [], inner = [];
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const a = a0 + span * t;              // arc trails behind the tip (CCW spin)
    const w = 22 * Math.sin(Math.PI * Math.min(1, t * 1.15)) * (1 - t * 0.6);
    outer.push([CENTRE[0] + Math.cos(a) * (pr + w * 0.4), CENTRE[1] + Math.sin(a) * (pr + w * 0.4)]);
    inner.push([CENTRE[0] + Math.cos(a) * (pr - w), CENTRE[1] + Math.sin(a) * (pr - w)]);
  }
  slashPath = "M" + [...outer, ...inner.reverse()].map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" L") + " Z";
  const slash = await svgRaster(wrap(`<defs><linearGradient id="sg" gradientUnits="userSpaceOnUse" x1="${TIP[0]}" y1="${TIP[1]}" x2="${CENTRE[0] + Math.cos(a0 + span) * pr}" y2="${CENTRE[1] + Math.sin(a0 + span) * pr}">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.95"/><stop offset="0.35" stop-color="#cdefff" stop-opacity="0.7"/><stop offset="1" stop-color="#7fd3ff" stop-opacity="0"/></linearGradient>
      <filter id="sgb"><feGaussianBlur stdDeviation="1.4"/></filter></defs>
    <path d="${slashPath}" fill="url(#sg)" filter="url(#sgb)"/>`), cw, ch);
  // edge flash: the whole knife seen edge-on — a hot tapered line on the axis
  const nx = -uy, ny = ux;
  const e = (t, w) => [TIP[0] + ax[0] * t + nx * w, TIP[1] + ax[1] * t + ny * w];
  const edgePts = [e(0, 0), e(0.3, -5), e(0.75, -4), e(1, 0), e(0.75, 4), e(0.3, 5)];
  const edgeFlash = await svgRaster(wrap(`<defs><filter id="eb" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="6"/></filter></defs>
    <polygon points="${edgePts.map(([x, y]) => `${x},${y}`).join(" ")}" fill="#bfe9ff" filter="url(#eb)" opacity="0.9"/>
    <polygon points="${edgePts.map(([x, y]) => `${x},${y}`).join(" ")}" fill="#ffffff"/>`), cw, ch);

  const glow = await glowFrom(body, [150, 200, 255]);
  const layers = [
    { name: "glow", raster: glow },
    { name: "slash", raster: slash },
    { name: "handle", raster: handleR },
    { name: "blade", raster: bladeR },
    ...glints.map((g, n) => ({ name: `glint_${n}`, raster: g })),
    { name: "tip_flare", raster: flare },
    { name: "edge_flash", raster: edgeFlash },
  ];

  // new static art = the material-passed rest pose
  const rest = blank(cw, ch);
  over(rest, handleR); over(rest, bladeR);
  await saveWebp(crop(rest, bbox(rest)), STATIC_OUT, false);

  const c = M(CENTRE);
  // Spine angle of the long axis (tip -> butt), CCW positive, y up
  const axisDeg = (Math.atan2(-(BUTT[1] - TIP[1]), BUTT[0] - TIP[0]) * 180) / Math.PI;
  const pivots = { glow: c, slash: c, handle: c, blade: c, tip_flare: M([tipX, tipY]), edge_flash: c };
  glints.forEach((_, n) => { pivots[`glint_${n}`] = c; });
  const kids = ["glow", "slash", "handle", "blade", "tip_flare", ...glints.map((_, n) => `glint_${n}`)];
  const rig = {
    groups: [
      { name: "knife", parent: "symbol_anchor", pivot: c, rotation: +axisDeg.toFixed(3) },
      // the edge-on flash must NOT inherit the knife collapsing to nothing
      { name: "edgeline", parent: "symbol_anchor", pivot: c, rotation: +axisDeg.toFixed(3) },
    ],
    parents: { ...Object.fromEntries(kids.map((k) => [k, "knife"])), edge_flash: "edgeline" },
    hidden: ["slash", "tip_flare", "edge_flash", ...glints.map((_, n) => `glint_${n}`)],
  };
  const toSpine = ([x, y]) => [+(x - cw / 2).toFixed(2), +(ch / 2 - y).toFixed(2)];
  const meta = { axisDeg: +axisDeg.toFixed(3), centre: toSpine(c), tip: toSpine(M(TIP)), glints: glints.length };
  return {
    canvas: [cw, ch], art: [sc.aw, sc.ah], layers, pivots, rig, meta,
    checkAgainst: rest,
  };
}
