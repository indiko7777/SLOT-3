import type { BetModeObject } from "../rgs/types";

export function starsForMode(mode: string): number {
  return /^base_tier[1-3]$/.test(mode) ? Number(mode.slice(-1)) : 0;
}

/** The next paid spin selects one independent, published event table. */
export function selectSpinMode(ante: boolean, stars: number, modes: Record<string, BetModeObject>): string {
  if (ante && modes.ante) return "ante";
  const tier = Number.isFinite(stars) ? Math.max(0, Math.min(3, Math.floor(stars))) : 0;
  for (let candidate = tier; candidate > 0; candidate--) {
    const key = `base_tier${candidate}`;
    if (modes[key]) return key;
  }
  return "base";
}
