import { Container, Graphics, MeshPlane, Sprite, type Texture } from "pixi.js";
import { beamTexture, softGlowTexture, sparkDotTexture } from "./fxTextures";
import { getExtraTexture } from "./assets";

/**
 * The base-game street, alive: palms bend in the sea breeze on a vertex rig
 * (a 2D "skeleton" — every vertex follows a bend curve rooted at the trunk
 * base, with extra flutter in the crown), the hotel neon breathes and now and
 * then stutters, the ocean glints, and a police helicopter sweeps its
 * searchlight across the far sky. Everything is slow and small: it should
 * read as a living place, never pull the eye off the reels.
 *
 * Coordinates in the config are fractions of the background IMAGE, mapped
 * through the same cover-fit the plate uses, so every layer stays registered
 * at any window size.
 */

export interface PalmSpec {
  key: string;
  /** trunk base, as image fractions */
  x: number;
  y: number;
  /** palm height as a fraction of image height */
  h: number;
  /** where the trunk base sits across the palm texture (0 left … 1 right) */
  baseU?: number;
  flip?: boolean;
  /** sway amplitude as a fraction of palm height */
  amp?: number;
  phase?: number;
  /** 0 = sharp foreground, >0 = pushed back (darker, slower) */
  depth?: number;
}

export interface LivingBgConfig {
  plate: string;
  /** additive neon layers extracted from the plate (same canvas size) */
  neon?: string[];
  palms?: PalmSpec[];
  /** ocean bands for glints, image fractions */
  water?: { x0: number; y0: number; x1: number; y1: number }[];
  /** helicopter flight line, image fraction of height */
  heliY?: number;
  /** seagulls gliding across this sky band (image fractions of height) */
  gulls?: { y0: number; y1: number };
}

/** Ocean Drive at golden hour (street_golden_v1). */
export const BASE_STREET: LivingBgConfig = {
  plate: "bg_base",
  palms: [
    // hotel sidewalk, by the cafe
    { key: "palm_c", x: 0.125, y: 0.95, h: 0.95, amp: 0.026, phase: 1.2, flip: true, baseU: 0.52 },
    // beach side: planted on the promenade sidewalk right of the parked car
    // (car spans x 0.68–0.91, y 0.74–0.92), its root hidden by the control
    // bar so no stump floats on the sand; mirrored so it leans in over the
    // beach toward the reels.
    { key: "palm_d", x: 0.975, y: 0.95, h: 0.95, amp: 0.03, phase: 5.0, flip: true },
  ],
  water: [
    { x0: 0.58, y0: 0.585, x1: 0.792, y1: 0.655 },
    { x0: 0.908, y0: 0.585, x1: 1.0, y1: 0.66 },
  ],
  gulls: { y0: 0.12, y1: 0.36 },
};

/** Trunk-base position across the leaning palm textures. */
const PALM_D_BASE = 0.107;

interface Fit { s: number; ox: number; oy: number; iw: number; ih: number }

function coverFit(tex: Texture, w: number, h: number): Fit {
  const s = Math.max(w / tex.width, h / tex.height);
  return { s, ox: w / 2 - (tex.width * s) / 2, oy: h / 2 - (tex.height * s) / 2, iw: tex.width, ih: tex.height };
}

interface PalmRig { mesh: MeshPlane; base: Float32Array; vx: number; vy: number; w: number; h: number; amp: number; phase: number; speed: number; flip: boolean }

function buildPalm(parent: Container, spec: PalmSpec, fit: Fit, view: { w: number; h: number }): PalmRig | null {
  const tex = getExtraTexture(spec.key);
  if (!tex) return null;
  const amp = spec.amp ?? 0.018;
  const u = spec.baseU ?? 0.5;
  const baseX0 = fit.ox + spec.x * fit.iw * fit.s;
  const baseY = fit.oy + spec.y * fit.ih * fit.s;
  let hPx = spec.h * fit.ih * fit.s;
  // Every palm stays WHOLE on screen (the user doesn't want crowns or fronds
  // cropped by the display edge): shrink if the crown would leave the top,
  // nudge sideways off an edge, and drop it if that would move it too far
  // from where it stands (e.g. a phone's narrow crop).
  const margin = 4;
  const topRoom = baseY - margin;
  if (hPx > topRoom) hPx = topRoom;
  if (hPx < 40) return null;
  const k = hPx / tex.height;
  const sway = amp * tex.height * k * 1.5;
  const wPx = tex.width * k;
  const left = baseX0 - (spec.flip ? (1 - u) : u) * wPx;
  let shift = 0;
  if (left < margin + sway) shift = margin + sway - left;
  else if (left + wPx > view.w - margin - sway) shift = view.w - margin - sway - (left + wPx);
  if (Math.abs(shift) > wPx * 0.3) return null;
  const vx = 8, vy = 16;
  const mesh = new MeshPlane({ texture: tex, verticesX: vx, verticesY: vy });
  mesh.scale.set(spec.flip ? -k : k, k);
  // pin the trunk base (baseU across the texture) to the spec point
  mesh.x = baseX0 + shift + (spec.flip ? u * wPx : -u * wPx);
  mesh.y = baseY - hPx;
  const depth = spec.depth ?? 0;
  mesh.tint = depth > 0.5 ? 0x7d7fa6 : depth > 0 ? 0xa9a6c6 : 0xd2c6e0;
  parent.addChild(mesh);
  const buf = mesh.geometry.getBuffer("aPosition");
  return {
    mesh, base: new Float32Array(buf.data as Float32Array), vx, vy, w: tex.width, h: tex.height,
    amp: (spec.amp ?? 0.018) * tex.height, phase: spec.phase ?? Math.random() * 6,
    speed: 1 - depth * 0.35, flip: !!spec.flip,
  };
}

function swayPalm(r: PalmRig, t: number): void {
  const buf = r.mesh.geometry.getBuffer("aPosition");
  const d = buf.data as Float32Array;
  const tt = t * r.speed + r.phase;
  // breeze: a slow lean plus a gust that rolls through every ~7 s
  const lean = Math.sin(tt * 0.55) * 0.7 + Math.sin(tt * 0.23 + 1.3) * 0.5;
  const gust = Math.max(0, Math.sin(tt * 0.9 + 0.4)) ** 3 * 0.6;
  const bend = (lean + gust) * r.amp;
  for (let j = 0; j < r.vy; j++) {
    const hgt = 1 - j / (r.vy - 1);          // 0 at the trunk base, 1 at the crown top
    const curve = hgt * hgt * (1.4 - 0.4 * hgt); // trunk stays planted, crown carries the motion
    const crown = Math.max(0, (hgt - 0.62) / 0.38);
    for (let i = 0; i < r.vx; i++) {
      const n = (j * r.vx + i) * 2;
      const bx = r.base[n]!, by = r.base[n + 1]!;
      const across = (bx / r.w - 0.5) * 2;   // -1 left frond tips … +1 right
      const flutter = crown * r.amp * 0.22 * Math.sin(tt * 2.6 + i * 0.9 + j * 0.5);
      d[n] = bx + bend * curve + flutter;
      // fronds droop and lift as the crown swings — the tips trail the bend
      d[n + 1] = by + crown * (across * bend * 0.12 + r.amp * 0.12 * Math.sin(tt * 1.9 + i * 0.7));
    }
  }
  buf.update();
}

/** Small far-off police helicopter: body + rotor blur + strobe + searchlight. */
function buildHeli(parent: Container): { root: Container; beam: Sprite; strobe: Graphics; rotor: Graphics } {
  const root = new Container();
  const beam = new Sprite(beamTexture());
  beam.anchor.set(0.5, 0);
  beam.blendMode = "add";
  beam.tint = 0xdfeaff;
  beam.alpha = 0.16;
  beam.width = 90;
  beam.height = 260;
  root.addChild(beam);
  const body = new Graphics();
  body.ellipse(0, 0, 9, 4).fill(0x0c0a14);
  body.rect(6, -1.2, 14, 2.2).fill(0x0c0a14);
  body.rect(18, -4, 2, 5).fill(0x0c0a14);
  body.rect(-5, 4, 11, 1).fill(0x0c0a14);
  root.addChild(body);
  const rotor = new Graphics();
  rotor.ellipse(0, -5, 15, 1.4).fill({ color: 0x0c0a14, alpha: 0.5 });
  root.addChild(rotor);
  const strobe = new Graphics();
  strobe.circle(0, 4, 1.6).fill(0xff3040);
  root.addChild(strobe);
  parent.addChild(root);
  return { root, beam, strobe, rotor };
}

/**
 * Build the living street into `parent` (the HUD background layer). Returns
 * the per-frame tick, or null when the plate isn't loaded.
 */
export function buildLivingBackground(parent: Container, view: { w: number; h: number }, cfg: LivingBgConfig): { world: Container; tick: (dt: number, t: number) => void } | null {
  const plateTex = getExtraTexture(cfg.plate);
  if (!plateTex) return null;
  const fit = coverFit(plateTex, view.w, view.h);
  const world = new Container();
  parent.addChild(world);

  const plate = new Sprite(plateTex);
  plate.scale.set(fit.s);
  plate.position.set(fit.ox, fit.oy);
  world.addChild(plate);

  // neon: additive copies of the plate's own tubes, so they always register
  const neon: Sprite[] = [];
  for (const key of cfg.neon ?? []) {
    const t = getExtraTexture(key);
    if (!t) continue;
    const sp = new Sprite(t);
    sp.blendMode = "add";
    sp.scale.set((plateTex.width / t.width) * fit.s);
    sp.position.set(fit.ox, fit.oy);
    sp.alpha = 0.5;
    world.addChild(sp);
    neon.push(sp);
  }

  // helicopter crossing the far sky (behind the palms)
  const heli = cfg.heliY != null ? buildHeli(world) : null;
  const heliY = fit.oy + (cfg.heliY ?? 0) * fit.ih * fit.s;

  const palms: PalmRig[] = [];
  for (const p of [...(cfg.palms ?? [])].sort((a, b) => (b.depth ?? 0) - (a.depth ?? 0))) {
    const rig = buildPalm(world, { baseU: p.key === "palm_d" ? PALM_D_BASE : p.key === "palm_b" ? 0.83 : 0.5, ...p }, fit, view);
    if (rig) palms.push(rig);
  }

  // ocean glints
  const glints: { s: Sprite; life: number; dur: number; peak: number }[] = [];
  const bands = cfg.water ?? [];
  const glintLayer = new Container();
  world.addChild(glintLayer);
  const spawnGlint = (): void => {
    if (!bands.length) return;
    const W = bands[Math.floor(Math.random() * bands.length)]!;
    const s = new Sprite(sparkDotTexture());
    s.anchor.set(0.5);
    s.blendMode = "add";
    s.tint = Math.random() < 0.5 ? 0xffffff : 0xffd9b0;
    const u = Math.random(), v = Math.random() ** 1.6;
    s.position.set(fit.ox + (W.x0 + (W.x1 - W.x0) * u) * fit.iw * fit.s, fit.oy + (W.y0 + (W.y1 - W.y0) * v) * fit.ih * fit.s);
    const size = (3 + v * 7) * Math.max(0.6, fit.s);
    s.width = size * 2.2; s.height = size * 0.8;
    s.alpha = 0;
    glintLayer.addChild(s);
    glints.push({ s, life: 0, dur: 0.6 + Math.random() * 1.1, peak: 0.35 + Math.random() * 0.5 });
  };

  // seagulls: a loose pair or trio gliding along the beach now and then
  const gullLayer = new Container();
  world.addChild(gullLayer);
  const gulls: { g: Graphics; x: number; y: number; vx: number; size: number; ph: number }[] = [];
  let gullT = 3 + Math.random() * 5;
  const drawGull = (g: Graphics, size: number, flap: number): void => {
    const lift = size * (0.15 + 0.35 * flap);
    g.clear()
      .moveTo(-size, -lift).quadraticCurveTo(-size * 0.45, -lift * 1.4, 0, 0)
      .quadraticCurveTo(size * 0.45, -lift * 1.4, size, -lift)
      .stroke({ width: Math.max(1.2, size * 0.16), color: 0x3a2a2a, alpha: 0.75, cap: "round", join: "round" });
  };

  let heliT = 4 + Math.random() * 6; // seconds until the next pass
  let heliRun = -1;
  let flickerAt = 6 + Math.random() * 8;
  let glintAcc = 0;

  const tick = (dt: number): void => {
    // Own continuous clock: the street must never jump back to its first pose
    // when the HUD redraws (that read as the trees "shaking" after each spin).
    const t = performance.now() / 1000;
    for (const r of palms) swayPalm(r, t);

    // neon breathing + an occasional stutter on one colour
    if (neon.length) {
      const base = 0.42 + 0.12 * Math.sin(t * 1.1);
      neon.forEach((n, i) => { n.alpha = base + 0.06 * Math.sin(t * 2.3 + i * 2); });
      if (t > flickerAt) {
        const ft = t - flickerAt;
        const who = neon[Math.floor(flickerAt * 7) % neon.length]!;
        if (ft < 0.5) who.alpha *= [1, 0.1, 1, 0.3, 0.05, 1, 0.4, 1][Math.floor(ft / 0.0625)] ?? 1;
        else flickerAt = t + 7 + Math.random() * 12;
      }
    }

    // glints
    if (bands.length) {
      glintAcc += dt;
      while (glintAcc > 0.09) { glintAcc -= 0.09; if (glints.length < 26) spawnGlint(); }
      for (let i = glints.length - 1; i >= 0; i--) {
        const g = glints[i]!;
        g.life += dt;
        const p = g.life / g.dur;
        g.s.alpha = g.peak * Math.sin(Math.min(1, p) * Math.PI);
        if (p >= 1) { g.s.destroy(); glints.splice(i, 1); }
      }
    }

    if (cfg.gulls) {
      gullT -= dt;
      if (gullT <= 0) {
        gullT = 12 + Math.random() * 14;
        const n = 2 + Math.floor(Math.random() * 2);
        const dir = Math.random() < 0.5 ? 1 : -1;
        const y = fit.oy + (cfg.gulls.y0 + Math.random() * (cfg.gulls.y1 - cfg.gulls.y0)) * fit.ih * fit.s;
        for (let i = 0; i < n; i++) {
          const g = new Graphics();
          gullLayer.addChild(g);
          const size = (5 + Math.random() * 4) * Math.max(0.7, fit.s * 1.2);
          gulls.push({ g, x: dir > 0 ? -30 - i * 40 : view.w + 30 + i * 40, y: y + (Math.random() - 0.5) * 40, vx: dir * (38 + Math.random() * 14), size, ph: Math.random() * 6 });
        }
      }
      for (let i = gulls.length - 1; i >= 0; i--) {
        const q = gulls[i]!;
        q.x += q.vx * dt;
        q.ph += dt;
        const flap = Math.max(0, Math.sin(q.ph * 7)) * (Math.sin(q.ph * 0.6) > 0.2 ? 1 : 0.15); // flap, then glide
        drawGull(q.g, q.size, flap);
        q.g.position.set(q.x, q.y + Math.sin(q.ph * 1.3) * 4);
        if (q.x < -80 || q.x > view.w + 80) { q.g.destroy(); gulls.splice(i, 1); }
      }
    }

    // helicopter pass every ~25–40 s, ~16 s to cross
    if (heli) {
      if (heliRun < 0) {
        heli.root.visible = false;
        heliT -= dt;
        if (heliT <= 0) heliRun = 0;
      } else {
        heliRun += dt;
        const p = heliRun / 16;
        if (p >= 1) { heliRun = -1; heliT = 25 + Math.random() * 15; }
        else {
          heli.root.visible = true;
          const x = -60 + (view.w + 120) * p;
          heli.root.position.set(x, heliY + Math.sin(p * Math.PI * 2) * 6);
          heli.root.scale.set(Math.max(0.8, fit.s * 1.1));
          heli.beam.rotation = Math.sin(heliRun * 0.6) * 0.35 + 0.1;
          heli.strobe.alpha = (heliRun * 1.4) % 1 < 0.12 ? 1 : 0.15;
          heli.rotor.scale.x = 0.7 + 0.3 * Math.abs(Math.sin(heliRun * 40));
        }
      }
    }
  };
  return { world, tick };
}
