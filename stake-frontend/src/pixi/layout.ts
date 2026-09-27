import type { LayoutMetrics, Rect } from "./types";

/** Keep the complete layout usable in landscape phones and the mini-player.
 * Scale the whole scene uniformly instead of squeezing individual controls. */
export function logicalViewport(width: number, height: number): { width: number; height: number; scale: number } {
  const wide = width >= height;
  const scale = Math.min(1, width / (wide ? 980 : 360), height / (wide ? 600 : 640));
  return { width: width / scale, height: height / scale, scale };
}

/** Gap between the wanted-stars strip and the top of the reel frame. */
const STARS_GAP = 4;

/** Height of the wanted-stars strip for a reel frame of this width — the same
 *  sizing the stars always used (HudView.drawWantedStars), just moved. */
function starsStripHeight(frameWidth: number): number {
  const r = Math.min(22, frameWidth / 11);
  const label = Math.min(13, frameWidth * 0.04);
  return Math.ceil(label + r * 2 + 16);
}

/** The "[n/8]" collection counter's font size (BoardView, unchanged). */
export const COUNTER_FONT_SIZE = 16;

export interface WantedStarsGeometry {
  starR: number;
  /** centres of the five stars, left to right */
  centers: Array<{ x: number; y: number }>;
  labelSize: number;
  labelX: number;
  /** top of the "WANTED LEVEL" label */
  labelY: number;
  /** the "[n/8]" counter: right-aligned, vertically centred at (counterX, counterY) */
  counterX: number;
  counterY: number;
}

/**
 * Mirrors the geometry HudView.drawWantedStars has always drawn inside a rect
 * (star size, label, spacing — the look is unchanged), and gives the "[n/8]"
 * counter its slot: the strip's top-right corner, level with the label and
 * entirely above the star row, so it can never sit on a star.
 */
export function wantedStarsGeometry(bar: Rect): WantedStarsGeometry {
  const starR = Math.min(22, bar.width / 11);
  const gap = starR * 0.55;
  const totalW = starR * 2 * 5 + gap * 4;
  const startX = bar.x + (bar.width - totalW) / 2 + starR;
  const labelSize = Math.min(13, bar.width * 0.04);
  const starCY = bar.y + bar.height / 2 + labelSize * 0.5 + 2;
  const centers = Array.from({ length: 5 }, (_, i) => ({ x: startX + i * (starR * 2 + gap), y: starCY }));
  const starsTop = starCY - starR;
  return {
    starR,
    centers,
    labelSize,
    labelX: bar.x + bar.width / 2,
    labelY: starsTop - labelSize - 2,
    counterX: bar.x + bar.width,
    counterY: starsTop - 2 - COUNTER_FONT_SIZE * 0.6,
  };
}

export function computeLayout(width: number, height: number): LayoutMetrics {
  const portrait = width < 980 || height > width;

  if (portrait) {
    const collectionBar: Rect = { x: 8, y: 4, width: width - 16, height: 42 };
    // The wanted stars sit directly on top of the reel frame, so reserve their
    // strip between the collection bar and the machine.
    const starsH = starsStripHeight(width - 16);

    const bottomHeight = width < 560 ? 192 : 160;
    const bottomBar: Rect = { x: 0, y: height - bottomHeight, width, height: bottomHeight };

    const buyPanelH = 46;
    const buyPanelY = height - bottomHeight - buyPanelH - 8;
    const leftPanel: Rect = { x: 8, y: buyPanelY, width: width - 16, height: buyPanelH };

    const availableTop = collectionBar.y + collectionBar.height + 8 + starsH + STARS_GAP;
    const availableHeight = Math.max(80, buyPanelY - availableTop - 8);
    const machineH = Math.min(availableHeight, (width - 16) * 1.05);
    const machineY = availableTop + (availableHeight - machineH) / 2;
    const machine: Rect = { x: 8, y: machineY, width: width - 16, height: machineH };
    const boardFrame: Rect = { x: machine.x, y: machine.y, width: machine.width, height: machine.height };
    const starsBar: Rect = { x: boardFrame.x, y: boardFrame.y - STARS_GAP - starsH, width: boardFrame.width, height: starsH };
    const board: Rect = {
      x: boardFrame.x + 10,
      y: boardFrame.y + 12,
      width: boardFrame.width - 20,
      height: boardFrame.height - 24
    };

    return {
      width,
      height,
      portrait,
      bottomBar,
      leftPanel,
      artPanel: null,
      starsBar,
      collectionBar,
      machine,
      boardFrame,
      board
    };
  }

  const bottomHeight = 96;
  const bottomBar: Rect = { x: 0, y: height - bottomHeight, width, height: bottomHeight };

  const leftWidth = Math.max(164, width * 0.15);
  const rightWidth = Math.max(246, width * 0.23);
  const sideMargin = Math.max(leftWidth, rightWidth);
  const machineW = width - 2 * sideMargin - 48;
  // The wanted stars sit directly on top of the reel frame: keep room for them.
  const starsH = starsStripHeight(machineW);
  const top = Math.max(60, 8 + starsH + STARS_GAP);
  const machine: Rect = {
    x: sideMargin + 24,
    y: top,
    width: machineW,
    height: height - bottomHeight - top - 14
  };
  const comfortableHeight = machine.width * 0.88;
  if (machine.height > comfortableHeight) {
    machine.y += (machine.height - comfortableHeight) / 2;
    machine.height = comfortableHeight;
  }
  const boardFrame: Rect = { ...machine };
  const starsBar: Rect = { x: boardFrame.x, y: boardFrame.y - STARS_GAP - starsH, width: boardFrame.width, height: starsH };
  const board: Rect = {
    x: boardFrame.x + 18,
    y: boardFrame.y + 18,
    width: boardFrame.width - 36,
    height: boardFrame.height - 36
  };

  // Centre the left buttons in the gap between the screen edge and the reel frame.
  const leftPanelW = leftWidth - 24;
  const leftPanelX = (boardFrame.x - leftPanelW) / 2;

  return {
    width,
    height,
    portrait,
    collectionBar: null,
    bottomBar,
    leftPanel: { x: leftPanelX, y: 52, width: leftPanelW, height: height - bottomHeight - 68 },
    artPanel: { x: width - rightWidth + 12, y: 50, width: rightWidth - 26, height: height - bottomHeight - 58 },
    starsBar,
    machine,
    boardFrame,
    board
  };
}
