// One-off: how many collection WILDs a player actually collects per spin, i.e.
// how fast the Beach Girl collection fills. Replays the frontend's dedup logic
// (each distinct WILD instance counts once: initial-board WILDs + WILDs created
// by tumble refills), weighted by the optimizer weight.
import { GRID_COLUMNS, GRID_ROWS, type BetMode, type Board, type GameEvent } from "../src/domain";
import { optimizeMode } from "../src/optimize";
import { simulateMode } from "../src/simulate";

function countWildsOnBoard(board: Board): number {
  let n = 0;
  for (let c = 0; c < GRID_COLUMNS; c++) for (let r = 0; r < GRID_ROWS; r++) if (board[c]![r] === "WILD") n++;
  return n;
}

/** Distinct WILD instances revealed across a round (matches the client). */
function wildsCollected(events: GameEvent[]): number {
  let total = 0;
  let removedPerCol: number[] = new Array(GRID_COLUMNS).fill(0);
  for (const e of events) {
    if (e.type === "board_settle") {
      total += countWildsOnBoard(e.board);
    } else if (e.type === "tumble_remove") {
      removedPerCol = new Array(GRID_COLUMNS).fill(0);
      for (const [c] of e.positions) removedPerCol[c]! += 1;
    } else if (e.type === "tumble_drop") {
      // New fills occupy the top `removedPerCol[c]` rows of each column.
      for (let c = 0; c < GRID_COLUMNS; c++) {
        for (let r = 0; r < removedPerCol[c]!; r++) {
          if (e.board[c]![r] === "WILD") total += 1;
        }
      }
    }
  }
  return total;
}

for (const mode of ["base", "ante"] as BetMode[]) {
  const sims = simulateMode(mode);
  const opt = optimizeMode(mode, sims);
  const w = new Map(opt.weighted.map((x) => [x.id, x.weight]));
  let totalWeight = 0;
  let wildWeight = 0; // weighted sum of WILDs collected
  for (const s of sims) {
    const weight = w.get(s.id) ?? 0;
    totalWeight += weight;
    wildWeight += weight * wildsCollected(s.record.events);
  }
  const perSpin = wildWeight / totalWeight;
  console.log(
    `${mode.padEnd(5)} WILDs/spin ${perSpin.toFixed(4)}  ` +
      `~1 WILD every ${(1 / perSpin).toFixed(0)} spins  ` +
      `girl 1 (8 parts) ~${Math.round(8 / perSpin)} spins  ` +
      `full gallery (24) ~${Math.round(24 / perSpin)} spins`
  );
}
