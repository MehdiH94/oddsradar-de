import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { holdsEveryCell, solveCombo } from "../../../src/freebets/engine/combo";
import { Match, Plan } from "../../../src/freebets/engine/types";
import { cellsOf, coverageOracle, denseLpValue, genMatches, genWallet, marginsFor, rng } from "./helpers";
import { expectValidPlan } from "./planChecks";

describe("solveCombo, on the user's example", () => {
  // Three matches of a past conversion (Heidenheim-Werder, Leicester-Ipswich, Getafe-Athletic), quoted the same
  // by three bookmakers that each hold 55 FB: 165 FB over 27 cells. Converted with no budget to respect, it gave
  // 133.75 euros: 81.06 %.
  const quotes = [
    [2.3, 3.8, 2.8],
    [2.3, 3.55, 2.95],
    [3.5, 2.6, 2.6],
  ];
  const matches: Match[] = quotes.map((odds, i) => ({ id: `golden${i}`, outcomes: 3, odds: [odds, odds, odds] }));

  it("is the closed form of that conversion, 81.06 % and 133.75 euros", () => {
    const combined = cellsOf(matches).map((cell) => cell.reduce((price, k, i) => price * quotes[i][k], 1));
    expect(combined).toHaveLength(27);
    const rate = 1 / combined.reduce((s, c) => s + 1 / (c - 1), 0);
    expect(rate).toBeCloseTo(0.8106, 4);
    expect(165 * rate).toBeCloseTo(133.75, 2);
  });

  it("gets the same optimum from the program, and the cent-rounded bets guarantee almost as much", () => {
    const combined = cellsOf(matches).map((cell) => cell.reduce((price, k, i) => price * quotes[i][k], 1));
    const closedForm = 165 / combined.reduce((s, c) => s + 1 / (c - 1), 0);
    const plan = solveCombo(matches, [55, 55, 55])!;
    expect(plan).not.toBeNull();
    // Every freebet spent, every cell paying the same: the program reaches the closed form.
    expect(plan.value).toBeCloseTo(closedForm, 6);
    // On whole cents of FB the guarantee gives up a few cents per cell: 133.63 euros against 133.75.
    expect(plan.cash).toBeGreaterThan(closedForm - 0.15);
    expect(plan.cash).toBeLessThanOrEqual(closedForm);
    expect(plan.used).toBeGreaterThan(164.9);
    expect(plan.used).toBeLessThanOrEqual(165);
    expect(plan.rate).toBeGreaterThan(0.8);
    expect(plan.payoff).toHaveLength(27);
    expect(plan.exact).toBe(true);
    expectValidPlan(plan, matches, [55, 55, 55]);
  });

  it("needs a second bookmaker: one alone would hold every cell", () => {
    expect(solveCombo(matches, [165, 0, 0])).toBeNull();
    // Without the rule it would convert at the same rate.
    const free = solveCombo(matches, [165, 0, 0], { coverage: false })!;
    expect(free.bets.every((bet) => bet.b === 0)).toBe(true);
    expect(free.rate).toBeGreaterThan(0.8);
  });
});

describe("solveCombo, against the linear program solved by scipy (HiGHS)", () => {
  // tests/freebets/engine/fixtures/lp-oracle.json: 69 programs (1 to 3 matches, 2 to 5 bookmakers, prices up to 30,
  // wallets from 1 to 200 FB, some that guarantee nothing) whose optimum was computed by scipy.optimize.linprog
  // with the HiGHS solver: maximise G so that every cell pays G and no budget is broken. Values frozen here; the
  // engine is not involved in them. The rule and the minimum stake are off, since the program has neither.
  const fixtures = JSON.parse(readFileSync(join(__dirname, "fixtures/lp-oracle.json"), "utf8")) as Array<{
    matches: Array<{ outcomes: 2 | 3; odds: Array<number[] | null> }>;
    fb: number[];
    value: number;
  }>;

  it("has the instances it says", () => {
    expect(fixtures).toHaveLength(69);
    expect(fixtures.filter((f) => f.value === 0)).toHaveLength(6);
  });

  it.each(fixtures.map((f, i) => [i, f] as const))("matches the optimum of instance %i", (_i, f) => {
    const matches: Match[] = f.matches.map((m, i) => ({ id: `m${i}`, outcomes: m.outcomes, odds: m.odds }));
    const plan = solveCombo(matches, f.fb, { coverage: false, minStake: 0 });
    if (f.value === 0) {
      expect(plan).toBeNull();
      return;
    }
    expect(plan).not.toBeNull();
    expect(Math.abs(plan!.value - f.value) / Math.max(1, f.value)).toBeLessThan(1e-7);
  });
});

describe("solveCombo, the rule that no bookmaker holds every cell", () => {
  function instance(seed: number) {
    const r = rng(seed);
    const size = r.next() < 0.3 ? 1 : 2;
    const B = size === 1 ? r.int(2, 4) : r.int(2, 3);
    const matches: Match[] = Array.from({ length: size }, (_, i) => {
      const outcomes = r.next() < 0.75 ? 3 : 2;
      return { id: `m${i}`, outcomes, odds: Array.from({ length: B }, () => Array.from({ length: outcomes }, () => Math.round(r.range(1.4, 6) * 100) / 100)) } as Match;
    });
    // A rich bookmaker among poorer ones: where the rule bites.
    const fb = Array.from({ length: B }, (_, b) => (b === 0 ? r.int(60, 200) : r.int(5, 60)));
    return { matches, fb };
  }

  it("finds the best plan that obeys it: the exhaustive search over every way to leave a cell empty agrees", () => {
    let binding = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const { matches, fb } = instance(seed);
      const best = coverageOracle(matches, fb);
      const free = denseLpValue(matches, fb);
      const plan = solveCombo(matches, fb, { minStake: 0, maxLps: 100000 });
      expect(plan).not.toBeNull();
      expect(Math.abs(plan!.value - best) / Math.max(1, best)).toBeLessThan(1e-9);
      if (free > best + 1e-6) binding++;
    }
    // The rule did cost something in some of them, or this would prove little.
    expect(binding).toBeGreaterThanOrEqual(4);
  });

  it("never leaves a bookmaker with a bet on every cell, over 300 random wallets and combos", () => {
    let plans = 0;
    for (let seed = 1000; seed < 1300; seed++) {
      const { matches, fb } = instance(seed);
      const plan = solveCombo(matches, fb);
      if (!plan) continue;
      plans++;
      expectValidPlan(plan, matches, fb);
    }
    expect(plans).toBeGreaterThan(250);
  });

  it("can need more bookmakers than it has: one bookmaker is not enough, even for a single bet", () => {
    const single: Match[] = [{ id: "a", outcomes: 3, odds: [[2.1, 3.4, 3.6], null] }];
    expect(solveCombo(single, [100, 100])).toBeNull();
    const two: Match[] = [{ id: "a", outcomes: 3, odds: [[2.1, 3.4, 3.6], [2.0, 3.5, 3.7]] }];
    const plan = solveCombo(two, [100, 100])!;
    expectValidPlan(plan, two, [100, 100]);
    expect(new Set(plan.bets.map((bet) => bet.b)).size).toBe(2);
  });
});

describe("solveCombo, the rounding to the cent", () => {
  // The program's stakes are real numbers; a bet is placed on whole cents, and a cent on a three-match bet moves its
  // cell by several FB. The guarantee given up in the rounding is what the value of the program has over the cash.
  function loss(size: 1 | 2 | 3, wallet: (B: number, r: ReturnType<typeof rng>, seed: number) => number[]) {
    const losses: number[] = [];
    for (let seed = 0; seed < 200; seed++) {
      const r = rng(seed + 31337);
      const B = r.int(3, 6);
      const matches = genMatches(size, marginsFor(B, seed), seed, { coverage: 1 });
      const fb = wallet(B, r, seed);
      const plan = solveCombo(matches, fb);
      if (!plan) continue;
      expectValidPlan(plan, matches, fb);
      losses.push((plan.value - plan.cash) / plan.value);
    }
    expect(losses.length).toBeGreaterThanOrEqual(195);
    return { mean: losses.reduce((s, v) => s + v, 0) / losses.length, max: Math.max(...losses) };
  }

  it("keeps all but 0.1 % of a three-match plan on average, 0.4 % at worst, with wallets of 10 to 60 FB", () => {
    // Rounding every stake to the nearest cent kept all but 0.16 % on average.
    const { mean, max } = loss(3, (B, _r, seed) => genWallet(B, seed));
    expect(mean).toBeLessThan(0.0012);
    expect(max).toBeLessThan(0.006);
  });

  it("keeps all but 0.4 % on average with wallets of 4 to 15 FB, where a cent weighs more", () => {
    const { mean, max } = loss(3, (B, r) => Array.from({ length: B }, () => r.int(4, 15)));
    expect(mean).toBeLessThan(0.004);
    expect(max).toBeLessThan(0.015);
  });

  it("keeps all but 0.04 % of a two-match plan on average", () => {
    const { mean } = loss(2, (B, _r, seed) => genWallet(B, seed));
    expect(mean).toBeLessThan(0.0004);
  });
});

describe("solveCombo, the minimum stake", () => {
  it("raises a stake that is too small to the minimum rather than leave its cell bare", () => {
    // A winner at 1.03 / 13.79 at one bookmaker and 1.04 / 13.39 at the other, 20 FB each. The rule keeps a bookmaker
    // from betting both outcomes: the second bookmaker bets the favourite (20 x 0.04 = 0.8 euros guaranteed) and the
    // first one has to cover the outsider, which needs only 0.8 / 12.79 = 0.06 FB, under the minimum of 0.1 FB.
    // Forbidding that stake left the outsider with no bookmaker (no plan at all); raised to 0.1 FB it pays 1.28.
    const match: Match[] = [{ id: "a", outcomes: 2, odds: [[1.03, 13.79], [1.04, 13.39]] }];
    const plan = solveCombo(match, [20, 20])!;
    expect(plan).not.toBeNull();
    expect(plan.bets.map((bet) => [bet.b, bet.cellIndex, bet.stake])).toEqual([
      [0, 1, 0.1],
      [1, 0, 20],
    ]);
    expect(plan.cash).toBeCloseTo(0.8, 9);
    expect(plan.used).toBeCloseTo(20.1, 9);
    expect(plan.exact).toBe(true);
    expectValidPlan(plan, match, [20, 20]);
  });

  it("does not force a bookmaker into more minimum bets than its freebets cover", () => {
    // A 1X2 at three bookmakers, the third with only 0.16 FB: it can place one bet of at least 0.1 FB, not two. The
    // best plan under the minimum (scipy's integer program: 10.6115222482 before the rounding) gives it one bet of
    // 0.16; two bets of 0.1 FB would break its budget.
    const match: Match[] = [
      {
        id: "a",
        outcomes: 3,
        odds: [
          [2.73, 4.42, 2.19],
          [2.71, 4.5, 2.1],
          [2.83, 4.51, 2.13],
        ],
      },
    ];
    const plan = solveCombo(match, [9, 9, 0.16])!;
    expect(plan.cash).toBeGreaterThan(10.6);
    expect(plan.value).toBeCloseTo(10.6115222482, 6);
    expect(plan.bets.filter((bet) => bet.b === 2).map((bet) => bet.stake)).toEqual([0.16]);
    expectValidPlan(plan, match, [9, 9, 0.16]);
  });

  // tests/freebets/engine/fixtures/minstake-oracle.json: 48 combos with small wallets, where the minimum stake
  // matters, whose best plan was computed by scipy.optimize.milp (HiGHS) with the gap closed: every bet is either 0 or
  // at least the minimum stake (a binary variable per bet), no bookmaker bets every cell, and the guaranteed gain is
  // maximised. The values are those of that program before the rounding to the cent, frozen here; the engine is not
  // involved in them. 16 are combos for which the engine once found no plan at all, 10 others where it found one far
  // under the optimum, 16 ordinary ones, and 6 with a minimum of 0.5 or 1 FB.
  const fixtures = JSON.parse(readFileSync(join(__dirname, "fixtures/minstake-oracle.json"), "utf8")) as Array<{
    group: string;
    minStake: number;
    fb: number[];
    matches: Array<{ outcomes: 2 | 3; odds: Array<number[] | null> }>;
    value: number;
  }>;
  const solved = fixtures.map((f) => {
    const matches: Match[] = f.matches.map((m, i) => ({ id: `m${i}`, outcomes: m.outcomes, odds: m.odds }));
    return { f, matches, plan: solveCombo(matches, f.fb, { minStake: f.minStake }) };
  });

  it("has the instances it says", () => {
    expect(fixtures).toHaveLength(48);
    expect(fixtures.filter((f) => f.group === "higher minimum")).toHaveLength(6);
  });

  it.each(solved.map((s, i) => [i, s] as const))("finds a valid plan on instance %i, never above the optimum", (_i, { f, matches, plan }) => {
    expect(plan).not.toBeNull();
    expectValidPlan(plan!, matches, f.fb, { minStake: f.minStake });
    // The plan is one of the program's feasible points: it cannot beat its optimum.
    expect(plan!.value).toBeLessThanOrEqual(f.value * (1 + 1e-6));
    // A search that ran to its end is within the tolerance of the optimum; one that was cut short says so, and is still
    // a good plan.
    const gap = (f.value - plan!.value) / f.value;
    if (plan!.exact) expect(gap).toBeLessThan(5e-4);
    else expect(plan!.value).toBeGreaterThan(0.5 * f.value);
  });

  it("is within 0.1 % of the optimum on most of them and 1.5 % on average, whatever the instance", () => {
    const gaps = solved.map(({ f, plan }) => (f.value - plan!.value) / f.value);
    expect(gaps.filter((gap) => gap < 1e-3).length).toBeGreaterThanOrEqual(38);
    expect(gaps.reduce((s, gap) => s + gap, 0) / gaps.length).toBeLessThan(0.015);
  });

  it("keeps every bet at the minimum or above on small wallets, over 300 random combos of one to three matches", () => {
    let plans = 0;
    for (let seed = 0; seed < 300; seed++) {
      const r = rng(seed + 4000);
      const B = r.int(3, 5);
      const matches = genMatches(1 + (seed % 3), marginsFor(B, seed), seed, { coverage: 1 });
      const fb = Array.from({ length: B }, () => r.int(2, 9));
      const minStake = [0.1, 0.1, 0.5][seed % 3];
      const plan = solveCombo(matches, fb, { minStake });
      if (!plan) continue;
      plans++;
      expectValidPlan(plan, matches, fb, { minStake });
    }
    // Wallets this small guarantee something nearly always. The few that do not are barely enough for the minimum on
    // every cell (27 cells at 0.5 FB is 13.5 FB), or not enough at all.
    expect(plans).toBeGreaterThanOrEqual(295);
  });

  it("stays bounded when the search cannot finish, and says so", () => {
    // 5 FB over the 27 cells of three matches: nearly every stake is a sliver, and the search is cut at its cap.
    const f = fixtures.find((x) => x.fb.join() === "2,2,1" && x.matches.length === 3)!;
    const { matches, plan } = solved[fixtures.indexOf(f)];
    expect(plan!.exact).toBe(false);
    expect(plan!.lps).toBeLessThan(100);
    expectValidPlan(plan!, matches, f.fb);
  });
});

describe("holdsEveryCell", () => {
  const bet = (b: number, cellIndex: number) => ({ b, cellIndex, cell: [cellIndex], odds: 2, stake: 1 });
  const planWith = (bets: ReturnType<typeof bet>[]) => ({ bets }) as Plan;

  it("is true when one bookmaker has a bet on every cell, however the cells are shared with the others", () => {
    expect(holdsEveryCell(planWith([bet(0, 0), bet(0, 1), bet(0, 2), bet(1, 1)]), 3)).toBe(true);
  });

  it("is false while a cell is left to the others, and for no bet at all", () => {
    expect(holdsEveryCell(planWith([bet(0, 0), bet(0, 1), bet(1, 2)]), 3)).toBe(false);
    expect(holdsEveryCell(planWith([bet(0, 0), bet(0, 0), bet(0, 1)]), 3)).toBe(false);
    expect(holdsEveryCell(planWith([]), 3)).toBe(false);
  });
});

describe("solveCombo, plans", () => {
  const margins = marginsFor(5, 11);

  it("are valid on random combos of one, two and three matches, mixing 2 and 3 outcomes", () => {
    let plans = 0;
    let mixed = 0;
    for (let seed = 1; seed <= 120; seed++) {
      const pool = genMatches(10, margins, seed, { share2way: 0.4 });
      const r = rng(seed);
      const size = r.int(1, 3);
      const picked = [...pool].sort(() => r.next() - 0.5).slice(0, size);
      const fb = genWallet(5, seed, seed % 3 === 0);
      const plan = solveCombo(picked, fb);
      if (!plan) continue;
      plans++;
      if (new Set(picked.map((m) => m.outcomes)).size > 1) mixed++;
      expectValidPlan(plan, picked, fb);
    }
    expect(plans).toBeGreaterThan(90);
    expect(mixed).toBeGreaterThan(5);
  });

  it("count 18 cells for two football matches and a tennis one", () => {
    const matches: Match[] = [
      { id: "f1", outcomes: 3, odds: [[2.4, 3.3, 3.0], [2.5, 3.2, 2.9], [2.3, 3.4, 3.1]] },
      { id: "f2", outcomes: 3, odds: [[3.1, 3.2, 2.3], [3.0, 3.3, 2.4], [3.2, 3.1, 2.2]] },
      { id: "t", outcomes: 2, odds: [[1.9, 2.0], [1.95, 1.95], [1.85, 2.05]] },
    ];
    const fb = [30, 30, 30];
    const plan = solveCombo(matches, fb)!;
    expect(plan.payoff).toHaveLength(18);
    expectValidPlan(plan, matches, fb);
    const free = solveCombo(matches, fb, { coverage: false, minStake: 0 })!;
    expect(Math.abs(free.value - denseLpValue(matches, fb)) / free.value).toBeLessThan(1e-9);
  });

  it("do not use a bookmaker that has no freebets, whatever its prices, nor one that does not price every match", () => {
    const matches: Match[] = [
      { id: "a", outcomes: 3, odds: [[2.4, 3.3, 3.0], [2.5, 3.2, 2.9], [9, 9, 9], [2.6, 3.4, 3.1]] },
      { id: "b", outcomes: 2, odds: [[1.9, 2.0], [1.95, 1.95], [9, 9], null] },
    ];
    const fb = [40, 40, 0, 40];
    const plan = solveCombo(matches, fb)!;
    expect(plan.bets.some((bet) => bet.b === 2 || bet.b === 3)).toBe(false);
    expectValidPlan(plan, matches, fb);
    // As if bookmakers 2 and 3 did not exist.
    const alone = solveCombo(
      matches.map((m) => ({ ...m, odds: m.odds.slice(0, 2) })),
      [40, 40]
    )!;
    expect(plan.cash).toBeCloseTo(alone.cash, 9);
  });

  it("have no bet under the minimum stake, which can be raised", () => {
    const pool = genMatches(8, margins, 77);
    const fb = genWallet(5, 77);
    for (const minStake of [0.1, 1, 3]) {
      const plan = solveCombo(pool.slice(0, 3), fb, { minStake });
      if (!plan) continue;
      expectValidPlan(plan, pool.slice(0, 3), fb, { minStake });
    }
  });

  it("give nothing when the wallet is too small for the minimum stake to be a bet", () => {
    const matches = genMatches(3, marginsFor(3, 5), 5, { coverage: 1 });
    expect(solveCombo(matches, [0.04, 0.04, 0.04])).toBeNull();
  });

  it("give up on a combo that cannot beat the target, and keep one that can", () => {
    const matches = genMatches(3, marginsFor(4, 9), 9, { coverage: 1 });
    const fb = [30, 25, 20, 35];
    const plan = solveCombo(matches, fb)!;
    expect(solveCombo(matches, fb, { target: plan.value * 1.01 })).toBeNull();
    const beatable = solveCombo(matches, fb, { target: plan.value * 0.9 })!;
    expect(beatable.cash).toBeCloseTo(plan.cash, 6);
  });

  it("say when the search was cut short, and are still valid", () => {
    let inexact = 0;
    let cheaper = 0;
    for (let seed = 1; seed <= 80; seed++) {
      const { matches, fb } = (() => {
        const r = rng(seed);
        const pool = genMatches(6, marginsFor(4, seed), seed, { coverage: 1 });
        return { matches: pool.slice(0, 2), fb: [r.int(80, 300), r.int(5, 30), r.int(5, 30), r.int(5, 30)] };
      })();
      const full = solveCombo(matches, fb);
      const cut = solveCombo(matches, fb, { maxLps: 3 });
      if (!cut) continue;
      expectValidPlan(cut, matches, fb);
      if (!cut.exact) {
        inexact++;
        // Cut short, it can only be worse than the whole search.
        expect(cut.cash).toBeLessThanOrEqual(full!.cash + 1e-9);
        if (cut.cash < full!.cash - 0.5) cheaper++;
      } else {
        expect(cut.cash).toBeCloseTo(full!.cash, 6);
      }
      expect(full!.exact).toBe(true);
    }
    expect(inexact).toBeGreaterThan(0);
    void cheaper;
  });

  it("refuse what is not a combo or a market", () => {
    const ok: Match = { id: "a", outcomes: 2, odds: [[1.9, 2.1], [2, 2]] };
    expect(() => solveCombo([], [10, 10])).toThrow(RangeError);
    expect(() => solveCombo([ok, ok, ok, ok], [10, 10])).toThrow(RangeError);
    expect(() => solveCombo([{ ...ok, outcomes: 4 as unknown as 3 }], [10, 10])).toThrow(RangeError);
    expect(() => solveCombo([{ ...ok, odds: [[1.9, 2.1, 5], [2, 2]] }], [10, 10])).toThrow(RangeError);
    expect(() => solveCombo([{ ...ok, odds: [[1.0, 2.1], [2, 2]] }], [10, 10])).toThrow(RangeError);
    expect(() => solveCombo([{ ...ok, odds: [[NaN, 2.1], [2, 2]] }], [10, 10])).toThrow(RangeError);
    expect(() => solveCombo([{ ...ok, odds: [[1.9, 5000], [2, 2]] }], [10, 10])).toThrow(RangeError);
    expect(() => solveCombo([ok], [10, Infinity])).toThrow(RangeError);
    // A bad price at a bookmaker with nothing to spend is not read.
    expect(() => solveCombo([{ ...ok, odds: [[1.9, 2.1], [0, 0]] }], [10, 0])).not.toThrow();
  });
});
