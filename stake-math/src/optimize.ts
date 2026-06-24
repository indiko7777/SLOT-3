import type { BetMode } from "./domain";
import { type Criteria, MODES, TARGET_RTP } from "./model";
import type { Sim } from "./simulate";

export interface WeightedSim {
  id: number;
  weight: number;
  /** Payout in integer hundredths (Stake books/lookup unit). */
  payoutCents: number;
}

export interface OptimizeResult {
  mode: BetMode;
  cost: number;
  weighted: WeightedSim[];
  rtp: number;
  probabilities: Record<Criteria, number>;
  means: Record<Criteria, number>;
  hitRate: number;
  bonusRate: number;
  wincapRate: number;
  totalWeight: number;
}

/** Large scale so even ~1e-5 frequencies map to fat integer weights. */
const SCALE = 1_000_000_000_000;

/**
 * Two-stage weighting (mirrors Stake's "generate then optimize"):
 *
 *  1. Coverage sims are bucketed by criteria. Each criteria is assigned its
 *     TARGET published probability (the volatility model) and that mass is
 *     spread equally across the criteria's sims.
 *       - base/ante: freegame & wincap fixed; basegame solved from RTP;
 *         remainder is the zero (dead-spin) mass.
 *       - buy/super: bonus guaranteed; wincap solved from RTP; rest freegame.
 *  2. One "adjuster" sim's integer weight is closed-form solved so the
 *     weighted mean equals 0.96 * cost EXACTLY (residual < 1e-7 RTP pts).
 */
export function optimizeMode(mode: BetMode, sims: Sim[]): OptimizeResult {
  const cfg = MODES[mode];
  const cost = cfg.cost;
  const targetMeanCents = TARGET_RTP * cost * 100;

  const groups: Record<Criteria, Sim[]> = {
    zero: [],
    basegame: [],
    basebig: [],
    freegame: [],
    wincap: []
  };
  for (const s of sims) groups[s.criteria].push(s);

  const mean = (g: Sim[]): number =>
    g.length ? g.reduce((a, s) => a + s.payoutX, 0) / g.length : 0;
  const E: Record<Criteria, number> = {
    zero: 0,
    basegame: mean(groups.basegame),
    basebig: mean(groups.basebig),
    freegame: mean(groups.freegame),
    wincap: mean(groups.wincap)
  };

  const T = TARGET_RTP * cost;
  const P: Record<Criteria, number> = { zero: 0, basegame: 0, basebig: 0, freegame: 0, wincap: 0 };

  if (cfg.isBuyBonus) {
    if (groups.freegame.length === 0 || groups.wincap.length === 0)
      throw new Error(`[${mode}] buy mode needs freegame + wincap coverage`);
    // T = (1-Pwc)*Efg + Pwc*Ewc
    const pwc = (T - E.freegame) / (E.wincap - E.freegame);
    if (!(pwc > 0 && pwc < 1))
      throw new Error(
        `[${mode}] wincap prob ${pwc.toFixed(6)} out of range ` +
          `(Efg=${E.freegame.toFixed(2)}, Ewc=${E.wincap.toFixed(2)}, T=${T})`
      );
    P.wincap = pwc;
    P.freegame = 1 - pwc;
  } else {
    const split = cfg.rtpSplit;
    if (!split) throw new Error(`[${mode}] cash mode needs rtpSplit`);
    // Each positive band carries `split.x * T` of RTP -> probability = that /
    // band mean. Bands with a split but no coverage throw; bands with no split
    // are simply skipped. Zero (dead spins) is the residual mass.
    const positiveBands = ["basegame", "basebig", "freegame", "wincap"] as const;
    let pzero = 1;
    for (const band of positiveBands) {
      const frac = split[band] ?? 0;
      if (frac <= 0) continue;
      const e = E[band];
      if (e <= 0)
        throw new Error(`[${mode}] band ${band} has RTP split ${frac} but no coverage`);
      const p = (T * frac) / e;
      if (p <= 0 || p >= 1)
        throw new Error(
          `[${mode}] band ${band} prob ${p.toFixed(4)} out of range ` +
            `(E=${e.toFixed(2)}, split=${frac}); adjust pays/split.`
        );
      P[band] = p;
      pzero -= p;
    }
    if (pzero < 0)
      throw new Error(
        `[${mode}] zero prob ${pzero.toFixed(4)} < 0 — engine too generous; ` +
          `soften pays or shift split toward bonus.`
      );
    P.zero = pzero;
  }

  // Stage 1: criteria mass -> equal integer weight within criteria.
  const weighted: WeightedSim[] = sims.map((s) => ({
    id: s.id,
    weight: 0,
    payoutCents: Math.round(s.payoutX * 100)
  }));
  const wIndex = new Map(weighted.map((w, i) => [sims[i]!, w]));
  for (const crit of Object.keys(groups) as Criteria[]) {
    const g = groups[crit];
    if (g.length === 0 || P[crit] <= 0) continue;
    const total = Math.round(P[crit] * SCALE);
    const per = Math.floor(total / g.length);
    let rem = total - per * g.length;
    for (const s of g) {
      const w = wIndex.get(s)!;
      w.weight = per + (rem-- > 0 ? 1 : 0);
    }
  }

  // Stage 2: exact closed-form RTP solve via one adjuster sim.
  exactSolve(weighted, targetMeanCents);

  let num = 0;
  let den = 0;
  let hitW = 0;
  let bonusW = 0;
  let capW = 0;
  for (let i = 0; i < weighted.length; i++) {
    const w = weighted[i]!;
    num += w.payoutCents * w.weight;
    den += w.weight;
    if (w.payoutCents > 0) hitW += w.weight;
    const c = sims[i]!.criteria;
    if (c === "freegame" || c === "wincap") bonusW += w.weight;
    if (c === "wincap") capW += w.weight;
  }

  return {
    mode,
    cost,
    weighted,
    rtp: num / 100 / den / cost,
    probabilities: P,
    means: E,
    hitRate: hitW / den,
    bonusRate: bonusW / den,
    wincapRate: capW / den,
    totalWeight: den
  };
}

/**
 * Choose the lowest-payout sim (to pull RTP down) or the highest (to push it
 * up) and closed-form solve its integer weight so the weighted mean payout
 * equals `M` cents exactly. (A + x*p) / (Wo + x) = M  =>  x = (M*Wo - A)/(p - M)
 */
function exactSolve(weighted: WeightedSim[], M: number): void {
  let lo = weighted[0]!;
  let hi = weighted[0]!;
  for (const w of weighted) {
    if (w.payoutCents < lo.payoutCents) lo = w;
    if (w.payoutCents > hi.payoutCents) hi = w;
  }
  const meanNow = (): number => {
    let n = 0;
    let d = 0;
    for (const w of weighted) {
      n += w.payoutCents * w.weight;
      d += w.weight;
    }
    return n / d;
  };

  for (let iter = 0; iter < 4; iter++) {
    const cur = meanNow();
    if (Math.abs(cur - M) < 1e-6) return;
    const adj = cur > M ? lo : hi;
    if (adj.payoutCents === M) return;
    let A = 0;
    let Wo = 0;
    for (const w of weighted) {
      if (w === adj) continue;
      A += w.payoutCents * w.weight;
      Wo += w.weight;
    }
    let x = Math.round((M * Wo - A) / (adj.payoutCents - M));
    if (!Number.isFinite(x) || x < 0) x = 0;
    adj.weight = x;
  }
}
