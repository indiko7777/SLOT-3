import type { GameEvent } from "./domain";

/**
 * Feature pacing — turbo never fast-forwards a feature.
 *
 * Turbo / Extra Turbo / the held spacebar speed up ordinary base spins only.
 * The Getaway (from its trigger to the exit back to the base game) and the
 * other special moments always play at full presentation speed, so a player
 * who leaves turbo on still sees the chase the way it was made. A player who
 * really wants to move on skips deliberately: SKIP_PRESSES taps / clicks /
 * spacebar presses inside SKIP_WINDOW_MS fast-forward the rest of the feature.
 */

/** Payout multiple from which round_end plays the full-screen win cinematic. */
export const CINEMATIC_WIN_MULTIPLIER = 20;
/** Presses needed to skip, and the window they must land in. */
export const SKIP_PRESSES = 3;
export const SKIP_WINDOW_MS = 1500;
/** Global animation time scale while a skipped feature fast-forwards. */
export const SKIP_TIME_SCALE = 3;

/**
 * Single-event features in the base game (the Getaway is a span, see
 * FeaturePacer.opensSpan / closesSpan): the DRIVE-BY, Bust the Stash, the
 * Getaway Driver mega wild and the big-win cinematic.
 */
export function isFeatureBeat(event: GameEvent): boolean {
  switch (event.type) {
    case "drive_by":
    case "heat_transform":
    case "mega_wild_place":
      return true;
    case "round_end":
      return event.payoutMultiplier >= CINEMATIC_WIN_MULTIPLIER;
    default:
      return false;
  }
}

export interface PacerOptions {
  pressesToSkip?: number;
  windowMs?: number;
  /** Fired whenever `active` or `skipping` changes (re-apply the time scale). */
  onChange?: () => void;
}

export class FeaturePacer {
  private depth = 0;
  private inSpan = false;
  private skip = false;
  private presses: number[] = [];
  private readonly need: number;
  private readonly windowMs: number;
  private readonly onChange: () => void;

  constructor(options: PacerOptions = {}) {
    this.need = Math.max(1, options.pressesToSkip ?? SKIP_PRESSES);
    this.windowMs = options.windowMs ?? SKIP_WINDOW_MS;
    this.onChange = options.onChange ?? (() => undefined);
  }

  /** A feature is on screen: turbo is suspended until it ends or is skipped. */
  get active(): boolean {
    return this.depth > 0;
  }

  /** The player skipped the current feature: it fast-forwards to its end. */
  get skipping(): boolean {
    return this.skip;
  }

  begin(): void {
    this.depth++;
    if (this.depth === 1) this.onChange();
  }

  end(): void {
    if (this.depth === 0) return;
    this.depth--;
    if (this.depth === 0) {
      this.skip = false;
      this.presses = [];
      this.onChange();
    }
  }

  /** Drop every open feature (a new round, or playback that failed mid-way). */
  reset(): void {
    const was = this.depth > 0 || this.skip;
    this.depth = 0;
    this.inSpan = false;
    this.skip = false;
    this.presses = [];
    if (was) this.onChange();
  }

  /**
   * Run one round event under the right pacing. The Getaway span opens on
   * bonus_trigger and closes once round_end (the exit back to the base game)
   * has finished playing; single-event features cover just their event.
   */
  async run(event: GameEvent, play: () => Promise<void>): Promise<void> {
    const opens = event.type === "bonus_trigger" && !this.inSpan;
    const single = !this.inSpan && !opens && isFeatureBeat(event);
    if (opens) { this.inSpan = true; this.begin(); }
    if (single) this.begin();
    try {
      await play();
    } finally {
      if (single) this.end();
      if (this.inSpan && event.type === "round_end") { this.inSpan = false; this.end(); }
    }
  }

  /**
   * Register one deliberate skip press. Returns how many more presses are
   * needed (0 = the feature is now skipping), or null when there is nothing
   * to skip.
   */
  press(now: number): number | null {
    if (!this.active || this.skip) return null;
    this.presses = this.presses.filter((t) => now - t <= this.windowMs);
    this.presses.push(now);
    const left = this.need - this.presses.length;
    if (left > 0) return left;
    this.skip = true;
    this.presses = [];
    this.onChange();
    return 0;
  }
}
