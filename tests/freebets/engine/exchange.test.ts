import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ExchangeItem, convertAgainstExchange, exchangeCapacity, exchangeRate } from "../../../src/freebets/engine/exchange";
import { maximize } from "../../../src/freebets/engine/simplex";
import { EXCHANGE_COMMISSION, backLayRate } from "../../../src/db/surebets";
import { Rng, rng } from "./helpers";

const K = EXCHANGE_COMMISSION;
const options = { commission: K };

describe("the exchange's formulas", () => {
  it("give, for the first outcome of the mock-up, 75.6 % and 14.12 FB for 11 euros of liquidity", () => {
    // Brest-Auxerre: the bookmaker pays 4.60 on Auxerre, the exchange lays it at 4.65 for 11 euros.
    expect(K).toBe(0.03);
    expect(exchangeRate(4.6, 4.65, K)).toBeCloseTo((3.6 * 0.97) / 4.62, 12);
    expect(exchangeRate(4.6, 4.65, K)).toBeCloseTo(0.7558, 4);
    expect(exchangeCapacity(4.6, 4.65, 11, K)).toBeCloseTo(14.1167, 4);
  });

  it("agree with the site's back/lay rate: a freebet is a back whose stake is not returned", () => {
    const r = rng(1);
    for (let i = 0; i < 500; i++) {
      const back = r.range(1.5, 30);
      const lay = back * r.range(0.97, 1.08);
      // backLayRate is what the bet returns per unit staked, stake included; a freebet returns the profit only.
      expect(exchangeRate(back, lay, K)).toBeCloseTo(backLayRate(back, lay) - (1 - K) / (lay - K), 12);
    }
  });

  it("make the result the same whether the bookmaker's outcome wins or not", () => {
    const r = rng(2);
    for (let i = 0; i < 500; i++) {
      const back = r.range(1.5, 30);
      const lay = back * r.range(0.97, 1.08);
      const fb = r.range(1, 100);
      const stake = (fb * (back - 1)) / (lay - K);
      const ifItWins = fb * (back - 1) - stake * (lay - 1);
      const ifItLoses = stake * (1 - K);
      expect(ifItWins).toBeCloseTo(ifItLoses, 9);
      expect(ifItLoses).toBeCloseTo(fb * exchangeRate(back, lay, K), 9);
      // The liquidity that exactly covers that stake is the capacity.
      expect(exchangeCapacity(back, lay, stake, K)).toBeCloseTo(fb, 9);
    }
  });
});

describe("convertAgainstExchange, on the mock-up's three matches", () => {
  const items: ExchangeItem[] = [
    { id: "brest-auxerre/2", matchId: "brest-auxerre", back: 4.6, lay: 4.65, laySize: 11 },
    { id: "augsbourg-hambourg/X", matchId: "augsbourg-hambourg", back: 3.9, lay: 3.95, laySize: 9 },
    { id: "lille-lens/2", matchId: "lille-lens", back: 3.85, lay: 3.9, laySize: 120 },
  ];

  it("chains the three: the first two limited by their liquidity, the last taking the rest of the 30 FB", () => {
    const res = convertAgainstExchange(items, 30, options);
    expect(res.steps.map((s) => s.id)).toEqual(["brest-auxerre/2", "augsbourg-hambourg/X", "lille-lens/2"]);
    expect(res.steps.map((s) => s.limited)).toEqual([true, true, false]);
    expect(res.steps.map((s) => Math.round(s.fb * 100) / 100)).toEqual([14.12, 12.17, 3.72]);
    expect(res.steps.map((s) => Math.round(s.rate * 1000) / 10)).toEqual([75.6, 71.8, 71.4]);
    expect(res.steps.map((s) => Math.round(s.cash * 100) / 100)).toEqual([10.67, 8.73, 2.66]);
    // The first step's lay is its whole liquidity; the money to put up is stake x (price - 1).
    expect(res.steps[0].layStake).toBeCloseTo(11, 9);
    expect(res.steps[0].liability).toBeCloseTo(40.15, 2);
    expect(res.steps[1].liability).toBeCloseTo(26.55, 2);
    expect(res.steps[2].liability).toBeCloseTo(7.94, 2);
    expect(res.converted).toBeCloseTo(30, 9);
    expect(res.leftover).toBe(0);
    expect(res.cash).toBeCloseTo(22.06, 2);
    expect(res.liability).toBeCloseTo(74.64, 2);
  });

  it("converts less when the liquidity is short, and says how much is left", () => {
    const res = convertAgainstExchange(items.slice(0, 2), 30, options);
    expect(res.steps.every((s) => s.limited)).toBe(true);
    expect(res.converted).toBeCloseTo(14.1167 + 12.1655, 3);
    expect(res.leftover).toBeCloseTo(30 - res.converted, 9);
  });

  it("converts everything in the first step when its liquidity is enough", () => {
    const res = convertAgainstExchange(items, 5, options);
    expect(res.steps).toHaveLength(1);
    expect(res.steps[0].id).toBe("brest-auxerre/2");
    expect(res.steps[0].limited).toBe(false);
    expect(res.steps[0].fb).toBeCloseTo(5, 9);
    expect(res.leftover).toBe(0);
  });
});

describe("convertAgainstExchange, which outcomes", () => {
  // A price p with a lay at the same p: the rate 0.97 (p - 1) / (p - 0.03).
  const item = (id: string, matchId: string, price: number, laySize: number): ExchangeItem => ({ id, matchId, back: price, lay: price, laySize });

  it("does not let a high rate with no liquidity take a place from the outcome that converts the most", () => {
    const items = [
      item("a", "a", 9, 0.5),
      item("b", "b", 8, 0.5),
      item("c", "c", 7, 0.5),
      item("d", "d", 3, 500),
    ];
    const res = convertAgainstExchange(items, 100, options);
    // Three places: the best rates would be a, b, c, which convert 1.7 FB in all. a, b and d convert almost all 100.
    expect(res.steps.map((s) => s.id).sort()).toEqual(["a", "b", "d"]);
    expect(res.converted).toBeGreaterThan(99);
    const greedy = items
      .slice()
      .sort((x, y) => exchangeRate(y.back, y.lay, K) - exchangeRate(x.back, x.lay, K))
      .slice(0, 3)
      .reduce((s, it) => s + exchangeCapacity(it.back, it.lay, it.laySize, K) * exchangeRate(it.back, it.lay, K), 0);
    expect(res.cash).toBeGreaterThan(40 * greedy);
    // The steps come best rate first.
    expect(res.steps.map((s) => s.rate)).toEqual([...res.steps.map((s) => s.rate)].sort((x, y) => y - x));
  });

  it("uses one outcome of a match at most", () => {
    const items = [item("a1", "a", 9, 5), item("a2", "a", 8.5, 5), item("b", "b", 5, 5), item("c", "c", 4, 50)];
    const res = convertAgainstExchange(items, 40, options);
    expect(new Set(res.steps.map((s) => s.matchId)).size).toBe(res.steps.length);
    expect(res.steps.filter((s) => s.matchId === "a")).toHaveLength(1);
    // But the other outcome of the match can be the better one when it has the liquidity.
    const roomier = convertAgainstExchange([item("a1", "a", 9, 0.1), item("a2", "a", 8.5, 50)], 30, options);
    expect(roomier.steps.map((s) => s.id)).toEqual(["a2"]);
  });

  it("limits the chain to the number of conversions asked for", () => {
    const items = Array.from({ length: 6 }, (_, i) => item(`i${i}`, `m${i}`, 9 - i, 3));
    expect(convertAgainstExchange(items, 100, options).steps).toHaveLength(3);
    expect(convertAgainstExchange(items, 100, { ...options, maxConversions: 2 }).steps).toHaveLength(2);
    expect(convertAgainstExchange(items, 100, { ...options, maxConversions: 1 }).steps).toHaveLength(1);
  });

  it("leaves out the outcomes under the floors, and the ones that are not prices", () => {
    const items = [item("thin", "t", 9, 1.5), item("poor", "p", 2.2, 500), item("fine", "f", 6, 50), { ...item("nan", "n", 5, 50), back: Number.NaN }, item("none", "z", 5, 0), { ...item("one", "o", 5, 50), lay: 1 }];
    const all = convertAgainstExchange(items, 30, options);
    expect(all.steps.map((s) => s.id)).not.toContain("nan");
    expect(all.steps.map((s) => s.id)).not.toContain("none");
    expect(all.steps.map((s) => s.id)).not.toContain("one");
    expect(all.ignored).toBe(3);
    const noThin = convertAgainstExchange(items, 30, { ...options, minLaySize: 2 });
    expect(noThin.steps.map((s) => s.id)).not.toContain("thin");
    const noPoor = convertAgainstExchange(items, 30, { ...options, minRate: 0.6 });
    expect(noPoor.steps.map((s) => s.id)).not.toContain("poor");
    expect(noPoor.steps.every((s) => s.rate >= 0.6)).toBe(true);
  });

  it("gives the same chain whatever the order the outcomes come in", () => {
    const r = rng(3);
    const items = Array.from({ length: 12 }, (_, i) => item(`i${i}`, `m${i % 8}`, r.range(2.5, 9), r.range(2, 80)));
    const reference = convertAgainstExchange(items, 60, options);
    for (let t = 0; t < 10; t++) {
      const shuffled = [...items].sort(() => r.next() - 0.5);
      const res = convertAgainstExchange(shuffled, 60, options);
      expect(res.steps.map((s) => s.id)).toEqual(reference.steps.map((s) => s.id));
      expect(res.cash).toBeCloseTo(reference.cash, 12);
    }
  });

  it("has nothing to convert with no outcome, no freebets, or none that can be", () => {
    expect(convertAgainstExchange([], 30, options)).toMatchObject({ steps: [], converted: 0, leftover: 30, cash: 0 });
    expect(convertAgainstExchange([item("a", "a", 5, 50)], 0, options)).toMatchObject({ steps: [], converted: 0, leftover: 0, cash: 0 });
    expect(convertAgainstExchange([item("a", "a", 5, 0)], 30, options).steps).toEqual([]);
  });

  it("refuses a commission that is not a fraction, a chain that is not 1 to 3 conversions, freebets that are not a number", () => {
    const one = [item("a", "a", 5, 50)];
    expect(() => convertAgainstExchange(one, 30, { commission: 1 })).toThrow(RangeError);
    expect(() => convertAgainstExchange(one, 30, { commission: -0.1 })).toThrow(RangeError);
    expect(() => convertAgainstExchange(one, 30, { ...options, maxConversions: 0 })).toThrow(RangeError);
    expect(() => convertAgainstExchange(one, 30, { ...options, maxConversions: 4 })).toThrow(RangeError);
    expect(() => convertAgainstExchange(one, Number.NaN, options)).toThrow(RangeError);
  });
});

// --- exactness ---------------------------------------------------------------------------------------------------

// Every set of at most `slots` outcomes of distinct matches, the FB shared among them by the simplex (maximise the
// cash with the wallet and each outcome's capacity as the limits): the best of them. It shares nothing with the
// engine's search or its filling, so it is a second opinion.
function bestBySubsets(items: readonly ExchangeItem[], fb: number, slots: number): number {
  let best = 0;
  const chosen: number[] = [];
  const evaluate = () => {
    const s = chosen.length;
    const rates = chosen.map((i) => exchangeRate(items[i].back, items[i].lay, K));
    const caps = chosen.map((i) => exchangeCapacity(items[i].back, items[i].lay, items[i].laySize, K));
    const A = new Float64Array((s + 1) * s);
    for (let j = 0; j < s; j++) A[j] = 1;
    for (let i = 0; i < s; i++) A[(i + 1) * s + i] = 1;
    best = Math.max(best, maximize(s, s + 1, rates, A, [fb, ...caps]).value);
  };
  const visit = (from: number) => {
    if (chosen.length > 0) evaluate();
    if (chosen.length === slots) return;
    for (let i = from; i < items.length; i++) {
      if (chosen.some((c) => items[c].matchId === items[i].matchId)) continue;
      chosen.push(i);
      visit(i + 1);
      chosen.pop();
    }
  };
  visit(0);
  return best;
}

function randomItems(r: Rng, n: number, paired: boolean): ExchangeItem[] {
  return Array.from({ length: n }, (_, i) => {
    const back = r.range(2.2, 9);
    return { id: `i${i}`, matchId: `m${paired ? Math.floor(i / 2) : i}`, back, lay: back * r.range(0.98, 1.05), laySize: r.next() < 0.5 ? r.range(0.5, 8) : r.range(8, 120) };
  });
}

describe("convertAgainstExchange, the best chain", () => {
  it("is the best one there is: 200 random markets checked against every set of outcomes, shared out by the simplex", () => {
    const r = rng(4);
    let beatsGreedy = 0;
    for (let t = 0; t < 200; t++) {
      const items = randomItems(r, r.int(3, 9), t % 2 === 1);
      const fb = Math.round(r.range(10, 150));
      const slots = [3, 3, 2, 1][t % 4];
      const res = convertAgainstExchange(items, fb, { ...options, maxConversions: slots });
      const best = bestBySubsets(items, fb, slots);
      expect(Math.abs(res.cash - best) / Math.max(1, best)).toBeLessThan(1e-9);
      // The chain of the best rates, to see how often the choice matters.
      const byRate = items
        .filter((_, i, all) => all.findIndex((o) => o.matchId === all[i].matchId && exchangeRate(o.back, o.lay, K) >= exchangeRate(all[i].back, all[i].lay, K)) === i)
        .sort((x, y) => exchangeRate(y.back, y.lay, K) - exchangeRate(x.back, x.lay, K))
        .slice(0, slots);
      let left = fb;
      let greedy = 0;
      for (const it of byRate) {
        const take = Math.min(exchangeCapacity(it.back, it.lay, it.laySize, K), left);
        greedy += take * exchangeRate(it.back, it.lay, K);
        left -= take;
      }
      if (best > greedy + 1e-6) beatsGreedy++;
    }
    // The best chain is not the best rates in a good share of them, or this would prove little.
    expect(beatsGreedy).toBeGreaterThan(10);
  });

  it("is the best one there is: 40 markets whose best chain scipy found by integer programming (HiGHS)", () => {
    // tests/freebets/engine/fixtures/exchange-oracle.json: outcomes with their prices and liquidity, a wallet, and the
    // best cash of at most 3 outcomes, one per match, found by scipy.optimize.milp with no optimality gap.
    const fixtures = JSON.parse(readFileSync(join(__dirname, "fixtures/exchange-oracle.json"), "utf8")) as Array<{ items: ExchangeItem[]; fb: number; cash: number }>;
    expect(fixtures).toHaveLength(40);
    for (const f of fixtures) {
      const res = convertAgainstExchange(f.items, f.fb, options);
      expect(Math.abs(res.cash - f.cash) / Math.max(1, f.cash)).toBeLessThan(1e-9);
      expect(new Set(res.steps.map((s) => s.matchId)).size).toBe(res.steps.length);
    }
  });

  it("is found in a short time among thousands of outcomes, even when each has hardly any liquidity", () => {
    const r = rng(5);
    const realistic = convertAgainstExchange(randomItems(r, 2000, false), 100, options);
    expect(realistic.nodes).toBeLessThan(5000);
    const slivers: ExchangeItem[] = Array.from({ length: 1500 }, (_, i) => {
      const back = r.range(3, 12);
      return { id: `s${i}`, matchId: `m${i}`, back, lay: back, laySize: r.range(0.2, 0.8) };
    });
    const thin = convertAgainstExchange(slivers, 100, options);
    // Without the first chain to beat, 26,000 branches.
    expect(thin.nodes).toBeLessThan(1000);
    expect(thin.steps).toHaveLength(3);
    expect(thin.leftover).toBeGreaterThan(90);
  });
});
