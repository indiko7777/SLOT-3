// Car body + two rim plates from the keyed side-profile render.
//   body: rims cut out and backed with a dark wheel-barrel disc
//   rim_f / rim_r: the rims alone (circular, transparent outside / in gaps)
const sharp = require("sharp");
const SRC = "raw/v9/car_side_clean.png";
const OUT = "../../public/assets/driveby";
const W_OUT = 1400;
const RIMS = [{ name: "rim_f", cx: 571.5, cy: 568.5 }, { name: "rim_r", cx: 2062.5, cy: 564 }];
const R = 148; // rim radius in source px (measured 142-144 + a hair of tyre lip)
(async () => {
  require("fs").mkdirSync(OUT, { recursive: true });
  const { data, info } = await sharp(SRC).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height;
  const body = Buffer.from(data);
  for (const rim of RIMS) {
    const x0 = Math.floor(rim.cx - R), y0 = Math.floor(rim.cy - R), S = R * 2 + 2;
    const plate = Buffer.alloc(S * S * 4);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const sx = x0 + x, sy = y0 + y;
      if (sx < 0 || sy < 0 || sx >= W || sy >= H) continue;
      const d = Math.hypot(sx - rim.cx, sy - rim.cy);
      if (d > R) continue;
      const si = (sy * W + sx) * 4, pi = (y * S + x) * 4;
      // soft 1.5px edge so the spinning plate never shows a stair-step rim
      const edge = Math.max(0, Math.min(1, (R - d) / 1.5));
      plate[pi] = data[si]; plate[pi + 1] = data[si + 1]; plate[pi + 2] = data[si + 2];
      plate[pi + 3] = Math.round(data[si + 3] * edge);
      // body: replace the rim with the dark barrel / brake behind it
      const k = d / R;
      const shade = Math.round(10 + 22 * k);
      body[si] = shade; body[si + 1] = shade; body[si + 2] = shade + 3; body[si + 3] = 255;
    }
    const scale = W_OUT / W;
    const outS = Math.round(S * scale);
    await sharp(plate, { raw: { width: S, height: S, channels: 4 } }).resize(outS, outS).webp({ quality: 90, alphaQuality: 100 }).toFile(`${OUT}/${rim.name}.webp`);
    console.log(rim.name, "center(out px)", ((rim.cx) * scale).toFixed(1), ((rim.cy) * scale).toFixed(1), "size", outS);
  }
  const outH = Math.round(H * W_OUT / W);
  const info2 = await sharp(body, { raw: { width: W, height: H, channels: 4 } }).resize(W_OUT, outH).webp({ quality: 88, alphaQuality: 100 }).toFile(`${OUT}/car_body.webp`);
  console.log("car_body", W_OUT, outH, info2.size);
})();
