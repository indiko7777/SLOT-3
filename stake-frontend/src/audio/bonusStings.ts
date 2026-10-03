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
  osc(ctx, "triangle", 180 * tone, 70, hit, 0.12, 0.42, pan, 0.002);
}

/** Soft-clip curve: warm saturation that adds audible harmonics to low tones. */
function drive(ctx: Ctx, amount: number): WaveShaperNode {
  const ws = ctx.createWaveShaper();
  const n = 1024;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(amount * x) / Math.tanh(amount);
  }
  ws.curve = curve;
  ws.oversample = "2x";
  return ws;
}

/**
 * The NO HIT stamp landing — a heavy cinematic "failure" hit, no cartoon
 * elements (no siren, no metal ping): a thick saturated impact, a sub that
 * drops through the floor, and a dark minor chord that winds down like a tape
 * stopping — the sound of momentum dying. Deeper and longer with heat.
 */
export function noHitImpact(ctx: Ctx, out: AudioNode, heat: number, _last: boolean, scale = 1): void {
  const t = ctx.currentTime;
  const h = Math.min(3, Math.max(0, heat));
  const inten = (1 + h * 0.1) * scale;
  const len = 0.95 + h * 0.12;
  const b = bus(ctx, out, 0.72 * inten, 0.42);

  // 1. Impact: a thick low-mid slam, saturated so it reads on small speakers.
  const hitDrive = drive(ctx, 3.2);
  const hitLp = ctx.createBiquadFilter();
  hitLp.type = "lowpass";
  hitLp.frequency.setValueAtTime(2600, t);
  hitLp.frequency.exponentialRampToValueAtTime(240, t + 0.22);
  const hitG = ctx.createGain();
  env(hitG.gain, t, 0.55, 0.003, 0.32);
  hitDrive.connect(hitLp).connect(hitG).connect(b);
  const body = ctx.createOscillator();
  body.type = "triangle";
  body.frequency.setValueAtTime(150, t);
  body.frequency.exponentialRampToValueAtTime(48, t + 0.25);
  body.connect(hitDrive);
  body.start(t);
  body.stop(t + 0.4);
  noise(ctx, t, 0.09, 0.5, hitDrive, { type: "bandpass", f0: 700, q: 0.6 });
  noise(ctx, t, 0.018, 0.35, b, { type: "highpass", f0: 3000 }); // attack edge

  // 2. Sub drop: falls through the floor and keeps falling.
  osc(ctx, "sine", 92, 26, t, len, 0.85, b, 0.004);

  // 3. Power-down: a dark minor chord, saturated, filter closing while the
  //    pitch sags an octave — a tape grinding to a halt.
  const pdDrive = drive(ctx, 2.2);
  const pdLp = ctx.createBiquadFilter();
  pdLp.type = "lowpass";
  pdLp.Q.value = 1.4;
  pdLp.frequency.setValueAtTime(2400, t + 0.02);
  pdLp.frequency.exponentialRampToValueAtTime(160, t + len);
  const pdG = ctx.createGain();
  pdG.gain.setValueAtTime(0.0001, t);
  pdG.gain.exponentialRampToValueAtTime(0.32, t + 0.03);
  pdG.gain.setValueAtTime(0.32, t + len * 0.35);
  pdG.gain.exponentialRampToValueAtTime(0.0001, t + len + 0.1);
  pdDrive.connect(pdLp).connect(pdG).connect(b);
  const root = 55 - h * 2; // A1, sinking a touch lower each miss
  for (const [mult, det] of [[1, -7], [1, 7], [1.189, 0], [1.498, -4], [2, 5]] as const) {
    const o = ctx.createOscillator();
    o.type = "sawtooth";
    o.frequency.setValueAtTime(root * mult, t);
    // tape-stop curve: holds briefly, then sags hard
    o.frequency.setValueAtTime(root * mult, t + 0.08);
    o.frequency.exponentialRampToValueAtTime(root * mult * 0.5, t + len);
    o.detune.value = det;
    const g = ctx.createGain();
    g.gain.value = 0.18;
    o.connect(g).connect(pdDrive);
    o.start(t);
    o.stop(t + len + 0.15);
  }

  // 4. Dark rumble tail.
  noise(ctx, t + 0.04, len + 0.3, 0.22, b, { type: "lowpass", f0: 520, f1: 120, q: 0.7 }, 0.05);
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
