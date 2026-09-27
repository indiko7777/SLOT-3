/**
 * DIAMOND — facet-based light and angular shards (premium tier).
 *
 * Asset audit: the gem itself is in the set's cel style, but nine baked-in
 * white four-point "twinkle" stars (and the old rig's three big pink / cyan /
 * gold sparkle sprites) made it read as a generic sparkly cartoon. The baked
 * stars are painted out here — each arm is inpainted ACROSS its own direction,
 * so the facet lines it covered continue straight through — and the new
 * static art is the clean stone.
 *
 * Light then lives in the stone's real facets: the art is segmented into its
 * ink-bounded facets, grouped into light bands that can flash in sequence
 * (refraction / fire), and into angular shards that ARE the stone at rest
 * (a pixel-exact partition) and break apart along the cut on destroy.
 *
 *   glow · shard_0..shard_N (the stone) · light_0..light_M (facet light) ·
 *   table_fire (the table facet's white flash)
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  load, standardCanvas, glowFrom, alphaMask, maskNew, over, blank, bbox, crop, saveWebp, lum,
  maskDilate, maskBlur, clone, diffuseFill, applyMask, svgRaster,
} from "../img.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, "../../../../public/assets/symbols/diamond.webp");
const PRISTINE = path.resolve(HERE, "diamond.source.webp");

// Baked twinkle stars (source px): centre, arm half-lengths (h, v), half-width.
const STARS = [
  [180, 30, 32, 28, 4.5], [441, 88, 29, 27, 4.5], [353, 190, 30, 28, 4.5], [156, 256, 21, 18, 3.8],
  [324, 92, 13, 13, 2.8], [289, 139, 11, 13, 2.8], [372, 151, 13, 13, 2.8], [148, 163, 11, 11, 2.6],
  [271, 303, 16, 15, 3.0],
];

/** Snap each star centre to the brightest pixel near the estimate. */
function refineStars(src) {
  return STARS.map(([cx, cy, lh, lv, hw]) => {
    let best = -1, bx = cx, by = cy;
    for (let y = cy - 7; y <= cy + 7; y++) for (let x = cx - 7; x <= cx + 7; x++) {
      if (x < 0 || y < 0 || x >= src.w || y >= src.h) continue;
      const i = (y * src.w + x) * 4;
      const v = lum(src.data[i], src.data[i + 1], src.data[i + 2]) * (src.data[i + 3] / 255);
      // prefer the centre of the cross: bright here AND along both axes
      const i2 = (y * src.w + Math.min(src.w - 1, x + 3)) * 4, i3 = (Math.min(src.h - 1, y + 3) * src.w + x) * 4;
      const score = v + 0.5 * lum(src.data[i2], src.data[i2 + 1], src.data[i2 + 2]) + 0.5 * lum(src.data[i3], src.data[i3 + 1], src.data[i3 + 2]);
      if (score > best) { best = score; bx = x; by = y; }
    }
    return [bx, by, lh, lv, hw];
  });
}

/** Remove the stars: vertical arms are rebuilt from the pixels left/right of
 *  them (row interpolation), horizontal arms from above/below — so straight
 *  facet lines that cross an arm continue through it. */
function paintOutStars(src, stars) {
  const out = clone(src);
  const W = src.w, H = src.h;
  const inV = new Uint8Array(W * H), inH = new Uint8Array(W * H);
  for (const [cx, cy, lh, lv, hw] of stars) {
    for (let y = Math.floor(cy - lv - 2); y <= cy + lv + 2; y++) for (let x = Math.floor(cx - lh - 2); x <= cx + lh + 2; x++) {
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const dx = Math.abs(x - cx), dy = Math.abs(y - cy);
      // generous: the arms carry a soft glow halo well beyond the hard spike
      const core = Math.hypot(dx, dy) <= hw * 3.2 + 2;
      const vArm = dy <= lv + 4 && dx <= hw * 1.6 * Math.max(0.45, 1 - dy / (lv + 4)) + 3;
      const hArm = dx <= lh + 4 && dy <= hw * 1.6 * Math.max(0.45, 1 - dx / (lh + 4)) + 3;
      const k = y * W + x;
      if (vArm || core) inV[k] = 1;
      if (hArm || core) inH[k] = 1;
    }
  }
  const px = (x, y) => src.data.subarray((y * W + x) * 4, (y * W + x) * 4 + 4);
  const rowInterp = (x, y, mask) => {
    let l = x, r = x;
    while (l > 0 && mask[y * W + l]) l--;
    while (r < W - 1 && mask[y * W + r]) r++;
    const t = (x - l) / Math.max(1, r - l);
    const a = px(l, y), b = px(r, y);
    return [0, 1, 2, 3].map((c) => a[c] + (b[c] - a[c]) * t);
  };
  const colInterp = (x, y, mask) => {
    let u = y, d = y;
    while (u > 0 && mask[u * W + x]) u--;
    while (d < H - 1 && mask[d * W + x]) d++;
    const t = (y - u) / Math.max(1, d - u);
    const a = px(x, u), b = px(x, d);
    return [0, 1, 2, 3].map((c) => a[c] + (b[c] - a[c]) * t);
  };
  const both = new Uint8Array(W * H);
  for (let k = 0; k < both.length; k++) both[k] = inV[k] | inH[k];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const k = y * W + x;
    if (!both[k]) continue;
    let c;
    if (inV[k] && !inH[k]) c = rowInterp(x, y, both);
    else if (inH[k] && !inV[k]) c = colInterp(x, y, both);
    else { const a = rowInterp(x, y, both), b = colInterp(x, y, both); c = a.map((v, i) => (v + b[i]) / 2); }
    for (let ch = 0; ch < 4; ch++) out.data[k * 4 + ch] = Math.round(c[ch]);
  }
  return out;
}

/** Star footprint mask (source px), generous enough to cover the glow halo. */
function starMask(W, H, stars) {
  const m = maskNew(W, H);
  for (const [cx, cy, lh, lv, hw] of stars) {
    for (let y = Math.floor(cy - lv - 5); y <= cy + lv + 5; y++) for (let x = Math.floor(cx - lh - 5); x <= cx + lh + 5; x++) {
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const dx = Math.abs(x - cx), dy = Math.abs(y - cy);
      const core = Math.hypot(dx, dy) <= hw * 3.2 + 2;
      const vArm = dy <= lv + 4 && dx <= hw * 1.6 * Math.max(0.45, 1 - dy / (lv + 4)) + 3;
      const hArm = dx <= lh + 4 && dy <= hw * 1.6 * Math.max(0.45, 1 - dx / (lh + 4)) + 3;
      if (core || vArm || hArm) m.a[y * W + x] = 1;
    }
  }
  return m;
}

/**
 * Repair the star footprints: diffuse the surrounding colours in (smooth, no
 * streaks), snap alpha (the big stars poke out past the silhouette), then
 * re-draw every ink line that crossed a footprint. Each line is fitted (PCA)
 * to the ink just outside the patch and extended inward until it exits the
 * patch or meets another reconstructed line — so a facet vertex hidden under
 * a star comes back as a vertex.
 */
async function repairStars(src, stars) {
  const W = src.w, H = src.h;
  const mask = starMask(W, H, stars);
  const isInk = (x, y) => {
    const i = (y * W + x) * 4;
    return src.data[i + 3] > 200 && lum(src.data[i], src.data[i + 1], src.data[i + 2]) < 58;
  };
  // Diffuse FACET colour only: nearby ink is treated as unknown too, so no
  // black bleeds into the patch — the redrawn lines alone restore the ink.
  const near = maskDilate(mask, 14);
  const hole = maskNew(W, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const k = y * W + x;
    if (mask.a[k] || (near.a[k] && isInk(x, y))) hole.a[k] = 1;
  }
  const diffused = diffuseFill(src, hole, 700);
  const filled = clone(src);
  for (let k = 0; k < mask.a.length; k++) {
    if (!mask.a[k]) continue;
    for (let c = 0; c < 3; c++) filled.data[k * 4 + c] = diffused.data[k * 4 + c];
    filled.data[k * 4 + 3] = diffused.data[k * 4 + 3] >= 128 ? 255 : 0;
  }
  const inMask = (x, y) => x >= 0 && y >= 0 && x < W && y < H && mask.a[y * W + x] > 0;
  let strokes = "";
  const alphaAt = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? 0 : src.data[(y * W + x) * 4 + 3]);
  // Stars that cross the SILHOUETTE: rebuild the edge as the chord between
  // where it enters and leaves the patch, then lay the ink outline inside it.
  const silhouetteStrokes = [];
  for (const [cx, cy, lh, lv] of stars) {
    const R = Math.max(lh, lv) + 8;
    const edge = [];
    for (let y = Math.max(1, Math.floor(cy - R)); y <= Math.min(H - 2, cy + R); y++) for (let x = Math.max(1, Math.floor(cx - R)); x <= Math.min(W - 2, cx + R); x++) {
      if (inMask(x, y) || alphaAt(x, y) < 128) continue;
      if (alphaAt(x + 1, y) >= 128 && alphaAt(x - 1, y) >= 128 && alphaAt(x, y + 1) >= 128 && alphaAt(x, y - 1) >= 128) continue;
      let d = 99;
      for (let r = 1; r <= 3 && d === 99; r++) if (inMask(x + r, y) || inMask(x - r, y) || inMask(x, y + r) || inMask(x, y - r)) d = r;
      if (d <= 3) edge.push([x, y]);
    }
    if (edge.length < 2) continue;
    // the two entry points = the farthest-apart pair of edge pixels
    let best = 0, P1 = edge[0], P2 = edge[1];
    for (let i = 0; i < edge.length; i++) for (let j = i + 1; j < edge.length; j++) {
      const d = (edge[i][0] - edge[j][0]) ** 2 + (edge[i][1] - edge[j][1]) ** 2;
      if (d > best) { best = d; P1 = edge[i]; P2 = edge[j]; }
    }
    // inside = the side of the chord the star centre's opaque neighbours are on
    const nx = -(P2[1] - P1[1]), ny = P2[0] - P1[0];
    const nl = Math.hypot(nx, ny) || 1;
    let sInside = 0;
    for (let y = Math.floor(cy - R); y <= cy + R; y++) for (let x = Math.floor(cx - R); x <= cx + R; x++) {
      if (inMask(x, y) || x < 0 || y < 0 || x >= W || y >= H) continue;
      if (alphaAt(x, y) >= 200) sInside += Math.sign(((x - P1[0]) * nx + (y - P1[1]) * ny) / nl);
    }
    const inSign = sInside >= 0 ? 1 : -1;
    for (let y = Math.floor(cy - R); y <= cy + R; y++) for (let x = Math.floor(cx - R); x <= cx + R; x++) {
      if (!inMask(x, y)) continue;
      const side = ((x - P1[0]) * nx + (y - P1[1]) * ny) / nl * inSign;
      const k = y * W + x;
      filled.data[k * 4 + 3] = side >= 0 ? 255 : 0;
    }
    // outline band just inside the chord (the art's outer ink is ~7px)
    const off = 3.4 * inSign;
    const ox_ = (nx / nl) * off, oy_ = (ny / nl) * off;
    silhouetteStrokes.push(`<line x1="${P1[0] + ox_}" y1="${P1[1] + oy_}" x2="${P2[0] + ox_}" y2="${P2[1] + oy_}" stroke="#050608" stroke-width="7.2" stroke-linecap="butt"/>`);
  }
  for (const [cx, cy, lh, lv] of stars) {
    const R = Math.max(lh, lv) + 22;
    // collar: ink within 12px outside the patch, near this star
    const collar = [];
    for (let y = Math.max(0, Math.floor(cy - R)); y <= Math.min(H - 1, cy + R); y++) for (let x = Math.max(0, Math.floor(cx - R)); x <= Math.min(W - 1, cx + R); x++) {
      if (inMask(x, y) || !isInk(x, y)) continue;
      let near = false;
      for (let d = 1; d <= 12 && !near; d++) {
        if (inMask(x + d, y) || inMask(x - d, y) || inMask(x, y + d) || inMask(x, y - d)) near = true;
      }
      if (near) collar.push([x, y]);
    }
    // cluster collar ink into strokes
    const seen = new Set(), key = (p) => p[0] * 10000 + p[1];
    const set = new Map(collar.map((p) => [key(p), p]));
    const lines = [];
    for (const p of collar) {
      if (seen.has(key(p))) continue;
      const comp = [], st = [p];
      seen.add(key(p));
      while (st.length) {
        const q = st.pop();
        comp.push(q);
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const n = set.get(key([q[0] + dx, q[1] + dy]));
          if (n && !seen.has(key(n))) { seen.add(key(n)); st.push(n); }
        }
      }
      if (comp.length < 18) continue;
      // the OUTER outline is rebuilt by the silhouette chord, not here
      const onEdge = comp.some(([x, y]) => alphaAt(x + 2, y) < 128 || alphaAt(x - 2, y) < 128 || alphaAt(x, y + 2) < 128 || alphaAt(x, y - 2) < 128
        || alphaAt(x + 4, y) < 128 || alphaAt(x - 4, y) < 128 || alphaAt(x, y + 4) < 128 || alphaAt(x, y - 4) < 128);
      if (onEdge) continue;
      const mx = comp.reduce((s, q) => s + q[0], 0) / comp.length, my = comp.reduce((s, q) => s + q[1], 0) / comp.length;
      let sxx = 0, syy = 0, sxy = 0;
      for (const [x, y] of comp) { sxx += (x - mx) ** 2; syy += (y - my) ** 2; sxy += (x - mx) * (y - my); }
      const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy);
      let ux = Math.cos(ang), uy = Math.sin(ang);
      // thickness across the fitted direction
      let width = 0;
      for (const [x, y] of comp) width = Math.max(width, Math.abs((x - mx) * -uy + (y - my) * ux));
      width = Math.max(3, Math.min(9, width * 2 + 1));
      // point the direction INTO the patch
      const probe = (s) => inMask(Math.round(mx + ux * s), Math.round(my + uy * s));
      let into = 0;
      for (let s = 1; s < 30; s++) { if (probe(s)) { into = 1; break; } if (probe(-s)) { into = -1; break; } }
      if (!into) continue;
      ux *= into; uy *= into;
      lines.push({ x: mx, y: my, ux, uy, width });
    }
    // extend each line through the patch, stopping at another line
    for (const L of lines) {
      let tEnd = 0;
      for (let s = 1; s < 3 * R; s++) {
        const x = Math.round(L.x + L.ux * s), y = Math.round(L.y + L.uy * s);
        if (inMask(x, y)) tEnd = s;
        else if (tEnd && s > tEnd + 3) break;
      }
      for (const O of lines) {
        if (O === L) continue;
        const den = L.ux * O.uy - L.uy * O.ux;
        if (Math.abs(den) < 0.2) continue;
        const t = ((O.x - L.x) * O.uy - (O.y - L.y) * O.ux) / den;
        const u = ((O.x - L.x) * L.uy - (O.y - L.y) * L.ux) / den;
        const ix = Math.round(L.x + L.ux * t), iy = Math.round(L.y + L.uy * t);
        if (t > 0 && u > 0 && t < tEnd && inMask(ix, iy)) tEnd = t;
      }
      if (tEnd <= 0) continue;
      const x2 = L.x + L.ux * (tEnd + L.width * 0.3), y2 = L.y + L.uy * (tEnd + L.width * 0.3);
      strokes += `<line x1="${L.x.toFixed(1)}" y1="${L.y.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="#050608" stroke-width="${L.width.toFixed(1)}" stroke-linecap="round"/>`;
    }
  }
  // strokes only inside the patches (never over untouched art)
  const lineR = await svgRaster(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${strokes}${silhouetteStrokes.join("")}</svg>`, W, H);
  over(filled, applyMask(lineR, maskDilate(mask, 1)));
  return filled;
}

// Shard seeds (source px): each facet joins the nearest seed. Crown pieces
// across the top, pavilion wedges toward the culet — the stone breaks along
// its own cut.
const SHARD_SEEDS = [
  [70, 120], [170, 80], [300, 60], [420, 110], [250, 150],
  [90, 230], [200, 270], [300, 270], [420, 230], [250, 360],
];
const LIGHT_BANDS = 6;

/** Label ink-bounded facets; every opaque pixel ends with a facet id. */
function facets(body) {
  const W = body.w, H = body.h;
  const lab = new Int32Array(W * H).fill(-1);
  const facetPx = (k) => body.data[k * 4 + 3] > 200 && lum(body.data[k * 4], body.data[k * 4 + 1], body.data[k * 4 + 2]) >= 70;
  const list = [];
  for (let s = 0; s < W * H; s++) {
    if (lab[s] >= 0 || !facetPx(s)) continue;
    const id = list.length, comp = [s], st = [s];
    lab[s] = id;
    while (st.length) {
      const k = st.pop();
      const x = k % W, y = (k / W) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
        const kk = yy * W + xx;
        if (lab[kk] < 0 && facetPx(kk)) { lab[kk] = id; st.push(kk); comp.push(kk); }
      }
    }
    list.push(comp);
  }
  // drop specks (highlight flecks inside a facet get re-absorbed below)
  const keep = list.map((c) => c.length >= 140);
  for (let i = 0; i < list.length; i++) if (!keep[i]) for (const k of list[i]) lab[k] = -1;
  // multi-source BFS: ink + specks take the nearest facet's id
  const q = [];
  for (let k = 0; k < W * H; k++) if (lab[k] >= 0) q.push(k);
  for (let h = 0; h < q.length; h++) {
    const k = q[h], x = k % W, y = (k / W) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
      const kk = yy * W + xx;
      if (lab[kk] < 0 && body.data[kk * 4 + 3] > 0) { lab[kk] = lab[k]; q.push(kk); }
    }
  }
  const stats = list.map(() => ({ n: 0, sx: 0, sy: 0 }));
  for (let k = 0; k < W * H; k++) {
    const id = lab[k];
    if (id < 0 || !keep[id]) continue;
    if (!facetPx(k)) continue;
    stats[id].n++; stats[id].sx += k % W; stats[id].sy += (k / W) | 0;
  }
  const ids = stats.map((s, i) => i).filter((i) => keep[i] && stats[i].n > 0);
  return { lab, ids, centroid: (i) => [stats[i].sx / stats[i].n, stats[i].sy / stats[i].n], area: (i) => stats[i].n, facetPx };
}

export async function build({ debug } = {}) {
  const original = await load(PRISTINE).catch(() => null);
  const src0 = original ?? (await load(SRC));
  const clean = await repairStars(src0, STARS);
  const sc = await standardCanvas(clean);
  const { body, cw, ch } = sc;
  const M = (p) => sc.map(p[0], p[1]);
  const F = facets(body);

  // ── shards: facets grouped to the nearest seed (a pixel-exact partition) ──
  const seeds = SHARD_SEEDS.map(M);
  const shardOf = new Map();
  for (const i of F.ids) {
    const [x, y] = F.centroid(i);
    let best = 0, bd = Infinity;
    seeds.forEach(([sx, sy], s) => { const d = (x - sx) ** 2 + (y - sy) ** 2; if (d < bd) { bd = d; best = s; } });
    shardOf.set(i, best);
  }
  const shards = seeds.map(() => blank(cw, ch));
  const shardCent = seeds.map(() => ({ n: 0, x: 0, y: 0 }));
  for (let k = 0; k < cw * ch; k++) {
    if (body.data[k * 4 + 3] === 0) continue;
    const id = F.lab[k];
    const s = id >= 0 && shardOf.has(id) ? shardOf.get(id) : 0;
    shards[s].data.set(body.data.subarray(k * 4, k * 4 + 4), k * 4);
    shardCent[s].n++; shardCent[s].x += k % cw; shardCent[s].y += (k / cw) | 0;
  }
  const used = shards.map((_, s) => shardCent[s].n > 0);

  // ── facet light: soft white inside each facet (kept off the ink) ──
  const byX = [...F.ids].sort((a, b) => F.centroid(a)[0] - F.centroid(b)[0]);
  // the table = the largest facet in the top third
  const top = F.ids.filter((i) => F.centroid(i)[1] < ch * 0.42);
  const table = top.reduce((b, i) => (F.area(i) > F.area(b) ? i : b), top[0]);
  const lights = Array.from({ length: LIGHT_BANDS }, () => blank(cw, ch));
  const tableFire = blank(cw, ch);
  const tints = [[255, 255, 255], [240, 250, 255], [255, 248, 236]];
  const bandOf = new Map(byX.filter((i) => i !== table).map((i, n, arr) => [i, Math.min(LIGHT_BANDS - 1, Math.floor((n / arr.length) * LIGHT_BANDS))]));
  // distance from the facet edge (so light swells from the facet centre)
  const inner = maskNew(cw, ch);
  for (let k = 0; k < cw * ch; k++) if (F.lab[k] >= 0 && F.facetPx(k)) inner.a[k] = 1;
  const soft = await maskBlur(maskDilate({ w: cw, h: ch, a: inner.a.map((v, k) => v) }, 0), 2.2);
  for (let k = 0; k < cw * ch; k++) {
    const id = F.lab[k];
    if (id < 0 || !F.facetPx(k)) continue;
    const a = Math.max(0, Math.min(1, (soft.a[k] - 0.35) / 0.65));
    if (a <= 0) continue;
    if (id === table) {
      tableFire.data.set([255, 255, 255, Math.round(a * 235)], k * 4);
    } else if (bandOf.has(id)) {
      const b = bandOf.get(id);
      const t = tints[b % tints.length];
      lights[b].data.set([t[0], t[1], t[2], Math.round(a * 215)], k * 4);
    }
  }

  const layers = [{ name: "glow", raster: await glowFrom(body, [255, 225, 160]) }];
  shards.forEach((r, s) => { if (used[s]) layers.push({ name: `shard_${s}`, raster: r }); });
  lights.forEach((r, b) => layers.push({ name: `light_${b}`, raster: r }));
  layers.push({ name: "table_fire", raster: tableFire });

  // new static art: the clean stone
  await saveWebp(crop(body, bbox(body)), SRC, false);

  const centre = [cw / 2, ch / 2];
  const toSpine = ([x, y]) => [+(x - cw / 2).toFixed(2), +(ch / 2 - y).toFixed(2)];
  const pivots = { glow: centre, table_fire: centre };
  const kids = ["glow", "table_fire"];
  const shardMeta = [];
  shards.forEach((_, s) => {
    if (!used[s]) return;
    const c = [shardCent[s].x / shardCent[s].n, shardCent[s].y / shardCent[s].n];
    pivots[`shard_${s}`] = c;
    kids.push(`shard_${s}`);
    shardMeta.push({ name: `shard_${s}`, centre: toSpine(c) });
  });
  for (let b = 0; b < LIGHT_BANDS; b++) { pivots[`light_${b}`] = centre; kids.push(`light_${b}`); }
  const rig = {
    groups: [{ name: "gem", parent: "symbol_anchor", pivot: centre }],
    parents: Object.fromEntries(kids.map((k) => [k, "gem"])),
    hidden: [...Array.from({ length: LIGHT_BANDS }, (_, b) => `light_${b}`), "table_fire"],
  };
  if (debug) console.error(`diamond: ${F.ids.length} facets -> ${shardMeta.length} shards, ${LIGHT_BANDS} light bands, table facet ${table}`);
  return {
    canvas: [cw, ch], art: [sc.aw, sc.ah], layers, pivots, rig,
    meta: { shards: shardMeta, lights: LIGHT_BANDS },
    checkAgainst: body,
  };
}
