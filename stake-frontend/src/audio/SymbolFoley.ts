/**
 * Small physical sound cues synced to the skeletal symbol animations.
 *
 * The cues are EVENT keys authored inside each clip (tools/skel-pipeline/
 * symbol_motion.py): the pistol's "fire" is on the exact frame the muzzle
 * flash appears, "tink" when the ejected casing lands, the cartridges'
 * "rattle" on each touchdown. SkelPlayer fires them as playback passes, so
 * they stay locked to the motion at any speed (turbo, extra-turbo).
 *
 * Everything is synthesised (no new audio files) and deliberately quiet: these
 * sit UNDER the existing win / tumble sounds as texture, not a redesign.
 */

/** Cues that are pure detail: dropped in turbo, where the motion is a blur. */
const DETAIL = new Set(["casing", "tink", "rattle", "flutter", "flick", "jingle", "tick", "catch", "strip"]);

/**
 * Decides whether a cue may sound now. A five-pistol cluster fires five "fire"
 * events on the same frame — that must be ONE shot, not a machine-gun stack —
 * and a big cascade must not pile up dozens of voices.
 */
export class FoleyGate {
  private readonly last = new Map<string, number>();
  private recent: number[] = [];

  constructor(
    private readonly dedupeMs = 70,
    private readonly maxPerWindow = 6,
    private readonly windowMs = 120
  ) {}

  allow(cue: string, turbo: boolean, now: number): boolean {
    if (turbo && DETAIL.has(cue)) return false;
    const prev = this.last.get(cue);
    if (prev !== undefined && now - prev < this.dedupeMs) return false;
    this.recent = this.recent.filter((t) => now - t < this.windowMs);
    if (this.recent.length >= this.maxPerWindow) return false;
    this.last.set(cue, now);
    this.recent.push(now);
    return true;
  }
}

type Voice = (ctx: AudioContext, out: AudioNode, t: number, v: number) => void;

function noise(ctx: AudioContext, dur: number): AudioBufferSourceNode {
  const frames = Math.max(1, Math.floor(ctx.sampleRate * dur));
  const buf = ctx.createBuffer(1, frames, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < frames; i++) d[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  return src;
}

function env(ctx: AudioContext, t: number, peak: number, attack: number, decay: number): GainNode {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  return g;
}

/** Filtered noise burst. */
function burst(ctx: AudioContext, out: AudioNode, t: number, dur: number, peak: number,
  type: BiquadFilterType, f0: number, f1 = f0, q = 1): void {
  const src = noise(ctx, dur + 0.02);
  const flt = ctx.createBiquadFilter();
  flt.type = type;
  flt.Q.value = q;
  flt.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) flt.frequency.exponentialRampToValueAtTime(f1, t + dur);
  const g = env(ctx, t, peak, 0.004, dur);
  src.connect(flt).connect(g).connect(out);
  src.start(t);
  src.stop(t + dur + 0.03);
}

/** Decaying sine partials — metal pings, glass. */
function ring(ctx: AudioContext, out: AudioNode, t: number, freqs: number[], peak: number, decay: number): void {
  freqs.forEach((f, i) => {
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(f, t);
    const g = env(ctx, t, peak / (i + 1), 0.003, decay * (1 - i * 0.18));
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + decay + 0.05);
  });
}

/** Pitch-dropping sine — body of a thump. */
function thump(ctx: AudioContext, out: AudioNode, t: number, f0: number, f1: number, peak: number, dur: number): void {
  const o = ctx.createOscillator();
  o.type = "sine";
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  const g = env(ctx, t, peak, 0.004, dur);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + dur + 0.05);
}

/** Short engine rev: detuned saws through an opening low-pass. */
function rev(ctx: AudioContext, out: AudioNode, t: number, f0: number, f1: number, dur: number, peak: number): void {
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.setValueAtTime(380, t);
  lp.frequency.exponentialRampToValueAtTime(1800, t + dur * 0.7);
  const g = env(ctx, t, peak, 0.05, dur);
  lp.connect(g).connect(out);
  for (const det of [-9, 7]) {
    const o = ctx.createOscillator();
    o.type = "sawtooth";
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + dur * 0.8);
    o.detune.value = det * 3;
    o.connect(lp);
    o.start(t);
    o.stop(t + dur + 0.05);
  }
}

const rnd = (a: number, b: number) => a + Math.random() * (b - a);

/** cue -> synth. Volumes are relative (the bus scales them). */
const VOICES: Record<string, Voice> = {
  // pistol
  fire: (c, o, t, v) => { burst(c, o, t, 0.07, 0.5 * v, "bandpass", 1900, 900, 0.7); thump(c, o, t, 120, 45, 0.45 * v, 0.12); },
  casing: (c, o, t, v) => burst(c, o, t, 0.03, 0.12 * v, "highpass", 3500),
  tink: (c, o, t, v) => { ring(c, o, t, [3150, 5070], 0.12 * v, 0.14); ring(c, o, t + 0.07, [3300, 5300], 0.06 * v, 0.09); },
  slidelock: (c, o, t, v) => { burst(c, o, t, 0.012, 0.3 * v, "highpass", 2800); burst(c, o, t + 0.045, 0.02, 0.35 * v, "bandpass", 1600, 1600, 2); },
  strip: (c, o, t, v) => burst(c, o, t, 0.13, 0.16 * v, "bandpass", 2400, 1100, 3),
  // ammo
  jolt: (c, o, t, v) => { thump(c, o, t, 150, 70, 0.18 * v, 0.07); ring(c, o, t, [2600, 4100], 0.07 * v, 0.08); },
  rattle: (c, o, t, v) => { for (let i = 0; i < 3; i++) ring(c, o, t + rnd(0, 0.05), [rnd(2300, 3600), rnd(4200, 5600)], 0.07 * v, rnd(0.04, 0.08)); },
  scatter: (c, o, t, v) => { for (let i = 0; i < 5; i++) ring(c, o, t + rnd(0, 0.16), [rnd(2200, 3800), rnd(4000, 6000)], 0.07 * v, rnd(0.05, 0.1)); },
  // cash
  riffle: (c, o, t, v) => { for (let i = 0; i < 7; i++) burst(c, o, t + i * 0.022, 0.018, 0.12 * v, "bandpass", rnd(2400, 3800), rnd(2400, 3800), 1.4); },
  flutter: (c, o, t, v) => { for (let i = 0; i < 4; i++) burst(c, o, t + i * 0.05, 0.04, 0.06 * v, "bandpass", rnd(1800, 3000), rnd(1800, 3000), 1.2); },
  snap: (c, o, t, v) => { burst(c, o, t, 0.02, 0.28 * v, "highpass", 2200); thump(c, o, t, 200, 90, 0.12 * v, 0.05); },
  // a note thumb-flicked off the fan: a crisp paper snap, then air
  flick: (c, o, t, v) => { burst(c, o, t, 0.012, 0.2 * v, "highpass", 3400); burst(c, o, t + 0.015, 0.09, 0.07 * v, "bandpass", 2600, 1500, 1.3); },
  // duffel
  thump: (c, o, t, v) => { thump(c, o, t, 95, 45, 0.4 * v, 0.16); burst(c, o, t, 0.08, 0.1 * v, "lowpass", 500); },
  jingle: (c, o, t, v) => { for (let i = 0; i < 4; i++) ring(c, o, t + rnd(0.01, 0.12), [rnd(1900, 2700), rnd(3600, 4600)], 0.06 * v, rnd(0.08, 0.16)); },
  burst: (c, o, t, v) => { thump(c, o, t, 110, 40, 0.42 * v, 0.2); burst(c, o, t, 0.18, 0.14 * v, "lowpass", 900, 300); },
  // knife
  swish: (c, o, t, v) => burst(c, o, t, 0.16, 0.16 * v, "bandpass", 700, 3200, 1.6),
  catch: (c, o, t, v) => burst(c, o, t, 0.015, 0.2 * v, "highpass", 3000),
  shing: (c, o, t, v) => { burst(c, o, t, 0.03, 0.08 * v, "highpass", 5000); ring(c, o, t, [2780, 4170, 6250], 0.1 * v, 0.42); },
  tick: (c, o, t, v) => ring(c, o, t, [3600], 0.06 * v, 0.07),
  slice: (c, o, t, v) => { burst(c, o, t, 0.1, 0.14 * v, "bandpass", 1500, 5200, 2); ring(c, o, t + 0.05, [5200, 7800], 0.06 * v, 0.25); },
  // diamond
  chime: (c, o, t, v) => ring(c, o, t, [2093, 3136, 4186], 0.07 * v, 0.6),
  ping: (c, o, t, v) => ring(c, o, t, [3520, 5280], 0.07 * v, 0.28),
  shatter: (c, o, t, v) => { burst(c, o, t, 0.12, 0.22 * v, "highpass", 3200); for (let i = 0; i < 6; i++) ring(c, o, t + rnd(0, 0.14), [rnd(3500, 7000)], 0.05 * v, rnd(0.08, 0.2)); },
  // brass
  punch: (c, o, t, v) => { thump(c, o, t, 90, 38, 0.55 * v, 0.14); burst(c, o, t, 0.05, 0.16 * v, "lowpass", 600); ring(c, o, t, [880, 1390], 0.05 * v, 0.2); },
  drop: (c, o, t, v) => thump(c, o, t, 70, 35, 0.3 * v, 0.18),
  // bike
  rev: (c, o, t, v) => rev(c, o, t, 62, 150, 0.36, 0.16 * v),
  wheelie: (c, o, t, v) => rev(c, o, t, 90, 210, 0.42, 0.14 * v),
  vroom: (c, o, t, v) => rev(c, o, t, 80, 230, 0.5, 0.18 * v),
};

/** Symbol-specific variants of shared cue names (land thuds, "fire"). */
const BY_SYMBOL: Record<string, Record<string, Voice>> = {
  PISTOL: { impact: (c, o, t, v) => { burst(c, o, t, 0.012, 0.18 * v, "highpass", 2600); thump(c, o, t, 140, 70, 0.12 * v, 0.05); } },
  AMMO: { impact: (c, o, t, v) => VOICES.rattle(c, o, t, 0.8 * v) },
  CASH: { impact: (c, o, t, v) => burst(c, o, t, 0.05, 0.08 * v, "bandpass", 2200, 1400, 1.2) },
  DIAMOND: { fire: (c, o, t, v) => ring(c, o, t, [4186, 6272], 0.08 * v, 0.32) },
  DUFFEL: { thud: (c, o, t, v) => thump(c, o, t, 85, 45, 0.3 * v, 0.14) },
  BRASS: { thud: (c, o, t, v) => { thump(c, o, t, 80, 40, 0.4 * v, 0.12); ring(c, o, t, [760, 1210], 0.04 * v, 0.14); } },
  BIKE: { thud: (c, o, t, v) => { thump(c, o, t, 70, 40, 0.3 * v, 0.14); burst(c, o, t, 0.04, 0.08 * v, "highpass", 2400); } },
  PHONE_SCATTER: { thud: (c, o, t, v) => { thump(c, o, t, 60, 32, 0.35 * v, 0.2); burst(c, o, t, 0.06, 0.08 * v, "lowpass", 700); } },
  KNIFE: {},
};

export function hasFoley(id: string, cue: string): boolean {
  return Boolean(BY_SYMBOL[id]?.[cue] ?? VOICES[cue]);
}

/** Play one cue into `out`. Unknown cues are ignored. */
export function playFoley(ctx: AudioContext, out: AudioNode, id: string, cue: string, volume: number): void {
  const voice = BY_SYMBOL[id]?.[cue] ?? VOICES[cue];
  if (!voice) return;
  voice(ctx, out, ctx.currentTime + 0.005, volume);
}
