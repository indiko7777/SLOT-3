import type { RoundRecord } from "../domain";
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
  getBetLevel(): number;
  getCredit(): number;
  getCurrency(): string;
  /** Cost multiplier for a bet mode, sourced from the RGS betModes config
   *  (e.g. buy = 100, super_buy = 500, ante = 1.5). Falls back to 1 if unknown. */
  getCostMultiplier?(mode: string): number;
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
  playAudio?(track: string, volumeScale?: number): void;
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
