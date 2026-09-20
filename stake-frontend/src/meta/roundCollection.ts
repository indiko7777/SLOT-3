import type { GameEvent, RoundRecord } from "../domain";

export interface CollectionReceipt { wilds: number; consumed: boolean }
export type CollectionReceipts = Record<string, CollectionReceipt>;

export function receiptKey(record: RoundRecord): string {
  const start = record.events.find(event => event.type === "round_start");
  return `${record.id}:${start?.type === "round_start" ? start.boardSeedLabel : "round"}`;
}

export function sanitizeReceipts(raw: unknown): CollectionReceipts {
  if (!raw || typeof raw !== "object") return {};
  return Object.fromEntries(Object.entries(raw).slice(-64).flatMap(([key, value]) => {
    if (!value || typeof value !== "object") return [];
    const receipt = value as Partial<CollectionReceipt>;
    if (!Number.isSafeInteger(receipt.wilds) || receipt.wilds! < 0) return [];
    return [[key, { wilds: receipt.wilds!, consumed: receipt.consumed === true }]];
  }));
}

/** Count newly arriving collection wilds, never surviving wilds falling again.
 * Mirrors board gravity: removed cells are refilled at the TOP of each column. */
export function countRoundWilds(events: readonly GameEvent[]): number {
  let total = 0;
  const holes = new Set<string>();
  for (const event of events) {
    if (event.type === "board_settle") {
      total += event.board.flat().filter(symbol => symbol === "WILD").length;
      holes.clear();
    } else if (event.type === "tumble_remove") {
      for (const [col, row] of event.positions) holes.add(`${col},${row}`);
    } else if (event.type === "tumble_drop") {
      for (let col = 0; col < event.board.length; col++) {
        const newCount = [...holes].filter(key => key.startsWith(`${col},`)).length;
        total += event.board[col]!.slice(0, newCount).filter(symbol => symbol === "WILD").length;
      }
      holes.clear();
    }
  }
  return total;
}
