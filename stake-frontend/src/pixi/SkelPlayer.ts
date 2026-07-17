/**
 * SkelPlayer — plays Spine-3.8-format skeletal animation JSON in plain Pixi v8.
 * TypeScript port of tools/skel-pipeline/player/SkelPlayer.js (from-scratch
 * implementation of the public JSON format — no Spine runtime code, no license).
 *
 * Supports: bone rotate/translate/scale timelines, slot color (alpha+tint),
 * attachment swaps, stepped keys, draw order = slot order. Not supported:
 * meshes, IK, draworder timelines, curve arrays (import-safe JSON only).
 *
 * Bundles are produced by tools/skel-pipeline (pack_atlas → make_skeleton →
 * gen_anim → validate) and live in public/assets/skel/<symbol>/.
 */
import { Container, Matrix, Rectangle, Sprite, Texture } from "pixi.js";

const RAD = Math.PI / 180;

interface AtlasRegion { rotate: boolean; x: number; y: number; w: number; h: number }

interface KeyFrame {
  time?: number;
  curve?: string;
  angle?: number;
  x?: number;
  y?: number;
  color?: string;
  name?: string | null;
}

interface Attachment {
  path?: string;
  x?: number; y?: number;
  rotation?: number;
  scaleX?: number; scaleY?: number;
  width?: number; height?: number;
}

interface BoneData { name: string; parent?: string; x?: number; y?: number; rotation?: number; scaleX?: number; scaleY?: number }
interface SlotData { name: string; bone: string; attachment?: string; color?: string }

export interface SkelData {
  bones: BoneData[];
  slots: SlotData[];
  skins: { default?: Record<string, Record<string, Attachment>> } | Array<{ name: string; attachments: Record<string, Record<string, Attachment>> }>;
  animations?: Record<string, AnimData>;
}

interface AnimData {
  bones?: Record<string, { rotate?: KeyFrame[]; translate?: KeyFrame[]; scale?: KeyFrame[] }>;
  slots?: Record<string, { color?: KeyFrame[]; attachment?: KeyFrame[] }>;
}

interface Bone {
  name: string; parent: Bone | null;
  sx: number; sy: number; srot: number; ssx: number; ssy: number;
  x: number; y: number; rot: number; scx: number; scy: number;
  m: [number, number, number, number, number, number];
}

interface Slot {
  name: string; bone: Bone;
  setupAtt: string | null; att: string | null;
  setupColor: string; color: string;
  atts: Record<string, Attachment>;
  sprite: Sprite;
}

export interface PlayOptions { loop?: boolean; speed?: number; onComplete?: (() => void) | null }

function parseAtlas(text: string): Record<string, AtlasRegion> {
  const lines = text.split(/\r?\n/);
  const regions: Record<string, AtlasRegion> = {};
  let i = 0;
  while (i < lines.length && !lines[i].trim()) i++;
  i++;                                                    // page name
  while (i < lines.length && lines[i].includes(":")) i++; // page props
  while (i < lines.length) {
    const name = lines[i].trim(); i++;
    if (!name) continue;
    const r: AtlasRegion = { rotate: false, x: 0, y: 0, w: 0, h: 0 };
    while (i < lines.length && lines[i].includes(":")) {
      const idx = lines[i].indexOf(":");
      const k = lines[i].slice(0, idx).trim();
      const vals = lines[i].slice(idx + 1).split(",").map((s) => s.trim());
      if (k === "rotate") r.rotate = vals[0] === "true" || vals[0] === "90";
      else if (k === "xy") { r.x = +vals[0]; r.y = +vals[1]; }
      else if (k === "size") { r.w = +vals[0]; r.h = +vals[1]; }
      i++;
    }
    regions[name] = r;
  }
  return regions;
}

const lerpAngle = (a: number, b: number, r: number): number =>
  a + ((((b - a) % 360) + 540) % 360 - 180) * r;

function keyAt<T>(frames: KeyFrame[], t: number, interp: (a: KeyFrame, b: KeyFrame, r: number) => T): T {
  if (t <= (frames[0].time || 0)) return interp(frames[0], frames[0], 0);
  const last = frames[frames.length - 1];
  if (t >= (last.time || 0)) return interp(last, last, 0);
  let i = 0;
  while (t >= (frames[i + 1].time || 0)) i++;
  const f0 = frames[i], f1 = frames[i + 1];
  const r = f0.curve === "stepped" ? 0 : (t - (f0.time || 0)) / ((f1.time || 0) - (f0.time || 0));
  return interp(f0, f1, r);
}

export class SkelPlayer extends Container {
  private readonly _regions: Record<string, AtlasRegion>;
  private readonly _base: Texture;
  private readonly _texCache = new Map<string, Texture>();
  private readonly _anims: Record<string, AnimData>;
  private _bones: Bone[] = [];
  private _byName: Record<string, Bone> = {};
  private _slots: Slot[] = [];
  private _slotByName: Record<string, Slot> = {};
  private _cur: string | null = null;
  private _t = 0;
  private _loop = false;
  private _speed = 1;
  private _playing = false;
  private _onComplete: (() => void) | null = null;

  constructor(data: SkelData, atlasText: string, baseTexture: Texture) {
    super();
    this._regions = parseAtlas(atlasText);
    this._base = baseTexture;
    this._anims = data.animations || {};
    this._buildSkeleton(data);
    this._pose(null, 0);
  }

  private _texture(name: string): Texture | null {
    const cached = this._texCache.get(name);
    if (cached) return cached;
    const r = this._regions[name];
    if (!r) return null;
    const tex = new Texture({
      source: this._base.source,
      frame: r.rotate ? new Rectangle(r.x, r.y, r.h, r.w) : new Rectangle(r.x, r.y, r.w, r.h),
      rotate: r.rotate ? 2 : 0,
    });
    this._texCache.set(name, tex);
    return tex;
  }

  private _buildSkeleton(data: SkelData): void {
    this._bones = [];
    this._byName = {};
    for (const b of data.bones) {
      const bone: Bone = {
        name: b.name, parent: b.parent ? this._byName[b.parent] : null,
        sx: b.x || 0, sy: b.y || 0, srot: b.rotation || 0,
        ssx: b.scaleX ?? 1, ssy: b.scaleY ?? 1,
        x: 0, y: 0, rot: 0, scx: 1, scy: 1, m: [1, 0, 0, 1, 0, 0],
      };
      this._bones.push(bone);
      this._byName[b.name] = bone;
    }
    let skin: Record<string, Record<string, Attachment>>;
    if (Array.isArray(data.skins)) {
      skin = (data.skins.find((s) => s.name === "default") || data.skins[0]).attachments;
    } else {
      skin = data.skins.default || {};
    }
    this._slots = data.slots.map((s) => {
      const slot: Slot = {
        name: s.name, bone: this._byName[s.bone],
        setupAtt: s.attachment || null, att: null,
        setupColor: s.color || "ffffffff", color: "ffffffff",
        atts: skin[s.name] || {},
        sprite: new Sprite(),
      };
      slot.sprite.anchor.set(0.5);
      this.addChild(slot.sprite); // flat, in slot order => correct draw order
      return slot;
    });
    this._slotByName = {};
    for (const s of this._slots) this._slotByName[s.name] = s;
  }

  get animations(): string[] { return Object.keys(this._anims); }

  duration(name: string): number {
    let d = 0;
    const scan = (o: unknown): void => {
      if (Array.isArray(o)) {
        for (const f of o) d = Math.max(d, (f as KeyFrame).time || 0);
      } else if (o && typeof o === "object") {
        for (const v of Object.values(o as Record<string, unknown>)) scan(v);
      }
    };
    if (this._anims[name]) scan(this._anims[name]);
    return d;
  }

  play(name: string, { loop = false, speed = 1, onComplete = null }: PlayOptions = {}): this {
    if (!this._anims[name]) throw new Error(`unknown animation: ${name}`);
    this._cur = name; this._t = 0; this._loop = loop;
    this._speed = speed; this._onComplete = onComplete; this._playing = true;
    this._pose(name, 0);
    return this;
  }

  stop(): void { this._playing = false; }

  /** call every frame with elapsed seconds */
  update(dt: number): void {
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

  private _pose(animName: string | null, t: number): void {
    for (const b of this._bones) {
      b.x = b.sx; b.y = b.sy; b.rot = b.srot; b.scx = b.ssx; b.scy = b.ssy;
    }
    for (const s of this._slots) { s.att = s.setupAtt; s.color = s.setupColor; }
    const anim = animName ? this._anims[animName] : null;
    if (anim) {
      for (const bn in (anim.bones || {})) {
        const b = this._byName[bn]; if (!b) continue;
        const tl = anim.bones![bn];
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
        const tl = anim.slots![sn];
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
          let name = s.setupAtt;
          for (const k of tl.attachment) { if (t >= (k.time || 0)) name = k.name ?? null; }
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
      const reg = att ? this._regions[(att.path || attName)!] : null;
      const alpha = parseInt((s.color || "ffffffff").slice(6, 8), 16) / 255;
      if (!att || !reg || alpha <= 0) { sp.visible = false; continue; }
      sp.visible = true;
      const tex = this._texture((att.path || attName)!);
      if (tex) sp.texture = tex;
      sp.alpha = alpha;
      sp.tint = parseInt((s.color || "ffffffff").slice(0, 6), 16);
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
