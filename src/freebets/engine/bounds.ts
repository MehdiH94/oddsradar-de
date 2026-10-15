// Upper bounds on what a combo can guarantee, cheap enough to rule out most combos without solving them. Both are
// proven majorants of the exact optimum (tests/freebets/engine/bounds.test.ts checks them against it), so
// dropping a combo with them never loses the best plan.
import { MAX_CELLS, Match } from "./types";

export interface MatchFeatures {
  // The sum of 1/price over the outcomes, at the best price of each: 1 / (the match's TRJ at its best prices).
  s1: number;
  // The sum of 1/price^2: large when one outcome is very likely (a favourite at 1.20), which makes the combos
  // that contain the match poor.
  s2: number;
  // How many bookmakers with freebets price the match.
  pricers: number;
}

// The best prices come from the bookmakers with freebets only: they are the only ones that can bet. The match
// must be valid (src/freebets/engine/combo.ts, matchProblem). Null when no bookmaker with freebets prices it.
export function matchFeatures(match: Match, fb: readonly number[]): MatchFeatures | null {
  const best = new Array<number>(match.outcomes).fill(0);
  let pricers = 0;
  for (let b = 0; b < fb.length; b++) {
    if (!(fb[b] > 0)) continue;
    const odds = match.odds[b];
    if (!odds) continue;
    pricers++;
    for (let k = 0; k < match.outcomes; k++) if (odds[k] > best[k]) best[k] = odds[k];
  }
  if (pricers === 0) return null;
  let s1 = 0;
  let s2 = 0;
  for (const price of best) {
    s1 += 1 / price;
    s2 += 1 / (price * price);
  }
  return { s1, s2, pricers };
}

// An upper bound on the rate (guaranteed cash over freebets used) of any combo of these matches:
//     rate <= 1 / (prod S1 + prod S2).
// Without budgets the rate is 1 / sum over the cells of 1/(c - 1), c being the cell's combined price. With
// p = 1/c, 1/(c - 1) = p / (1 - p) >= p + p^2. The cells are every combination of outcomes, so the sum of the p
// over them is the product of the matches' S1 and the sum of the p^2 the product of their S2, whatever
// bookmaker bets what: a real combined price never exceeds the product of the best prices.
export function rateBound(features: readonly MatchFeatures[]): number {
  let p1 = 1;
  let p2 = 1;
  for (const f of features) {
    p1 *= f.s1;
    p2 *= f.s2;
  }
  return 1 / (p1 + p2);
}

// --- the second bound, on the flat arrays of a run ----------------------------------------------------------------

// A match laid out for the hot loops: its prices by bookmaker, three slots each.
export interface FlatMatch {
  match: Match;
  features: MatchFeatures;
  outcomes: number;
  // odds[b * 3 + k]; 0 when the bookmaker does not price the match or has no freebets.
  odds: Float64Array;
  priced: Uint8Array;
}

export function flatten(match: Match, features: MatchFeatures, budgets: ArrayLike<number>): FlatMatch {
  const B = budgets.length;
  const odds = new Float64Array(B * 3);
  const priced = new Uint8Array(B);
  for (let b = 0; b < B; b++) {
    const prices = match.odds[b];
    if (!prices || !(budgets[b] > 0)) continue;
    priced[b] = 1;
    for (let k = 0; k < match.outcomes; k++) odds[b * 3 + k] = prices[k];
  }
  return { match, features, outcomes: match.outcomes, odds, priced };
}

// A match with a single outcome at the price 1, which pads the combos of fewer than three matches (it changes
// neither their cells nor their prices).
export function paddingMatch(budgets: ArrayLike<number>): FlatMatch {
  const B = budgets.length;
  const odds = new Float64Array(B * 3);
  for (let b = 0; b < B; b++) odds[b * 3] = 1;
  // Never read: the padding is not a real match.
  const placeholder: Match = { id: "", outcomes: 2, odds: [] };
  return { match: placeholder, features: { s1: 1, s2: 1, pricers: B }, outcomes: 1, odds, priced: new Uint8Array(B).fill(1) };
}

// The room one run reuses for every combo, so that the hot loops allocate nothing.
export interface Scratch {
  B: number;
  budgets: Float64Array;
  // gains[b * MAX_CELLS + j]: what one FB at bookmaker b gains on cell j (the combined price - 1); 0 where b
  // cannot bet it.
  gains: Float64Array;
  // best[j]: the largest gain on cell j over the bookmakers.
  best: Float64Array;
}

export function makeScratch(budgets: readonly number[]): Scratch {
  const B = budgets.length;
  return { B, budgets: Float64Array.from(budgets.map((v) => Math.max(0, v))), gains: new Float64Array(B * MAX_CELLS), best: new Float64Array(MAX_CELLS) };
}

// Fills the scratch for the combo of these three matches and returns its number of cells.
export function fillGains(s: Scratch, m0: FlatMatch, m1: FlatMatch, m2: FlatMatch): number {
  const n0 = m0.outcomes;
  const n1 = m1.outcomes;
  const n2 = m2.outcomes;
  const J = n0 * n1 * n2;
  s.best.fill(0, 0, J);
  for (let b = 0; b < s.B; b++) {
    const base = b * MAX_CELLS;
    if (!(s.budgets[b] > 0) || !m0.priced[b] || !m1.priced[b] || !m2.priced[b]) {
      s.gains.fill(0, base, base + MAX_CELLS);
      continue;
    }
    const at = b * 3;
    let j = 0;
    for (let k0 = 0; k0 < n0; k0++) {
      const c0 = m0.odds[at + k0];
      for (let k1 = 0; k1 < n1; k1++) {
        const c01 = c0 * m1.odds[at + k1];
        for (let k2 = 0; k2 < n2; k2++) {
          const gain = c01 * m2.odds[at + k2] - 1;
          s.gains[base + j] = gain;
          if (gain > s.best[j]) s.best[j] = gain;
          j++;
        }
      }
    }
  }
  return J;
}

// An upper bound on the cash the combo of the filled scratch can guarantee (weak duality). Giving the cells the
// multipliers mu_j proportional to 1 / best_j, the optimum is at most
//     sum over the bookmakers b of F_b * max_j (gain_bj / best_j)  /  sum over the cells of 1 / best_j.
// It counts the budgets, so a wallet that is very uneven (100 FB at a bookmaker whose prices are poor) weighs in:
// about 98 % of the true optimum on realistic combos. 0 when a cell cannot be bet by anyone.
export function cashBound(s: Scratch, J: number): number {
  let inverse = 0;
  for (let j = 0; j < J; j++) {
    if (!(s.best[j] > 0)) return 0;
    inverse += 1 / s.best[j];
  }
  let total = 0;
  for (let b = 0; b < s.B; b++) {
    if (!(s.budgets[b] > 0)) continue;
    const base = b * MAX_CELLS;
    let share = 0;
    for (let j = 0; j < J; j++) {
      const q = s.gains[base + j] / s.best[j];
      if (q > share) share = q;
    }
    total += s.budgets[b] * share;
  }
  return total / inverse;
}
