// Chroma-key a Gemini render (object on a flat green/blue/magenta screen) into a
// trimmed transparent PNG.
//
//   node chroma_key.cjs <input.jpg> <output.png> [green|blue|magenta]
//
// - alpha from key-colour dominance (e.g. g - max(r,b) for green), soft ramp
// - only key pixels CONNECTED TO THE IMAGE BORDER become transparent; key colour
//   seen through glass/holes INSIDE the object becomes tinted dark glass instead
//   of a hole (car windows, gaps between fingers...)
// - despill: kept pixels may not lean toward the key colour
// - trims to the object's bounding box (+8px)
//
// Pick the screen colour the object does NOT contain: green for most things,
// BLUE (#0000FF) for green objects (palms, a green pistol), MAGENTA (#FF00FF)
// otherwise. Needs `sharp` (npm i -D sharp).
const sharp = require("sharp");
const args = process.argv.slice(2);
// --global: key EVERY screen-coloured pixel (logos/lettering: the counters of
// A, E, R... must be see-through, not tinted glass).
const GLOBAL = args.includes("--global");
const [src, out, keyName = "green"] = args.filter((a) => !a.startsWith("--"));
if (!src || !out) {
  console.error("usage: node chroma_key.cjs <input> <output.png> [green|blue|magenta]");
  process.exit(1);
}

// dominance(r,g,b) > 0 means "looks like the screen"
const KEYS = {
  green: (r, g, b) => g - Math.max(r, b),
  blue: (r, g, b) => b - Math.max(r, g),
  magenta: (r, g, b) => Math.min(r, b) - g,
};
const DESPILL = {
  green: (p) => { const cap = Math.max(p[0], p[2]); if (p[1] > cap) p[1] = cap; },
  blue: (p) => { const cap = Math.max(p[0], p[1]); if (p[2] > cap) p[2] = cap; },
  magenta: (p) => { const cap = Math.max(p[1], Math.min(p[0], p[2]) * 0.85); if (p[0] > cap && p[2] > cap) { p[0] = Math.min(p[0], cap + 30); p[2] = Math.min(p[2], cap + 30); } },
};
const dominance = KEYS[keyName];
if (!dominance) throw new Error(`unknown key ${keyName}`);

(async () => {
  const { data, info } = await sharp(src).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: W, height: H } = info;
  const N = W * H;
  const LO = 28, HI = 110; // dominance ramp: <=LO opaque, >=HI fully keyed
  const dom = new Float32Array(N);
  for (let i = 0; i < N; i++) dom[i] = dominance(data[i * 3], data[i * 3 + 1], data[i * 3 + 2]);

  // Background = key-coloured pixels connected to the border (flood fill).
  const outside = new Uint8Array(N);
  const stack = [];
  for (let x = 0; x < W; x++) stack.push(x, (H - 1) * W + x);
  for (let y = 0; y < H; y++) stack.push(y * W, y * W + W - 1);
  while (stack.length) {
    const i = stack.pop();
    if (outside[i] || dom[i] <= LO) continue;
    outside[i] = 1;
    const x = i % W, y = (i / W) | 0;
    if (x > 0) stack.push(i - 1);
    if (x < W - 1) stack.push(i + 1);
    if (y > 0) stack.push(i - W);
    if (y < H - 1) stack.push(i + W);
  }
  if (GLOBAL) for (let i = 0; i < N; i++) if (dom[i] > LO) outside[i] = 1;
  // Grow 2px so the soft ramp applies at the rim.
  const near = new Uint8Array(outside);
  for (let pass = 0; pass < 2; pass++) {
    const prev = new Uint8Array(near);
    for (let i = 0; i < N; i++) {
      if (prev[i]) continue;
      const x = i % W;
      if ((x > 0 && prev[i - 1]) || (x < W - 1 && prev[i + 1]) || (i >= W && prev[i - W]) || (i < N - W && prev[i + W])) near[i] = 1;
    }
  }

  const rgba = Buffer.alloc(N * 4);
  const glass = [34, 28, 48];
  for (let i = 0; i < N; i++) {
    const p = [data[i * 3], data[i * 3 + 1], data[i * 3 + 2]];
    let a = 255;
    const d = dom[i];
    if (d > LO) {
      const t = Math.min(1, (d - LO) / (HI - LO));
      if (near[i]) a = Math.round(255 * (1 - t));
      else {
        for (let c = 0; c < 3; c++) p[c] = Math.round(p[c] * (1 - t) + glass[c] * t);
        a = Math.round(255 * (1 - 0.12 * t));
      }
    }
    DESPILL[keyName](p);
    rgba[i * 4] = p[0]; rgba[i * 4 + 1] = p[1]; rgba[i * 4 + 2] = p[2]; rgba[i * 4 + 3] = a;
  }

  let x0 = W, y0 = H, x1 = 0, y1 = 0;
  for (let i = 0; i < N; i++) if (rgba[i * 4 + 3] > 24) {
    const x = i % W, y = (i / W) | 0;
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  const m = 8;
  x0 = Math.max(0, x0 - m); y0 = Math.max(0, y0 - m); x1 = Math.min(W - 1, x1 + m); y1 = Math.min(H - 1, y1 + m);
  await sharp(rgba, { raw: { width: W, height: H, channels: 4 } })
    .extract({ left: x0, top: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 })
    .png({ compressionLevel: 9 })
    .toFile(out);
  console.log(`${out}: ${x1 - x0 + 1}x${y1 - y0 + 1}`);
})();
