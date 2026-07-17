/**
 * SkelPlayer - plays Spine-3.8-format skeletal animation JSON in plain Pixi v8.
 * No Spine runtime code, no pixi-spine dependency, no Spine license needed.
 *
 * Supports: bone rotate/translate/scale timelines, slot color (alpha+tint),
 * attachment swaps, stepped keys, draw order = slot order. Not supported: meshes,
 * IK, draworder timelines, curve arrays (keep JSON import-safe per AGENTS.md).
 *
 * Usage:
 *   import { SkelPlayer } from './SkelPlayer.js';
 *   const p = await SkelPlayer.load({ json:'gem/gem.json', atlas:'gem/gem.atlas', png:'gem/packed.png' });
 *   app.stage.addChild(p);            // origin = symbol centre
 *   app.ticker.add(tk => p.update(tk.deltaMS / 1000));
 *   p.play('drop', { onComplete: () => p.play('idle', { loop:true }) });
 */
import { Assets, Container, Matrix, Rectangle, Sprite, Texture } from 'pixi.js';

const RAD = Math.PI / 180;

function parseAtlas(text) {
  const lines = text.split(/\r?\n/);
  const regions = {};
  let i = 0;
  while (i < lines.length && !lines[i].trim()) i++;
  i++;                                              // page name
  while (i < lines.length && lines[i].includes(':')) i++; // page props
  while (i < lines.length) {
    const name = lines[i].trim(); i++;
    if (!name) continue;
    const r = { rotate: false, x: 0, y: 0, w: 0, h: 0 };
    while (i < lines.length && lines[i].includes(':')) {
      const idx = lines[i].indexOf(':');
      const k = lines[i].slice(0, idx).trim();
      const vals = lines[i].slice(idx + 1).split(',').map(s => s.trim());
      if (k === 'rotate') r.rotate = vals[0] === 'true' || vals[0] === '90';
      else if (k === 'xy') { r.x = +vals[0]; r.y = +vals[1]; }
      else if (k === 'size') { r.w = +vals[0]; r.h = +vals[1]; }
      i++;
    }
    regions[name] = r;
  }
  return regions;
}

const lerpAngle = (a, b, r) => a + (((b - a) % 360 + 540) % 360 - 180) * r;

function keyAt(frames, t, interp) {
  if (t <= (frames[0].time || 0)) return interp(frames[0], frames[0], 0);
  const last = frames[frames.length - 1];
  if (t >= (last.time || 0)) return interp(last, last, 0);
  let i = 0;
  while (t >= (frames[i + 1].time || 0)) i++;
  const f0 = frames[i], f1 = frames[i + 1];
  const r = f0.curve === 'stepped' ? 0 : (t - (f0.time || 0)) / ((f1.time || 0) - (f0.time || 0));
  return interp(f0, f1, r);
}

export class SkelPlayer extends Container {
  static async load({ json, atlas, png }) {
    const [data, atlasText, baseTex] = await Promise.all([
      fetch(json).then(r => r.json()),
      fetch(atlas).then(r => r.text()),
      Assets.load(png),
    ]);
    return new SkelPlayer(data, atlasText, baseTex);
  }

  constructor(data, atlasText, baseTexture) {
    super();
    this._regions = parseAtlas(atlasText);
    this._base = baseTexture;
    this._texCache = new Map();
    this._anims = data.animations || {};
    this._buildSkeleton(data);
    this._cur = null; this._t = 0; this._loop = false;
    this._speed = 1; this._playing = false; this._onComplete = null;
    this._pose(null, 0);
  }

  _texture(name) {
    if (this._texCache.has(name)) return this._texCache.get(name);
    const r = this._regions[name];
    if (!r) return null;
    const tex = new Texture({
      source: this._base.source ?? this._base,
      frame: r.rotate ? new Rectangle(r.x, r.y, r.h, r.w) : new Rectangle(r.x, r.y, r.w, r.h),
      rotate: r.rotate ? 2 : 0,
    });
    this._texCache.set(name, tex);
    return tex;
  }

  _buildSkeleton(data) {
    this._bones = [];
    this._byName = {};
    for (const b of data.bones) {
      const bone = {
        name: b.name, parent: b.parent ? this._byName[b.parent] : null,
        sx: b.x || 0, sy: b.y || 0, srot: b.rotation || 0,
        ssx: b.scaleX ?? 1, ssy: b.scaleY ?? 1,
        x: 0, y: 0, rot: 0, scx: 1, scy: 1, m: [1, 0, 0, 1, 0, 0],
      };
      this._bones.push(bone);
      this._byName[b.name] = bone;
    }
    let skin = data.skins;
    if (Array.isArray(skin)) skin = (skin.find(s => s.name === 'default') || skin[0]).attachments;
    else skin = skin.default || {};
    this._slots = data.slots.map(s => {
      const slot = {
        name: s.name, bone: this._byName[s.bone],
        setupAtt: s.attachment || null, att: null,
        setupColor: s.color || 'ffffffff', color: 'ffffffff',
        atts: skin[s.name] || {},
        sprite: new Sprite(),
      };
      slot.sprite.anchor.set(0.5);
      this.addChild(slot.sprite);   // flat, in slot order => correct draw order
      return slot;
    });
    this._slotByName = {};
    for (const s of this._slots) this._slotByName[s.name] = s;
  }

  get animations() { return Object.keys(this._anims); }

  duration(name) {
    let d = 0;
    const scan = o => {
      for (const k in o) {
        const v = o[k];
        if (Array.isArray(v)) { for (const f of v) d = Math.max(d, f.time || 0); }
        else if (v && typeof v === 'object') scan(v);
      }
    };
    if (this._anims[name]) scan(this._anims[name]);
    return d;
  }

  play(name, { loop = false, speed = 1, onComplete = null } = {}) {
    if (!this._anims[name]) throw new Error(`unknown animation: ${name}`);
    this._cur = name; this._t = 0; this._loop = loop;
    this._speed = speed; this._onComplete = onComplete; this._playing = true;
    this._pose(name, 0);
    return this;
  }

  stop() { this._playing = false; }

  /** call every frame with elapsed seconds */
  update(dt) {
    if (!this._playing || !this._cur) return;
    const dur = this.duration(this._cur);
    this._t += dt * this._speed;
    if (dur > 0 && this._t >= dur) {
      if (this._loop) this._t %= dur;
      else {
        this._t = dur; this._playing = false;
        const cb = this._onComplete; this._onComplete = null;
        this._pose(this._cur, this._t);
        if (cb) cb();
        return;
      }
    }
    this._pose(this._cur, this._t);
  }

  _pose(animName, t) {
    for (const b of this._bones) {
      b.x = b.sx; b.y = b.sy; b.rot = b.srot; b.scx = b.ssx; b.scy = b.ssy;
    }
    for (const s of this._slots) { s.att = s.setupAtt; s.color = s.setupColor; }
    const anim = animName ? this._anims[animName] : null;
    if (anim) {
      for (const bn in (anim.bones || {})) {
        const b = this._byName[bn]; if (!b) continue;
        const tl = anim.bones[bn];
        if (tl.rotate) b.rot = b.srot + keyAt(tl.rotate, t, (a, c, r) => lerpAngle(a.angle || 0, c.angle || 0, r));
        if (tl.translate) {
          b.x = b.sx + keyAt(tl.translate, t, (a, c, r) => (a.x || 0) + ((c.x || 0) - (a.x || 0)) * r);
          b.y = b.sy + keyAt(tl.translate, t, (a, c, r) => (a.y || 0) + ((c.y || 0) - (a.y || 0)) * r);
        }
        if (tl.scale) {
          b.scx = b.ssx * keyAt(tl.scale, t, (a, c, r) => { const av = a.x ?? 1, cv = c.x ?? 1; return av + (cv - av) * r; });
          b.scy = b.ssy * keyAt(tl.scale, t, (a, c, r) => { const av = a.y ?? 1, cv = c.y ?? 1; return av + (cv - av) * r; });
        }
      }
      for (const sn in (anim.slots || {})) {
        const s = this._slotByName[sn]; if (!s) continue;
        const tl = anim.slots[sn];
        if (tl.color) s.color = keyAt(tl.color, t, (a, c, r) => {
          const A = a.color || 'ffffffff', C = c.color || 'ffffffff';
          let out = '';
          for (let i = 0; i < 8; i += 2) {
            const av = parseInt(A.slice(i, i + 2), 16), cv = parseInt(C.slice(i, i + 2), 16);
            out += Math.round(av + (cv - av) * r).toString(16).padStart(2, '0');
          }
          return out;
        });
        if (tl.attachment) {
          let name = s.setupAtt;
          for (const k of tl.attachment) { if (t >= (k.time || 0)) name = k.name; }
          s.att = name;
        }
      }
    }
    // world transforms: Spine y-up/CCW-deg -> Pixi y-down at compose time
    for (const b of this._bones) {
      const r = -b.rot * RAD, cos = Math.cos(r), sin = Math.sin(r);
      const l11 = cos * b.scx, l12 = sin * b.scx, l21 = -sin * b.scy, l22 = cos * b.scy;
      const lx = b.x, ly = -b.y;
      if (b.parent) {
        const p = b.parent.m;
        b.m = [p[0] * l11 + p[2] * l12, p[1] * l11 + p[3] * l12,
               p[0] * l21 + p[2] * l22, p[1] * l21 + p[3] * l22,
               p[0] * lx + p[2] * ly + p[4], p[1] * lx + p[3] * ly + p[5]];
      } else b.m = [l11, l12, l21, l22, lx, ly];
    }
    // apply to sprites
    const M = new Matrix();
    for (const s of this._slots) {
      const sp = s.sprite;
      const attName = s.att, att = attName ? s.atts[attName] : null;
      const reg = att ? this._regions[att.path || attName] : null;
      const alpha = parseInt((s.color || 'ffffffff').slice(6, 8), 16) / 255;
      if (!att || !reg || alpha <= 0) { sp.visible = false; continue; }
      sp.visible = true;
      sp.texture = this._texture(att.path || attName);
      sp.alpha = alpha;
      sp.tint = parseInt((s.color || 'ffffffff').slice(0, 6), 16);
      // full matrix: boneWorld * attLocal * sizeScale
      const ar = -(att.rotation || 0) * RAD, ac = Math.cos(ar), as = Math.sin(ar);
      const kx = ((att.width || reg.w) / reg.w) * (att.scaleX ?? 1);
      const ky = ((att.height || reg.h) / reg.h) * (att.scaleY ?? 1);
      const a11 = ac * kx, a12 = as * kx, a21 = -as * ky, a22 = ac * ky;
      const ax = att.x || 0, ay = -(att.y || 0);
      const m = s.bone.m;
      M.set(
        m[0] * a11 + m[2] * a12, m[1] * a11 + m[3] * a12,
        m[0] * a21 + m[2] * a22, m[1] * a21 + m[3] * a22,
        m[0] * ax + m[2] * ay + m[4], m[1] * ax + m[3] * ay + m[5],
      );
      sp.setFromMatrix(M);
    }
  }
}
