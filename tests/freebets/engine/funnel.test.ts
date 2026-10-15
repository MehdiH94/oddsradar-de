import { describe, expect, it } from "vitest";
import { DEFAULT_MAX_MATCHES, MAX_COMBOS, topPlans } from "../../../src/freebets/engine/funnel";
import { disjointTop, exhaustiveTop, genMatches, genWallet, marginsFor } from "./helpers";
import { expectValidPlan } from "./planChecks";
import { solveCombo } from "../../../src/freebets/engine/combo";
import { Match, Plan } from "../../../src/freebets/engine/types";

const scenario = (matchesCount: number, B: number, seed: number, opts: { share2way?: number; coverage?: number } = {}) => ({
  matches: genMatches(matchesCount, marginsFor(B, seed), seed, opts),
  fb: genWallet(B, seed, seed % 4 === 0),
});

const ids = (plans: readonly Plan[]) => plans.map((p) => p.matchIds.join("+"));
const exact = { epsilon: 0, maxMatches: Infinity } as const;

describe("topPlans, against the exhaustive search (every combo solved, then the best ones with no match in common)", () => {
  const cases: Array<{ size: 1 | 2 | 3; count: number; seeds: number[]; B: number[] }> = [
    { size: 1, count: 30, seeds: [1, 2, 3, 4, 5, 6, 7, 8], B: [3, 6] },
    { size: 2, count: 18, seeds: [11, 12, 13, 14, 15, 16], B: [3, 6] },
    { size: 3, count: 12, seeds: [21, 22, 23, 24], B: [3, 6] },
  ];
  for (const { size, count, seeds, B } of cases) {
    it(`finds the same ${size === 1 ? "single bets" : `combos of ${size}`} on ${count} matches, in ${seeds.length} markets`, () => {
      seeds.forEach((seed, n) => {
        const { matches, fb } = scenario(count, B[n % B.length], seed, { share2way: 0.4 });
        const want = exhaustiveTop(matches, fb, size);
        const got = topPlans(matches, fb, { size, ...exact });
        expect(want.length).toBeGreaterThan(0);
        expect(ids(got.plans)).toEqual(ids(want));
        got.plans.forEach((plan, i) => expect(plan.cash).toBeCloseTo(want[i].cash, 9));
        expect(got.stats.partial).toBe(false);
      });
    });
  }

  it("with a floor on the rate, finds the best plans among those that reach it", () => {
    const { matches, fb } = scenario(14, 4, 31);
    const plans: Plan[] = [];
    for (let i = 0; i < matches.length; i++) {
      for (let j = i + 1; j < matches.length; j++) {
        const plan = solveCombo([matches[i], matches[j]], fb);
        if (plan) plans.push(plan);
      }
    }
    const rates = plans.map((p) => p.rate);
    // A floor at the average rate, and one that only the very best rates reach: the plans of the best cash have
    // lower rates than that.
    for (const floor of [rates.reduce((s, r) => s + r, 0) / rates.length, Math.max(...rates) - 1e-9]) {
      const want = disjointTop(plans.filter((p) => p.rate >= floor), 3);
      const got = topPlans(matches, fb, { size: 2, minRate: floor, ...exact });
      expect(want.length).toBeGreaterThan(0);
      expect(ids(got.plans)).toEqual(ids(want));
      got.plans.forEach((plan) => expect(plan.rate).toBeGreaterThanOrEqual(floor));
    }
    // And no combo converts at 99 %.
    expect(topPlans(matches, fb, { size: 2, minRate: 0.99 }).plans).toEqual([]);
  });
});

describe("topPlans, the tolerance and the cut", () => {
  it("with the tolerance, the first plan is within it of the best and the three lose under 1 % together", () => {
    for (const seed of [41, 42, 43, 44, 45, 46]) {
      const { matches, fb } = scenario(40, 5, seed);
      const best = topPlans(matches, fb, { size: 3, ...exact }).plans;
      const fast = topPlans(matches, fb, { size: 3, epsilon: 0.005, maxMatches: Infinity }).plans;
      expect(fast).toHaveLength(best.length);
      expect(fast[0].cash).toBeGreaterThanOrEqual(best[0].cash / 1.005 - 1e-9);
      const total = (plans: Plan[]) => plans.reduce((s, p) => s + p.cash, 0);
      expect(total(fast)).toBeGreaterThanOrEqual(0.99 * total(best));
    }
  });

  it("looks at the best matches only by default, as many as the size of the combo allows", () => {
    const { matches, fb } = scenario(300, 5, 51);
    expect(topPlans(matches, fb, { size: 1 }).stats.kept).toBeGreaterThan(250);
    expect(topPlans(matches, fb, { size: 2 }).stats.kept).toBe(DEFAULT_MAX_MATCHES[2]);
    expect(topPlans(matches, fb, { size: 3 }).stats.kept).toBe(DEFAULT_MAX_MATCHES[3]);
    expect(topPlans(matches, fb, { size: 3, maxMatches: 20 }).stats.kept).toBe(20);
  });

  it("cannot be made to bound more combos than the limit, whatever it is asked", () => {
    const { matches, fb } = scenario(400, 4, 52, { coverage: 0.95 });
    const res = topPlans(matches, fb, { size: 3, maxMatches: Infinity, deadlineMs: 60_000 });
    expect(res.stats.combos).toBeLessThanOrEqual(MAX_COMBOS);
    // C(85, 3) = 98,770 fits, C(86, 3) = 102,340 does not.
    expect(res.stats.kept).toBeLessThanOrEqual(85);
    expect(res.plans).toHaveLength(3);
    expect(res.stats.partial).toBe(false);
  });

  it("does little work on an ordinary request: a fixed budget of operations, not of time", () => {
    const { matches, fb } = scenario(100, 6, 5);
    const { plans, stats } = topPlans(matches, fb, { size: 3 });
    expect(plans).toHaveLength(3);
    expect(stats.kept).toBe(50);
    expect(stats.combos).toBe(19600);
    // Of the 19,600 combos, 817 are looked at and 815 of those are dismissed by a few rounds of column
    // generation: 9 are solved, with 18 programs. Several times that is still far from solving the pool.
    expect(stats.looked).toBeLessThan(3000);
    expect(stats.solved).toBeLessThan(30);
    expect(stats.lps).toBeLessThan(80);
  });
});

describe("topPlans, the plans", () => {
  it("are valid, best first, and share no match", () => {
    for (const [size, seed] of [[1, 61], [2, 62], [3, 63], [3, 64], [2, 65]] as const) {
      const { matches, fb } = scenario(40, 5, seed);
      const { plans } = topPlans(matches, fb, { size });
      expect(plans).toHaveLength(3);
      plans.forEach((plan) => {
        const picked = plan.matchIds.map((id) => matches.find((m) => m.id === id)!);
        expect(picked).toHaveLength(size);
        expectValidPlan(plan, picked, fb);
      });
      for (let i = 1; i < plans.length; i++) expect(plans[i].cash).toBeLessThanOrEqual(plans[i - 1].cash);
      const used = plans.flatMap((p) => p.matchIds);
      expect(new Set(used).size).toBe(used.length);
    }
  });

  it("are as many as asked for, as long as there are matches left to give", () => {
    const { matches, fb } = scenario(30, 4, 71);
    expect(topPlans(matches, fb, { size: 2, plans: 1 }).plans).toHaveLength(1);
    const five = topPlans(matches, fb, { size: 2, plans: 5 }).plans;
    expect(five).toHaveLength(5);
    expect(new Set(five.flatMap((p) => p.matchIds)).size).toBe(10);
    // Three matches cannot make two combos of two.
    expect(topPlans(matches.slice(0, 3), fb, { size: 2, plans: 2 }).plans.length).toBeLessThanOrEqual(1);
  });

  it("are the same every time", () => {
    const { matches, fb } = scenario(60, 5, 72);
    const once = topPlans(matches, fb, { size: 3 });
    const twice = topPlans(matches, fb, { size: 3 });
    expect(twice.plans).toEqual(once.plans);
  });

  it("mix the sports: a combo can hold a 2-way market and a 3-way one", () => {
    const { matches, fb } = scenario(40, 5, 73, { share2way: 0.5 });
    const { plans } = topPlans(matches, fb, { size: 3 });
    const outcomes = plans.map((p) => p.matchIds.map((id) => matches.find((m) => m.id === id)!.outcomes));
    expect(outcomes.some((o) => new Set(o).size > 1)).toBe(true);
  });
});

describe("topPlans, the wallet", () => {
  it("has no plan from a single bookmaker with freebets: it would hold every cell", () => {
    const { matches } = scenario(20, 4, 81);
    const res = topPlans(matches, [50, 0, 0, 0], { size: 2 });
    expect(res.plans).toEqual([]);
    expect(res.stats.uncovered).toBe(matches.length);
    expect(topPlans(matches, [0, 0, 0, 0], { size: 2 }).plans).toEqual([]);
    expect(topPlans(matches, [], { size: 2 }).plans).toEqual([]);
  });

  it("does not let a bookmaker with no freebets help, however good its prices", () => {
    const { matches, fb } = scenario(25, 4, 82);
    const withZero = fb.slice(0, 3).concat(0);
    const full = topPlans(matches, withZero, { size: 2, ...exact });
    const cut = topPlans(
      matches.map((m) => ({ ...m, odds: m.odds.slice(0, 3) })),
      withZero.slice(0, 3),
      { size: 2, ...exact }
    );
    expect(ids(full.plans)).toEqual(ids(cut.plans));
    full.plans.forEach((plan, i) => expect(plan.cash).toBeCloseTo(cut.plans[i].cash, 9));
  });

  it("has nothing when there are fewer matches than the combo needs", () => {
    const { matches, fb } = scenario(20, 4, 83);
    expect(topPlans(matches.slice(0, 2), fb, { size: 3 }).plans).toEqual([]);
    expect(topPlans([], fb, { size: 1 }).plans).toEqual([]);
  });
});

describe("topPlans, the matches it is given", () => {
  it("leaves out the ones it cannot use, counts them, and is not troubled by them", () => {
    const { matches, fb } = scenario(30, 4, 91);
    const bad: Match[] = [
      { ...matches[0], id: matches[0].id }, // an id already given
      { id: "four-way", outcomes: 4 as unknown as 3, odds: matches[1].odds },
      { id: "odds-of-one", outcomes: 2, odds: [[1, 2], [1.9, 2.1], null, null] },
      { id: "nan", outcomes: 2, odds: [[Number.NaN, 2], [1.9, 2.1], null, null] },
      { id: "short", outcomes: 3, odds: [[2, 3], null, null, null] },
    ];
    const clean = topPlans(matches, fb, { size: 2 });
    const noisy = topPlans([...matches, ...bad], fb, { size: 2 });
    expect(noisy.stats.invalid).toBe(5);
    expect(noisy.stats.matches).toBe(matches.length + 5);
    expect(noisy.plans).toEqual(clean.plans);
  });

  it("leaves out a match that only one bookmaker with freebets prices", () => {
    const { matches, fb } = scenario(20, 4, 92);
    const lone: Match = { id: "lone", outcomes: 3, odds: [[9, 9, 9], null, null, null] };
    const res = topPlans([lone, ...matches], fb, { size: 1, ...exact });
    expect(res.stats.uncovered).toBeGreaterThanOrEqual(1);
    expect(res.plans.every((p) => !p.matchIds.includes("lone"))).toBe(true);
  });

  it("refuses what is not a size of combo, or a wallet that is not numbers", () => {
    const { matches, fb } = scenario(5, 3, 93);
    expect(() => topPlans(matches, fb, { size: 4 as unknown as 3 })).toThrow(RangeError);
    expect(() => topPlans(matches, [10, Number.NaN, 10], { size: 2 })).toThrow(RangeError);
  });
});

describe("topPlans, the clock", () => {
  it("says so when time ran out in the selection, and still answers", () => {
    const { matches, fb } = scenario(30, 4, 101);
    // The clock reads 0 until the bounds are done, then far past any deadline.
    let calls = 0;
    const now = () => (++calls <= 2 ? 0 : 1e9);
    const res = topPlans(matches, fb, { size: 2, deadlineMs: 1000, now });
    expect(res.stats.partial).toBe(true);
    res.plans.forEach((plan) => expect(plan.cash).toBeGreaterThan(0));
  });

  it("says so when time ran out in the bounds", () => {
    const { matches, fb } = scenario(30, 4, 102);
    let calls = 0;
    const now = () => (++calls <= 1 ? 0 : 1e9);
    const res = topPlans(matches, fb, { size: 2, deadlineMs: 1000, now });
    expect(res.stats.partial).toBe(true);
  });

  it("is not partial with a clock that stays in time", () => {
    const { matches, fb } = scenario(30, 4, 103);
    const res = topPlans(matches, fb, { size: 2, now: () => 0 });
    expect(res.stats.partial).toBe(false);
    expect(res.plans.length).toBeGreaterThan(0);
  });
});
