import type { RoundRecord, UiStrings } from "../domain";
import type { BetModeObject } from "../rgs/types";
import type { PieceGain } from "../meta/collection";

/** Persistent Beach Girl gallery snapshot for HUD rendering (cosmetic). */
export interface GalleryProgress {
  girlId: number;
  girlName: string;
  artPrefix: string;
  pieces: number;
  totalPieces: number;
  completedGirls: number;
  totalGirls: number;
  mastered: boolean;
}

export interface SceneRuntime {
  getMode(): string;
  isAnteEnabled(): boolean;
  isMuted(): boolean;
  isTurbo(): boolean;
  isPlaying(): boolean;
  isReplayActive?(): boolean;
  getBetLevel(): number;
  getCredit(): number;
  /** DISPLAY currency code (XGC→GC, XSC→SC already applied). */
  getCurrency(): string;
  /** Cost multiplier for a bet mode, sourced from the RGS betModes config
   *  (e.g. getaway = 100, super_getaway = 500, ante = 1.5). Defaults to 1. */
  getCostMultiplier?(mode: string): number;
  /** Stake.US social casino flag from the RGS jurisdiction config. */
  isSocial(): boolean;
  /** Social-aware UI strings (bet→play, buy→feature, …). */
  getUiStrings(): UiStrings;
  /** The bet modes the RGS actually offered this session (drives game info). */
  getBetModes(): Record<string, BetModeObject>;
  /** True while an autoplay run is in progress. */
  isAutoplayActive?(): boolean;
  /** Spins left in the current autoplay run (Infinity = endless, 0 = none). */
  getAutoplayRemaining?(): number;
  /** Live in-spin Wanted level = cascade Heat, 0–5. At 5★ the Getaway triggers. */
  getWantedLevel(): number;
  /** Pieces shown for the current girl (0..her piece count). */
  getCollectionCount(): number;
  /** Add one landed WILD's points (= base bet); returns a card-reveal to animate
   *  when its points just unlocked a new card, else null. Persists. */
  collectWild(): PieceGain | null;
  /** Full persistent-gallery progress for the HUD. */
  getGalleryProgress(): GalleryProgress;
  /** Head-start Power Level unlocked (0..3), regardless of the current bet. */
  getActiveTier?(): number;
  /** Head-start stars in effect for the CURRENT bet (0..3): the active tier when
   *  wagering at/below its average-bet lock, else 0 (the advantage is dimmed). */
  getHeadStartStars?(): number;
  /** Whether the head-start is active for the current bet (false = dimmed). */
  isHeadStartActive?(): boolean;
  onAction(action: string): Promise<void>;
  onSafeLand?: (index: number, total: number) => void;
  /** Bonus heat level 0–3 (consecutive dead spins); drives siren/helicopter audio. */
  onBonusHeat?: (level: number) => void;
  /** Fired as each reel column snaps to its stop — drives the mechanical reel-stop SFX. */
  onReelStop?: (col: number, total: number) => void;
  /** Fired once when a 2+-scatter anticipation spin begins — drives the tension riser. */
  onAnticipation?: () => void;
  /** Fired when symbols transform to cash/money on the board. */
  onTransform?: () => void;
  /** Fired once per spin when a scatter anticipation reel stops short of the
   *  scatter (the bonus didn't trigger) — drives the negative near-miss cue. */
  onAnticipationMiss?: () => void;
  /** Fired on a Getaway dead spin (nothing landed), in sync with the visual
   *  dead-spin beat. heat = consecutive misses, 1–3. */
  onDeadSpin?: (heat: number) => void;
  playAudio?(track: string, volumeScale?: number): void;
  /** Start the typewriter sound (synced with getaway intro text animation). */
  onTypewriterStart?(): void;
  /** Stop the typewriter sound immediately. */
  onTypewriterStop?(): void;
  /** Cinematic "bang" fired when a win banner pops (and on each tier crossing
   *  inside the big count-up), scaled by tier. */
  bannerImpact?(intensity: "low" | "mid" | "high" | "grand"): void;
  /** Spin up the continuous money-counter roller (call once when the count-up
   *  starts), drive it each frame, then resolve it. */
  winCounterStart?(): void;
  winCounterUpdate?(progress: number, tier: "none" | "big" | "mega" | "grand" | "max"): void;
  winCounterEnd?(): void;
  previewRecord: RoundRecord;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LayoutMetrics {
  width: number;
  height: number;
  portrait: boolean;
  bottomBar: Rect;
  leftPanel: Rect | null;
  artPanel: Rect | null;
  /** Portrait-only: strip above the reel grid reserved for the 5 wanted stars. */
  starsBar: Rect | null;
  machine: Rect;
  boardFrame: Rect;
  board: Rect;
}
