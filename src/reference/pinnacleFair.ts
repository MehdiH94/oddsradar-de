// Fair odds from a bookmaker's prices the way PasBet's calculator takes
// them (pasbet.app/outils/fair-odds, the owner's choice, 28/10/2026): the
// market's payout (TRJ) first, 1 / Σ 1/price, then its margin taken off each
// outcome in proportion to its price, so that a longshot carries more of it
// than a favourite, as bookmakers price them:
//   fair = n × price / (n − price × (1/TRJ − 1))
// for a market of n outcomes. The fair odds' chances add up to 100%: each
// outcome's 1/fair is 1/price − (1/TRJ − 1)/n.

// The market's payout: 0.986 for 2.05 and 1.90.
export function payoutOf(prices: readonly number[]): number {
  return 1 / prices.reduce((sum, price) => sum + 1 / price, 0);
}

// Each outcome's fair odds, in the prices' order; none when a price is not
// one (1 or less), or when the margin is too large for the formula to give
// an outcome a fair price (a longshot past n / (1/TRJ − 1)).
export function marginProportionalFair(prices: readonly number[]): number[] | null {
  const n = prices.length;
  if (n < 2 || prices.some((price) => !Number.isFinite(price) || price <= 1)) return null;
  const margin = 1 / payoutOf(prices) - 1;
  const fair = prices.map((price) => (n * price) / (n - price * margin));
  return fair.every((odds) => Number.isFinite(odds) && odds > 1) ? fair : null;
}

// PasBet's check of a value bet's market (its "TRJ de contrôle"): the
// payout of the bookmaker's price on the outcome bet with the reference's
// prices on the others. From CONTROL_MIN_PAYOUT up, the reference's own
// prices are consistent with the bookmaker's; under it, the bookmaker's price
// is set against a market too wide to say it beats the fair odds.
export const CONTROL_MIN_PAYOUT = 0.99;

export function controlPayout(price: number, others: readonly number[]): number {
  return payoutOf([price, ...others]);
}
