/**
 * Procedural stings for the Getaway's two letdown beats — NO HIT (a spin that
 * landed nothing) and the DUD (a dynamite with no gold beside it). Each layer
 * is fired by the view on the frame its visual happens, so picture and sound
 * stay locked at any playback speed.
 *
 * Built to read on laptop and phone speakers: every layer carries real energy
 * above ~200 Hz, the low end is a bonus on headphones. A shared synthetic room
 * reverb glues the layers into one cinematic hit instead of a pile of beeps.
 */

type Ctx = BaseAudioContext;

const noiseCache = new WeakMap<Ctx, AudioBuffer>();
const roomCache = new WeakMap<AudioNode, GainNode>();

function noiseBuffer(ctx: Ctx): AudioBuffer {
  let buf = noiseCache.get(ctx);
  if (!buf) {
    buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 2), ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    noiseCache.set(ctx, buf);
  }
  return buf;
}

/** Send bus into a short dark room (built once per output). */
function room(ctx: Ctx, out: AudioNode): GainNode {
  let send = roomCache.get(out);
  if (send) return send;
  const len = Math.floor(ctx.sampleRate * 1.5);
  const ir = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      const t = i / ctx.sampleRate;
      // a few early reflections, then a smooth exponential tail
      const early = t < 0.06 && Math.random() < 0.004 ? 2.5 : 0;
      d[i] = (Math.random() * 2 - 1) * (Math.exp(-t * 3.4) + early);
    }
  }
  const conv = ctx.createConvolver();
  conv.buffer = ir;
  const tone = ctx.createBiquadFilter();
  tone.type = "lowpass";
  tone.frequency.value = 4200;
  const wet = ctx.createGain();
  wet.gain.value = 0.55;
  send = ctx.createGain();
  send.connect(conv).connect(tone).connect(wet).connect(out);
  roomCache.set(out, send);
  return send;
}

/** A bus: dry to `out`, plus `wet` into the room. */
function bus(ctx: Ctx, out: AudioNode, gain: number, wet: number): GainNode {
  const g = ctx.createGain();
  g.gain.value = gain;
  g.connect(out);
  const s = ctx.createGain();
  s.gain.value = wet;
  g.connect(s).connect(room(ctx, out));
  return g;
}

function env(g: AudioParam, t: number, peak: number, attack: number, decay: number): void {
  g.setValueAtTime(0.0001, t);
  g.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
  g.exponentialRampToValueAtTime(0.0001, t + attack + decay);
}

function osc(ctx: Ctx, type: OscillatorType, f0: number, f1: number, t: number, dur: number, peak: number, dest: AudioNode, attack = 0.005): OscillatorNode {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
  env(g.gain, t, peak, attack, dur);
  o.connect(g).connect(dest);
  o.start(t);
  o.stop(t + attack + dur + 0.05);
  return o;
}

/** Filtered noise burst. `sweep` moves the filter from f0 to f1 over the burst. */
function noise(ctx: Ctx, t: number, dur: number, peak: number, dest: AudioNode,
  filter: { type: BiquadFilterType; f0: number; f1?: number; q?: number }, attack = 0.002): void {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx);
  const f = ctx.createBiquadFilter();
  f.type = filter.type;
  f.Q.value = filter.q ?? 0.8;
  f.frequency.setValueAtTime(filter.f0, t);
  if (filter.f1) f.frequency.exponentialRampToValueAtTime(filter.f1, t + dur);
  const g = ctx.createGain();
  env(g.gain, t, peak, attack, dur);
  src.connect(f).connect(g).connect(dest);
  src.start(t, Math.random() * 1.2, attack + dur + 0.05);
}

/* ─────────────────────────── NO HIT ─────────────────────────── */

/**
 * A strip of police tape whips across the reel window: a rising "fwip" over
 * the travel, then a sharp slap and a short vinyl flutter as it pulls taut.
 * Fired when the tape STARTS moving; `seconds` is its travel time.
 */
export function tapeSlap(ctx: Ctx, out: AudioNode, index: number, seconds: number, scale = 1): void {
  const t = ctx.currentTime;
  const hit = t + Math.max(0.03, seconds);
  const b = bus(ctx, out, 1.8 * scale, 0.22);
  const pan = ctx.createStereoPanner();
  pan.pan.value = index % 2 === 0 ? -0.35 : 0.35;
  pan.connect(b);
  // whoosh: band of noise climbing as the tape accelerates
  noise(ctx, t, hit - t, 0.22, pan, { type: "bandpass", f0: 450, f1: 3600, q: 1.4 }, (hit - t) * 0.85);
  // the slap: a bright crack + a little body
  const tone = 1 + index * 0.06;
  noise(ctx, hit, 0.07, 0.75, pan, { type: "bandpass", f0: 2300 * tone, q: 0.9 });
  noise(ctx, hit, 0.025, 0.5, pan, { type: "highpass", f0: 5200 });
  osc(ctx, "triangle", 230 * tone, 110, hit, 0.09, 0.32, pan, 0.002);
  // flutter: the tape buzzing as it settles
  const flutter = ctx.createGain();
  const lfo = ctx.createOscillator();
  const lfoGain = ctx.createGain();
  lfo.frequency.value = 34;
  lfoGain.gain.value = 0.5;
  flutter.gain.value = 0.5;
  lfo.connect(lfoGain).connect(flutter.gain);
  flutter.connect(pan);
  noise(ctx, hit + 0.03, 0.2, 0.12, flutter, { type: "bandpass", f0: 1500, q: 2 });
  lfo.start(hit);
  lfo.stop(hit + 0.3);
}

/**
 * The NO HIT stamp landing: a cinematic low brass "braam", a punchy kick, a
 * heavy metal stamp, and a two-tone police yelp — the pursuit closing in.
 * Grows with heat; the last spin (BUSTED) adds a long dread tail.
 */
export function noHitImpact(ctx: Ctx, out: AudioNode, heat: number, last: boolean, scale = 1): void {
  const t = ctx.currentTime;
  const inten = (1 + Math.min(3, Math.max(0, heat)) * 0.1 + (last ? 0.18 : 0)) * scale;
  const b = bus(ctx, out, 1.0 * inten, last ? 0.4 : 0.3);

  // Braam: detuned saws on a dark minor cluster, filter clamping shut.
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.Q.value = 2.2;
  lp.frequency.setValueAtTime(3400, t);
  lp.frequency.exponentialRampToValueAtTime(420, t + 0.75);
  const braam = ctx.createGain();
  env(braam.gain, t, 0.5, 0.012, last ? 1.5 : 0.95);
  lp.connect(braam).connect(b);
  const root = last ? 65.4 : 73.4;
  for (const [mult, det] of [[1, -8], [1, 9], [1.5, 0], [2, -5], [2.12, 6]] as const) {
    const o = ctx.createOscillator();
    o.type = "sawtooth";
    o.frequency.setValueAtTime(root * mult * 1.02, t);
    o.frequency.exponentialRampToValueAtTime(root * mult * 0.985, t + 0.9);
    o.detune.value = det;
    const g = ctx.createGain();
    g.gain.value = 0.16;
    o.connect(g).connect(lp);
    o.start(t);
    o.stop(t + (last ? 1.7 : 1.1));
  }

  // Kick: sub thump with an audible mid body.
  osc(ctx, "sine", 170, 44, t, 0.2, 0.55, b, 0.002);
  osc(ctx, "triangle", 330, 115, t, 0.16, 0.6, b, 0.002);
  noise(ctx, t, 0.012, 0.55, b, { type: "highpass", f0: 3800 });

  // Metal stamp: inharmonic partials with a fast decay.
  for (const [f, g, d] of [[392, 0.32, 0.5], [987, 0.22, 0.38], [1561, 0.15, 0.3], [2418, 0.1, 0.22], [3190, 0.07, 0.16]] as const) {
    osc(ctx, "sine", f, f * 0.97, t, d, g, b, 0.002);
  }
  noise(ctx, t, 0.13, 0.65, b, { type: "bandpass", f0: 1150, q: 0.7 });

  // Police yelp: square through a lowpass, swept up and back.
  const yelp = (start: number, up: number): void => {
    const o = ctx.createOscillator();
    o.type = "square";
    o.frequency.setValueAtTime(520 * up, start);
    o.frequency.exponentialRampToValueAtTime(1380 * up, start + 0.15);
    o.frequency.exponentialRampToValueAtTime(820 * up, start + 0.34);
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = 2300;
    const g = ctx.createGain();
    env(g.gain, start, 0.13 * inten, 0.02, 0.33);
    const p = ctx.createStereoPanner();
    p.pan.value = 0.4;
    o.connect(f).connect(g).connect(p).connect(b);
    o.start(start);
    o.stop(start + 0.4);
  };
  yelp(t + 0.05, 1);
  if (heat >= 2 || last) yelp(t + 0.36, 1.06);

  // Busted: a long sub swell under everything.
  if (last) osc(ctx, "sine", 55, 41, t + 0.04, 1.3, 0.35, b, 0.05);
}

/* ─────────────────────────── DUD ─────────────────────────── */

/**
 * The dud's build-up: the fuse hisses and crackles faster and faster while a
 * tense riser climbs — the player is sure it is about to blow. Lasts exactly
 * `seconds`, ending on the fizzle frame.
 */
export function dudArm(ctx: Ctx, out: AudioNode, seconds: number, scale = 1): void {
  const t = ctx.currentTime;
  const end = t + Math.max(0.08, seconds);
  const b = bus(ctx, out, 2.4 * scale, 0.15);

  // fuse hiss swelling
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx);
  const bp = ctx.createBiquadFilter();
  bp.type = "bandpass";
  bp.Q.value = 1.3;
  bp.frequency.setValueAtTime(3800, t);
  bp.frequency.linearRampToValueAtTime(6200, end);
  const hg = ctx.createGain();
  hg.gain.setValueAtTime(0.03, t);
  hg.gain.linearRampToValueAtTime(0.2, end - 0.02);
  hg.gain.linearRampToValueAtTime(0.0001, end + 0.02);
  src.connect(bp).connect(hg).connect(b);
  src.start(t, Math.random(), end - t + 0.05);

  // crackle: spits that come faster as it burns down
  let c = t + 0.02;
  let gap = 0.07;
  while (c < end - 0.01) {
    noise(ctx, c, 0.012, 0.18 + Math.random() * 0.2, b, { type: "highpass", f0: 2500 + Math.random() * 2500 });
    c += gap * (0.6 + Math.random() * 0.8);
    gap = Math.max(0.018, gap * 0.86);
  }

  // riser: two voices sliding up a fifth apart, tremolo speeding up
  const trem = ctx.createGain();
  trem.gain.value = 0.5;
  const lfo = ctx.createOscillator();
  const lfoAmt = ctx.createGain();
  lfo.frequency.setValueAtTime(6, t);
  lfo.frequency.linearRampToValueAtTime(24, end);
  lfoAmt.gain.value = 0.5;
  lfo.connect(lfoAmt).connect(trem.gain);
  trem.connect(b);
  for (const [f0, f1, type] of [[300, 760, "triangle"], [450, 1140, "sine"]] as const) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, end);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.11, end - 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, end + 0.01);
    o.connect(g).connect(trem);
    o.start(t);
    o.stop(end + 0.05);
  }
  lfo.start(t);
  lfo.stop(end + 0.05);
}

/**
 * ...and nothing. The spark pops out with a "pfft" of escaping smoke, the
 * sticks clunk down limp, and a two-step deflating "bwomp" lands the joke.
 */
export function dudFizzle(ctx: Ctx, out: AudioNode, scale = 1): void {
  const t = ctx.currentTime;
  const b = bus(ctx, out, 2.0 * scale, 0.2);

  // last little spark pops
  for (let i = 0; i < 3; i++) noise(ctx, t + i * 0.035, 0.01, 0.25 - i * 0.06, b, { type: "highpass", f0: 4000 });
  // pfft: air escaping, filter closing down
  noise(ctx, t + 0.01, 0.42, 0.42, b, { type: "lowpass", f0: 4200, f1: 260, q: 0.9 }, 0.012);
  noise(ctx, t + 0.01, 0.22, 0.16, b, { type: "bandpass", f0: 1800, f1: 600, q: 1.6 }, 0.01);
  // sticks drop: a dull wooden clunk
  osc(ctx, "triangle", 230, 125, t + 0.12, 0.13, 0.32, b, 0.002);
  noise(ctx, t + 0.12, 0.03, 0.3, b, { type: "bandpass", f0: 900, q: 1.2 });

  // bwomp... bwooomp: deflating two-step, lowpassed so it stays warm
  const deflate = (start: number, f0: number, f1: number, dur: number, peak: number, wobble: boolean): void => {
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = 1400;
    const g = ctx.createGain();
    env(g.gain, start, peak, 0.02, dur);
    f.connect(g).connect(b);
    for (const [type, mul] of [["triangle", 1], ["sine", 2]] as const) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(f0 * mul, start);
      o.frequency.exponentialRampToValueAtTime(f1 * mul, start + dur);
      if (wobble) {
        const v = ctx.createOscillator();
        const vg = ctx.createGain();
        v.frequency.value = 7;
        vg.gain.value = f1 * mul * 0.03;
        v.connect(vg).connect(o.frequency);
        v.start(start);
        v.stop(start + dur + 0.05);
      }
      const og = ctx.createGain();
      og.gain.value = mul === 1 ? 1 : 0.35;
      o.connect(og).connect(f);
      o.start(start);
      o.stop(start + dur + 0.08);
    }
  };
  deflate(t + 0.08, 330, 250, 0.16, 0.22, false);
  deflate(t + 0.27, 262, 140, 0.5, 0.26, true);
}
