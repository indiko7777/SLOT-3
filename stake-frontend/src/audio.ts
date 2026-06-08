import type { GameEvent } from "./domain";

/* ═══════════════════════════════════════════════════
   Layered Audio Bus – GTA 6 Miami Heist theme
   ═══════════════════════════════════════════════════
   10 audio files that LAYER (overlap), not cut each other off:
   ─ bg_base       looping lo-fi Miami background
   ─ bg_bonus      looping tense heist background
   ─ spin_loop     looping reel spin sound
   ─ win_small     one-shot small win jingle
   ─ win_big       one-shot big win celebration
   ─ mega_win      one-shot epic jackpot celebration
   ─ bonus_trigger one-shot dramatic heist alarm
   ─ vault_lock    one-shot heavy vault mechanism
   ─ heat_rise     one-shot cinematic tension riser
   ─ siren         one-shot police siren burst
   ════════════════════════════════════════════════ */

type TrackName =
  | "bg_base" | "bg_bonus" | "spin_loop"
  | "win_small" | "win_big" | "mega_win"
  | "bonus_trigger" | "vault_lock" | "heat_rise" | "siren";

const AUDIO_BASE = "assets/audio/";

const ALL_TRACKS: TrackName[] = [
  "bg_base", "bg_bonus", "spin_loop",
  "win_small", "win_big", "mega_win",
  "bonus_trigger", "vault_lock", "heat_rise", "siren"
];

/** Base volume per track (0–1) */
const VOLUME: Record<TrackName, number> = {
  bg_base:       0.30,
  bg_bonus:      0.25,
  spin_loop:     0.40,
  win_small:     0.55,
  win_big:       0.65,
  mega_win:      0.80,
  bonus_trigger: 0.70,
  vault_lock:    0.70,
  heat_rise:     0.50,
  siren:         0.55,
};

/** Fade duration in seconds */
const FADE = 0.8;

/* ── Radio stations (GTA-style) ─────────────────────
   Each wheel option maps to either a looping mp3 track, a procedurally
   generated synth station, a scanner/talk channel, or OFF (full mute). */
type StationAudio =
  | { kind: "off" }
  | { kind: "track"; track: TrackName }
  | { kind: "synth"; wave: OscillatorType; base: number; tempo: number; scale: number[] }
  | { kind: "scanner" };

export const STATION_AUDIO: Record<string, StationAudio> = {
  off:     { kind: "off" },
  heat:    { kind: "track", track: "bg_base" },
  vault:   { kind: "track", track: "bg_bonus" },
  neon:    { kind: "synth", wave: "sawtooth", base: 220.0, tempo: 0.22, scale: [0, 3, 7, 10, 12, 10, 7, 3] },
  vice:    { kind: "synth", wave: "square",   base: 277.18, tempo: 0.18, scale: [0, 2, 4, 7, 9, 12, 9, 4] },
  scanner: { kind: "scanner" },
};

/* ── Active loop handle ─────────────────────────── */

interface ActiveLoop {
  source: AudioBufferSourceNode;
  gain: GainNode;
  track: TrackName;
}

/* ═══════════════════════════════════════════════════ */

export class EventAudioBus {
  private ctx: AudioContext | null = null;
  private rawData = new Map<TrackName, ArrayBuffer>();    // pre-fetched
  private buffers = new Map<TrackName, AudioBuffer>();    // decoded
  private fetched = false;
  private decoded = false;

  /* active loop slots — bg and spin can each have one */
  private bgLoop: ActiveLoop | null = null;
  private spinLoop: ActiveLoop | null = null;
  private inBonus = false;

  /* radio: once the player picks a station the game stops auto-switching music */
  private radioOverride = false;
  private radioStation = "heat";
  private synthTimer: number | null = null;
  private synthMaster: GainNode | null = null;

  /* ── lifecycle ─────────────────────────────────── */

  /**
   * Pre-fetch all mp3 files during boot (no user gesture needed).
   * Call this from main.ts alongside texture loading.
   */
  async prefetch(): Promise<void> {
    if (this.fetched) return;
    this.fetched = true;
    await Promise.all(
      ALL_TRACKS.map(async (t) => {
        try {
          const r = await fetch(`${AUDIO_BASE}${t}.mp3`);
          if (!r.ok) return;
          this.rawData.set(t, await r.arrayBuffer());
        } catch { /* missing file — synth fallback */ }
      })
    );
  }

  /**
   * Create / resume AudioContext (needs user gesture) and
   * decode pre-fetched data into AudioBuffers (nearly instant).
   */
  async unlock(): Promise<void> {
    if (!this.ctx) this.ctx = new AudioContext();
    if (this.ctx.state === "suspended") await this.ctx.resume();

    if (!this.decoded && this.fetched) {
      this.decoded = true;
      await this.decodeAll();
      // start ambient bg music as soon as decoded
      this.startLoop("bg_base", "bg");
    }
  }

  /** Decode all pre-fetched ArrayBuffers → AudioBuffers */
  private async decodeAll(): Promise<void> {
    if (!this.ctx) return;
    await Promise.all(
      [...this.rawData.entries()].map(async ([name, raw]) => {
        try {
          // decodeAudioData detaches the buffer, so use as-is (one-time)
          const buf = await this.ctx!.decodeAudioData(raw);
          this.buffers.set(name, buf);
        } catch { /* decode failed — synth fallback */ }
      })
    );
    this.rawData.clear(); // free memory
  }

  /* ── public API (same signature as before) ─────── */

  playEvent(event: GameEvent, muted: boolean, turbo: boolean): void {
    if (muted) {
      this.killAll();
      return;
    }
    void this.unlock().then(() => this.route(event, turbo));
  }

  /** Fire vault sound for each safe landing during grand reveal — synced with visual */
  fireSafeLand(index: number, total: number): void {
    if (!this.ctx) return;
    const buf = this.buffers.get("vault_lock");
    if (!buf) { this.synthTone("vault_lock"); return; }

    const progress = total > 1 ? index / (total - 1) : 1;
    const source = this.ctx.createBufferSource();
    source.buffer = buf;
    source.playbackRate.value = 0.85 + progress * 0.4;     // pitch: 0.85→1.25
    const gain = this.ctx.createGain();
    gain.gain.value = VOLUME.vault_lock * (0.5 + progress * 0.6);  // vol: 50%→110%
    source.connect(gain).connect(this.ctx.destination);
    source.start();
  }

  /** UI click sound (button taps etc.) */
  playUI(_cue: string, muted: boolean): void {
    if (muted) return;
    void this.unlock().then(() => this.synthClick());
  }

  /* ── Bonus heat (chase tension) ────────────────── */

  private heliTimer: number | null = null;
  private heliMaster: GainNode | null = null;
  private lastHeat = -1;

  /** Drive the chase tension: escalating siren stabs + a helicopter at max heat. */
  setBonusHeat(level: number): void {
    if (level === this.lastHeat) return;
    const rising = level > this.lastHeat;
    this.lastHeat = level;
    void this.unlock().then(() => {
      if (level > 0 && rising) this.fire("siren", 0.35 + level * 0.22);
      if (level >= 3) this.startHeli();
      else this.stopHeli();
    });
  }

  /** Procedural helicopter: rapid low rotor thumps. */
  private startHeli(): void {
    if (!this.ctx || this.heliTimer !== null) return;
    const master = this.ctx.createGain();
    master.gain.setValueAtTime(0.0001, this.ctx.currentTime);
    master.gain.exponentialRampToValueAtTime(0.5, this.ctx.currentTime + 0.4);
    master.connect(this.ctx.destination);
    this.heliMaster = master;
    let next = this.ctx.currentTime + 0.05;
    const tick = (): void => {
      if (!this.ctx || !this.heliMaster) return;
      while (next < this.ctx.currentTime + 0.25) {
        const osc = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        osc.type = "square";
        osc.frequency.setValueAtTime(48, next);
        g.gain.setValueAtTime(0.0001, next);
        g.gain.exponentialRampToValueAtTime(0.09, next + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, next + 0.07);
        osc.connect(g).connect(master);
        osc.start(next);
        osc.stop(next + 0.09);
        next += 0.085; // ~12 Hz rotor
      }
      this.heliTimer = window.setTimeout(tick, 60);
    };
    tick();
  }

  private stopHeli(): void {
    if (this.heliTimer !== null) { window.clearTimeout(this.heliTimer); this.heliTimer = null; }
    if (this.heliMaster && this.ctx) {
      const g = this.heliMaster;
      const now = this.ctx.currentTime;
      try {
        g.gain.cancelScheduledValues(now);
        g.gain.setValueAtTime(Math.max(g.gain.value, 0.0001), now);
        g.gain.exponentialRampToValueAtTime(0.0001, now + 0.3);
      } catch { /* ignore */ }
      const ref = g;
      window.setTimeout(() => { try { ref.disconnect(); } catch { /* ignore */ } }, 400);
      this.heliMaster = null;
    }
  }

  /* ── Radio (GTA-style station wheel) ───────────── */

  getStation(): string {
    return this.radioStation;
  }

  /** Switch the background music to a chosen radio station. */
  selectStation(id: string): void {
    this.radioStation = id;
    this.radioOverride = true;
    void this.unlock().then(() => {
      this.stopSynthRadio();
      this.fadeOut("bg");
      const cfg = STATION_AUDIO[id];
      if (!cfg || cfg.kind === "off") return;
      if (cfg.kind === "track") {
        this.startLoop(cfg.track, "bg");
      } else if (cfg.kind === "synth") {
        this.startSynthRadio(cfg.wave, cfg.base, cfg.tempo, cfg.scale);
      } else if (cfg.kind === "scanner") {
        this.startScannerRadio();
      }
    });
  }

  /** A looping procedural synthwave arpeggio + bass. */
  private startSynthRadio(wave: OscillatorType, base: number, tempo: number, scale: number[]): void {
    if (!this.ctx) return;
    const master = this.ctx.createGain();
    master.gain.setValueAtTime(0.0001, this.ctx.currentTime);
    master.gain.exponentialRampToValueAtTime(0.5, this.ctx.currentTime + FADE);
    master.connect(this.ctx.destination);
    this.synthMaster = master;

    let step = 0;
    let nextTime = this.ctx.currentTime + 0.06;
    const semis = (n: number) => base * Math.pow(2, n / 12);

    const schedule = (): void => {
      if (!this.ctx || !this.synthMaster) return;
      while (nextTime < this.ctx.currentTime + 0.25) {
        // arpeggio note
        this.synthNoteAt(wave, semis(scale[step % scale.length]), nextTime, tempo * 0.9, 0.10, master);
        // bass on every 4th step (an octave + a fifth down)
        if (step % 4 === 0) this.synthNoteAt("triangle", semis(scale[0]) / 2, nextTime, tempo * 3.6, 0.16, master);
        // off-beat soft shimmer an octave up
        if (step % 2 === 1) this.synthNoteAt("sine", semis(scale[step % scale.length] + 12), nextTime, tempo * 0.5, 0.04, master);
        nextTime += tempo;
        step++;
      }
      this.synthTimer = window.setTimeout(schedule, 60);
    };
    schedule();
  }

  /** A low police-scanner channel: static chatter bursts + the odd siren blip. */
  private startScannerRadio(): void {
    if (!this.ctx) return;
    const master = this.ctx.createGain();
    master.gain.setValueAtTime(0.0001, this.ctx.currentTime);
    master.gain.exponentialRampToValueAtTime(0.5, this.ctx.currentTime + FADE);
    master.connect(this.ctx.destination);
    this.synthMaster = master;

    let nextTime = this.ctx.currentTime + 0.1;
    const schedule = (): void => {
      if (!this.ctx || !this.synthMaster) return;
      while (nextTime < this.ctx.currentTime + 0.4) {
        if (Math.random() < 0.7) this.noiseBurstAt(nextTime, 0.12 + Math.random() * 0.18, master);
        if (Math.random() < 0.12) this.synthNoteAt("square", 620 + Math.random() * 240, nextTime, 0.14, 0.06, master);
        nextTime += 0.18 + Math.random() * 0.22;
      }
      this.synthTimer = window.setTimeout(schedule, 70);
    };
    schedule();
  }

  /** Schedule one enveloped oscillator note into a destination gain. */
  private synthNoteAt(wave: OscillatorType, freq: number, when: number, dur: number, gain: number, dest: GainNode): void {
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = wave;
    osc.frequency.setValueAtTime(freq, when);
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(gain, when + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    osc.connect(g).connect(dest);
    osc.start(when);
    osc.stop(when + dur + 0.03);
  }

  /** Filtered white-noise burst (radio static). */
  private noiseBurstAt(when: number, dur: number, dest: GainNode): void {
    if (!this.ctx) return;
    const frames = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, frames, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < frames; i++) data[i] = (Math.random() * 2 - 1) * 0.5;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const filter = this.ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 900 + Math.random() * 1400;
    filter.Q.value = 1.5;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(0.08, when + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    src.connect(filter).connect(g).connect(dest);
    src.start(when);
    src.stop(when + dur + 0.02);
  }

  private stopSynthRadio(): void {
    if (this.synthTimer !== null) { window.clearTimeout(this.synthTimer); this.synthTimer = null; }
    if (this.synthMaster && this.ctx) {
      const g = this.synthMaster;
      const now = this.ctx.currentTime;
      try {
        g.gain.cancelScheduledValues(now);
        g.gain.setValueAtTime(Math.max(g.gain.value, 0.0001), now);
        g.gain.exponentialRampToValueAtTime(0.0001, now + 0.35);
      } catch { /* ignore */ }
      const ref = g;
      window.setTimeout(() => { try { ref.disconnect(); } catch { /* ignore */ } }, 500);
      this.synthMaster = null;
    }
  }

  /* ── event → sound routing ─────────────────────── */

  private route(ev: GameEvent, turbo: boolean): void {
    const vol = turbo ? 0.55 : 1;      // quieter in turbo

    // Always make sure background music is running
    this.ensureBg();

    switch (ev.type) {

      /* ── spin lifecycle ──────────────────────── */
      case "round_start":
        this.startLoop("spin_loop", "spin");
        break;

      case "board_settle":
        this.fadeOut("spin");
        break;

      /* ── wins ────────────────────────────────── */
      case "cluster_win":
        if (ev.payout >= 20)     this.fire("win_big", vol);
        else                     this.fire("win_small", vol);
        break;

      /* ── heat system ─────────────────────────── */
      case "heat_advance":
        if (ev.to >= 4)          this.fire("siren", vol * 0.7);
        else if (ev.to >= 2)     this.fire("heat_rise", vol);
        break;

      case "heat_transform":
        this.fire("siren", vol);
        break;

      case "mega_wild_place":
        this.fire("heat_rise", vol);
        break;

      case "global_multiplier_apply":
        this.fire("siren", vol * 0.8);
        break;

      /* ── scatter / bonus ─────────────────────── */
      case "scatter_tease":
        this.fire("heat_rise", vol * 0.7);
        break;

      case "bonus_trigger":
        this.fire("bonus_trigger", vol);
        this.inBonus = true;
        this.crossfadeBg("bg_bonus");
        break;

      case "bonus_spin":
        // Grand reveal audio is handled by fireSafeLand() callback
        // Normal bonus spins with few symbols still get a vault sound
        if (ev.landedSymbols.length > 0 && ev.landedSymbols.length < 20)
          this.fire("vault_lock", vol);
        break;

      case "safe_lock":
        this.fire("vault_lock", vol);
        break;

      case "master_key_crack":
        this.fire("siren", vol * 0.45);
        break;

      case "bonus_end":
        this.inBonus = false;
        if (ev.filledScreen || ev.totalPayout >= 100)
          this.fire("mega_win", vol);
        else if (ev.totalPayout >= 10)
          this.fire("win_big", vol);
        else
          this.fire("win_small", vol);
        this.crossfadeBg("bg_base");
        break;

      /* ── round end (just cleanup) ──────────── */
      case "round_end":
        this.fadeOut("spin");
        break;
    }
  }

  /* ═══════════════════════════════════════════════
     Playback helpers
     ═══════════════════════════════════════════════ */

  /** Fire a one-shot sound (layers on top of everything) */
  private fire(track: TrackName, volumeScale = 1): void {
    if (!this.ctx) return;
    const buf = this.buffers.get(track);
    if (!buf) { this.synthTone(track); return; }

    const source = this.ctx.createBufferSource();
    source.buffer = buf;
    const gain = this.ctx.createGain();
    gain.gain.value = (VOLUME[track] ?? 0.5) * volumeScale;
    source.connect(gain).connect(this.ctx.destination);
    source.start();
    // source auto-disconnects when finished
  }

  /** Start a looping track in a named slot */
  private startLoop(track: TrackName, slot: "bg" | "spin"): void {
    if (!this.ctx) return;
    const existing = slot === "bg" ? this.bgLoop : this.spinLoop;
    if (existing?.track === track) return;          // already playing this track

    const buf = this.buffers.get(track);
    if (!buf) return;

    // fade out whatever was in this slot
    if (existing) this.fadeAndStop(existing);

    const source = this.ctx.createBufferSource();
    source.buffer = buf;
    source.loop = true;

    const gain = this.ctx.createGain();
    const now = this.ctx.currentTime;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(VOLUME[track], now + FADE);

    source.connect(gain).connect(this.ctx.destination);
    source.start();

    const loop: ActiveLoop = { source, gain, track };
    if (slot === "bg") this.bgLoop = loop;
    else               this.spinLoop = loop;
  }

  /** Fade out and stop a loop slot */
  private fadeOut(slot: "bg" | "spin"): void {
    const loop = slot === "bg" ? this.bgLoop : this.spinLoop;
    if (!loop) return;
    this.fadeAndStop(loop);
    if (slot === "bg") this.bgLoop = null;
    else               this.spinLoop = null;
  }

  /** Crossfade background music to a new track */
  private crossfadeBg(to: TrackName): void {
    if (this.radioOverride) return; // the player is controlling the radio
    this.fadeOut("bg");
    this.startLoop(to, "bg");
  }

  /** Make sure background music is running (restart after mute) */
  private ensureBg(): void {
    if (this.radioOverride) return; // the chosen station persists; don't auto-restart
    if (this.bgLoop) return;
    this.startLoop(this.inBonus ? "bg_bonus" : "bg_base", "bg");
  }

  /** Gracefully fade a loop to silence then stop it */
  private fadeAndStop(loop: ActiveLoop): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    try {
      loop.gain.gain.cancelScheduledValues(now);
      loop.gain.gain.setValueAtTime(
        Math.max(loop.gain.gain.value, 0.0001), now
      );
      loop.gain.gain.exponentialRampToValueAtTime(0.0001, now + FADE);
      loop.source.stop(now + FADE + 0.05);
    } catch {
      /* already stopped — ignore */
    }
  }

  /** Kill all loops immediately (for mute) */
  private killAll(): void {
    this.fadeOut("bg");
    this.fadeOut("spin");
    this.stopSynthRadio();
  }

  /* ═══════════════════════════════════════════════
     Synth fallback (when mp3 files missing)
     ═══════════════════════════════════════════════ */

  private synthClick(): void {
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    const t = this.ctx.currentTime;
    osc.type = "sine";
    osc.frequency.setValueAtTime(800, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.015, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
    osc.connect(g).connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + 0.06);
  }

  /** Simple sine-wave fallback for missing audio files */
  private synthTone(track: TrackName): void {
    if (!this.ctx) return;

    const FALLBACK: Partial<Record<TrackName, { f: number; d: number; g: number }>> = {
      win_small:     { f: 330, d: 0.15, g: 0.020 },
      win_big:       { f: 520, d: 0.25, g: 0.025 },
      mega_win:      { f: 880, d: 0.35, g: 0.025 },
      bonus_trigger: { f: 620, d: 0.20, g: 0.022 },
      vault_lock:    { f: 300, d: 0.12, g: 0.018 },
      heat_rise:     { f: 440, d: 0.18, g: 0.020 },
      siren:         { f: 700, d: 0.20, g: 0.022 },
    };

    const s = FALLBACK[track];
    if (!s) return;

    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    const t = this.ctx.currentTime;
    osc.type = "sine";
    osc.frequency.setValueAtTime(s.f, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(s.g, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + s.d);
    osc.connect(g).connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + s.d + 0.02);
  }
}
