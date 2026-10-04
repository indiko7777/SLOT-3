/**
 * Procedural sounds for the girl collection reveal, each fired on the frame
 * its visual happens (see pixi/girlReveal.ts). Positive, glossy, "you got it"
 * — the counterpart to the bonus's letdown stings.
 */
import { bus, env, noise, osc, drive, type Ctx } from "./bonusStings";

export type CollectionCue = "lock" | "snap" | "sweep" | "shutter" | "name";

/** Target lock: two quick rising blips over a soft airy riser. */
function lock(ctx: Ctx, out: AudioNode, s: number): void {
  const t = ctx.currentTime;
  const b = bus(ctx, out, 0.7 * s, 0.25);
  osc(ctx, "sine", 1180, 1500, t, 0.06, 0.18, b, 0.003);
  osc(ctx, "sine", 1580, 2000, t + 0.09, 0.07, 0.16, b, 0.003);
  noise(ctx, t, 0.5, 0.12, b, { type: "bandpass", f0: 900, f1: 4200, q: 1.2 }, 0.42);
}

/** The piece seats itself: a glassy chime-hit with body and sparkle. */
function snap(ctx: Ctx, out: AudioNode, s: number): void {
  const t = ctx.currentTime;
  const b = bus(ctx, out, 0.9 * s, 0.35);
  osc(ctx, "sine", 160, 60, t, 0.18, 0.55, b, 0.002);           // weight
  noise(ctx, t, 0.03, 0.4, b, { type: "highpass", f0: 3500 });   // contact
  for (const [f, g, d] of [[1046, 0.2, 0.9], [1568, 0.14, 0.7], [2093, 0.1, 0.55], [2637, 0.06, 0.4]] as const) {
    osc(ctx, "sine", f, f, t + 0.005, d, g, b, 0.002);           // bright major chime
  }
  noise(ctx, t + 0.02, 0.35, 0.08, b, { type: "highpass", f0: 7000 }, 0.01); // sparkle tail
}

/** Light sweeping up the body: a shimmering riser with a rising arpeggio. */
function sweep(ctx: Ctx, out: AudioNode, s: number): void {
  const t = ctx.currentTime;
  const b = bus(ctx, out, 0.75 * s, 0.4);
  noise(ctx, t, 0.62, 0.22, b, { type: "bandpass", f0: 600, f1: 6000, q: 1.4 }, 0.55);
  const notes = [523, 659, 784, 1046, 1318, 1568];
  notes.forEach((f, i) => osc(ctx, "triangle", f, f, t + i * 0.09, 0.3, 0.12, b, 0.004));
}

/** Camera shutter: mechanical click-clack with a little whir. */
function shutter(ctx: Ctx, out: AudioNode, s: number): void {
  const t = ctx.currentTime;
  const b = bus(ctx, out, 1.0 * s, 0.15);
  noise(ctx, t, 0.018, 0.7, b, { type: "bandpass", f0: 2600, q: 1.5 });
  noise(ctx, t + 0.045, 0.024, 0.55, b, { type: "bandpass", f0: 1800, q: 1.2 });
  osc(ctx, "square", 220, 140, t + 0.01, 0.05, 0.05, b, 0.002);
  noise(ctx, t + 0.26, 0.016, 0.45, b, { type: "bandpass", f0: 2600, q: 1.5 }); // second flash
  noise(ctx, t + 0.3, 0.02, 0.35, b, { type: "bandpass", f0: 1800, q: 1.2 });
}

/** Her name lands: a warm saturated impact under a bright major-chord swell. */
function name(ctx: Ctx, out: AudioNode, s: number): void {
  const t = ctx.currentTime;
  const b = bus(ctx, out, 0.8 * s, 0.45);
  osc(ctx, "sine", 120, 42, t, 0.4, 0.75, b, 0.003);
  noise(ctx, t, 0.04, 0.45, b, { type: "highpass", f0: 2500 });
  const d = drive(ctx, 1.8);
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.setValueAtTime(900, t);
  lp.frequency.exponentialRampToValueAtTime(5200, t + 0.35);
  const g = ctx.createGain();
  env(g.gain, t, 0.3, 0.02, 1.6);
  d.connect(lp).connect(g).connect(b);
  // D major add9 — bright, triumphant
  for (const f of [146.8, 220, 293.7, 370, 440, 659.3]) {
    for (const det of [-6, 6]) {
      const o = ctx.createOscillator();
      o.type = "sawtooth";
      o.frequency.value = f;
      o.detune.value = det;
      const og = ctx.createGain();
      og.gain.value = 0.07;
      o.connect(og).connect(d);
      o.start(t);
      o.stop(t + 1.8);
    }
  }
  for (const [f, dd] of [[1174.7, 1.2], [1760, 1.0], [2349, 0.8]] as const) osc(ctx, "sine", f, f, t + 0.06, dd, 0.06, b, 0.01);
}

export function collectionSting(ctx: Ctx, out: AudioNode, cue: CollectionCue, turbo: boolean): void {
  const s = turbo ? 0.6 : 1;
  if (cue === "lock") lock(ctx, out, s);
  else if (cue === "snap") snap(ctx, out, s);
  else if (cue === "sweep") sweep(ctx, out, s);
  else if (cue === "shutter") shutter(ctx, out, s);
  else name(ctx, out, s);
}
