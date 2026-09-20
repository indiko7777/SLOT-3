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
