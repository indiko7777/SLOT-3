/** A dedicated, cancellable sound stage for the Getaway payout screen only.
 *
 * Nothing here loops and nothing runs off a wall clock: the visual counter
 * drives every counting note and every tier promotion, so the audio can never
 * outlive the screen it belongs to. Base-game win sounds are a separate stage
 * and are never touched from here.
 *
 * The shape is a single dopamine arc — a sub drop as the payout lands, a rising
 * ladder under the count, a brass stinger each time the win is promoted to a
 * bigger tier, one resolved chord on the total, and a short whoosh on the wipe
 * back to the street. */
export class GetawayResultSound {
  private channel: GainNode | null = null;
  private voices = new Set<AudioScheduledSourceNode>();
  private counting = false;
  private lastStep = -1;
  private noise: AudioBuffer | null = null;

  constructor(private readonly ctx: AudioContext, private readonly output: AudioNode) {}

  /** Every beat that starts a new section gets a fresh channel, so the previous
   *  section is always silenced rather than layered on top of. */
  private stage(): void {
    this.cancel();
    const channel = this.ctx.createGain();
    channel.gain.value = 0.75;
    channel.connect(this.output);
    this.channel = channel;
  }

  /** Register a scheduled source so cancel() can always reach it, even while it
   *  is still waiting to start. */
  private track(voice: AudioScheduledSourceNode, tail: AudioNode[], at: number, stopAt: number): void {
    this.voices.add(voice);
    voice.onended = () => {
      this.voices.delete(voice);
      voice.disconnect();
      for (const node of tail) node.disconnect();
    };
    voice.start(at);
    voice.stop(stopAt);
  }

  private tone(options: {
    freq: number; duration: number; volume: number;
    delay?: number; type?: OscillatorType; glideTo?: number;
  }): void {
    if (!this.channel) return;
    const { freq, duration, volume, delay = 0, type = "sine", glideTo } = options;
    const at = this.ctx.currentTime + delay;
    const voice = this.ctx.createOscillator();
    const envelope = this.ctx.createGain();
    voice.type = type;
    voice.frequency.setValueAtTime(freq, at);
    if (glideTo !== undefined) voice.frequency.exponentialRampToValueAtTime(Math.max(1, glideTo), at + duration);
    envelope.gain.setValueAtTime(0, at);
    envelope.gain.linearRampToValueAtTime(volume, at + 0.008);
    envelope.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    voice.connect(envelope).connect(this.channel);
    this.track(voice, [envelope], at, at + duration + 0.01);
  }

  /** Filtered noise — the air under a riser, a stinger or the exit whoosh. */
  private air(options: {
    duration: number; volume: number; from: number; to: number;
    delay?: number; q?: number; type?: BiquadFilterType;
  }): void {
    if (!this.channel) return;
    const { duration, volume, from, to, delay = 0, q = 1, type = "bandpass" } = options;
    const at = this.ctx.currentTime + delay;
    this.noise ??= this.buildNoise();
    const voice = this.ctx.createBufferSource();
    voice.buffer = this.noise;
    const filter = this.ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.setValueAtTime(from, at);
    filter.frequency.exponentialRampToValueAtTime(Math.max(20, to), at + duration);
    filter.Q.value = q;
    const envelope = this.ctx.createGain();
    envelope.gain.setValueAtTime(0, at);
    envelope.gain.linearRampToValueAtTime(volume, at + Math.min(0.06, duration * 0.3));
    envelope.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    voice.connect(filter).connect(envelope).connect(this.channel);
    this.track(voice, [filter, envelope], at, at + duration + 0.01);
  }

  private buildNoise(): AudioBuffer {
    const length = Math.max(1, Math.floor(this.ctx.sampleRate));
    const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  /** The chase cuts out and the payout lands: a sub drop under a rising shimmer. */
  open(): void {
    this.stage();
    this.tone({ freq: 138, duration: 0.55, volume: 0.17, type: "sine", glideTo: 41 });
    this.air({ duration: 0.42, volume: 0.055, from: 420, to: 5200 });
    [261.626, 329.628, 391.995, 587.33].forEach((freq, i) =>
      this.tone({ freq, delay: 0.04 + i * 0.05, duration: 0.5, volume: 0.04 }));
    this.tone({ freq: 1567.98, delay: 0.2, duration: 0.34, volume: 0.016 });
  }

  start(): void {
    this.stage();
    this.counting = true;
    this.lastStep = -1;
    this.progress(0);
  }

  /** One note per step of the visual count — never per frame, so the ladder
   *  sounds identical at 60 Hz and 144 Hz. */
  progress(progress: number): void {
    if (!this.counting) return;
    const p = Math.max(0, Math.min(1, progress));
    const step = Math.floor(p * 40);
    if (step === this.lastStep || p >= 1) return;
    this.lastStep = step;
    const ladder = [523.251, 587.33, 659.255, 783.991, 880, 1046.502, 1174.659, 1318.51];
    const note = ladder[Math.min(ladder.length - 1, Math.floor(p * ladder.length))]!;
    const freq = note * (step % 2 ? 1 : 0.5);
    this.tone({ freq, duration: 0.07, volume: 0.042 });
    this.tone({ freq: freq * 2.003, duration: 0.04, volume: 0.011, type: "triangle" });
  }

  /** A promotion mid-count — the biggest beat on this screen. It layers over the
   *  running count rather than replacing it, so the ladder never stutters. */
  tier(level: number): void {
    if (!this.channel) return;
    const step = Math.max(0, Math.min(3, Math.floor(level)));
    const root = [174.614, 220, 261.626, 349.228][step]!;
    [1, 1.5, 2].forEach((ratio, i) =>
      this.tone({ freq: root * ratio, delay: i * 0.012, duration: 0.34 + step * 0.05, volume: 0.05, type: "sawtooth" }));
    this.tone({ freq: root * 8, delay: 0.02, duration: 0.5, volume: 0.02, type: "triangle" });
    this.air({ duration: 0.3, volume: 0.05, from: 1800, to: 6500, q: 0.8 });
    this.tone({ freq: 70, duration: 0.24, volume: 0.1, glideTo: 44 });
  }

  /** The total lands. One resolved chord with a bounded tail — never a layered
   *  multi-second jingle competing with the base game's own win sounds. */
  end(): void {
    this.stage();
    this.tone({ freq: 130.813, duration: 0.3, volume: 0.1, type: "triangle" });
    [261.626, 329.628, 391.995, 523.251, 659.255].forEach((freq, i) =>
      this.tone({ freq, delay: i * 0.028, duration: 0.7, volume: 0.05 }));
    this.tone({ freq: 1046.502, delay: 0.05, duration: 0.85, volume: 0.03, type: "triangle" });
    this.air({ delay: 0.01, duration: 0.5, volume: 0.045, from: 6000, to: 900, type: "highpass" });
  }

  /** The wipe back to the street: one short downward whoosh, then silence. */
  exit(): void {
    this.stage();
    this.air({ duration: 0.28, volume: 0.075, from: 5200, to: 240, type: "lowpass", q: 1.1 });
    this.tone({ freq: 96, duration: 0.26, volume: 0.09, glideTo: 38 });
  }

  cancel(): void {
    this.counting = false;
    const now = this.ctx.currentTime;
    const channel = this.channel;
    this.channel = null;
    if (channel) {
      channel.gain.cancelScheduledValues(now);
      channel.gain.setValueAtTime(channel.gain.value, now);
      channel.gain.linearRampToValueAtTime(0, now + 0.012);
    }
    const voices = [...this.voices];
    this.voices.clear();
    let remaining = voices.length;
    for (const voice of voices) {
      const ended = voice.onended;
      voice.onended = (event) => {
        ended?.call(voice, event);
        if (--remaining === 0) channel?.disconnect();
      };
      try { voice.stop(now + 0.015); }
      catch { if (--remaining === 0) channel?.disconnect(); }
    }
    // Keep the channel connected for its 12 ms fade to avoid a hard-cut click.
    if (!voices.length) channel?.disconnect();
  }
}
