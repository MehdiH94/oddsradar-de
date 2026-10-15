export type PayoutTier = "none" | "low" | "mid" | "high" | "sure";

// How good a TRJ is, the higher the better: under 90 % is low for a main
// market, from 95 % high, and from 100 % the best prices together guarantee a
// profit whatever the outcome (a "surebet").
export function payoutTier(rate: number | null | undefined): PayoutTier {
  if (rate === null || rate === undefined) return "none";
  if (rate >= 1) return "sure";
  if (rate >= 0.95) return "high";
  if (rate >= 0.9) return "mid";
  return "low";
}
