// Keep only the largest connected opaque region of a keyed PNG (drops ghosts,
// specks), then trim.  node keep_main.cjs in.png out.png [alphaThreshold]
const sharp = require("sharp");
const [, , src, out, thrA] = process.argv;
const T = +(thrA || 24);
(async () => {
  const { data, info } = await sharp(src).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height, N = W * H;
  const lab = new Int32Array(N).fill(-1);
  let best = -1, bestSize = 0, id = 0;
  const sizes = [];
  const stack = new Int32Array(N);
  for (let i = 0; i < N; i++) {
    if (lab[i] !== -1 || data[i * 4 + 3] <= T) continue;
    let sp = 0, size = 0;
    stack[sp++] = i; lab[i] = id;
    while (sp) {
      const k = stack[--sp]; size++;
      const x = k % W, y = (k / W) | 0;
      const nb = [x > 0 ? k - 1 : -1, x < W - 1 ? k + 1 : -1, y > 0 ? k - W : -1, y < H - 1 ? k + W : -1];
      for (const n of nb) if (n >= 0 && lab[n] === -1 && data[n * 4 + 3] > T) { lab[n] = id; stack[sp++] = n; }
    }
    sizes.push(size);
    if (size > bestSize) { bestSize = size; best = id; }
    id++;
  }
  let x0 = W, y0 = H, x1 = 0, y1 = 0;
  for (let i = 0; i < N; i++) {
    const keep = lab[i] === best || (lab[i] === -1 && data[i * 4 + 3] > 0 && near(i));
    if (!keep) { data[i * 4 + 3] = 0; continue; }
    const x = i % W, y = (i / W) | 0;
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  // soft edge pixels (alpha <= T) survive only when they touch the kept region
  function near(i) {
    const x = i % W, y = (i / W) | 0;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx >= 0 && yy >= 0 && xx < W && yy < H && lab[yy * W + xx] === best) return true;
    }
    return false;
  }
  const m = 4;
  x0 = Math.max(0, x0 - m); y0 = Math.max(0, y0 - m); x1 = Math.min(W - 1, x1 + m); y1 = Math.min(H - 1, y1 + m);
  await sharp(data, { raw: { width: W, height: H, channels: 4 } }).extract({ left: x0, top: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 }).png().toFile(out);
  console.log(out, x1 - x0 + 1, "x", y1 - y0 + 1, "components:", sizes.length, "kept:", bestSize);
})();
