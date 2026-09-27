/**
 * Minimal straight-alpha RGBA raster toolkit on top of sharp, for building
 * semantic skeletal layers (a pistol's slide, individual cartridges, loose
 * bills…) without Pillow.
 *
 * A Raster is { w, h, data: Uint8ClampedArray (RGBA, straight alpha) }.
 * A Mask is { w, h, a: Float32Array } with coverage 0..1.
 *
 * Vector shapes (polygons, painted fills, whole SVG illustrations) are
 * rasterised through sharp's SVG renderer, which gives proper anti-aliasing.
 */
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
// sharp is a stake-frontend devDependency; resolve it from there.
const require = createRequire(path.resolve(HERE, "../../../package.json"));
export const sharp = require("sharp");

export function blank(w, h) {
  return { w, h, data: new Uint8ClampedArray(w * h * 4) };
}

export function clone(r) {
  return { w: r.w, h: r.h, data: new Uint8ClampedArray(r.data) };
}

export async function load(file) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { w: info.width, h: info.height, data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length).slice() };
}

export async function save(r, file) {
  await sharp(Buffer.from(r.data.buffer, r.data.byteOffset, r.data.length), { raw: { width: r.w, height: r.h, channels: 4 } })
    .png({ compressionLevel: 9 })
    .toFile(file);
}

export async function saveWebp(r, file, lossless = true) {
  await sharp(Buffer.from(r.data.buffer, r.data.byteOffset, r.data.length), { raw: { width: r.w, height: r.h, channels: 4 } })
    .webp(lossless ? { lossless: true, effort: 6 } : { quality: 90, alphaQuality: 100, effort: 6 })
    .toFile(file);
}

/** Tight bbox of alpha > thr: [x0, y0, x1, y1) or null. */
export function bbox(r, thr = 0) {
  let x0 = r.w, y0 = r.h, x1 = -1, y1 = -1;
  for (let y = 0; y < r.h; y++) {
    for (let x = 0; x < r.w; x++) {
      if (r.data[(y * r.w + x) * 4 + 3] > thr) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return x1 < 0 ? null : [x0, y0, x1 + 1, y1 + 1];
}

export function crop(r, [x0, y0, x1, y1]) {
  const out = blank(x1 - x0, y1 - y0);
  for (let y = y0; y < y1; y++) {
    const s = (y * r.w + x0) * 4;
    out.data.set(r.data.subarray(s, s + (x1 - x0) * 4), (y - y0) * out.w * 4);
  }
  return out;
}

/** High-quality resize (lanczos3, alpha-aware). */
export async function resize(r, w, h) {
  const { data, info } = await sharp(Buffer.from(r.data.buffer, r.data.byteOffset, r.data.length), { raw: { width: r.w, height: r.h, channels: 4 } })
    .resize(w, h, { kernel: "lanczos3", fit: "fill" })
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { w: info.width, h: info.height, data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length).slice() };
}

/** Straight-alpha "over" composite of src onto dst at (ox, oy), with an
 *  optional coverage mask (in src space) and opacity. Mutates dst. */
export function over(dst, src, ox = 0, oy = 0, { mask = null, opacity = 1 } = {}) {
  for (let y = 0; y < src.h; y++) {
    const dy = y + oy;
    if (dy < 0 || dy >= dst.h) continue;
    for (let x = 0; x < src.w; x++) {
      const dx = x + ox;
      if (dx < 0 || dx >= dst.w) continue;
      const si = (y * src.w + x) * 4;
      let sa = (src.data[si + 3] / 255) * opacity;
      if (mask) sa *= mask.a[y * src.w + x];
      if (sa <= 0) continue;
      const di = (dy * dst.w + dx) * 4;
      const da = dst.data[di + 3] / 255;
      const oa = sa + da * (1 - sa);
      for (let c = 0; c < 3; c++) {
        dst.data[di + c] = (src.data[si + c] * sa + dst.data[di + c] * da * (1 - sa)) / oa;
      }
      dst.data[di + 3] = oa * 255;
    }
  }
  return dst;
}

/** Composite src UNDER dst (dst stays on top). Mutates dst. */
export function under(dst, src, ox = 0, oy = 0) {
  const tmp = blank(dst.w, dst.h);
  over(tmp, src, ox, oy);
  over(tmp, dst, 0, 0);
  dst.data.set(tmp.data);
  return dst;
}

/* ─── masks ─────────────────────────────────────────────────────────── */

export function maskNew(w, h, v = 0) {
  const a = new Float32Array(w * h);
  if (v) a.fill(v);
  return { w, h, a };
}

export function alphaMask(r) {
  const m = maskNew(r.w, r.h);
  for (let i = 0; i < m.a.length; i++) m.a[i] = r.data[i * 4 + 3] / 255;
  return m;
}

/** Keep pixels where pred(r,g,b,a,x,y) is true (hard mask). */
export function colorMask(r, pred) {
  const m = maskNew(r.w, r.h);
  for (let y = 0; y < r.h; y++) {
    for (let x = 0; x < r.w; x++) {
      const i = (y * r.w + x) * 4;
      if (pred(r.data[i], r.data[i + 1], r.data[i + 2], r.data[i + 3], x, y)) m.a[y * r.w + x] = 1;
    }
  }
  return m;
}

export function maskMul(a, b) {
  const m = maskNew(a.w, a.h);
  for (let i = 0; i < m.a.length; i++) m.a[i] = a.a[i] * b.a[i];
  return m;
}

export function maskAdd(a, b) {
  const m = maskNew(a.w, a.h);
  for (let i = 0; i < m.a.length; i++) m.a[i] = Math.min(1, a.a[i] + b.a[i]);
  return m;
}

export function maskSub(a, b) {
  const m = maskNew(a.w, a.h);
  for (let i = 0; i < m.a.length; i++) m.a[i] = Math.max(0, a.a[i] - b.a[i]);
  return m;
}

export function maskInvert(a) {
  const m = maskNew(a.w, a.h);
  for (let i = 0; i < m.a.length; i++) m.a[i] = 1 - a.a[i];
  return m;
}

/** Max-filter dilation by radius px (square-ish, repeated 3x3). */
export function maskDilate(m, radius) {
  let cur = m.a;
  for (let k = 0; k < radius; k++) {
    const nxt = new Float32Array(cur.length);
    for (let y = 0; y < m.h; y++) {
      for (let x = 0; x < m.w; x++) {
        let v = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= m.h) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            if (xx < 0 || xx >= m.w) continue;
            const c = cur[yy * m.w + xx];
            if (c > v) v = c;
          }
        }
        nxt[y * m.w + x] = v;
      }
    }
    cur = nxt;
  }
  return { w: m.w, h: m.h, a: cur };
}

export function maskErode(m, radius) {
  return maskInvert(maskDilate(maskInvert(m), radius));
}

export async function maskBlur(m, sigma) {
  if (sigma <= 0.3) return m;
  const buf = Buffer.alloc(m.w * m.h);
  for (let i = 0; i < m.a.length; i++) buf[i] = Math.round(Math.max(0, Math.min(1, m.a[i])) * 255);
  // sharp widens a 1-channel raw input to sRGB on output; take channel 0 back.
  const out = await sharp(buf, { raw: { width: m.w, height: m.h, channels: 1 } }).blur(sigma).extractChannel(0).raw().toBuffer();
  if (out.length !== m.w * m.h) throw new Error(`maskBlur: expected ${m.w * m.h} bytes, got ${out.length}`);
  const r = maskNew(m.w, m.h);
  for (let i = 0; i < r.a.length; i++) r.a[i] = out[i] / 255;
  return r;
}

/** Flood-fill connected region (4-neighbour) from a seed where pred holds. */
export function floodMask(r, sx, sy, pred) {
  const m = maskNew(r.w, r.h);
  const stack = [sx, sy];
  const seen = new Uint8Array(r.w * r.h);
  while (stack.length) {
    const y = stack.pop(), x = stack.pop();
    if (x < 0 || y < 0 || x >= r.w || y >= r.h) continue;
    const k = y * r.w + x;
    if (seen[k]) continue;
    seen[k] = 1;
    const i = k * 4;
    if (!pred(r.data[i], r.data[i + 1], r.data[i + 2], r.data[i + 3], x, y)) continue;
    m.a[k] = 1;
    stack.push(x + 1, y, x - 1, y, x, y + 1, x, y - 1);
  }
  return m;
}

/** Keep only 8-connected components of a binary mask with >= minArea pixels. */
export function keepLarge(m, minArea) {
  const w = m.w, h = m.h;
  const label = new Int32Array(w * h).fill(-1);
  const out = maskNew(w, h);
  const stack = [];
  for (let s = 0; s < w * h; s++) {
    if (m.a[s] < 0.5 || label[s] >= 0) continue;
    const comp = [];
    stack.push(s);
    label[s] = s;
    while (stack.length) {
      const k = stack.pop();
      comp.push(k);
      const x = k % w, y = (k / w) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const kk = yy * w + xx;
        if (m.a[kk] >= 0.5 && label[kk] < 0) { label[kk] = s; stack.push(kk); }
      }
    }
    if (comp.length >= minArea) for (const k of comp) out.a[k] = 1;
  }
  return out;
}

/** Rasterise SVG markup to a Raster of size (w, h). */
export async function svgRaster(svg, w, h) {
  const { data, info } = await sharp(Buffer.from(svg), { density: 72 })
    .resize(w, h, { fit: "fill" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { w: info.width, h: info.height, data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length).slice() };
}

/** Anti-aliased polygon/path coverage mask via SVG. `d` is an SVG path. */
export async function pathMask(d, w, h) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><path d="${d}" fill="#fff"/></svg>`;
  return alphaMask(await svgRaster(svg, w, h));
}

export function polyPath(pts) {
  return "M" + pts.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(" L") + " Z";
}

/** Copy of r with alpha multiplied by mask. */
export function applyMask(r, m) {
  const out = clone(r);
  for (let i = 0; i < m.a.length; i++) out.data[i * 4 + 3] = Math.round(out.data[i * 4 + 3] * Math.max(0, Math.min(1, m.a[i])));
  return out;
}

/** Solid-colour layer with a mask as alpha. */
export function fillMask(m, [r, g, b], alpha = 1) {
  const out = blank(m.w, m.h);
  for (let i = 0; i < m.a.length; i++) {
    const a = Math.max(0, Math.min(1, m.a[i] * alpha));
    if (a <= 0) continue;
    out.data[i * 4] = r; out.data[i * 4 + 1] = g; out.data[i * 4 + 2] = b; out.data[i * 4 + 3] = Math.round(a * 255);
  }
  return out;
}

/**
 * Inpaint `hole` (mask) in r from its surroundings by iterative diffusion
 * (repeated neighbour averaging of known pixels). Good for flat/soft areas —
 * a painted cover under a moving part, a small watermark on a dark wall.
 */
export function diffuseFill(r, hole, iters = 400) {
  const out = clone(r);
  const w = r.w, h = r.h;
  const known = new Uint8Array(w * h);
  for (let i = 0; i < known.length; i++) known[i] = hole.a[i] > 0.02 ? 0 : 1;
  const acc = new Float32Array(w * h * 4);
  for (let i = 0; i < w * h; i++) for (let c = 0; c < 4; c++) acc[i * 4 + c] = out.data[i * 4 + c];
  for (let it = 0; it < iters; it++) {
    let changed = 0;
    const next = new Float32Array(acc);
    const nk = new Uint8Array(known);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const k = y * w + x;
        if (hole.a[k] <= 0.02) continue;
        let n = 0; const s = [0, 0, 0, 0];
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          const kk = yy * w + xx;
          if (!known[kk]) continue;
          const wt = dx && dy ? 0.7 : 1;
          for (let c = 0; c < 4; c++) s[c] += acc[kk * 4 + c] * wt;
          n += wt;
        }
        if (n > 0) {
          for (let c = 0; c < 4; c++) next[k * 4 + c] = s[c] / n;
          if (!known[k]) { nk[k] = 1; changed++; }
        }
      }
    }
    acc.set(next);
    known.set(nk);
    if (!changed && it > 20) break;
  }
  for (let i = 0; i < w * h; i++) {
    const t = Math.max(0, Math.min(1, hole.a[i]));
    if (t <= 0) continue;
    for (let c = 0; c < 4; c++) out.data[i * 4 + c] = r.data[i * 4 + c] * (1 - t) + acc[i * 4 + c] * t;
  }
  return out;
}

/** Luminance helper. */
export const lum = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;

/** Place art (Raster) centred on a canvas the way make_parts_generic does:
 *  art scaled to 72% of max_side, canvas = art / 0.72 rounded to even. */
export async function standardCanvas(art, maxSide = 712) {
  const bb = bbox(art);
  const trimmed = crop(art, bb);
  const scale = (maxSide * 0.72) / Math.max(trimmed.w, trimmed.h);
  const aw = Math.max(1, Math.round(trimmed.w * scale));
  const ah = Math.max(1, Math.round(trimmed.h * scale));
  const scaled = await resize(trimmed, aw, ah);
  const cw = Math.max(64, Math.floor(Math.round(aw / 0.72) / 2) * 2);
  const ch = Math.max(64, Math.floor(Math.round(ah / 0.72) / 2) * 2);
  const ox = Math.floor((cw - aw) / 2), oy = Math.floor((ch - ah) / 2);
  const body = blank(cw, ch);
  over(body, scaled, ox, oy);
  // map from source-art pixel coords -> canvas coords
  const map = (x, y) => [ox + (x - bb[0]) * scale, oy + (y - bb[1]) * scale];
  return { body, cw, ch, ox, oy, aw, ah, scale, srcBox: bb, map };
}

/** Soft silhouette aura like make_parts_generic's glow layer. */
export async function glowFrom(body, tint, maxSide = 712) {
  const a = alphaMask(body);
  // inflate 5% about the centre
  const big = maskNew(body.w, body.h);
  const s = 1.05, cx = body.w / 2, cy = body.h / 2;
  for (let y = 0; y < body.h; y++) {
    for (let x = 0; x < body.w; x++) {
      const sx = Math.round(cx + (x - cx) / s), sy = Math.round(cy + (y - cy) / s);
      if (sx >= 0 && sy >= 0 && sx < body.w && sy < body.h) big.a[y * body.w + x] = a.a[sy * body.w + sx];
    }
  }
  const soft = await maskBlur(big, Math.max(6, Math.floor(maxSide * 0.045)));
  for (let i = 0; i < soft.a.length; i++) soft.a[i] = Math.min(1, soft.a[i] * 0.8);
  return fillMask(soft, tint, 1);
}

/** The art's own bright, low-saturation highlights lifted into a layer (the
 *  same rule make_parts_generic uses), optionally restricted by a mask. */
export async function shineFrom(body, restrict = null) {
  const out = blank(body.w, body.h);
  for (let i = 0; i < body.w * body.h; i++) {
    const r = body.data[i * 4], g = body.data[i * 4 + 1], b = body.data[i * 4 + 2], al = body.data[i * 4 + 3];
    if (al <= 40) continue;
    if (restrict && restrict.a[i] < 0.5) continue;
    const L = lum(r, g, b);
    const sat = Math.max(r, g, b) - Math.min(r, g, b);
    if (L > 190 && sat < 90) {
      out.data[i * 4] = 255; out.data[i * 4 + 1] = 252; out.data[i * 4 + 2] = 245;
      out.data[i * 4 + 3] = Math.min(al, Math.min(255, Math.round((L - 190) * 4.2)));
    }
  }
  return blurRaster(out, 1.1);
}

export async function blurRaster(r, sigma) {
  if (sigma <= 0.3) return r;
  // blur premultiplied to avoid dark fringes
  const pre = Buffer.alloc(r.w * r.h * 4);
  for (let i = 0; i < r.w * r.h; i++) {
    const a = r.data[i * 4 + 3] / 255;
    pre[i * 4] = r.data[i * 4] * a; pre[i * 4 + 1] = r.data[i * 4 + 1] * a; pre[i * 4 + 2] = r.data[i * 4 + 2] * a; pre[i * 4 + 3] = r.data[i * 4 + 3];
  }
  const out = await sharp(pre, { raw: { width: r.w, height: r.h, channels: 4 } }).blur(sigma).raw().toBuffer();
  const res = blank(r.w, r.h);
  for (let i = 0; i < r.w * r.h; i++) {
    const a = out[i * 4 + 3];
    if (!a) continue;
    const k = 255 / a;
    res.data[i * 4] = out[i * 4] * k; res.data[i * 4 + 1] = out[i * 4 + 1] * k; res.data[i * 4 + 2] = out[i * 4 + 2] * k; res.data[i * 4 + 3] = a;
  }
  return res;
}

/** Composite a list of rasters (bottom first) onto a background colour — for
 *  debug previews. */
export function flatten(layers, bg = [38, 40, 50]) {
  const w = layers[0].w, h = layers[0].h;
  const out = blank(w, h);
  for (let i = 0; i < w * h; i++) { out.data[i * 4] = bg[0]; out.data[i * 4 + 1] = bg[1]; out.data[i * 4 + 2] = bg[2]; out.data[i * 4 + 3] = 255; }
  for (const l of layers) over(out, l);
  return out;
}

export const HERE_DIR = HERE;
