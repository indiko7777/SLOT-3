/**
 * DRIVE-BY sound, synthesized (no assets): a V12 pass-by with real Doppler —
 * revving in from the right, roaring past at the closest point (the visual
 * slow-motion beat), dropping pitch as it tears away to the left — plus tyre
 * roar, a wind whoosh at the pass and one heavy hit per wild that lands.
 *
 * Everything is scheduled on the AudioContext clock from the view's own
 * timeline, so the roar peaks on the frame the car is centred.
 * Laptop speakers: every layer carries energy above ~200 Hz.
 */
import { bus, env, type Ctx } from "./bonusStings";

const noiseCache = new WeakMap<Ctx, AudioBuffer>();
function noise(ctx: Ctx): AudioBuffer {
  let b = noiseCache.get(ctx);
  if (!b) {
    b = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 3), ctx.sampleRate);
    const d = b.getChannelData(0);
    // pinkish noise (one-pole) — less hiss, more road
    let last = 0;
    for (let i = 0; i < d.length; i++) { last = 0.82 * last + 0.18 * (Math.random() * 2 - 1); d[i] = last * 2.4; }
    noiseCache.set(ctx, b);
  }
  return b;
}

function drive(ctx: Ctx, amount: number): WaveShaperNode {
  const ws = ctx.createWaveShaper();
  const n = 1024, curve = new Float32Array(n);
  for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; curve[i] = Math.tanh(x * amount) / Math.tanh(amount); }
  ws.curve = curve;
  return ws;
}

export interface PassTiming {
  /** seconds from now: headlights / first audible */
  start: number;
  /** seconds from now: car centred (closest point) */
  pass: number;
  /** seconds from now: car gone */
  end: number;
}

/** The whole pass-by, scheduled at once. */
export function driveByPass(ctx: Ctx, out: AudioNode, tm: PassTiming, scale = 1): void {
  const t0 = ctx.currentTime + tm.start;
  const tp = ctx.currentTime + tm.pass;
  const t1 = ctx.currentTime + tm.end;
  const tail = t1 + 0.9;
  const master = bus(ctx, out, 0.9 * scale, 0.22);
  const pan = ctx.createStereoPanner();
  pan.pan.setValueAtTime(0.95, t0);
  pan.pan.linearRampToValueAtTime(0, tp);
  pan.pan.linearRampToValueAtTime(-0.95, t1);
  pan.connect(master);

  // ── engine: three detuned harmonic voices through drive + a closing lowpass
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.Q.value = 0.9;
  lp.frequency.setValueAtTime(700, t0);
  lp.frequency.exponentialRampToValueAtTime(5200, tp);
  lp.frequency.exponentialRampToValueAtTime(900, t1 + 0.3);
  const eg = ctx.createGain();
  eg.gain.setValueAtTime(0.0001, t0);
  eg.gain.exponentialRampToValueAtTime(0.09, t0 + (tp - t0) * 0.55);
  eg.gain.exponentialRampToValueAtTime(0.42, tp);
  eg.gain.exponentialRampToValueAtTime(0.06, t1);
  eg.gain.exponentialRampToValueAtTime(0.0001, tail);
  const sat = drive(ctx, 3.2);
  sat.connect(lp).connect(eg).connect(pan);
  const base = 92; // V12-ish firing fundamental at speed
  const dop = (v: OscillatorNode, mult: number) => {
    const f = v.frequency;
    f.setValueAtTime(base * mult * 0.86, t0);
    f.exponentialRampToValueAtTime(base * mult * 1.13, tp - (tp - t0) * 0.18); // revving in, approaching (Doppler up)
    f.exponentialRampToValueAtTime(base * mult * 1.05, tp);
    f.exponentialRampToValueAtTime(base * mult * 0.78, t1);                    // receding (Doppler down)
    f.exponentialRampToValueAtTime(base * mult * 0.7, tail);
  };
  for (const [type, mult, gain, det] of [["sawtooth", 1, 0.5, -6], ["square", 2, 0.22, 5], ["sawtooth", 3, 0.16, 9], ["triangle", 4.02, 0.1, -3]] as const) {
    const o = ctx.createOscillator();
    o.type = type;
    o.detune.value = det;
    dop(o, mult);
    const g = ctx.createGain();
    g.gain.value = gain;
    o.connect(g).connect(sat);
    o.start(t0);
    o.stop(tail);
  }
  // a gear-shift blip just before the pass: a quick dip and back
  const shift = ctx.createGain();
  shift.gain.setValueAtTime(1, t0);
  const ts = tp - Math.min(0.35, (tp - t0) * 0.4);
  shift.gain.setValueAtTime(1, ts);
  shift.gain.linearRampToValueAtTime(0.35, ts + 0.05);
  shift.gain.linearRampToValueAtTime(1, ts + 0.13);
  eg.disconnect();
  eg.connect(shift).connect(pan);

  // ── tyres on asphalt: band-passed noise riding the same distance curve
  const road = ctx.createBufferSource();
  road.buffer = noise(ctx);
  road.loop = true;
  const bp = ctx.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.setValueAtTime(600, t0);
  bp.frequency.exponentialRampToValueAtTime(1400, tp);
  bp.frequency.exponentialRampToValueAtTime(500, t1);
  bp.Q.value = 0.6;
  const rg = ctx.createGain();
  rg.gain.setValueAtTime(0.0001, t0);
  rg.gain.exponentialRampToValueAtTime(0.32, tp);
  rg.gain.exponentialRampToValueAtTime(0.0001, t1 + 0.4);
  road.connect(bp).connect(rg).connect(pan);
  road.start(t0);
  road.stop(t1 + 0.5);

  // ── wind whoosh right at the pass
  const wind = ctx.createBufferSource();
  wind.buffer = noise(ctx);
  const hp = ctx.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.setValueAtTime(900, tp - 0.25);
  hp.frequency.exponentialRampToValueAtTime(3200, tp + 0.2);
  const wg = ctx.createGain();
  env(wg.gain, tp - 0.22, 0.5, 0.2, 0.55);
  wind.connect(hp).connect(wg).connect(pan);
  wind.start(tp - 0.25);
  wind.stop(tp + 0.9);

  // ── body: a low punch as it passes (felt on headphones, a click on laptops)
  const thump = ctx.createOscillator();
  thump.type = "sine";
  thump.frequency.setValueAtTime(150, tp - 0.02);
  thump.frequency.exponentialRampToValueAtTime(48, tp + 0.35);
  const tg = ctx.createGain();
  env(tg.gain, tp - 0.02, 0.35, 0.02, 0.4);
  thump.connect(tg).connect(master);
  thump.start(tp - 0.02);
  thump.stop(tp + 0.5);
}

/** Title swoosh as "DRIVE-BY" streaks in. */
export function driveByTitle(ctx: Ctx, out: AudioNode, scale = 1): void {
  const t = ctx.currentTime;
  const m = bus(ctx, out, 0.55 * scale, 0.3);
  const src = ctx.createBufferSource();
  src.buffer = noise(ctx);
  const bp = ctx.createBiquadFilter();
  bp.type = "bandpass";
  bp.Q.value = 1.4;
  bp.frequency.setValueAtTime(500, t);
  bp.frequency.exponentialRampToValueAtTime(4200, t + 0.28);
  const g = ctx.createGain();
  env(g.gain, t, 0.6, 0.12, 0.3);
  const pan = ctx.createStereoPanner();
  pan.pan.setValueAtTime(0.8, t);
  pan.pan.linearRampToValueAtTime(-0.2, t + 0.35);
  src.connect(bp).connect(g).connect(pan).connect(m);
  src.start(t);
  src.stop(t + 0.6);
  // a bright synth stab under it — the Vice City "hit"
  for (const [f, a] of [[392, 0.12], [587, 0.08], [784, 0.05]] as const) {
    const o = ctx.createOscillator();
    o.type = "sawtooth";
    o.frequency.setValueAtTime(f, t + 0.08);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(3800, t + 0.08);
    lp.frequency.exponentialRampToValueAtTime(700, t + 0.6);
    const og = ctx.createGain();
    env(og.gain, t + 0.08, a, 0.01, 0.55);
    o.connect(lp).connect(og).connect(m);
    o.start(t + 0.08);
    o.stop(t + 0.7);
  }
}

/** One wild slamming into its cell. `i` steps the pitch so a run of hits climbs. */
export function driveByImpact(ctx: Ctx, out: AudioNode, i: number, pan: number, scale = 1): void {
  const t = ctx.currentTime;
  const m = bus(ctx, out, 0.75 * scale, 0.28);
  const p = ctx.createStereoPanner();
  p.pan.value = Math.max(-1, Math.min(1, pan));
  p.connect(m);
  const step = Math.pow(2, Math.min(i, 6) / 12);
  // punch
  const o = ctx.createOscillator();
  o.type = "sine";
  o.frequency.setValueAtTime(260 * step, t);
  o.frequency.exponentialRampToValueAtTime(70, t + 0.16);
  const og = ctx.createGain();
  env(og.gain, t, 0.55, 0.004, 0.2);
  o.connect(og).connect(p);
  o.start(t); o.stop(t + 0.3);
  // armour plate slap: short metallic band of noise
  const n = ctx.createBufferSource();
  n.buffer = noise(ctx);
  const bp = ctx.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = 1900 * step;
  bp.Q.value = 2.2;
  const ng = ctx.createGain();
  env(ng.gain, t, 0.5, 0.002, 0.09);
  n.connect(bp).connect(ng).connect(p);
  n.start(t); n.stop(t + 0.15);
  // bright tick on top
  const c = ctx.createOscillator();
  c.type = "square";
  c.frequency.setValueAtTime(1600 * step, t);
  c.frequency.exponentialRampToValueAtTime(900 * step, t + 0.05);
  const cg = ctx.createGain();
  env(cg.gain, t, 0.08, 0.001, 0.05);
  c.connect(cg).connect(p);
  c.start(t); c.stop(t + 0.08);
}
