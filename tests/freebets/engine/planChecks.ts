import { expect } from "vitest";
import { Match, Plan } from "../../../src/freebets/engine/types";
import { cellsOf, payoffsOf, priceOf } from "./helpers";

// What a plan must always be, checked from the bets and the prices alone, not from the plan's own numbers.
export function expectValidPlan(plan: Plan, matches: readonly Match[], fb: readonly number[], opts: { minStake?: number; coverage?: boolean } = {}) {
  const minStake = opts.minStake ?? 0.1;
  const cells = cellsOf(matches);
  expect(plan.matchIds).toEqual(matches.map((m) => m.id));
  expect(plan.payoff).toHaveLength(cells.length);
  for (const bet of plan.bets) {
    // On whole cents, not under the minimum, where the bookmaker has freebets and prices every match.
    expect(Math.abs(bet.stake * 100 - Math.round(bet.stake * 100))).toBeLessThan(1e-6);
    expect(bet.stake).toBeGreaterThanOrEqual(minStake - 1e-9);
    const price = priceOf(matches, fb, bet.b, cells[bet.cellIndex]);
    expect(price).not.toBeNull();
    expect(bet.odds).toBeCloseTo(price!, 9);
    expect(bet.cell).toEqual(cells[bet.cellIndex]);
  }
  // Budgets.
  fb.forEach((budget, b) => {
    const spent = plan.bets.filter((bet) => bet.b === b).reduce((s, bet) => s + bet.stake, 0);
    expect(spent).toBeLessThanOrEqual(Math.max(budget, 0) + 1e-9);
    expect(plan.usedBy[b]).toBeCloseTo(spent, 9);
  });
  expect(plan.used).toBeCloseTo(plan.usedBy.reduce((s, v) => s + v, 0), 9);
  // The guarantee: the smallest gain over the cells, recomputed.
  const payoff = payoffsOf(plan, matches, fb);
  payoff.forEach((gain, j) => expect(plan.payoff[j]).toBeCloseTo(gain, 9));
  expect(plan.cash).toBeCloseTo(Math.min(...payoff), 9);
  expect(plan.cash).toBeGreaterThan(0);
  expect(plan.cash).toBeLessThanOrEqual(plan.value + 1e-9);
  expect(plan.rate).toBeCloseTo(plan.cash / plan.used, 9);
  // The rule: no bookmaker has a bet on every cell.
  if (opts.coverage ?? true) {
    for (let b = 0; b < fb.length; b++) {
      const held = new Set(plan.bets.filter((bet) => bet.b === b).map((bet) => bet.cellIndex));
      expect(held.size).toBeLessThan(cells.length);
    }
  }
}
