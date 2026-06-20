import type { RoundRecord } from "../domain";

export interface SceneRuntime {
  getMode(): string;
  isAnteEnabled(): boolean;
  isMuted(): boolean;
  isTurbo(): boolean;
  isPlaying(): boolean;
  getBetLevel(): number;
  getCredit(): number;
  getCurrency(): string;
  /** Persistent Wanted meter, 0–5 (fractional). At 5 the Getaway triggers free. */
  getWantedLevel(): number;
  /** Beach Girl collection count, 0-7 */
  getCollectionCount(): number;
  incrementCollectionCount(): number;
  resetCollectionCount(): void;
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
  machine: Rect;
  boardFrame: Rect;
  board: Rect;
}
