/** A dedicated, cancellable sound stage for the Getaway payout only. No sample
 * loops or wall-clock timers: the visual counter drives each counting note. */
export class GetawayResultSound {
  private channel: GainNode | null = null;
  private voices = new Set<OscillatorNode>();
  private counting = false;
  private lastStep = -1;

  constructor(private readonly ctx: AudioContext, private readonly output: AudioNode) {}

  private stage(): void {
    this.cancel();
    this.channel = this.ctx.createGain();
    this.channel.gain.value = 0.75;
    this.channel.connect(this.output);
  }

  private note(frequency: number, delay: number, duration: number, volume: number, type: OscillatorType = "sine"): void {
    if (!this.channel) return;
    const at = this.ctx.currentTime + delay;
    const voice = this.ctx.createOscillator();
    const envelope = this.ctx.createGain();
    voice.type = type;
    voice.frequency.setValueAtTime(frequency, at);
    envelope.gain.setValueAtTime(0, at);
    envelope.gain.linearRampToValueAtTime(volume, at + 0.008);
    envelope.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    voice.connect(envelope).connect(this.channel);
    this.voices.add(voice);
    voice.onended = () => {
      this.voices.delete(voice);
      voice.disconnect();
      envelope.disconnect();
    };
    voice.start(at);
    voice.stop(at + duration + 0.01);
  }

  open(): void {
    this.stage();
    // Warm bass arrival, then an airy major-ninth flourish.
    this.note(65.406, 0, 0.36, 0.13, "triangle");
    [261.626, 329.628, 391.995, 587.33].forEach((frequency, i) => this.note(frequency, i * 0.065, 0.48, 0.04));
    this.note(1567.98, 0.18, 0.32, 0.014);
  }

  start(): void {
    this.stage();
    this.counting = true;
    this.lastStep = -1;
    this.progress(0);
  }

  progress(progress: number): void {
    if (!this.counting) return;
    const p = Math.max(0, Math.min(1, progress));
    const step = Math.floor(p * 36);
    if (step === this.lastStep || p >= 1) return;
    this.lastStep = step;
    const notes = [523.251, 587.33, 659.255, 783.991, 880, 1046.502];
    const index = Math.min(notes.length - 1, Math.floor(p * notes.length));
    const frequency = notes[index]! * (step % 2 ? 1 : 0.5);
    this.note(frequency, 0, 0.065, 0.046);
    this.note(frequency * 2.003, 0, 0.035, 0.01, "triangle");
  }

  end(): void {
    this.stage();
    // The final chord arrives with the exact total; its full tail is under 0.6 s.
    this.note(130.813, 0, 0.22, 0.08, "triangle");
    [523.251, 659.255, 783.991, 1046.502].forEach((frequency, i) => this.note(frequency, i * 0.035, 0.38, 0.052));
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
