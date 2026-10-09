import { exactDecimals, money } from "../currency";

/** Use the final win's EXACT precision (the currency's decimals up to 6, never
 * rounded) for the entire roll instead of flickering as intermediate values
 * change. Plain digits — `Number()`-safe. */
export function winCountFormatter(finalAmount: number): (amount: number) => string {
  const precision = exactDecimals(finalAmount);
  return amount => Math.min(finalAmount, Math.max(0, amount)).toFixed(precision);
}

/** Same roll, shown as money in the active currency ("$1,250.40", "¥1,250"). */
export function winCountMoney(finalAmount: number): (amount: number) => string {
  const precision = exactDecimals(finalAmount);
  return amount => money(Math.min(finalAmount, Math.max(0, amount)), precision);
}

/** One clock owns the displayed amount and its audio. Skipping commits both
 * synchronously, even between animation frames or in a background tab. */
export function createWinCount(options: {
  duration: number;
  update(progress: number): void;
  start?(): void;
  progress?(progress: number): void;
  end?(): void;
  cancel?(): void;
}): { done: Promise<void>; finish(): void; cancel(): void } {
  let frame = 0;
  let settled = false;
  let resolve!: () => void;
  const done = new Promise<void>((r) => { resolve = r; });
  const finish = (): void => {
    if (settled) return;
    settled = true;
    cancelAnimationFrame(frame);
    options.update(1);
    options.end?.();
    resolve();
  };
  const cancel = (): void => {
    if (settled) return;
    settled = true;
    cancelAnimationFrame(frame);
    options.cancel?.();
    resolve();
  };
  if (options.duration <= 0) {
    settled = true;
    options.update(1);
    resolve();
  } else {
    const start = performance.now();
    options.update(0);
    options.start?.();
    const tick = (now: number): void => {
      if (settled) return;
      const p = Math.min(1, Math.max(0, (now - start) / options.duration));
      if (p === 1) { finish(); return; }
      options.update(Math.pow(p, 0.88));
      options.progress?.(p);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
  }
  return { done, finish, cancel };
}
