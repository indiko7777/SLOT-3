/** Never expose a half-restored base scene. Cleanup also runs if an animation
 * is interrupted, so Getaway cannot leave the game covered or its HUD hidden. */
export async function runGetawayExit(steps: {
  cover(): Promise<void>;
  restore(): void;
  reveal(): Promise<void>;
  cleanup(): void;
}): Promise<void> {
  let restored = false;
  try {
    await steps.cover();
    restored = true;
    steps.restore();
    await steps.reveal();
  } finally {
    try { if (!restored) steps.restore(); }
    finally { steps.cleanup(); }
  }
}
