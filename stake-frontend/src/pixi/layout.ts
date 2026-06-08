import type { LayoutMetrics, Rect } from "./types";

export function computeLayout(width: number, height: number): LayoutMetrics {
  const portrait = width < 980 || height > width;
  const bottomHeight = portrait ? 86 : 96;
  const bottomBar: Rect = { x: 0, y: height - bottomHeight, width, height: bottomHeight };

  if (portrait) {
    const machine: Rect = { x: 8, y: 48, width: width - 16, height: height - bottomHeight - 186 };
    const boardFrame: Rect = { x: machine.x, y: machine.y, width: machine.width, height: machine.height };
    const board: Rect = {
      x: boardFrame.x + 12,
      y: boardFrame.y + 16,
      width: boardFrame.width - 24,
      height: boardFrame.height - 32
    };

    return {
      width,
      height,
      portrait,
      bottomBar,
      leftPanel: { x: 8, y: height - bottomHeight - 122, width: width - 16, height: 110 },
      artPanel: null,
      machine,
      boardFrame,
      board
    };
  }

  const leftWidth = Math.max(164, width * 0.15);
  const rightWidth = Math.max(246, width * 0.23);
  const machine: Rect = {
    x: leftWidth + 24,
    y: 60,
    width: width - leftWidth - rightWidth - 64,
    height: height - bottomHeight - 74
  };
  const boardFrame: Rect = { ...machine };
  const board: Rect = {
    x: boardFrame.x + 18,
    y: boardFrame.y + 18,
    width: boardFrame.width - 36,
    height: boardFrame.height - 36
  };

  return {
    width,
    height,
    portrait,
    bottomBar,
    leftPanel: { x: 12, y: 52, width: leftWidth - 24, height: height - bottomHeight - 68 },
    artPanel: { x: width - rightWidth + 12, y: 50, width: rightWidth - 26, height: height - bottomHeight - 58 },
    machine,
    boardFrame,
    board
  };
}
