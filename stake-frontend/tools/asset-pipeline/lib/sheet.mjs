/** Sprite-sheet packer. Lays equally-sized animation frames into a grid and emits
 *  a Pixi v8-native spritesheet atlas (TexturePacker JSON-hash format) plus the
 *  composite PNG. Pixi's Assets.load(atlas.json) then exposes
 *  spritesheet.animations[name] as a Texture[] ready for an AnimatedSprite. */
import sharp from "sharp";
import { writeFile } from "node:fs/promises";
import { dirname, basename } from "node:path";

/**
 * @param {object} opts
 * @param {string} opts.name        animation name, e.g. "safe_win"
 * @param {Array<Buffer>} opts.frames  RGBA PNG buffers, all the SAME size
 * @param {string} opts.outPng      absolute path for the sheet PNG
 * @param {string} opts.outJson     absolute path for the atlas JSON
 * @param {number} [opts.fps]       playback hint stored in meta
 * @returns {Promise<{sheetKb:number, frameCount:number, cell:{w:number,h:number}, grid:{cols:number,rows:number}}>}
 */
export async function packSheet({ name, frames, outPng, outJson, fps = 16 }) {
  if (!frames.length) throw new Error(`packSheet(${name}): no frames`);

  // All frames must share dimensions — normalize to the max W/H, centered.
  const metas = await Promise.all(frames.map((f) => sharp(f).metadata()));
  const cellW = Math.max(...metas.map((m) => m.width));
  const cellH = Math.max(...metas.map((m) => m.height));

  const normalized = await Promise.all(
    frames.map((f) =>
      sharp(f)
        .resize(cellW, cellH, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .toBuffer()
    )
  );

  const cols = Math.ceil(Math.sqrt(frames.length));
  const rows = Math.ceil(frames.length / cols);
  const sheetW = cols * cellW;
  const sheetH = rows * cellH;

  const composites = normalized.map((buf, i) => ({
    input: buf,
    left: (i % cols) * cellW,
    top: Math.floor(i / cols) * cellH,
  }));

  const sheet = await sharp({
    create: { width: sheetW, height: sheetH, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite(composites)
    .png({ palette: true, colors: 256, effort: 9, compressionLevel: 9 })
    .toBuffer();

  await writeFile(outPng, sheet);

  // Build Pixi spritesheet JSON (hash format).
  const frameNames = frames.map((_, i) => `${name}_${String(i).padStart(2, "0")}.png`);
  const framesObj = {};
  frameNames.forEach((fn, i) => {
    framesObj[fn] = {
      frame: { x: (i % cols) * cellW, y: Math.floor(i / cols) * cellH, w: cellW, h: cellH },
      rotated: false,
      trimmed: false,
      spriteSourceSize: { x: 0, y: 0, w: cellW, h: cellH },
      sourceSize: { w: cellW, h: cellH },
    };
  });

  const atlas = {
    frames: framesObj,
    animations: { [name]: frameNames },
    meta: {
      app: "getaway-asset-pipeline",
      image: basename(outPng),
      format: "RGBA8888",
      size: { w: sheetW, h: sheetH },
      scale: "1",
      fps, // custom hint, ignored by Pixi but read by SymbolView
    },
  };
  await writeFile(outJson, JSON.stringify(atlas));

  return {
    sheetKb: sheet.length / 1024,
    frameCount: frames.length,
    cell: { w: cellW, h: cellH },
    grid: { cols, rows },
  };
}

export const sheetDir = (root) => dirname(root);
