import { GRID_COLUMNS, GRID_ROWS, type BonusCell, type Position } from "../domain";

/** The four orthogonal neighbours a dynamite reaches — the math engine's own
 *  rule (stake-math engine.ts `neighbours`). */
export function blastNeighbours([c, r]: Position): Position[] {
  const out: Position[] = [];
  if (c > 0) out.push([c - 1, r]);
  if (c < GRID_COLUMNS - 1) out.push([c + 1, r]);
  if (r > 0) out.push([c, r - 1]);
  if (r < GRID_ROWS - 1) out.push([c, r + 1]);
  return out;
}

/**
 * Dynamite that landed this spin with NO gold bar beside it. The engine only
 * emits `master_key_crack` when there is something to double, so these never
 * get an event: without this they sat on the board doing nothing and silently
 * disappeared on the next spin. The view fizzles them out on the spot instead.
 * `grid` is the spin's lockedGrid (after landings, before any blast).
 */
export function dudDynamites(grid: BonusCell[][], landed: Position[]): Position[] {
  return landed.filter(([c, r]) =>
    grid[c]?.[r]?.symbol === "MASTER_KEY" &&
    !blastNeighbours([c, r]).some(([nc, nr]) => grid[nc]?.[nr]?.symbol === "SAFE"));
}
