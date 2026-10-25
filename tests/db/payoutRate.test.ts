import { describe, it, expect } from "vitest";
import { payoutRate } from "../../src/db/payoutRate";
import { EventWithOdds, RawOdds } from "../../src/types";

const at = "2026-09-20T10:00:00.000Z";
const odds = (market: string, prices: Record<string, number>): RawOdds[] =>
  Object.entries(prices).map(([selection, price]) => ({ market, selection, price }));

function event(byBookmaker: Record<string, RawOdds[]>): EventWithOdds {
  return {
    id: "evt",
    sport: "football",
    competition: "",
    startTime: at,
    participants: ["PSG", "OM"],
    byBookmaker: Object.fromEntries(Object.entries(byBookmaker).map(([bk, o]) => [bk, { scrapedAt: at, odds: o }])),
  };
}

const football = event({
  betclic: odds("1X2", { "1": 1.65, X: 3.1, "2": 4.8 }),
  winamax: odds("1X2", { "1": 1.5, X: 3.2, "2": 5.0 }),
});

describe("payoutRate", () => {
  it("combines the best price of each outcome across bookmakers", () => {
    expect(payoutRate(football)).toBeCloseTo(1 / (1 / 1.65 + 1 / 3.2 + 1 / 5.0), 10);
  });

  it("only uses the given bookmakers' prices", () => {
    const three = event({ ...Object.fromEntries(Object.entries(football.byBookmaker).map(([bk, b]) => [bk, b.odds])), unibet: odds("1X2", { "1": 1.7, X: 3.0, "2": 4.0 }) });
    expect(payoutRate(three, ["unibet", "winamax"])).toBeCloseTo(1 / (1 / 1.7 + 1 / 3.2 + 1 / 5.0), 10);
  });

  it("uses the two outcomes of a match without a draw", () => {
    const tennis = event({ winamax: odds("Vainqueur du match", { "1": 2.0, "2": 2.0 }), betclic: odds("Vainqueur du match", { "1": 1.9, "2": 2.1 }) });
    expect(payoutRate(tennis)).toBeCloseTo(1 / (1 / 2.0 + 1 / 2.1), 10);
  });

  // The owner, 25/10/2026: every outcome of a match can't be bet at one
  // bookmaker, so its TRJ alone is no bet.
  it("combines two sites at least: one with every best price gives up the outcome another costs the least on", () => {
    const one = event({
      twentybet: odds("1X2", { "1": 2.83, X: 3.24, "2": 2.69 }),
      neobet: odds("1X2", { "1": 2.66, X: 3.13, "2": 2.52 }),
    });
    // Each other site's price costs 1/2.66 - 1/2.83, 1/3.13 - 1/3.24, 1/2.52 - 1/2.69: the draw's the least.
    expect(payoutRate(one)).toBeCloseTo(1 / (1 / 2.83 + 1 / 3.13 + 1 / 2.69), 10);
    // A single site prices the match: no TRJ.
    expect(payoutRate(one, ["twentybet"])).toBeNull();
    expect(payoutRate(event({ winamax: odds("1X2", { "1": 2, X: 3, "2": 4 }) }))).toBeNull();
  });

  it("is null when an outcome has no price among the given bookmakers", () => {
    const noDrawAtWinamax = event({
      betclic: odds("1X2", { "1": 1.65, X: 3.1, "2": 4.8 }),
      winamax: odds("1X2", { "1": 1.5, "2": 5.0 }),
    });
    expect(payoutRate(noDrawAtWinamax, ["winamax"])).toBeNull();
    expect(payoutRate(football, [])).toBeNull();
    expect(payoutRate(event({}))).toBeNull();
  });

  it("prices the first bookmaker's market, like the dashboard", () => {
    // Betclic lists the match as 1X2, Winamax as a two-way market: only the
    // 1X2 prices count, so Winamax's can't stand in for them.
    const mixed = event({
      betclic: odds("1X2", { "1": 2.0, X: 4.0, "2": 4.0 }),
      winamax: odds("Vainqueur du match", { "1": 9.0, "2": 9.0 }),
    });
    // Betclic alone prices the 1X2: no two sites, no TRJ.
    expect(payoutRate(mixed)).toBeNull();
  });

  it("prices the market most bookmakers list, though the first bookmaker's is another", () => {
    // Unibet's list gives a basketball match's result in regular time (a 1X2
    // with a draw at 12), where the others give the winner, overtime included.
    const basketball = event({
      unibet: odds("1X2", { "1": 1.77, X: 12, "2": 2.05 }),
      vbet: odds("Vainqueur du match", { "1": 1.6, "2": 1.81 }),
      winamax: odds("Vainqueur du match", { "1": 1.72, "2": 1.98 }),
    });
    // Winamax has both best prices: VBET's 1.60 costs less than its 1.81.
    expect(payoutRate(basketball)).toBeCloseTo(1 / (1 / 1.6 + 1 / 1.98), 10);
    expect(payoutRate(basketball, ["vbet"])).toBeNull();
  });

  describe("winner-among-N markets", () => {
    const race = (byBookmaker: Record<string, Record<string, number>>): EventWithOdds => ({
      ...event(Object.fromEntries(Object.entries(byBookmaker).map(([bk, prices]) => [bk, odds("Vainqueur", prices)]))),
      sport: "formule 1",
      participants: ["GP de Bahreïn"],
    });
    // A whole field (implied probabilities 0.5 + 0.25 + 0.2 + 0.1 = 1.05),
    // and Betclic's 3-favourite listing (0.4 + 0.2 + 0.15 = 0.75).
    const winamax = { Antonelli: 2, Russell: 4, Verstappen: 5, Norris: 10 };
    const betclic = { Antonelli: 2.5, Russell: 5, Verstappen: 6.5 };

    it("takes each competitor's best price over the whole field", () => {
      expect(payoutRate(race({ betclic, winamax }))).toBeCloseTo(1 / (1 / 2.5 + 1 / 5 + 1 / 6.5 + 1 / 10), 10);
      expect(payoutRate(race({ winamax }))).toBeCloseTo(1 / 1.05, 10);
    });

    it("is null when no bookmaker lists the whole field, not a rate over 3 favourites", () => {
      expect(payoutRate(race({ betclic }))).toBeNull();
      expect(payoutRate(race({ betclic, winamax }), ["betclic"])).toBeNull();
    });
  });
});
