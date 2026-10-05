/**
 * Number display rules (Engine approval):
 *  - the BALANCE is the only value rounded, to 2 decimals;
 *  - every other amount (wins, bet, costs) is shown EXACTLY, with as many
 *    decimals as it needs. A 0.05x win on a 0.01 bet is 0.0005, never "0.00".
 *
 * Amounts arrive from the RGS as integers with six decimals (micro-units), so
 * six decimals is the most any exact amount can need. Floating-point noise
 * below that grid (0.1 + 0.2) is removed before counting decimals.
 */

/** RGS money precision: 1,000,000 = 1.00. */
const MAX_DECIMALS = 6;

/** Decimals needed to show `amount` exactly: at least 2, at most 6. */
export function amountDecimals(amount: number): number {
  const micro = Math.round(Math.abs(amount) * 10 ** MAX_DECIMALS);
  let decimals = MAX_DECIMALS;
  while (decimals > 2 && micro % 10 ** (MAX_DECIMALS - decimals + 1) === 0) decimals--;
  return decimals;
}

/** Exact money amount ("0.0005", "1.50", "1,250.75" with grouping). */
export function formatAmount(amount: number, grouping = false, decimals = amountDecimals(amount)): string {
  return amount.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
    useGrouping: grouping,
  });
}

/** The player's balance — the one figure that is rounded to 2 decimals. */
export function formatBalance(amount: number): string {
  return amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false });
}

/** Exact multiplier without trailing zeros: 0.05 → "0.05", 1.5 → "1.5", 100 → "100". */
export function formatMultiplier(x: number, grouping = false): string {
  return x.toLocaleString("en-US", { maximumFractionDigits: MAX_DECIMALS, useGrouping: grouping });
}
