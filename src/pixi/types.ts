import type { RoundRecord } from "../domain";

export interface SceneRuntime {
  getMode(): string;
  isAnteEnabled(): boolean;
  isMuted(): boolean;
  isTurbo(): boolean;
  isPlaying(): boolean;
  getBetLevel(): number;
  getCredit(): number;
  onAction(action: string): Promise<void>;
  onSafeLand?: (index: number, total: number) => void;
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
  topPlaque: Rect;
  boardFrame: Rect;
  heatRail: Rect;
  board: Rect;
}
