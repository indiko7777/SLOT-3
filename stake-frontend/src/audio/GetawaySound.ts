/**
 * The Getaway's own sound set: a chase music loop with a tension layer that
 * rises with the heat, the rear doors, the reels, a hit for EVERY gold bar that
 * sticks, the dynamite (landing, fuse, blast, each ×2) and the spin meter.
 *
 * All samples are rendered offline by tools/audio/getaway.mjs into
 * public/assets/audio/getaway/. The cinematic transition into the feature (the
 * intro hit, the typewriter, the trucks / stars) is NOT part of this set — it
 * keeps its original sounds.
 *
 * Every cue is fired by the view on the frame its visual happens (BonusView's
 * `cue` sink), never from the event stream, so sound and picture cannot drift.
 */

export const GETAWAY_SAMPLE_BASE = "assets/audio/getaway/";

export const GETAWAY_SAMPLES = [
  "music_main", "music_tension",
  "door", "spin_start", "column_stop",
  "bar_land_0", "bar_land_1", "bar_land_2", "bar_land_3", "bar_land_4", "bar_big",
  "dynamite_land", "fuse", "boom", "double", "dud",
  "dead_1", "dead_2", "dead_3", "held", "tick", "last_spin",
  "result_open", "result_tick", "result_tier_0", "result_tier_1", "result_tier_2", "result_tier_3",
  "result_end", "result_exit",
] as const;
export type GetawaySample = (typeof GETAWAY_SAMPLES)[number];

/** A moment in the Getaway that has a sound, fired on its visual frame. */
export type GetawayCue =
  | { kind: "spin_start" }
  | { kind: "column_stop"; col: number }
  /** a gold bar stuck: index = its order among this spin's landings */
  | { kind: "bar"; index: number; value: number }
  | { kind: "dynamite" }
  /** the fuse is burning down; the blast follows after `seconds` */
  | { kind: "fuse"; seconds: number }
  /** power 0..1 — how much gold the blast is about to double */
  | { kind: "boom"; power: number }
  /** one neighbour bar doubled: index = its order in this blast */
  | { kind: "double"; index: number }
  | { kind: "dud" }
  | { kind: "held" }
  | { kind: "spent"; spinsLeft: number }
  | { kind: "dead"; heat: number };

/** The music loop length the renderer writes (8 bars at 128 BPM). */
export const MUSIC_LOOP_SECONDS = 15;
/** Bars at or above this multiplier get the heavy "big bar" layer. */
export const BIG_BAR_X = 25;

const MUSIC_LEVEL = 0.8;
const TENSION_LEVEL = 0.7;
/** Tension layer (sirens, rotor, toms) by heat = consecutive dead spins. */
const HEAT_TENSION = [0, 0.45, 0.75, 1];

/** Per-sample level, matched by ear-safe loudness (LUFS) to the original set:
 *  impacts sit on top of the music, detail sits under it. */
const LEVEL: Partial<Record<GetawaySample, number>> = {
  door: 1.0,
  spin_start: 0.45,
  column_stop: 0.5,
  bar_land_0: 1.15, bar_land_1: 1.15, bar_land_2: 1.15, bar_land_3: 1.15, bar_land_4: 1.15,
  bar_big: 0.9,
  dynamite_land: 1.0,
  fuse: 0.75,
  boom: 1.0,
  double: 0.95,
  dud: 0.9,
  dead_1: 0.95, dead_2: 0.95, dead_3: 0.95,
  held: 0.55,
  tick: 0.8,
  last_spin: 0.8,
};

interface LoopBuffer { duration: number; sampleRate: number; numberOfChannels: number; getChannelData(c: number): Float32Array }

/**
 * Where a rendered loop really starts and ends inside its decoded buffer. The
 * files are cut sample-exact, but some decoders keep the MP3 encoder delay as a
 * few ms of leading silence; looping over that would put a gap (and a click) in
 * the music every 15 s. The loop audio itself never starts on silence.
 */
export function loopPoints(buffer: LoopBuffer, seconds = MUSIC_LOOP_SECONDS): { start: number; end: number } {
  const sr = buffer.sampleRate;
  const scan = Math.min(4096, Math.floor(buffer.duration * sr));
  let lead = 0;
  outer: for (; lead < scan; lead++) {
    for (let c = 0; c < buffer.numberOfChannels; c++) {
      if (Math.abs(buffer.getChannelData(c)[lead]!) > 1e-4) break outer;
    }
  }
  if (lead >= scan) lead = 0;
  let start = lead / sr;
  let end = start + seconds;
  if (end > buffer.duration + 1e-4) {
    end = buffer.duration;
    start = Math.max(0, end - seconds);
  }
  return { start, end };
}

/** Pitch ratio for the n-th bar to land in a spin: up the A-minor pentatonic
 *  (5 rendered notes), then the same run an octave higher. */
export function barVoice(index: number): { sample: GetawaySample; rate: number } {
  const i = Math.max(0, Math.floor(index));
  const octave = Math.min(1, Math.floor(i / 5));
  return { sample: `bar_land_${i % 5}` as GetawaySample, rate: octave ? 2 : 1 };
}

export class GetawaySound {
  private readonly bus: GainNode;
  private music: {
    main: AudioBufferSourceNode;
    tension: AudioBufferSourceNode | null;
    gain: GainNode;
    tensionGain: GainNode;
  } | null = null;
  private heat = 0;

  constructor(
    private readonly ctx: AudioContext,
    output: AudioNode,
    private readonly buffers: ReadonlyMap<string, AudioBuffer>,
  ) {
    this.bus = ctx.createGain();
    this.bus.gain.value = 1;
    this.bus.connect(output);
  }

  has(name: GetawaySample): boolean { return this.buffers.has(name); }

  get musicPlaying(): boolean { return this.music !== null; }

  /** One-shot sample. Returns false when the sample isn't loaded. */
  play(name: GetawaySample, { rate = 1, gain = 1, pan = 0, delay = 0 }: { rate?: number; gain?: number; pan?: number; delay?: number } = {}): boolean {
    const buffer = this.buffers.get(name);
    if (!buffer) return false;
    const at = this.ctx.currentTime + delay;
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = rate;
    const level = this.ctx.createGain();
    level.gain.value = (LEVEL[name] ?? 1) * gain;
    let tail: AudioNode = level;
    const panner = pan && typeof this.ctx.createStereoPanner === "function" ? this.ctx.createStereoPanner() : null;
    if (panner) { panner.pan.value = Math.max(-1, Math.min(1, pan)); level.connect(panner); tail = panner; }
    source.connect(level);
    tail.connect(this.bus);
    source.onended = () => { source.disconnect(); level.disconnect(); panner?.disconnect(); };
    source.start(at);
    return true;
  }

  /** The chase music: the main loop plus its sample-locked tension layer (held
   *  silent until the heat rises). Idempotent. */
  startMusic(fadeIn = 1.4): void {
    if (this.music) return;
    const mainBuf = this.buffers.get("music_main");
    if (!mainBuf) return;
    const tensionBuf = this.buffers.get("music_tension") ?? null;
    const now = this.ctx.currentTime;
    const at = now + 0.03;

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(MUSIC_LEVEL, now + fadeIn);
    gain.connect(this.bus);

    const loop = (buffer: AudioBuffer, into: AudioNode): AudioBufferSourceNode => {
      const src = this.ctx.createBufferSource();
      src.buffer = buffer;
      src.loop = true;
      const { start, end } = loopPoints(buffer);
      src.loopStart = start;
      src.loopEnd = end;
      src.connect(into);
      src.start(at, start);
      return src;
    };
    const main = loop(mainBuf, gain);

    const tensionGain = this.ctx.createGain();
    tensionGain.gain.setValueAtTime(this.tensionTarget(), now);
    tensionGain.connect(gain);
    const tension = tensionBuf ? loop(tensionBuf, tensionGain) : null;
    this.music = { main, tension, gain, tensionGain };
  }

  stopMusic(fade = 0.8): void {
    const music = this.music;
    if (!music) return;
    this.music = null;
    const now = this.ctx.currentTime;
    const g = music.gain.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(Math.max(0.0001, g.value), now);
    g.exponentialRampToValueAtTime(0.0001, now + fade);
    for (const src of [music.main, music.tension]) {
      if (!src) continue;
      src.onended = () => src.disconnect();
      try { src.stop(now + fade + 0.05); } catch { /* already stopped */ }
    }
    window.setTimeout(() => { music.gain.disconnect(); music.tensionGain.disconnect(); }, (fade + 0.2) * 1000);
  }

  /** Heat 0..3 (consecutive dead spins) brings the sirens / rotor / toms in. */
  setHeat(level: number): void {
    this.heat = Math.max(0, Math.min(3, Math.floor(level)));
    if (!this.music) return;
    const g = this.music.tensionGain.gain;
    const now = this.ctx.currentTime;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    // Rising heat comes in fast (the cops are on you); cooling off is slower.
    g.setTargetAtTime(this.tensionTarget(), now, this.heat > 0 ? 0.25 : 0.9);
  }

  private tensionTarget(): number {
    return (HEAT_TENSION[this.heat] ?? 0) * TENSION_LEVEL;
  }

  /** A view cue → its sound. */
  cue(c: GetawayCue, turbo: boolean): void {
    const soft = turbo ? 0.7 : 1;
    switch (c.kind) {
      case "spin_start":
        this.play("spin_start", { gain: soft, rate: turbo ? 1.25 : 1 });
        return;
      case "column_stop":
        this.play("column_stop", { gain: soft, pan: (c.col - 2) * 0.3, rate: 1 + c.col * 0.03 });
        return;
      case "bar": {
        const v = barVoice(c.index);
        this.play(v.sample, { rate: v.rate, gain: soft, pan: 0 });
        if (c.value >= BIG_BAR_X) this.play("bar_big", { gain: soft });
        return;
      }
      case "dynamite":
        this.play("dynamite_land", { gain: soft });
        return;
      case "fuse": {
        // The rendered fuse burns 0.62 s into the blast; fit it to the visual.
        const rate = Math.max(0.8, Math.min(1.8, 0.62 / Math.max(0.1, c.seconds)));
        this.play("fuse", { rate });
        return;
      }
      case "boom":
        this.play("boom", { gain: 0.85 + 0.25 * Math.max(0, Math.min(1, c.power)) });
        return;
      case "double":
        // Each doubled bar rings a whole tone higher: 2, 4, 8… you hear it climb.
        this.play("double", { rate: Math.pow(2, (2 * Math.min(6, c.index)) / 12), gain: soft });
        return;
      case "dud":
        this.play("dud", { gain: soft });
        return;
      case "held":
        this.play("held", { gain: soft });
        return;
      case "spent":
        this.play("tick", { gain: soft });
        if (c.spinsLeft === 1) this.play("last_spin", { delay: 0.1 });
        return;
      case "dead":
        this.play(`dead_${Math.max(1, Math.min(3, Math.floor(c.heat)))}` as GetawaySample, { gain: soft });
        return;
    }
  }

  doors(): boolean { return this.play("door"); }

  /** Everything off (mute, leaving the feature). */
  stopAll(): void {
    this.stopMusic(0.05);
  }
}
