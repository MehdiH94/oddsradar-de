import { describe, expect, it } from "vitest";
import { FreebetMarket } from "../../src/db/freebets";
import { chainView, eligibleSports, engineMatches, exchangeItems, freebetsByIndex, holdingBookmakers, parseRequest } from "../../src/freebets/conversions";
import { convertAgainstExchange } from "../../src/freebets/engine/exchange";

function market(eventId: string, sport: string, prices: FreebetMarket["prices"], exchange: FreebetMarket["exchange"] = {}, outcomes: readonly string[] = ["1", "X", "2"]): FreebetMarket {
  return {
    eventId,
    sport,
    competition: "L1",
    startTime: "2026-10-17T19:00:00.000Z",
    participants: ["Home", "Away"],
    market: outcomes.length === 3 ? "1X2" : "Vainqueur du match",
    outcomes,
    prices,
    scrapedAt: Object.fromEntries(Object.keys(prices).map((id) => [id, "2026-10-14T07:00:00.000Z"])),
    exchange,
  };
}

describe("parseRequest", () => {
  it("reads a mode, the size of the combo and the sports", () => {
    expect(parseRequest({ mode: "bookmakers" })).toEqual({ mode: "bookmakers", legs: 1 });
    expect(parseRequest({ mode: "bookmakers", legs: "3", sports: "tennis,football,football" })).toEqual({ mode: "bookmakers", legs: 3, sports: ["football", "tennis"] });
    expect(parseRequest({ mode: "exchange", bookmaker: "merkurbets", sports: "football" })).toEqual({ mode: "exchange", bookmaker: "merkurbets", sports: ["football"] });
  });

  it("takes a sports list that is present and empty for no sport, and an absent one for every sport", () => {
    expect(parseRequest({ mode: "bookmakers", sports: "" })).toEqual({ mode: "bookmakers", legs: 1, sports: [] });
    expect(parseRequest({ mode: "bookmakers" })).not.toHaveProperty("sports");
  });

  it.each([
    [{}, "mode"],
    [{ mode: "both" }, "mode"],
    [{ mode: ["bookmakers"] }, "mode"],
    [{ mode: "bookmakers", legs: "4" }, "accumulator"],
    [{ mode: "bookmakers", legs: "0" }, "accumulator"],
    [{ mode: "bookmakers", legs: "1.5" }, "accumulator"],
    [{ mode: "bookmakers", legs: "x" }, "accumulator"],
    [{ mode: "exchange" }, "bookmaker"],
    [{ mode: "exchange", bookmaker: "nobody" }, "bookmaker"],
    [{ mode: "exchange", bookmaker: "constructor" }, "bookmaker"],
    [{ mode: "bookmakers", sports: ["a", "b"] }, "sports"],
    [{ mode: "bookmakers", sports: "x".repeat(41) }, "sports"],
    [{ mode: "bookmakers", sports: Array.from({ length: 31 }, (_, i) => `s${i}`).join(",") }, "sports"],
  ])("refuses %j", (query, word) => {
    expect(parseRequest(query)).toEqual({ error: expect.stringContaining(word) });
  });
});

describe("what is asked of the engine", () => {
  const wallet = { leovegas: 20, merkurbets: 15.5 };

  it("puts the freebets by the site's order of bookmakers, 0 where there are none", () => {
    expect(freebetsByIndex(wallet)).toEqual([20, 15.5, 0]);
    expect(freebetsByIndex({ merkurbets: 15.5 })).toEqual([0, 15.5, 0]);
    expect(holdingBookmakers(wallet)).toEqual(["leovegas", "merkurbets"]);
    expect(holdingBookmakers({})).toEqual([]);
  });

  it("gives the engine the prices of the bookmakers that hold freebets only, and the matches two of them price", () => {
    const markets = [
      market("both", "football", { leovegas: [2, 3, 4], merkurbets: [2.2, 3, 4] }),
      market("one", "football", { leovegas: [2, 3, 4] }),
      market("tennis", "tennis", { leovegas: [1.8, 2.1], merkurbets: [1.7, 2.2] }, {}, ["1", "2"]),
    ];
    const matches = engineMatches(markets, freebetsByIndex(wallet));
    expect(matches.map((m) => [m.id, m.outcomes])).toEqual([["both", 3], ["tennis", 2]]);
    // 20bet holding none, its prices are left out.
    expect(matches[0].odds).toEqual([[2, 3, 4], [2.2, 3, 4], null]);
    // Merkur Bets holding no freebets, its prices never reach the engine: no match
    // is priced by two holders then.
    expect(engineMatches(markets, freebetsByIndex({ leovegas: 20 }))).toEqual([]);
  });

  it("makes an item of each outcome the bookmaker prices and the exchange lays", () => {
    const items = exchangeItems(
      [
        market("a", "football", { merkurbets: [2, 3.5, 4.6] }, { X: { lay: 3.6, laySize: 40 }, "2": { lay: 4.7, laySize: 11 } }),
        market("b", "football", { leovegas: [2, 3, 4] }, { "1": { lay: 2.1, laySize: 50 } }),
        market("c", "football", { merkurbets: [2, 3, 4] }, {}),
      ],
      "merkurbets"
    );
    expect(items).toEqual([
      { id: "a|X", matchId: "a", back: 3.5, lay: 3.6, laySize: 40 },
      { id: "a|2", matchId: "a", back: 4.6, lay: 4.7, laySize: 11 },
    ]);
  });
});

describe("eligibleSports", () => {
  const markets = [
    market("f", "football", { leovegas: [2, 3, 4], merkurbets: [2, 3, 4] }, { X: { lay: 3.1, laySize: 40 } }),
    market("t", "tennis", { leovegas: [1.8, 2.1] }, {}, ["1", "2"]),
    market("b", "basketball", { leovegas: [1.8, 2.1] }, { "1": { lay: 1.9, laySize: 30 } }, ["1", "2"]),
  ];

  it("between bookmakers, the sports two of the bookmakers holding freebets price", () => {
    expect(eligibleSports(markets, { mode: "bookmakers", legs: 1 }, ["leovegas", "merkurbets"])).toEqual(["football"]);
    expect(eligibleSports(markets, { mode: "bookmakers", legs: 1 }, ["leovegas"])).toEqual([]);
    // With no freebets yet, the page still shows which sports can be converted.
    expect(eligibleSports(markets, { mode: "bookmakers", legs: 1 }, [])).toEqual(["football"]);
  });

  it("against the exchange, the sports the bookmaker prices and the exchange lays", () => {
    expect(eligibleSports(markets, { mode: "exchange", bookmaker: "leovegas" }, ["leovegas"])).toEqual(["basketball", "football"]);
    expect(eligibleSports(markets, { mode: "exchange", bookmaker: "merkurbets" }, ["merkurbets"])).toEqual(["football"]);
  });
});

describe("chainView", () => {
  // The mock-up's three conversions of 30 FB at Betway: the pick of each match, its price at the bookmaker
  // and its lay on the exchange, with the money offered.
  const rows = [
    { id: "brest|2", matchId: "brest", back: 4.6, lay: 4.65, laySize: 11 },
    { id: "augsburg|X", matchId: "augsburg", back: 3.9, lay: 3.95, laySize: 9 },
    { id: "lille|2", matchId: "lille", back: 3.85, lay: 3.9, laySize: 120 },
  ];
  const markets = new Map(rows.map((r) => [r.matchId, market(r.matchId, "football", { merkurbets: [2, 3, 4] })]));
  const result = convertAgainstExchange(rows, 30, { commission: 0.03 });
  const view = chainView(result, new Map(rows.map((r) => [r.id, r])), markets, "merkurbets", 30);

  it("gives the three conversions of the mock-up, on whole cents", () => {
    expect(view.steps.map((s) => s.label)).toEqual(["Away", "Draw", "Away"]);
    expect(view.steps.map((s) => s.fb)).toEqual([14.12, 12.17, 3.71]);
    expect(view.steps.map((s) => s.layStake)).toEqual([11, 9, 2.73]);
    expect(view.steps.map((s) => s.liability)).toEqual([40.15, 26.55, 7.92]);
    expect(view.steps.map((s) => s.cash)).toEqual([10.67, 8.73, 2.65]);
    expect(view.steps.map((s) => s.limited)).toEqual([true, true, false]);
    expect(view.steps.map((s) => s.rank)).toEqual([1, 2, 3]);
  });

  it("converts the whole wallet and not a cent more, with the totals of its steps", () => {
    expect(view.converted).toBe(30);
    expect(view.leftover).toBe(0);
    expect(view.cash).toBeCloseTo(22.05, 9);
    expect(view.liability).toBeCloseTo(74.62, 9);
  });

  it("leaves the same cash whether the outcome comes out or not, to the cent", () => {
    for (const step of view.steps) {
      expect(step.ifWins.gain).toBeCloseTo(step.fb * (step.back - 1), 2);
      expect(step.ifWins.pays).toBe(step.liability);
      expect(step.ifWins.net).toBeCloseTo(step.ifWins.gain - step.liability, 9);
      expect(Math.abs(step.ifWins.net - step.ifLoses.net)).toBeLessThanOrEqual(0.011);
      expect(step.cash).toBeLessThanOrEqual(Math.min(step.ifWins.net, step.ifLoses.net) + 1e-9);
      // Never more to lay than the exchange offers.
      expect(step.layStake).toBeLessThanOrEqual(step.laySize);
    }
  });

  it("does not convert more than the wallet holds when the steps round up", () => {
    // Three steps of 14.11x, 12.16x and 3.71x round to 14.11 + 12.17 + 3.72 = 30.00 against a wallet of 29.99.
    const small = convertAgainstExchange(rows, 29.99, { commission: 0.03 });
    const rounded = chainView(small, new Map(rows.map((r) => [r.id, r])), markets, "merkurbets", 29.99);
    expect(rounded.converted).toBeLessThanOrEqual(29.99);
    expect(rounded.converted + rounded.leftover).toBeCloseTo(29.99, 9);
    expect(rounded.steps.reduce((sum, step) => sum + step.fb, 0)).toBeCloseTo(rounded.converted, 9);
  });

  it("never lays more than the exchange offers, even when rounding the stake to the cent would", () => {
    // 11.376 euros to lay: the stake that uses all of it, 11.3766 for 14.60 FB, rounds up to 11.38.
    const odd = [{ id: "brest|2", matchId: "brest", back: 4.6, lay: 4.65, laySize: 11.376 }];
    const one = chainView(convertAgainstExchange(odd, 30, { commission: 0.03 }), new Map(odd.map((r) => [r.id, r])), markets, "merkurbets", 30);
    expect(one.steps[0].fb).toBe(14.6);
    expect(one.steps[0].layStake).toBe(11.37);
  });

  it("is empty for no step", () => {
    const none = chainView(convertAgainstExchange([], 10, { commission: 0.03 }), new Map(), new Map(), "merkurbets", 10);
    expect(none).toEqual({ converted: 0, leftover: 10, cash: 0, liability: 0, steps: [] });
  });
});
