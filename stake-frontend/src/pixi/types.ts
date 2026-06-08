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
  onAction(action: string): Promise<void>;
  onSafeLand?: (index: number, total: number) => void;
  /** Bonus heat level 0–3 (consecutive dead spins); drives siren/helicopter audio. */
  onBonusHeat?: (level: number) => void;
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
