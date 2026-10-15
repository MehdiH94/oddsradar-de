// What the freebets engine takes and gives back.
//
// The engine is pure: it knows a bookmaker only by its index in the wallet's array and a match only by an id,
// and it imports nothing outside this folder (tests/freebets/engine/architecture.test.ts keeps it so), which
// lets it run as it is in a worker thread. The part that reads the database and names the bookmakers is
// src/freebets/ around it.

// A combined bet holds at most this many matches, each with at most this many outcomes (a 1X2 has 3, a
// winner 2): at most 3 x 3 x 3 cells, one per combination of outcomes.
export const MAX_MATCHES_PER_COMBO = 3;
export const MAX_OUTCOMES = 3;
export const MAX_CELLS = MAX_OUTCOMES ** MAX_MATCHES_PER_COMBO;

// Decimal odds above this are not a real price (a 3-match combo would multiply them): the match is not used.
export const MAX_ODDS = 1000;

// A plan that guarantees less than this, in FB, is not a plan.
export const MIN_CASH = 0.01;

export interface Match {
  id: string;
  // How many outcomes the market has: 3 for a 1X2, 2 for a winner.
  outcomes: 2 | 3;
  // odds[b]: the price of each outcome at bookmaker b, or null when it does not price the match.
  odds: ReadonlyArray<readonly number[] | null>;
}

export interface Bet {
  // The bookmaker (its index in the wallet) where the freebet is placed.
  b: number;
  // The cell this bet covers: its index among the combo's cells (the matches' outcomes in the combo's order,
  // the last match varying fastest) and the outcome it takes in each match.
  cellIndex: number;
  cell: number[];
  // The combined price at that bookmaker: the product of its odds on each outcome of the cell.
  odds: number;
  // In FB, a multiple of 0.01.
  stake: number;
}

export interface Plan {
  matchIds: string[];
  // The cash guaranteed whatever happens, in euros: the smallest gain over the cells, computed on the rounded
  // stakes (what the user sees is what the bets give).
  cash: number;
  // The freebets the bets use, and cash / used.
  used: number;
  rate: number;
  bets: Bet[];
  // The gain if each cell wins, and the freebets used at each bookmaker.
  payoff: number[];
  usedBy: number[];
  // The optimum of the linear program before rounding to the cent.
  value: number;
  // False when the search was cut short (too many branches of the coverage rule, a column generation that
  // did not converge, a stake under the minimum dropped): the plan is valid, but a better one may exist.
  exact: boolean;
  // Linear programs solved to find it (diagnostic).
  lps: number;
}

export interface ComboOptions {
  // No bet under this many FB (bookmakers have a minimum stake).
  minStake?: number;
  // Linear programs the coverage rule's branching may solve before it stops (the plan is then inexact).
  maxLps?: number;
  // False ignores the rule "no bookmaker holds every cell": for checks only.
  coverage?: boolean;
  // Give up (null) when the combo provably cannot guarantee more than this.
  target?: number;
}
