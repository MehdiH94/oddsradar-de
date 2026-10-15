import { describe, expect, it } from "vitest";
import { cashBound, fillGains, flatten, makeScratch, matchFeatures, paddingMatch, rateBound } from "../../../src/freebets/engine/bounds";
import { MAX_CELLS, Match } from "../../../src/freebets/engine/types";
import { cellsOf, denseLpValue, gainsOf, genMatches, genWallet, marginsFor, rng } from "./helpers";

// A random combo of one to three matches, priced by 2 to 8 bookmakers whose wallets are even or very uneven.
function randomCombo(seed: number) {
  const r = rng(seed);
  const B = r.int(2, 8);
  const pool = genMatches(8, marginsFor(B, seed), seed, { share2way: 0.4, coverage: 0.85 });
  const size = r.int(1, 3);
  const matches = pool.slice(0, size);
  const fb = Array.from({ length: B }, (_, b) => (seed % 3 === 0 ? (b === 0 ? r.int(100, 600) : r.int(1, 15)) : r.int(0, 3) === 0 ? 0 : r.int(5, 80)));
  return { matches, fb };
}

// The second bound, written out the long way from the cells and the gains.
function naiveCashBound(matches: readonly Match[], fb: readonly number[]): number {
  const { a, B, J } = gainsOf(matches, fb);
  const best = Array.from({ length: J }, (_, j) => Math.max(0, ...Array.from({ length: B }, (_, b) => a[b * J + j])));
  if (best.some((v) => !(v > 0))) return 0;
  const inverse = best.reduce((s, v) => s + 1 / v, 0);
  let total = 0;
  for (let b = 0; b < B; b++) {
    if (!(fb[b] > 0)) continue;
    total += fb[b] * Math.max(...Array.from({ length: J }, (_, j) => a[b * J + j] / best[j]));
  }
  return total / inverse;
}

function flatBound(matches: readonly Match[], fb: readonly number[]) {
  const scratch = makeScratch(fb);
  const flats = matches.map((m) => flatten(m, matchFeatures(m, fb)!, scratch.budgets));
  const padding = paddingMatch(scratch.budgets);
  const cells = fillGains(scratch, flats[0], flats[1] ?? padding, flats[2] ?? padding);
  return { scratch, cells, bound: cashBound(scratch, cells) };
}

describe("matchFeatures", () => {
  const match: Match = {
    id: "m",
    outcomes: 3,
    odds: [
      [2.0, 3.5, 4.0],
      [2.5, 3.0, 3.0],
      [9.0, 9.0, 9.0], // the best prices, at a bookmaker with no freebets
      null,
    ],
  };

  it("sums 1/price and 1/price^2 at the best price of each outcome", () => {
    const f = matchFeatures(match, [10, 10, 0, 10])!;
    // Best prices 2.5, 3.5, 4.0.
    expect(f.s1).toBeCloseTo(1 / 2.5 + 1 / 3.5 + 1 / 4, 12);
    expect(f.s2).toBeCloseTo(1 / 6.25 + 1 / 12.25 + 1 / 16, 12);
    expect(f.pricers).toBe(2);
  });

  it("does not look at a bookmaker with no freebets, however good its prices", () => {
    const withBest = matchFeatures(match, [10, 10, 10, 10])!;
    const without = matchFeatures(match, [10, 10, 0, 10])!;
    expect(withBest.s1).toBeLessThan(without.s1);
    expect(withBest.pricers).toBe(3);
  });

  it("is null when no bookmaker with freebets prices the match", () => {
    expect(matchFeatures(match, [0, 0, 0, 10])).toBeNull();
    expect(matchFeatures(match, [])).toBeNull();
  });
});

describe("rateBound", () => {
  it("is about 81.26 % on the user's example, whose rate is 81.06 %", () => {
    const quotes = [
      [2.3, 3.8, 2.8],
      [2.3, 3.55, 2.95],
      [3.5, 2.6, 2.6],
    ];
    const matches: Match[] = quotes.map((odds, i) => ({ id: `m${i}`, outcomes: 3, odds: [odds] }));
    const features = matches.map((m) => matchFeatures(m, [55])!);
    expect(rateBound(features)).toBeCloseTo(0.8126, 4);
    const exact = 1 / cellsOf(matches).map((cell) => cell.reduce((price, k, i) => price * quotes[i][k], 1)).reduce((s, c) => s + 1 / (c - 1), 0);
    expect(rateBound(features)).toBeGreaterThan(exact);
  });

  it("is 1 / (S1 + S2) for a single match", () => {
    const m: Match = { id: "a", outcomes: 2, odds: [[1.9, 2.1]] };
    const f = matchFeatures(m, [10])!;
    expect(rateBound([f])).toBeCloseTo(1 / (f.s1 + f.s2), 12);
    // And the single bet's own rate is 1 / (1/0.9 + 1/1.1): under it.
    expect(rateBound([f])).toBeGreaterThan(1 / (1 / 0.9 + 1 / 1.1));
  });

  it("is never under what a combo can convert: the wallet times it is above the optimum", () => {
    let checked = 0;
    for (let seed = 1; seed <= 400; seed++) {
      const { matches, fb } = randomCombo(seed);
      const features = matches.map((m) => matchFeatures(m, fb));
      if (features.some((f) => f === null)) continue;
      const optimum = denseLpValue(matches, fb);
      const wallet = fb.reduce((s, v) => s + Math.max(0, v), 0);
      expect(rateBound(features as NonNullable<(typeof features)[number]>[]) * wallet).toBeGreaterThanOrEqual(optimum - 1e-9);
      checked++;
    }
    expect(checked).toBeGreaterThan(250);
  });
});

describe("cashBound", () => {
  it("is the formula, whatever the size of the combo", () => {
    let checked = 0;
    for (let seed = 1; seed <= 300; seed++) {
      const { matches, fb } = randomCombo(seed);
      if (matches.some((m) => matchFeatures(m, fb) === null)) continue;
      const { cells, bound } = flatBound(matches, fb);
      expect(cells).toBe(cellsOf(matches).length);
      expect(bound).toBeCloseTo(naiveCashBound(matches, fb), 9);
      checked++;
    }
    expect(checked).toBeGreaterThan(200);
  });

  it("is never under the optimum, even for very uneven wallets", () => {
    for (let seed = 1; seed <= 500; seed++) {
      const { matches, fb } = randomCombo(seed);
      if (matches.some((m) => matchFeatures(m, fb) === null)) continue;
      const { bound } = flatBound(matches, fb);
      expect(bound).toBeGreaterThanOrEqual(denseLpValue(matches, fb) - 1e-9);
    }
  });

  it("is close to the optimum on realistic combos: that is what keeps the search short", () => {
    let ratios = 0;
    let n = 0;
    for (let seed = 1; seed <= 150; seed++) {
      const margins = marginsFor(5, seed);
      const matches = genMatches(3, margins, seed, { coverage: 1 });
      const fb = genWallet(5, seed);
      const { bound } = flatBound(matches, fb);
      ratios += denseLpValue(matches, fb) / bound;
      n++;
    }
    expect(ratios / n).toBeGreaterThan(0.95);
  });

  it("is 0 when a cell cannot be bet by anyone", () => {
    const matches: Match[] = [
      { id: "a", outcomes: 3, odds: [[2, 3, 4], null] },
      { id: "b", outcomes: 2, odds: [null, [1.9, 2.1]] },
    ];
    // One bookmaker prices the first match, the other the second, and each is priced by a carrier: but nobody
    // prices both.
    const scratch = makeScratch([10, 10]);
    const flats = matches.map((m) => flatten(m, { s1: 1, s2: 1, pricers: 1 }, scratch.budgets));
    const cells = fillGains(scratch, flats[0], flats[1], paddingMatch(scratch.budgets));
    expect(cashBound(scratch, cells)).toBe(0);
  });

  it("leaves a bookmaker out when it has no freebets or does not price every match", () => {
    const matches: Match[] = [
      { id: "a", outcomes: 2, odds: [[1.9, 2.1], [2.0, 2.0], [3, 3]] },
      { id: "b", outcomes: 2, odds: [[1.9, 2.1], [2.0, 2.0], null] },
    ];
    const scratch = makeScratch([10, 10, 0]);
    const flats = matches.map((m) => flatten(m, matchFeatures(m, [10, 10, 0])!, scratch.budgets));
    const padding = paddingMatch(scratch.budgets);
    const cells = fillGains(scratch, flats[0], flats[1], padding);
    expect(cells).toBe(4);
    for (let j = 0; j < MAX_CELLS; j++) expect(scratch.gains[2 * MAX_CELLS + j]).toBe(0);
    expect(scratch.gains[0]).toBeCloseTo(1.9 * 1.9 - 1, 12);
  });
});
