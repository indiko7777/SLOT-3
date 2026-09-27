/**
 * Cascade fall timing — pure so it can be unit-tested without Pixi.
 *
 * BoardView owns WHERE a symbol is while it falls; the symbol's skeletal rig
 * owns HOW it reacts when it hits (its `land` clip). So the fall itself is a
 * clean constant-gravity drop with no bounce: the old easeOutBounce made every
 * object — brass, paper, a diamond — land with the same rubber-ball bounce.
 *
 * Every symbol in a column falls under the SAME acceleration (duration grows
 * with sqrt(distance)), starting from rest. Two bodies released together under
 * one gravity keep their spacing until the lower one stops, so a symbol can
 * never overtake — and overlap — the one below it. New symbols are released
 * bottom-first for the same reason (the top one trails, never catches up).
 */

export interface FallSpec {
  /** ms after the tumble starts that this symbol is released */
  delay: number;
  /** ms from release to touchdown */
  fallMs: number;
  startY: number;
  targetY: number;
}

export interface TumbleTiming {
  /** fall time for a one-cell drop, ms (duration scales with sqrt(cells)) */
  oneCellMs: number;
  /** upper bound on any single fall, ms */
  maxFallMs: number;
  /** release gap between stacked new symbols, ms */
  staggerMs: number;
  /** readable beat after the last touchdown before the tumble resolves, ms */
  settleMs: number;
}

export const TUMBLE_TIMING: Readonly<Record<"normal" | "turbo", TumbleTiming>> = {
  // Tuned so a full-column refill resolves within ~10% of the old bounce
  // tumble on both phone (~83px rows) and desktop (~208px rows) layouts.
  normal: { oneCellMs: 170, maxFallMs: 420, staggerMs: 18, settleMs: 24 },
  turbo: { oneCellMs: 70, maxFallMs: 140, staggerMs: 6, settleMs: 0 },
};

/** Constant-gravity drop duration for a distance in px. */
export function fallDuration(distPx: number, cellStep: number, turbo: boolean): number {
  const t = turbo ? TUMBLE_TIMING.turbo : TUMBLE_TIMING.normal;
  if (distPx <= 0 || cellStep <= 0) return 0;
  return Math.min(t.maxFallMs, t.oneCellMs * Math.sqrt(distPx / cellStep));
}

/** Gravity from rest: position fraction for time fraction r (ease-in quad). */
export function gravityEase(r: number): number {
  const c = Math.max(0, Math.min(1, r));
  return c * c;
}

/**
 * Plan one column. `survivorYs` are the current y of the symbols that stay on
 * the board (top→bottom); `cellY(row)` gives the resting y of a row; new
 * symbols enter stacked directly above the board.
 */
export function planColumn(
  survivorYs: number[],
  rows: number,
  cellY: (row: number) => number,
  cellStep: number,
  gap: number,
  turbo: boolean
): { survivors: FallSpec[]; fresh: FallSpec[] } {
  const t = turbo ? TUMBLE_TIMING.turbo : TUMBLE_TIMING.normal;
  const newCount = rows - survivorYs.length;

  const survivors = survivorYs.map((startY, i) => {
    const targetY = cellY(newCount + i);
    return { delay: 0, fallMs: fallDuration(targetY - startY, cellStep, turbo), startY, targetY };
  });

  const fresh: FallSpec[] = [];
  for (let i = 0; i < newCount; i++) {
    const startY = -(newCount - i) * cellStep - gap;
    const targetY = cellY(i);
    // Bottom-most new symbol goes first, the top one last.
    const delay = (newCount - 1 - i) * t.staggerMs;
    fresh.push({ delay, fallMs: fallDuration(targetY - startY, cellStep, turbo), startY, targetY });
  }
  return { survivors, fresh };
}

/** When the tumble should resolve: last touchdown plus the settle beat. */
export function tumbleDuration(specs: FallSpec[], turbo: boolean): number {
  const t = turbo ? TUMBLE_TIMING.turbo : TUMBLE_TIMING.normal;
  let last = 0;
  for (const s of specs) last = Math.max(last, s.delay + s.fallMs);
  return last > 0 ? last + t.settleMs : 0;
}
