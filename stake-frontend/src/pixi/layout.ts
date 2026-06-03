import type { LayoutMetrics, Rect } from "./types";

export function computeLayout(width: number, height: number): LayoutMetrics {
  const portrait = width < 980 || height > width;
  const bottomHeight = portrait ? 86 : 96;
  const bottomBar: Rect = { x: 0, y: height - bottomHeight, width, height: bottomHeight };
  const STUB: Rect = { x: 0, y: 0, width: 0, height: 0 };

  if (portrait) {
    const machine: Rect = { x: 8, y: 48, width: width - 16, height: height - bottomHeight - 186 };
    const boardFrame: Rect = { ...machine };
    const board: Rect = {
      x: boardFrame.x + 12,
      y: boardFrame.y + 16,
      width: boardFrame.width - 24,
      height: boardFrame.height - 32
    };
    return {
      width, height, portrait, bottomBar,
      leftPanel: { x: 8, y: height - bottomHeight - 122, width: width - 16, height: 110 },
      artPanel: null,
      machine,
      topPlaque: { x: width * 0.12, y: 8, width: width * 0.76, height: 34 },
      boardFrame,
      heatRail: STUB,
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
    x: boardFrame.x + 16,
    y: boardFrame.y + 18,
    width: boardFrame.width - 32,
    height: boardFrame.height - 36
  };

  return {
    width, height, portrait, bottomBar,
    leftPanel: { x: 12, y: 52, width: leftWidth - 24, height: height - bottomHeight - 68 },
    artPanel: { x: width - rightWidth + 12, y: 50, width: rightWidth - 26, height: height - bottomHeight - 58 },
    machine,
    topPlaque: { x: machine.x + machine.width * 0.12, y: machine.y - 44, width: machine.width * 0.76, height: 38 },
    boardFrame,
    heatRail: STUB,
    board
  };
}
