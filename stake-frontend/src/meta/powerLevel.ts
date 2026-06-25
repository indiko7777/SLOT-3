/**
 * Value-Weighted Wild Collection & Consumable Head-Start — the persistent
 * "Power Level" retention meta. Pure logic, no DOM, no money.
 *
 * Design (see docs/MATH_DESIGN.md §8). Reconciled to Stake's platform reality:
 *
 *  - PROGRESSION IS POINTS, NOT PIECES. Every WILD that lands in the base game
 *    adds `bet` points to a single global `points` total:
 *        Points Awarded = Wilds Landed × Base Bet
 *    The total is global + continuous and NEVER resets on a bet change.
 *
 *  - THREE CARDS unlock at cumulative point thresholds (Sapphire → Roxy → Vega).
 *    Unlocking a card logs the AVERAGE BET the player used during that phase and
 *    arms a head-start "Power Level" (1, 2 or 3 pre-lit WANTED stars).
 *
 *  - THE LOCK ("Active Power Level"). A head-start is only active when the
 *    player wagers AT OR BELOW the average bet logged for that tier. Above it,
 *    the advantage dims and the spin uses normal (Tier 0) logic. The client uses
 *    this to ROUTE the spin to the matching certified table (`base_tierN`).
 *
 *  - CONSUMABLE. Hitting the Getaway while a head-start is active consumes it on
 *    bonus completion (back to Tier 0; the card stays visible). Consuming the
 *    Tier 3 head-start triggers the GRAND RESET — points → 0, all cards cleared.
 *
 * PLATFORM NOTE (why this is client-side and RTP-neutral): Stake's RGS is
 * stateless across rounds with only an ephemeral sessionID — there is no
 * server-side player_state and no RGS-level table routing. So this state is
 * persisted client-side behind a store interface (the swap point for an
 * operator/account store later), and the CLIENT picks which certified bet mode
 * to request. Every `base_tierN` table verifies to EXACTLY 96% (see the math
 * engine), so the head-start is variance reshaping — a faster, more frequent
 * Getaway — not free EV (which Stake's per-mode RTP verification would reject).
 */

export const POWER_SCHEMA_VERSION = 1;

/** The normal-game bet mode (Tier 0); routed to when no head-start is active. */
export const BASE_MODE = "base";

export interface CardConfig {
  /** 0-based card index (0 = Sapphire …). */
  id: number;
  name: string;
  /** Cumulative `points` needed to unlock this card. Strictly increasing. */
  threshold: number;
  /** Power Level / pre-lit WANTED stars this card arms (1..3). */
  tier: number;
  /** Certified RGS bet mode this card's head-start routes to. */
  mode: string;
  /** Texture-key prefix for the card art ("char" | "char2" | "char3"). */
  artPrefix: string;
}

/**
 * Three collectible cards. Thresholds are the single pacing knob (points, where
 * 1 point = $1 of bet per WILD). Defaults are tuned for ~1 WILD / 16 base spins
 * at a $1 bet; bigger bets fill faster (that is the "value-weighted" design).
 * Re-pace by editing these — nothing else depends on the values.
 */
export const CARDS: readonly CardConfig[] = [
  { id: 0, name: "Sapphire", threshold: 10, tier: 1, mode: "base_tier1", artPrefix: "char" },
  { id: 1, name: "Roxy", threshold: 30, tier: 2, mode: "base_tier2", artPrefix: "char2" },
  { id: 2, name: "Vega", threshold: 70, tier: 3, mode: "base_tier3", artPrefix: "char3" }
];

export const NUM_CARDS = CARDS.length;

/**
 * The persistent player_state. Cross-session JSON — loaded at init (right after
 * /wallet/authenticate) and saved on every change. NEVER stores money/balance.
 */
export interface PowerState {
  version: number;
  /** gallery_points — global, continuous; only the Grand Reset clears it. */
  points: number;
  /** Cumulative thresholds crossed (0..3). The cards visible in the gallery. */
  cardsUnlocked: number;
  /** Head-starts already spent on a Getaway (0..cardsUnlocked). */
  consumed: number;
  /** avgBetByTier[t] = average BASE bet logged when card (t-1) unlocked (tier t).
   *  Index 0 unused. The lock for an active tier reads this. */
  avgBetByTier: number[];
  /** Base wagered since the last card unlock / reset — feeds the next avg bet. */
  phaseWagered: number;
  /** Paid base/ante spins since the last card unlock / reset. */
  phaseSpins: number;
}

export interface PointGain {
  /** Points added by this WILD (= the spin's base bet). */
  pointsAdded: number;
  /** New running total after the add. */
  total: number;
  /** The card this WILD's points just unlocked, or null (no threshold crossed). */
  cardUnlocked: CardConfig | null;
  /** Cards unlocked after the add (0..3). */
  cardsUnlocked: number;
}

export interface ConsumeResult {
  state: PowerState;
  /** True when the Tier 3 head-start was consumed (entire gallery wiped). */
  grandReset: boolean;
  /** The tier whose head-start was consumed (0 = nothing happened). */
  consumedTier: number;
}

export function emptyPowerState(): PowerState {
  return {
    version: POWER_SCHEMA_VERSION,
    points: 0,
    cardsUnlocked: 0,
    consumed: 0,
    avgBetByTier: [0, 0, 0, 0],
    phaseWagered: 0,
    phaseSpins: 0
  };
}

/**
 * The current head-start Power Level (0..3): the highest unlocked card's tier,
 * UNLESS it has already been consumed on a Getaway. = cardsUnlocked while no
 * head-start is pending, else 0. Independent of the bet (see effectiveTier).
 */
export function activeTier(s: PowerState): number {
  return s.cardsUnlocked > s.consumed ? Math.min(s.cardsUnlocked, NUM_CARDS) : 0;
}

/** Average bet logged for a tier (Infinity if none logged — never eligible). */
export function tierAverageBet(s: PowerState, tier: number): number {
  const avg = s.avgBetByTier[tier];
  return avg && avg > 0 ? avg : Infinity;
}

/**
 * The Power Level actually in effect for a spin at `bet` (THE LOCK): the active
 * tier if the player is wagering at or below its logged average bet, else 0
 * (the head-start dims and the spin uses normal Tier 0 logic).
 */
export function effectiveTier(s: PowerState, bet: number): number {
  const t = activeTier(s);
  if (t < 1) return 0;
  return bet <= tierAverageBet(s, t) ? t : 0;
}

export function isHeadStartActive(s: PowerState, bet: number): boolean {
  return effectiveTier(s, bet) > 0;
}

/** Certified bet mode to request for a base-game spin at `bet`. */
export function routeMode(s: PowerState, bet: number): string {
  const t = effectiveTier(s, bet);
  return t < 1 ? BASE_MODE : `base_tier${t}`;
}

/** Record one paid base/ante spin toward the current phase's average bet. Pure. */
export function recordSpin(s: PowerState, bet: number): PowerState {
  if (!Number.isFinite(bet) || bet <= 0) return s;
  return { ...s, phaseWagered: s.phaseWagered + bet, phaseSpins: s.phaseSpins + 1 };
}

/**
 * Add ONE WILD's points (= the spin's base bet) and unlock any card whose
 * cumulative threshold is now crossed. On unlock, logs the phase's average bet
 * for that tier and resets the phase. Pure — the caller persists the result.
 */
export function addPoints(s: PowerState, bet: number): { state: PowerState; gain: PointGain } {
  const add = Number.isFinite(bet) && bet > 0 ? bet : 0;
  let next: PowerState = { ...s, avgBetByTier: [...s.avgBetByTier], points: round2(s.points + add) };

  let unlocked: CardConfig | null = null;
  while (next.cardsUnlocked < NUM_CARDS && next.points >= CARDS[next.cardsUnlocked]!.threshold) {
    const card = CARDS[next.cardsUnlocked]!;
    const avg = next.phaseSpins > 0 ? next.phaseWagered / next.phaseSpins : add || 0;
    next.avgBetByTier[card.tier] = round2(avg);
    next.cardsUnlocked += 1;
    next.phaseWagered = 0;
    next.phaseSpins = 0;
    unlocked = card; // animate the highest card crossed this WILD
  }

  return {
    state: next,
    gain: { pointsAdded: add, total: next.points, cardUnlocked: unlocked, cardsUnlocked: next.cardsUnlocked }
  };
}

/**
 * Consume the head-start that was in effect for a Getaway spin. Called once on
 * bonus completion. `effTier` is the tier the spin was routed to (0 = no
 * head-start, nothing happens). Consuming the Tier 3 head-start = Grand Reset.
 */
export function consumeHeadStart(s: PowerState, effTier: number): ConsumeResult {
  if (effTier < 1) return { state: s, grandReset: false, consumedTier: 0 };
  const t = activeTier(s);
  if (t < 1) return { state: s, grandReset: false, consumedTier: 0 };
  if (t >= NUM_CARDS) {
    return { state: grandReset(s), grandReset: true, consumedTier: t };
  }
  return {
    state: { ...s, consumed: s.cardsUnlocked },
    grandReset: false,
    consumedTier: t
  };
}

/** Wipe the gallery back to State 0 (points, cards, head-starts) — pure. */
export function grandReset(s: PowerState): PowerState {
  return { ...emptyPowerState(), version: s.version || POWER_SCHEMA_VERSION };
}

/** Progress of `points` within the current (next-to-unlock) card, for the UI. */
export function cardProgress(s: PowerState): { into: number; needed: number; nextCard: CardConfig | null } {
  if (s.cardsUnlocked >= NUM_CARDS) return { into: 0, needed: 0, nextCard: null };
  const nextCard = CARDS[s.cardsUnlocked]!;
  const prevThreshold = s.cardsUnlocked > 0 ? CARDS[s.cardsUnlocked - 1]!.threshold : 0;
  return {
    into: round2(Math.max(0, s.points - prevThreshold)),
    needed: round2(nextCard.threshold - prevThreshold),
    nextCard
  };
}

/** Clamp/repair any loaded player_state so bad storage never crashes the game. */
export function sanitizePower(raw: Partial<PowerState> | null | undefined): PowerState {
  if (!raw || typeof raw !== "object") return emptyPowerState();
  const cardsUnlocked = clampInt(raw.cardsUnlocked, 0, NUM_CARDS);
  const consumed = clampInt(raw.consumed, 0, cardsUnlocked);
  const avgSrc = Array.isArray(raw.avgBetByTier) ? raw.avgBetByTier : [];
  const avgBetByTier = [0, 1, 2, 3].map((t) => {
    const v = Number(avgSrc[t]);
    return Number.isFinite(v) && v > 0 ? v : 0;
  });
  return {
    version: POWER_SCHEMA_VERSION,
    points: nonNegNumber(raw.points),
    cardsUnlocked,
    consumed,
    avgBetByTier,
    phaseWagered: nonNegNumber(raw.phaseWagered),
    phaseSpins: clampInt(raw.phaseSpins, 0, Number.MAX_SAFE_INTEGER)
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function nonNegNumber(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? round2(n) : 0;
}
function clampInt(v: unknown, lo: number, hi: number): number {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}
