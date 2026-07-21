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
  | "bonus_trigger" | "vault_lock" | "heat_rise" | "siren"
  | "count_up_tick" | "dynamite_explode" | "girl_complete"
  | "mega_wild_place" | "radio_dial" | "reel_stop" | "scatter_land"
  | "tumble_pop" | "ui_buy" | "ui_click" | "coin_sound"
  | "police_sound_loop" | "normal_win_sound" | "big_win_sound"
  | "new_reel_stop" | "wild_sound" | "good_win_combo" | "poker_machine_win"
  | "milestone2_girl1" | "mileston3_girl1" | "mileston4_girl1"
  | "milstone1_girl2" | "milestone2_girl2" | "mileston3_girl2" | "mileston4_girl2"
  | "mileston1_girl3" | "mileston2_girl3" | "mileston3_girl3" | "mileston4_girl3"
  | "getaway_end" | "money_counter_end" | "money_counter_loop" | "reel_loop"
  | "win_mega_grand" | "win_max" | "getaway_explosive" | "getaway_intro"
  | "win_big_lowest" | "sticky_gold_bar" | "typewriter"
  | "sunset_synths" | "turbo_night" | "vice_nights" | "open_lines";

const AUDIO_BASE = "assets/audio/";

const TRACK_PATHS: Partial<Record<TrackName, string>> = {
  bg_base: "assets/audio/turbo_night.mp3",
  sunset_synths: "assets/audio/sunset_synths.mp3",
  vice_nights: "assets/audio/vice_nights.mp3",
  open_lines: "assets/Open Lines 97.mp3",
  new_reel_stop: "assets/new sound/new reel stop sound.mp3",
  wild_sound: "assets/new sound/wild sound.mp3",
  good_win_combo: "assets/new sound/good winning combination soun.mp3",
  poker_machine_win: "assets/new sound/poker_machine_win.mp3",
  milestone2_girl1: "assets/new sound/milestone2 girl1.mp3",
  mileston3_girl1: "assets/new sound/mileston3 girl1.mp3",
  mileston4_girl1: "assets/new sound/mileston4 girl1.mp3",
  milstone1_girl2: "assets/new sound/milstone1 girl2.mp3",
  milestone2_girl2: "assets/new sound/milestone2 girl2.mp3",
  mileston3_girl2: "assets/new sound/mileston3 girl2.mp3",
  mileston4_girl2: "assets/new sound/mileston4 girl2 (2).mp3",
  mileston1_girl3: "assets/new sound/mileston1 girl3.mp3",
  mileston2_girl3: "assets/new sound/mileston2 girl3.mp3",
  mileston3_girl3: "assets/new sound/mileston3 girl3.mp3",
  mileston4_girl3: "assets/new sound/mileston4 girl3.mp3",
  getaway_end: "assets/new new sound/end of getaway sound.mp3",
  money_counter_end: "assets/new new sound/end of money counter sound.mp3",
  money_counter_loop: "assets/new new sound/money_counter_sound it is a loop so feel free to make it the exact length of the actual counting animation.mp3",
  reel_loop: "assets/new new sound/slot reel sound is a loop too so feel free to adapt it for turbo spins etc.mp3",
  win_mega_grand: "assets/new new sound/sound for 2 and 3 biggest winning banner.mp3",
  win_max: "assets/new new sound/sound for biggest winning banner.mp3",
  getaway_explosive: "assets/new new sound/sound for explosive multiples in the getaway play once per explosive.mp3",
  getaway_intro: "assets/new new sound/sound for getaway intro play in same time as the banner appear that give the cinematic look.mp3",
  win_big_lowest: "assets/new new sound/sound for lowest paying winning banner animation.mp3",
  sticky_gold_bar: "assets/new new sound/sound for sticky gold bar in getaway mode.mp3",
  bg_bonus: "assets/new new sound/continuous looping getaway background sound play after the intro sound.mp3",
  police_sound_loop: "assets/sound/police sound loop.mp3",
  typewriter: "assets/new new sound/type writer sound.mp3",
};

const ALL_TRACKS: TrackName[] = [
  "bg_base", "bg_bonus", "spin_loop",
  "win_small", "win_big", "mega_win",
  "bonus_trigger", "vault_lock", "heat_rise", "siren",
  "count_up_tick", "dynamite_explode", "girl_complete",
  "mega_wild_place", "radio_dial", "reel_stop", "scatter_land",
  "tumble_pop", "ui_buy", "ui_click", "coin_sound",
  "police_sound_loop", "normal_win_sound", "big_win_sound",
  "new_reel_stop", "wild_sound", "good_win_combo", "poker_machine_win",
  "milestone2_girl1", "mileston3_girl1", "mileston4_girl1",
  "milstone1_girl2", "milestone2_girl2", "mileston3_girl2", "mileston4_girl2",
  "mileston1_girl3", "mileston2_girl3", "mileston3_girl3", "mileston4_girl3",
  "getaway_end", "money_counter_end", "money_counter_loop", "reel_loop",
  "win_mega_grand", "win_max", "getaway_explosive", "getaway_intro",
  "win_big_lowest", "sticky_gold_bar", "typewriter",
  "sunset_synths", "turbo_night", "vice_nights", "open_lines"
];

/** Base volume per track (0–1+) */
const VOLUME: Record<TrackName, number> = {
  bg_base:           0.30,
  bg_bonus:          0.55,
  spin_loop:         0.40,
  win_small:         0.55,
  win_big:           0.65,
  mega_win:          0.80,
  bonus_trigger:     0.70,
  vault_lock:        0.70,
  heat_rise:         0.50,
  siren:             0.55,
  count_up_tick:     0.45,
  dynamite_explode:  0.85,
  girl_complete:     0.80,
  mega_wild_place:   0.75,
  radio_dial:        0.50,
  reel_stop:         0.50,
  scatter_land:      0.70,
  tumble_pop:        0.45,
  ui_buy:            0.65,
  ui_click:          4.5,
  coin_sound:        0.55,
  police_sound_loop: 0.35,
  normal_win_sound:  0.55,
  big_win_sound:     0.65,
  new_reel_stop:     1.0,
  wild_sound:        0.35,
  good_win_combo:    0.75,
  poker_machine_win: 0.85,
  // All girls voice volume boosted as requested
  milestone2_girl1:  1.30,
  mileston3_girl1:   1.30,
  mileston4_girl1:   1.35,
  milstone1_girl2:   1.30,
  milestone2_girl2:  1.30,
  mileston3_girl2:   1.30,
  mileston4_girl2:   1.35,
  // Girl 3 extra boosted voice volume
  mileston1_girl3:   1.65,
  mileston2_girl3:   1.65,
  mileston3_girl3:   1.65,
  mileston4_girl3:   1.70,
  // New new sound volumes
  getaway_end:       0.75,
  money_counter_end: 0.85,
  money_counter_loop:0.65,
  reel_loop:         0.50,
  win_mega_grand:    0.85,
  win_max:           1.0,
  getaway_explosive: 0.80,
  getaway_intro:     1.65, // boosted heavily for cinematic impact
  win_big_lowest:    0.75,
  sticky_gold_bar:   0.70,
  typewriter:        0.80,
  sunset_synths:     0.30,
  turbo_night:       0.30,
  vice_nights:       0.30,
  open_lines:        0.55,
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
  off:       { kind: "off" },
  heat:      { kind: "track", track: "bg_base" },
  vault:     { kind: "track", track: "bg_bonus" },
  neon:      { kind: "track", track: "sunset_synths" },
  vice:      { kind: "track", track: "vice_nights" },
  open_live: { kind: "track", track: "open_lines" },
  scanner:   { kind: "track", track: "open_lines" },
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

  /* active loop slots — bg, spin, counter can each have one */
  private bgLoop: ActiveLoop | null = null;
  private spinLoop: ActiveLoop | null = null;
  private counterLoop: ActiveLoop | null = null;
  private inBonus = false;

  /* voice playback & audio ducking tracking */
  private activeVoiceSource: AudioBufferSourceNode | null = null;
  private duckRestoreTimer: number | null = null;

  /* procedural synth reel sound (the repeating thock+tick during spin) */
  private spinReelTimer: number | null = null;
  private spinReelMaster: GainNode | null = null;

  /* radio: once the player picks a station the game stops auto-switching music */
  private radioOverride = false;
  private radioStation = "heat";
  private synthTimer: number | null = null;
  private synthMaster: GainNode | null = null;

  /* continuous money-counter "roller": a single looped voice whose pitch and
     roll-rate rise with the count-up progress, so it stays locked to the win
     counter for its entire (variable) duration instead of firing dead ticks. */
  private counterMaster: GainNode | null = null;
  private counterTrem: GainNode | null = null;
  private counterLfo: OscillatorNode | null = null;
  private counterOsc: OscillatorNode | null = null;
  private counterOsc2: OscillatorNode | null = null;
  private counterLp: BiquadFilterNode | null = null;

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
          const rawPath = TRACK_PATHS[t] ?? `${AUDIO_BASE}${t}.mp3`;
          const path = encodeURI(rawPath);
          const r = await fetch(path);
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
    const buf = this.buffers.get("sticky_gold_bar");
    if (!buf) { this.synthTone("vault_lock"); return; }

    const progress = total > 1 ? index / (total - 1) : 1;
    const source = this.ctx.createBufferSource();
    source.buffer = buf;
    source.playbackRate.value = 0.85 + progress * 0.4;     // pitch: 0.85→1.25
    const gain = this.ctx.createGain();
    gain.gain.value = (VOLUME.sticky_gold_bar ?? 0.70) * (0.5 + progress * 0.6);  // vol: 50%→110%
    source.connect(gain).connect(this.ctx.destination);
    source.start();
  }

  /* ── Typewriter sound (synced with getaway intro text) ─── */
  private typewriterSource: AudioBufferSourceNode | null = null;
  private typewriterGain: GainNode | null = null;

  /** Start looping the typewriter sound. Returns immediately. Call stopTypewriter() to stop. */
  startTypewriter(): void {
    if (!this.ctx) return;
    this.stopTypewriter(); // kill any previous instance
    const buf = this.buffers.get("typewriter");
    if (!buf) return;
    const source = this.ctx.createBufferSource();
    source.buffer = buf;
    source.loop = false; // single play — the file is long enough for the typing duration
    const gain = this.ctx.createGain();
    gain.gain.value = VOLUME.typewriter ?? 0.80;
    source.connect(gain).connect(this.ctx.destination);
    source.start();
    this.typewriterSource = source;
    this.typewriterGain = gain;
    // Auto-cleanup when the sound ends naturally
    source.onended = () => {
      this.typewriterSource = null;
      this.typewriterGain = null;
    };
  }

  /** Immediately stop (fade out) the typewriter sound. */
  stopTypewriter(): void {
    if (this.typewriterGain && this.ctx) {
      const now = this.ctx.currentTime;
      try {
        this.typewriterGain.gain.cancelScheduledValues(now);
        this.typewriterGain.gain.setValueAtTime(Math.max(this.typewriterGain.gain.value, 0.0001), now);
        this.typewriterGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.05); // very quick fade
      } catch { /* ignore */ }
    }
    if (this.typewriterSource) {
      const ref = this.typewriterSource;
      setTimeout(() => { try { ref.stop(); } catch { /* ignore */ } }, 80);
      this.typewriterSource = null;
    }
    this.typewriterGain = null;
  }

  /** UI click sound (button taps etc.) */
  playUI(cue: string, muted: boolean): void {
    if (muted) return;
    void this.unlock().then(() => {
      if ((cue === "buy" || cue === "ui_buy") && this.buffers.has("ui_buy")) {
        this.fire("ui_buy");
      } else if (cue === "radio" && this.buffers.has("radio_dial")) {
        this.fire("radio_dial");
      } else if (this.buffers.has("ui_click")) {
        this.fire("ui_click");
      } else {
        this.synthClick();
      }
    });
  }

  /** Reel stop: sound removed per user request. Only stops the synth reel on last column. */
  reelStop(col: number, total: number, _muted: boolean): void {
    if (col === total - 1) {
      this.stopSynthReel();
    }
  }

  /** Procedural reel spin: replaced with native loop track. */
  private startSynthReel(): void {
    this.startLoop("reel_loop", "spin");
  }

  private stopSynthReel(): void {
    this.fadeOut("spin");
  }

  /** Rising tension riser when 2+ scatters are in play (anticipation spin). */
  anticipation(muted: boolean): void {
    if (muted || this.riserActive) return;
    this.riserActive = true;
    void this.unlock().then(() => {
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      const dur = 1.1;
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      const lp = this.ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.setValueAtTime(500, t);
      lp.frequency.exponentialRampToValueAtTime(3500, t + dur);
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(160, t);
      osc.frequency.exponentialRampToValueAtTime(620, t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.10, t + dur * 0.7);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.1);
      osc.connect(lp).connect(g).connect(this.ctx.destination);
      osc.start(t); osc.stop(t + dur + 0.15);
      window.setTimeout(() => { this.riserActive = false; }, (dur + 0.2) * 1000);
    });
  }
  private riserActive = false;

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
        // Start the procedural synth reel sound the instant the player
        // fires a spin. reelStop(lastCol) stops it when the final column
        // lands, keeping it perfectly in sync with the visual animation.
        this.startSynthReel();
        break;

      case "board_settle":
        // The synth reel keeps playing through the reel animation that
        // runs during this event — no action needed here.
        break;

      /* ── wins ────────────────────────────────── */
      case "cluster_win":
        // Combination sound = reel stop sound (per user request)
        this.fire("new_reel_stop", vol);
        break;

      /* ── heat system ─────────────────────────── */
      case "heat_advance":
        if (ev.to >= 4)          this.fire("siren", vol * 0.7);
        else if (ev.to >= 2)     this.fire("heat_rise", vol);
        break;

      case "heat_transform":
        this.fire("poker_machine_win", vol * 1.1);
        break;

      case "mega_wild_place":
        this.fire("heat_rise", vol);
        break;

      case "global_multiplier_apply":
        this.fire("siren", vol * 0.8);
        break;

      case "tumble_remove":
        if (this.buffers.has("tumble_pop")) this.fire("tumble_pop", vol);
        break;

      /* ── scatter / bonus ─────────────────────── */
      case "scatter_tease":
        // No per-scatter zoom audio (removed per request). The negative "near
        // miss" cue for a failed anticipation is fired from BoardView's
        // onAnticipationMiss hook, synced to the reel stopping short — so a
        // 2-scatter tease that had no anticipation stays silent by design.
        break;

      case "bonus_trigger":
        this.fire("getaway_intro", vol, 1.25); // 25% faster so it ends sooner
        this.inBonus = true;
        this.crossfadeBg("bg_bonus");
        break;

      case "bonus_spin":
        // Gold bar audio is handled by fireSafeLand() callback when they physically land on screen.
        break;

      case "safe_lock":
        // Value is shown on the gold bar and added to COLLECTED — no audio here because fireSafeLand handles it sync'd with visual.
        break;

      case "master_key_crack":
        if (this.buffers.has("getaway_explosive")) this.fire("getaway_explosive", vol);
        else this.fire("siren", vol * 0.45);
        break;

      case "bonus_end":
        this.inBonus = false;
        this.fire("getaway_end", vol);
        this.crossfadeBg("bg_base");
        break;

      /* ── round end (just cleanup) ──────────── */
      case "round_end":
        // Safety: ensure the synth reel is gone (should already be stopped
        // by reelStop(lastCol), but guard against edge cases).
        this.stopSynthReel();
        this.fadeOut("spin");
        break;
    }
  }

  /* ═══════════════════════════════════════════════
     Playback helpers
     ═══════════════════════════════════════════════ */

  /** Fire a one-shot sound (layers on top of everything) */
  fire(track: TrackName, volumeScale = 1, playbackRate = 1): void {
    if (!this.ctx) return;
    if (this.ctx.state === "suspended") {
      void this.ctx.resume();
    }
    let buf = this.buffers.get(track);
    if (!buf) {
      if (track === "win_big" && this.buffers.has("big_win_sound")) buf = this.buffers.get("big_win_sound");
      else if (track === "win_small" && this.buffers.has("normal_win_sound")) buf = this.buffers.get("normal_win_sound");
      else if (track === "siren" && this.buffers.has("police_sound_loop")) buf = this.buffers.get("police_sound_loop");
      else if (track === "bg_bonus" && this.buffers.has("police_sound_loop")) buf = this.buffers.get("police_sound_loop");
      else if (track === "bg_base" && this.buffers.has("police_sound_loop")) buf = this.buffers.get("police_sound_loop");
    }
    if (!buf) { this.synthTone(track); return; }

    const isVoice = track.startsWith("mileston") || track.startsWith("milestone");
    if (isVoice) {
      // Prevent overlapping voice clips by stopping active voice
      if (this.activeVoiceSource) {
        try { this.activeVoiceSource.stop(); } catch { /* ignore */ }
        this.activeVoiceSource = null;
      }
      if (this.duckRestoreTimer !== null) {
        window.clearTimeout(this.duckRestoreTimer);
        this.duckRestoreTimer = null;
      }
      // Duck background music during voice playback
      if (this.bgLoop && this.bgLoop.gain) {
        const now = this.ctx.currentTime;
        const currentTrack = this.bgLoop.track;
        const baseVol = VOLUME[currentTrack] ?? 0.3;
        try {
          this.bgLoop.gain.gain.cancelScheduledValues(now);
          this.bgLoop.gain.gain.setValueAtTime(Math.max(0.0001, this.bgLoop.gain.gain.value), now);
          this.bgLoop.gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, baseVol * 0.15), now + 0.15);
        } catch { /* ignore */ }
      }
    }

    const source = this.ctx.createBufferSource();
    source.buffer = buf;
    source.playbackRate.value = playbackRate;
    const gain = this.ctx.createGain();
    gain.gain.value = (VOLUME[track] ?? 0.5) * volumeScale;
    source.connect(gain).connect(this.ctx.destination);
    source.start();

    if (isVoice) {
      this.activeVoiceSource = source;
      const durMs = Math.ceil(buf.duration * 1000) + 100;
      this.duckRestoreTimer = window.setTimeout(() => {
        this.activeVoiceSource = null;
        if (this.bgLoop && this.bgLoop.gain && this.ctx) {
          const now = this.ctx.currentTime;
          const baseVol = VOLUME[this.bgLoop.track] ?? 0.3;
          try {
            this.bgLoop.gain.gain.cancelScheduledValues(now);
            this.bgLoop.gain.gain.setValueAtTime(Math.max(0.0001, this.bgLoop.gain.gain.value), now);
            this.bgLoop.gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, baseVol), now + 0.35);
          } catch { /* ignore */ }
        }
      }, durMs);
    }
  }

  playWinTick(pitchLevel: "normal" | "medium" | "high"): void {
    if (!this.ctx) return;
    const buf = this.buffers.get("count_up_tick");
    if (buf) {
      const source = this.ctx.createBufferSource();
      source.buffer = buf;
      source.playbackRate.value = pitchLevel === "high" ? 1.2 : pitchLevel === "medium" ? 1.1 : 1.0;
      const gain = this.ctx.createGain();
      gain.gain.value = (VOLUME.count_up_tick ?? 0.45);
      source.connect(gain).connect(this.ctx.destination);
      source.start();
      return;
    }
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    
    const freq = pitchLevel === "high" ? 880 : pitchLevel === "medium" ? 660 : 440;
    osc.type = "sine";
    osc.frequency.setValueAtTime(freq, t);
    
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.035, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
    
    osc.connect(g).connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + 0.09);
  }

  /* ═══════════════════════════════════════════════
     Win-banner IMPACT — the cinematic "bang"
     ═══════════════════════════════════════════════
     A layered one-shot built for weight: a sub-bass body-drop, a tight
     transient crack, and (for bigger tiers) a detuned brass "braaam" stab —
     the getaway/heist hit that makes every banner land like a punch.
     Every banner that pops calls this; each tier crossing inside the big
     cinematic counter calls it again, so stacked banners each bang. */
  bannerImpact(intensity: "low" | "mid" | "high" | "grand" = "mid"): void {
    void this.unlock().then(() => {
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      const scale =
        intensity === "grand" ? 1.0 :
        intensity === "high"  ? 0.82 :
        intensity === "mid"   ? 0.66 : 0.5;

      const out = this.ctx.createGain();
      out.gain.value = 0.95 * scale;
      out.connect(this.ctx.destination);

      // 1) Sub-bass body drop — the chest thump (sine pitch-sweep down).
      const subEnd = 0.42 + scale * 0.22;
      const sub = this.ctx.createOscillator();
      const subG = this.ctx.createGain();
      sub.type = "sine";
      sub.frequency.setValueAtTime(155, t);
      sub.frequency.exponentialRampToValueAtTime(40, t + subEnd);
      subG.gain.setValueAtTime(0.0001, t);
      subG.gain.exponentialRampToValueAtTime(1.0, t + 0.012);
      subG.gain.exponentialRampToValueAtTime(0.0001, t + subEnd + 0.05);
      sub.connect(subG).connect(out);
      sub.start(t); sub.stop(t + subEnd + 0.1);

      // 2) Mid body punch — triangle for weight/warmth.
      const body = this.ctx.createOscillator();
      const bodyG = this.ctx.createGain();
      body.type = "triangle";
      body.frequency.setValueAtTime(110, t);
      body.frequency.exponentialRampToValueAtTime(58, t + 0.16);
      bodyG.gain.setValueAtTime(0.0001, t);
      bodyG.gain.exponentialRampToValueAtTime(0.55, t + 0.008);
      bodyG.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
      body.connect(bodyG).connect(out);
      body.start(t); body.stop(t + 0.24);

      // 3) Transient crack — short high-passed noise burst = the snap/attack.
      const frames = Math.floor(this.ctx.sampleRate * 0.06);
      const nbuf = this.ctx.createBuffer(1, frames, this.ctx.sampleRate);
      const ndata = nbuf.getChannelData(0);
      for (let i = 0; i < frames; i++) ndata[i] = (Math.random() * 2 - 1) * (1 - i / frames);
      const nsrc = this.ctx.createBufferSource();
      nsrc.buffer = nbuf;
      const nhp = this.ctx.createBiquadFilter();
      nhp.type = "highpass"; nhp.frequency.value = 2200;
      const nG = this.ctx.createGain();
      nG.gain.setValueAtTime(0.0001, t);
      nG.gain.exponentialRampToValueAtTime(0.6 * scale, t + 0.004);
      nG.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
      nsrc.connect(nhp).connect(nG).connect(out);
      nsrc.start(t);

      // 4) Heist brass "braaam" — detuned saw power chord (root + fifth) through
      //    a lowpass that snaps open. Only from mid up, so small wins stay clean.
      if (intensity !== "low") {
        const brassG = this.ctx.createGain();
        const brassLp = this.ctx.createBiquadFilter();
        brassLp.type = "lowpass";
        brassLp.frequency.setValueAtTime(300, t);
        brassLp.frequency.exponentialRampToValueAtTime(intensity === "grand" ? 4200 : 2600, t + 0.08);
        brassLp.frequency.exponentialRampToValueAtTime(700, t + 0.5);
        brassLp.Q.value = 3;
        const stabDur = intensity === "grand" ? 0.7 : intensity === "high" ? 0.55 : 0.42;
        brassG.gain.setValueAtTime(0.0001, t);
        brassG.gain.exponentialRampToValueAtTime(0.5 * scale, t + 0.02);
        brassG.gain.exponentialRampToValueAtTime(0.18 * scale, t + stabDur * 0.5);
        brassG.gain.exponentialRampToValueAtTime(0.0001, t + stabDur);
        brassLp.connect(brassG).connect(out);
        const root = intensity === "grand" ? 82.4 : 98.0; // E2 / G2
        const voices = [root, root * 1.5, root * 2, root * 2 * 1.5];
        for (const f of voices) {
          for (const det of [-6, 7]) {
            const o = this.ctx.createOscillator();
            o.type = "sawtooth";
            o.frequency.value = f;
            o.detune.value = det;
            o.connect(brassLp);
            o.start(t); o.stop(t + stabDur + 0.05);
          }
        }
      }
    });
  }

  /* ═══════════════════════════════════════════════
     Scatter-slam hit — fired by the board the instant each zoomed
     scatter symbol slams back down during the bonus-trigger tease.
     A rising dopamine ladder: every hit is the cinematic banner bang
     PLUS the win-combo jingle pitched up a step per scatter, so
     scatter 1 → 2 → 3 audibly climbs toward the bonus.
     ═══════════════════════════════════════════════ */

  /* ═══════════════════════════════════════════════
     Negative "miss" cue — the sound of NOTHING landing. Used for both a
     Getaway dead spin AND a scatter anticipation that stops short of the
     bonus. Deliberately built in the MID band (200–420 Hz) so it is clearly
     audible on laptop/phone speakers — the previous version sat at 48–130 Hz
     and was inaudible on anything but a subwoofer. A descending detuned
     two-note "wah-waah" (classic fail), a short body thud, and a noise tick
     for attack. Escalates slightly with heat (consecutive misses).
     ═══════════════════════════════════════════════ */
  deadSpin(heat: number): void {
    void this.unlock().then(() => {
      if (!this.ctx) return;
      const ctx = this.ctx;
      const t = ctx.currentTime;
      const inten = 0.85 + Math.min(3, Math.max(0, heat)) * 0.12;

      const out = ctx.createGain();
      out.gain.value = 1.35 * inten;
      out.connect(ctx.destination);

      // Sub-bass floor drop — this is what gives the miss real weight. Without
      // it the cue was all midrange "wah" and read as far too polite for a
      // spin that cost the player one of only three chances.
      const sub = ctx.createOscillator();
      const subG = ctx.createGain();
      sub.type = "sine";
      sub.frequency.setValueAtTime(120, t);
      sub.frequency.exponentialRampToValueAtTime(38, t + 0.5);
      subG.gain.setValueAtTime(0.0001, t);
      subG.gain.exponentialRampToValueAtTime(0.55 * inten, t + 0.03);
      subG.gain.exponentialRampToValueAtTime(0.0001, t + 0.62);
      sub.connect(subG).connect(out);
      sub.start(t);
      sub.stop(t + 0.68);

      // Sour minor-2nd rub under the fall — dissonance reads as "bad" instantly.
      for (const f of [233, 247]) {
        const d = ctx.createOscillator();
        const dg = ctx.createGain();
        d.type = "triangle";
        d.frequency.setValueAtTime(f, t + 0.12);
        d.frequency.exponentialRampToValueAtTime(f * 0.8, t + 0.5);
        dg.gain.setValueAtTime(0.0001, t + 0.12);
        dg.gain.exponentialRampToValueAtTime(0.13 * inten, t + 0.18);
        dg.gain.exponentialRampToValueAtTime(0.0001, t + 0.52);
        d.connect(dg).connect(out);
        d.start(t + 0.12);
        d.stop(t + 0.56);
      }

      // Two descending detuned saw notes through a lowpass — the "wah-waah".
      const note = (freq: number, start: number, dur: number, peak: number): void => {
        const lp = ctx.createBiquadFilter();
        lp.type = "lowpass";
        lp.frequency.value = 1900;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, start);
        g.gain.exponentialRampToValueAtTime(peak, start + 0.03);
        g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
        lp.connect(g).connect(out);
        for (const det of [-9, 8]) {
          const o = ctx.createOscillator();
          o.type = "sawtooth";
          o.frequency.setValueAtTime(freq, start);
          o.frequency.exponentialRampToValueAtTime(freq * 0.86, start + dur);
          o.detune.value = det;
          o.connect(lp);
          o.start(start);
          o.stop(start + dur + 0.03);
        }
      };
      note(392, t, 0.17, 0.22);          // "wah"  (G4-ish)
      note(311, t + 0.15, 0.30, 0.24);   // "waah" (Eb4-ish, lower — the letdown)

      // Short body thud so it has weight (kept in an audible ~150 Hz range).
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "triangle";
      o.frequency.setValueAtTime(190, t);
      o.frequency.exponentialRampToValueAtTime(90, t + 0.2);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.28, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.24);
      o.connect(g).connect(out);
      o.start(t);
      o.stop(t + 0.28);

      // Noise tick for attack definition.
      const frames = Math.floor(ctx.sampleRate * 0.04);
      const nbuf = ctx.createBuffer(1, frames, ctx.sampleRate);
      const nd = nbuf.getChannelData(0);
      for (let i = 0; i < frames; i++) nd[i] = (Math.random() * 2 - 1) * (1 - i / frames);
      const nsrc = ctx.createBufferSource();
      nsrc.buffer = nbuf;
      const nhp = ctx.createBiquadFilter();
      nhp.type = "highpass"; nhp.frequency.value = 1400;
      const ng = ctx.createGain();
      ng.gain.setValueAtTime(0.18, t);
      ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
      nsrc.connect(nhp).connect(ng).connect(out);
      nsrc.start(t);
    });
  }

  /**
   * Near-miss sting: the anticipation reel span up for a scatter and stopped
   * short. That is the single most deflating moment in the base game, so it
   * gets its OWN cue rather than reusing deadSpin — a long "power-down" swoop
   * (the riser collapsing back on itself), a dissonant tritone rub, and a dead
   * sub thud with no bounce. Deliberately slower and darker than deadSpin so
   * the two are never confused.
   */
  anticipationMiss(): void {
    void this.unlock().then(() => {
      if (!this.ctx) return;
      const ctx = this.ctx;
      const t = ctx.currentTime;

      const out = ctx.createGain();
      out.gain.value = 1.25;
      out.connect(ctx.destination);

      // Power-down: the riser's own voice, sagging from bright to nothing while
      // the filter closes over it — reads as the machine giving up.
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.setValueAtTime(3200, t);
      lp.frequency.exponentialRampToValueAtTime(260, t + 0.75);
      lp.Q.value = 6;
      const swG = ctx.createGain();
      swG.gain.setValueAtTime(0.0001, t);
      swG.gain.exponentialRampToValueAtTime(0.34, t + 0.05);
      swG.gain.exponentialRampToValueAtTime(0.0001, t + 0.85);
      lp.connect(swG).connect(out);
      for (const det of [-14, 11]) {
        const o = ctx.createOscillator();
        o.type = "sawtooth";
        o.frequency.setValueAtTime(540, t);
        o.frequency.exponentialRampToValueAtTime(66, t + 0.8);
        o.detune.value = det;
        o.connect(lp);
        o.start(t);
        o.stop(t + 0.88);
      }

      // Tritone rub — the "wrong" interval, held under the fall.
      for (const f of [196, 277]) {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = "triangle";
        o.frequency.setValueAtTime(f, t + 0.06);
        o.frequency.exponentialRampToValueAtTime(f * 0.72, t + 0.7);
        g.gain.setValueAtTime(0.0001, t + 0.06);
        g.gain.exponentialRampToValueAtTime(0.15, t + 0.14);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.72);
        o.connect(g).connect(out);
        o.start(t + 0.06);
        o.stop(t + 0.76);
      }

      // Dead sub thud — lands once, does not bounce.
      const sub = ctx.createOscillator();
      const subG = ctx.createGain();
      sub.type = "sine";
      sub.frequency.setValueAtTime(96, t);
      sub.frequency.exponentialRampToValueAtTime(32, t + 0.55);
      subG.gain.setValueAtTime(0.0001, t);
      subG.gain.exponentialRampToValueAtTime(0.6, t + 0.02);
      subG.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
      sub.connect(subG).connect(out);
      sub.start(t);
      sub.stop(t + 0.76);

      // Air release on the tail so it exhales rather than just stopping.
      const frames = Math.floor(ctx.sampleRate * 0.5);
      const nbuf = ctx.createBuffer(1, frames, ctx.sampleRate);
      const nd = nbuf.getChannelData(0);
      for (let i = 0; i < frames; i++) nd[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / frames, 2.2);
      const nsrc = ctx.createBufferSource();
      nsrc.buffer = nbuf;
      const nlp = ctx.createBiquadFilter();
      nlp.type = "lowpass";
      nlp.frequency.setValueAtTime(2600, t);
      nlp.frequency.exponentialRampToValueAtTime(400, t + 0.5);
      const ng = ctx.createGain();
      ng.gain.setValueAtTime(0.16, t + 0.03);
      ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
      nsrc.connect(nlp).connect(ng).connect(out);
      nsrc.start(t + 0.03);
    });
  }

  /**
   * Getaway trigger: the armored trucks rev and tear off the board. Three
   * phases matched to the visual — a diesel rev that BUILDS (0→0.9s, saw
   * cluster climbing 48→150 Hz with a ~26 Hz chug tremolo), a tire screech at
   * launch (bandpassed noise with pitch wobble), and a doppler whoosh fading
   * left as the convoy exits.
   */
  truckDriveOff(): void {
    void this.unlock().then(() => {
      if (!this.ctx) return;
      const ctx = this.ctx;
      const t = ctx.currentTime;

      const out = ctx.createGain();
      out.gain.value = 1.15;
      out.connect(ctx.destination);

      // 1) Diesel rev — detuned saws through a lowpass that opens as revs climb.
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.setValueAtTime(420, t);
      lp.frequency.exponentialRampToValueAtTime(2400, t + 0.9);
      const revG = ctx.createGain();
      revG.gain.setValueAtTime(0.0001, t);
      revG.gain.exponentialRampToValueAtTime(0.42, t + 0.12);
      revG.gain.setValueAtTime(0.42, t + 0.88);
      revG.gain.exponentialRampToValueAtTime(0.0001, t + 1.5);
      // engine chug: tremolo LFO on the rev bus
      const lfo = ctx.createOscillator();
      const lfoG = ctx.createGain();
      lfo.frequency.setValueAtTime(15, t);
      lfo.frequency.linearRampToValueAtTime(30, t + 0.9);
      lfoG.gain.value = 0.16;
      lfo.connect(lfoG).connect(revG.gain);
      lfo.start(t);
      lfo.stop(t + 1.5);
      lp.connect(revG).connect(out);
      for (const det of [-11, 0, 9]) {
        const o = ctx.createOscillator();
        o.type = "sawtooth";
        o.frequency.setValueAtTime(48, t);
        o.frequency.exponentialRampToValueAtTime(150, t + 0.9);
        o.detune.value = det * 3;
        o.connect(lp);
        o.start(t);
        o.stop(t + 1.55);
      }

      // 2) Tire screech right at the launch.
      const sFrames = Math.floor(ctx.sampleRate * 0.4);
      const sBuf = ctx.createBuffer(1, sFrames, ctx.sampleRate);
      const sd = sBuf.getChannelData(0);
      for (let i = 0; i < sFrames; i++) sd[i] = Math.random() * 2 - 1;
      const scr = ctx.createBufferSource();
      scr.buffer = sBuf;
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.Q.value = 9;
      bp.frequency.setValueAtTime(2300, t + 0.82);
      bp.frequency.linearRampToValueAtTime(3100, t + 0.98);
      bp.frequency.linearRampToValueAtTime(2500, t + 1.16);
      const sg = ctx.createGain();
      sg.gain.setValueAtTime(0.0001, t + 0.82);
      sg.gain.exponentialRampToValueAtTime(0.3, t + 0.86);
      sg.gain.exponentialRampToValueAtTime(0.0001, t + 1.22);
      scr.connect(bp).connect(sg).connect(out);
      scr.start(t + 0.82);

      // 3) Doppler whoosh as they blow past — noise sweeping down and away.
      const wFrames = Math.floor(ctx.sampleRate * 0.7);
      const wBuf = ctx.createBuffer(1, wFrames, ctx.sampleRate);
      const wd = wBuf.getChannelData(0);
      for (let i = 0; i < wFrames; i++) wd[i] = (Math.random() * 2 - 1) * (1 - i / wFrames);
      const who = ctx.createBufferSource();
      who.buffer = wBuf;
      const wlp = ctx.createBiquadFilter();
      wlp.type = "lowpass";
      wlp.frequency.setValueAtTime(2800, t + 0.9);
      wlp.frequency.exponentialRampToValueAtTime(320, t + 1.55);
      const wg = ctx.createGain();
      wg.gain.setValueAtTime(0.0001, t + 0.9);
      wg.gain.exponentialRampToValueAtTime(0.34, t + 1.0);
      wg.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
      who.connect(wlp).connect(wg).connect(out);
      who.start(t + 0.9);
    });
  }

  /**
   * The armored doors unlatching and swinging open on the Getaway reels.
   * Three phases matched to the visual: a heavy latch CLUNK, a metal groan as
   * the hinges take the weight, and a resonant boom as they come to rest.
   */
  truckDoors(): void {
    void this.unlock().then(() => {
      if (!this.ctx) return;
      const ctx = this.ctx;
      const t = ctx.currentTime;

      const out = ctx.createGain();
      out.gain.value = 1.1;
      out.connect(ctx.destination);

      // 1) Latch clunk — a short, hard metallic hit.
      const cFrames = Math.floor(ctx.sampleRate * 0.16);
      const cBuf = ctx.createBuffer(1, cFrames, ctx.sampleRate);
      const cd = cBuf.getChannelData(0);
      for (let i = 0; i < cFrames; i++) cd[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / cFrames, 3);
      const clunk = ctx.createBufferSource();
      clunk.buffer = cBuf;
      const cbp = ctx.createBiquadFilter();
      cbp.type = "bandpass"; cbp.frequency.value = 220; cbp.Q.value = 2.2;
      const cg = ctx.createGain();
      cg.gain.setValueAtTime(0.55, t);
      cg.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
      clunk.connect(cbp).connect(cg).connect(out);
      clunk.start(t);
      // low thud under it for weight
      const thud = ctx.createOscillator();
      const tg = ctx.createGain();
      thud.type = "sine";
      thud.frequency.setValueAtTime(90, t);
      thud.frequency.exponentialRampToValueAtTime(42, t + 0.22);
      tg.gain.setValueAtTime(0.0001, t);
      tg.gain.exponentialRampToValueAtTime(0.5, t + 0.015);
      tg.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
      thud.connect(tg).connect(out);
      thud.start(t); thud.stop(t + 0.34);

      // 2) Hinge groan — a detuned saw sliding down through a tight bandpass.
      const gStart = t + 0.16;
      const gbp = ctx.createBiquadFilter();
      gbp.type = "bandpass"; gbp.Q.value = 7;
      gbp.frequency.setValueAtTime(760, gStart);
      gbp.frequency.exponentialRampToValueAtTime(300, gStart + 0.6);
      const gg = ctx.createGain();
      gg.gain.setValueAtTime(0.0001, gStart);
      gg.gain.exponentialRampToValueAtTime(0.2, gStart + 0.09);
      gg.gain.exponentialRampToValueAtTime(0.0001, gStart + 0.68);
      gbp.connect(gg).connect(out);
      for (const det of [-9, 7]) {
        const o = ctx.createOscillator();
        o.type = "sawtooth";
        o.frequency.setValueAtTime(196, gStart);
        o.frequency.exponentialRampToValueAtTime(104, gStart + 0.62);
        o.detune.value = det;
        o.connect(gbp);
        o.start(gStart); o.stop(gStart + 0.7);
      }

      // 3) Settle boom as the doors hit their stops.
      const bT = t + 0.72;
      const boom = ctx.createOscillator();
      const bg = ctx.createGain();
      boom.type = "sine";
      boom.frequency.setValueAtTime(120, bT);
      boom.frequency.exponentialRampToValueAtTime(38, bT + 0.4);
      bg.gain.setValueAtTime(0.0001, bT);
      bg.gain.exponentialRampToValueAtTime(0.45, bT + 0.02);
      bg.gain.exponentialRampToValueAtTime(0.0001, bT + 0.55);
      boom.connect(bg).connect(out);
      boom.start(bT); boom.stop(bT + 0.6);
    });
  }

  /* ═══════════════════════════════════════════════
     Collection-piece whoosh — the airy riser that plays
     while the body part hangs in front of the camera and
     strikes down onto the silhouette. Timed to the visual:
     it swells through the present+strike (~0.56s) and peaks
     right at the moment of impact (bannerImpact fires there).
     ═══════════════════════════════════════════════ */
  pieceWhoosh(): void {
    void this.unlock().then(() => {
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      const dur = 0.55;

      // 1) Bandpass-swept noise — the "air" of the whoosh.
      const frames = Math.floor(this.ctx.sampleRate * dur);
      const buf = this.ctx.createBuffer(1, frames, this.ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      const bp = this.ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.Q.value = 1.1;
      bp.frequency.setValueAtTime(350, t);
      bp.frequency.exponentialRampToValueAtTime(3200, t + dur);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.16, t + dur * 0.75);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(bp).connect(g).connect(this.ctx.destination);
      src.start(t);
      src.stop(t + dur + 0.02);

      // 2) Subtle sine riser underneath for a sense of lift.
      const osc = this.ctx.createOscillator();
      const og = this.ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(240, t);
      osc.frequency.exponentialRampToValueAtTime(760, t + dur);
      og.gain.setValueAtTime(0.0001, t);
      og.gain.exponentialRampToValueAtTime(0.05, t + dur * 0.7);
      og.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(og).connect(this.ctx.destination);
      osc.start(t);
      osc.stop(t + dur + 0.05);
    });
  }

  /* ═══════════════════════════════════════════════
     Continuous money-counter roller (synced to count-up)
     ═══════════════════════════════════════════════ */

  /** Spin up the looping counter voice. */
  startWinCounter(): void {
    this.startLoop("money_counter_loop", "counter");
  }

  /** Drive the roller from the count-up. */
  updateWinCounter(p: number, tier: "none" | "big" | "mega" | "grand" | "max"): void {
    // With a static track we don't dynamically adjust pitch like the synth, 
    // but the API signature remains the same so EffectsLayer doesn't need changes here.
  }

  /** Resolve the roller: a quick upward flourish, then a clean fade-and-stop. */
  stopWinCounter(): void {
    this.fadeOut("counter");
    this.fire("money_counter_end");
  }

  /** Start a looping track in a named slot */
  private startLoop(track: TrackName, slot: "bg" | "spin" | "counter"): void {
    if (!this.ctx) return;
    const existing = slot === "bg" ? this.bgLoop : slot === "spin" ? this.spinLoop : this.counterLoop;
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
    const fade = slot === "spin" ? 0.05 : FADE;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(VOLUME[track], now + fade);

    source.connect(gain).connect(this.ctx.destination);
    source.start();

    const loop: ActiveLoop = { source, gain, track };
    if (slot === "bg") this.bgLoop = loop;
    else if (slot === "spin") this.spinLoop = loop;
    else this.counterLoop = loop;
  }

  /** Fade out and stop a loop slot */
  private fadeOut(slot: "bg" | "spin" | "counter"): void {
    const loop = slot === "bg" ? this.bgLoop : slot === "spin" ? this.spinLoop : this.counterLoop;
    if (!loop) return;
    this.fadeAndStop(loop);
    if (slot === "bg") this.bgLoop = null;
    else if (slot === "spin") this.spinLoop = null;
    else this.counterLoop = null;
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
    const fade = (loop.track === "spin_loop" || loop.track === "reel_stop" || loop.track === "reel_loop") ? 0.05 : FADE;
    try {
      loop.gain.gain.cancelScheduledValues(now);
      loop.gain.gain.setValueAtTime(
        Math.max(loop.gain.gain.value, 0.0001), now
      );
      loop.gain.gain.exponentialRampToValueAtTime(0.0001, now + fade);
      loop.source.stop(now + fade + 0.05);
    } catch {
      /* already stopped — ignore */
    }
  }

  /** Kill all loops immediately (for mute) */
  killAll(): void {
    if (this.bgLoop) this.fadeAndStop(this.bgLoop);
    if (this.spinLoop) this.fadeAndStop(this.spinLoop);
    this.stopSynthReel();
    this.stopSynthRadio();
    this.stopWinCounter();
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
