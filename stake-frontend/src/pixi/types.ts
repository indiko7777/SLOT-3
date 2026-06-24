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
  /** Live in-spin Wanted level = cascade Heat, 0–5. At 5★ the Getaway triggers. */
  getWantedLevel(): number;
  /** Pieces shown for the current girl (0..her piece count). */
  getCollectionCount(): number;
  /** Reveal one body part for a landed WILD; persists + returns what to animate
   *  (null once the gallery is mastered). */
  collectWild(): PieceGain | null;
  /** Full persistent-gallery progress for the HUD. */
  getGalleryProgress(): GalleryProgress;
  onAction(action: string): Promise<void>;
  onSafeLand?: (index: number, total: number) => void;
  /** Bonus heat level 0–3 (consecutive dead spins); drives siren/helicopter audio. */
  onBonusHeat?: (level: number) => void;
  /** Fired as each reel column snaps to its stop — drives the mechanical reel-stop SFX. */
  onReelStop?: (col: number, total: number) => void;
  /** Fired once when a 2+-scatter anticipation spin begins — drives the tension riser. */
  onAnticipation?: () => void;
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
