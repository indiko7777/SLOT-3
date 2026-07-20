import type { LayoutMetrics, Rect } from "./types";

export function computeLayout(width: number, height: number): LayoutMetrics {
  const portrait = width < 980 || height > width;

  if (portrait) {
    // Reserve a strip above the board for the 5 wanted-level stars.
    const starR = Math.min(16, width / 14);
    const starsH = Math.ceil(starR * 2 + 14 + 8);
    const starsBar: Rect = { x: 0, y: 4, width, height: starsH };

    const bottomHeight = 136; // 2-tier stacked bottom deck
    const bottomBar: Rect = { x: 0, y: height - bottomHeight, width, height: bottomHeight };

    const buyPanelH = 46;
    const buyPanelY = height - bottomHeight - buyPanelH - 8;
    const leftPanel: Rect = { x: 8, y: buyPanelY, width: width - 16, height: buyPanelH };

    const machineY = starsBar.y + starsH + 4;
    const machineH = Math.max(180, buyPanelY - machineY - 8);
    const machine: Rect = { x: 8, y: machineY, width: width - 16, height: machineH };
    const boardFrame: Rect = { x: machine.x, y: machine.y, width: machine.width, height: machine.height };
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
  const machine: Rect = {
    x: sideMargin + 24,
    y: 60,
    width: width - 2 * sideMargin - 48,
    height: height - bottomHeight - 74
  };
  const boardFrame: Rect = { ...machine };
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
    bottomBar,
    leftPanel: { x: leftPanelX, y: 52, width: leftPanelW, height: height - bottomHeight - 68 },
    artPanel: { x: width - rightWidth + 12, y: 50, width: rightWidth - 26, height: height - bottomHeight - 58 },
    starsBar: null,
    machine,
    boardFrame,
    board
  };
}
