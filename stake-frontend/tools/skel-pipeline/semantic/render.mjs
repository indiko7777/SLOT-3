#!/usr/bin/env node
/**
 * Offline frame renderer for a built symbol — the same pose maths as
 * src/pixi/SkelPlayer.ts, composited through SVG. Use it to eyeball clips for
 * seams, holes behind moving parts and timing, without a browser:
 *
 *   node semantic/render.mjs symbols/<name> <anim> [--every=2] [--frames=0,3,6]
 *        [--cols=8] [--scale=0.4] [--out=sheet.png] [--weight=1]
 *
 * Writes a contact sheet (frame number in each tile's corner).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sharp, load, crop } from "./img.mjs";

const RAD = Math.PI / 180;

function parseAtlas(text) {
  const lines = text.split(/\r?\n/);
  const regions = {};
  let i = 0;
  while (i < lines.length && !lines[i].trim()) i++;
  i++;
  while (i < lines.length && lines[i].includes(":")) i++;
  while (i < lines.length) {
    const name = lines[i].trim(); i++;
    if (!name) continue;
    const r = { x: 0, y: 0, w: 0, h: 0 };
    while (i < lines.length && lines[i].includes(":")) {
      const [k, v] = lines[i].split(":");
      const vals = v.split(",").map((s) => +s.trim());
      if (k.trim() === "xy") { r.x = vals[0]; r.y = vals[1]; }
      if (k.trim() === "size") { r.w = vals[0]; r.h = vals[1]; }
      i++;
    }
    regions[name] = r;
  }
  return regions;
}

const lerpAngle = (a, b, r) => a + ((((b - a) % 360) + 540) % 360 - 180) * r;
function keyAt(frames, t, interp) {
  if (t <= (frames[0].time || 0)) return interp(frames[0], frames[0], 0);
  const last = frames[frames.length - 1];
  if (t >= (last.time || 0)) return interp(last, last, 0);
  let i = 0;
  while (t >= (frames[i + 1].time || 0)) i++;
  const f0 = frames[i], f1 = frames[i + 1];
  const r = f0.curve === "stepped" ? 0 : (t - (f0.time || 0)) / ((f1.time || 0) - (f0.time || 0));
  return interp(f0, f1, r);
}

export function poseAt(data, animName, t, weight = 1) {
  const bones = data.bones.map((b) => ({ ...b, sx: b.x || 0, sy: b.y || 0, srot: b.rotation || 0, ssx: b.scaleX ?? 1, ssy: b.scaleY ?? 1 }));
  const byName = Object.fromEntries(bones.map((b) => [b.name, b]));
  for (const b of bones) { b.px = b.sx; b.py = b.sy; b.rot = b.srot; b.scx = b.ssx; b.scy = b.ssy; }
  const slots = data.slots.map((s) => ({ ...s, att: s.attachment || null, color: s.color || "ffffffff" }));
  const anim = animName ? data.animations[animName] : null;
  if (anim) {
    for (const [bn, tl] of Object.entries(anim.bones || {})) {
      const b = byName[bn]; if (!b) continue;
      if (tl.rotate) b.rot = b.srot + weight * keyAt(tl.rotate, t, (a, c, r) => lerpAngle(a.angle || 0, c.angle || 0, r));
      if (tl.translate) {
        b.px = b.sx + weight * keyAt(tl.translate, t, (a, c, r) => (a.x || 0) + ((c.x || 0) - (a.x || 0)) * r);
        b.py = b.sy + weight * keyAt(tl.translate, t, (a, c, r) => (a.y || 0) + ((c.y || 0) - (a.y || 0)) * r);
      }
      if (tl.scale) {
        const kx = keyAt(tl.scale, t, (a, c, r) => (a.x ?? 1) + ((c.x ?? 1) - (a.x ?? 1)) * r);
        const ky = keyAt(tl.scale, t, (a, c, r) => (a.y ?? 1) + ((c.y ?? 1) - (a.y ?? 1)) * r);
        b.scx = b.ssx * (1 + weight * (kx - 1));
        b.scy = b.ssy * (1 + weight * (ky - 1));
      }
    }
    for (const s of slots) {
      const tl = (anim.slots || {})[s.name];
      if (!tl) continue;
      if (tl.color) s.color = keyAt(tl.color, t, (a, c, r) => {
        const A = a.color || "ffffffff", C = c.color || "ffffffff";
        let out = "";
        for (let i = 0; i < 8; i += 2) {
          const av = parseInt(A.slice(i, i + 2), 16), cv = parseInt(C.slice(i, i + 2), 16);
          out += Math.round(av + (cv - av) * r).toString(16).padStart(2, "0");
        }
        return out;
      });
      if (tl.attachment) {
        let name = s.attachment || null;
        for (const k of tl.attachment) if (t >= (k.time || 0)) name = k.name ?? null;
        s.att = name;
      }
    }
  }
  for (const b of bones) {
    const r = -b.rot * RAD, cos = Math.cos(r), sin = Math.sin(r);
    const l = [cos * b.scx, sin * b.scx, -sin * b.scy, cos * b.scy, b.px, -b.py];
    if (b.parent) {
      const p = byName[b.parent].m;
      b.m = [p[0] * l[0] + p[2] * l[1], p[1] * l[0] + p[3] * l[1], p[0] * l[2] + p[2] * l[3], p[1] * l[2] + p[3] * l[3],
        p[0] * l[4] + p[2] * l[5] + p[4], p[1] * l[4] + p[3] * l[5] + p[5]];
    } else b.m = l;
  }
  return { bones: byName, slots };
}

export async function loadBundle(dir) {
  const name = path.basename(dir);
  const data = JSON.parse(fs.readFileSync(path.join(dir, `${name}.json`), "utf8"));
  const regions = parseAtlas(fs.readFileSync(path.join(dir, `${name}.atlas`), "utf8"));
  const sheet = await load(path.join(dir, "packed.png"));
  const uris = {};
  for (const [rn, r] of Object.entries(regions)) {
    const sub = crop(sheet, [r.x, r.y, r.x + r.w, r.y + r.h]);
    const png = await sharp(Buffer.from(sub.data.buffer), { raw: { width: sub.w, height: sub.h, channels: 4 } }).png().toBuffer();
    uris[rn] = "data:image/png;base64," + png.toString("base64");
  }
  const skin = data.skins.default;
  return { name, data, regions, uris, skin, cw: data.skeleton.width, ch: data.skeleton.height };
}

export function frameSvg(bundle, anim, t, { weight = 1, bg = "#262832", label = "" } = {}) {
  const { data, regions, uris, skin, cw, ch } = bundle;
  const pose = poseAt(data, anim, t, weight);
  let body = "";
  for (const s of pose.slots) {
    if (!s.att) continue;
    const att = (skin[s.name] || {})[s.att];
    if (!att) continue;
    const rn = att.path || s.att;
    const reg = regions[rn];
    const alpha = parseInt(s.color.slice(6, 8), 16) / 255;
    if (!reg || alpha <= 0) continue;
    const m = pose.bones[s.bone].m;
    const ar = -(att.rotation || 0) * RAD, ac = Math.cos(ar), as = Math.sin(ar);
    const kx = ((att.width || reg.w) / reg.w) * (att.scaleX ?? 1);
    const ky = ((att.height || reg.h) / reg.h) * (att.scaleY ?? 1);
    const a11 = ac * kx, a12 = as * kx, a21 = -as * ky, a22 = ac * ky;
    const ax = att.x || 0, ay = -(att.y || 0);
    const M = [m[0] * a11 + m[2] * a12, m[1] * a11 + m[3] * a12, m[0] * a21 + m[2] * a22, m[1] * a21 + m[3] * a22,
      m[0] * ax + m[2] * ay + m[4] + cw / 2, m[1] * ax + m[3] * ay + m[5] + ch / 2];
    const tint = s.color.slice(0, 6).toLowerCase();
    const filt = tint !== "ffffff" ? ` filter="url(#t${tint})"` : "";
    body += `<image href="${uris[rn]}" x="${-reg.w / 2}" y="${-reg.h / 2}" width="${reg.w}" height="${reg.h}" opacity="${alpha.toFixed(3)}" transform="matrix(${M.map((v) => v.toFixed(4)).join(" ")})"${filt}/>`;
  }
  const tints = [...new Set(pose.slots.map((s) => s.color.slice(0, 6).toLowerCase()).filter((c) => c !== "ffffff"))];
  const defs = tints.map((c) => {
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(c.slice(i, i + 2), 16) / 255);
    return `<filter id="t${c}"><feColorMatrix type="matrix" values="${r} 0 0 0 0 0 ${g} 0 0 0 0 0 ${b} 0 0 0 0 0 1 0"/></filter>`;
  }).join("");
  const lab = label ? `<text x="10" y="34" font-family="Arial" font-size="28" fill="#ffffff" fill-opacity="0.8">${label}</text>` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${cw}" height="${ch}" viewBox="0 0 ${cw} ${ch}"><defs>${defs}</defs><rect width="100%" height="100%" fill="${bg}"/>${body}${lab}</svg>`;
}

export async function renderSheet(dir, anim, frames, { cols = 8, scale = 0.4, out, weight = 1 } = {}) {
  const bundle = await loadBundle(dir);
  const tw = Math.round(bundle.cw * scale), th = Math.round(bundle.ch * scale);
  const tiles = [];
  for (const f of frames) {
    const svg = frameSvg(bundle, anim, f / 30, { weight, label: `${anim} ${f}` });
    tiles.push(await sharp(Buffer.from(svg)).resize(tw, th).png().toBuffer());
  }
  const rows = Math.ceil(tiles.length / cols);
  const W = Math.min(cols, tiles.length) * tw, H = rows * th;
  const comp = tiles.map((b, i) => ({ input: b, left: (i % cols) * tw, top: Math.floor(i / cols) * th }));
  await sharp({ create: { width: W, height: H, channels: 3, background: "#000" } }).composite(comp).png().toFile(out);
  return out;
}

const self = path.resolve(fileURLToPath(import.meta.url));
if (process.argv[1] && path.resolve(process.argv[1]) === self) {
  const [dir, anim] = process.argv.slice(2);
  const opt = Object.fromEntries(process.argv.slice(4).filter((a) => a.startsWith("--")).map((a) => a.slice(2).split("=")));
  const data = JSON.parse(fs.readFileSync(path.join(dir, `${path.basename(dir)}.json`), "utf8"));
  const a = data.animations[anim];
  if (!a) { console.error(`no animation ${anim}; have ${Object.keys(data.animations)}`); process.exit(1); }
  let dur = 0;
  const scan = (o) => { if (Array.isArray(o)) o.forEach((k) => { if (typeof k.time === "number") dur = Math.max(dur, k.time); }); else if (o && typeof o === "object") Object.values(o).forEach(scan); };
  scan(a);
  const last = Math.round(dur * 30);
  const every = +(opt.every || 2);
  const frames = opt.frames ? opt.frames.split(",").map(Number) : Array.from({ length: Math.floor(last / every) + 1 }, (_, i) => i * every);
  if (!opt.frames && frames[frames.length - 1] !== last) frames.push(last);
  const out = opt.out || `${dir}/_render_${anim}.png`;
  renderSheet(dir, anim, frames, { cols: +(opt.cols || 8), scale: +(opt.scale || 0.4), out, weight: +(opt.weight || 1) })
    .then((o) => console.log(`${o} (${frames.length} frames, ${last}f)`))
    .catch((e) => { console.error(e); process.exit(1); });
}
