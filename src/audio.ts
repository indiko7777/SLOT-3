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
    this.fadeOut("bg");
    this.startLoop(to, "bg");
  }

  /** Make sure background music is running (restart after mute) */
  private ensureBg(): void {
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
