import { describe, expect, it } from "vitest";
import { closingValue, expectedLabel, monthValueLabel, readTakenValueBets, readValueBetResults, stakesSummaryLabel, valueBetKey, valueBetLabel, valueSummaryLabel, type TakenValueBet } from "./takenValueBets";
import type { ValueBet } from "./types";

const BET = {
  eventId: "gala-fener",
  sport: "football",
  competition: "Süper Lig",
  startTime: "2026-11-04T19:45:00Z",
  participants: ["Galatasaray", "Fenerbahçe"],
  marketCount: 12,
  market: "1X2",
  marketLabel: "Ergebnis",
  selection: "2",
  label: "Fenerbahçe",
  bookmaker: "twentybet",
  price: 3.5,
  basis: "fair",
  fair: 3.35,
  edge: 0.045,
  matched: 5000,
} as ValueBet;

const taken = (over: Partial<TakenValueBet>): TakenValueBet => ({
  eventId: "e",
  startTime: "2026-11-04T19:45:00Z",
  label: "A - B, Ergebnis: A",
  market: "1X2",
  selection: "1",
  bookmaker: "twentybet",
  price: 3.5,
  edge: 0.04,
  ...over,
});

describe("takenValueBets", () => {
  it("names a value bet by its match, market, outcome and bookmaker, not its price", () => {
    expect(valueBetKey(BET)).toBe("gala-fener:1X2:2:twentybet");
    expect(valueBetKey({ ...BET, price: 3.6 })).toBe(valueBetKey(BET));
    expect(valueBetLabel(BET)).toBe("Galatasaray - Fenerbahçe, Ergebnis: Fenerbahçe");
  });

  it("reads the server's list, its closing price once there", () => {
    const read = readTakenValueBets({ taken: [{ key: "k", ...taken({}), closing: 3.3 }, { key: "bad" }, { key: "x", ...taken({}), closing: null }] });
    expect([...read.keys()]).toEqual(["k", "x"]);
    expect(read.get("k")?.closing).toBe(3.3);
    expect(read.get("x")?.closing).toBeNull();
    expect(readTakenValueBets(null).size).toBe(0);
  });

  it("measures the price taken against the closing price", () => {
    expect(closingValue(taken({ price: 3.5, closing: 3.3 }))).toBeCloseTo(3.5 / 3.3 - 1);
    expect(closingValue(taken({ closing: null }))).toBeNull();
    expect(closingValue(taken({}))).toBeNull();
  });

  it("sums up the average edge and closing line value", () => {
    expect(valueSummaryLabel([taken({ edge: 0.04, price: 3.3, closing: 3 }), taken({ edge: 0.06 })])).toMatch(
      /^2 Value Bets · Ø Vorteil \+5,0.% · Ø \+10,0.% gegenüber dem Schlusskurs \(1\)$/
    );
    expect(valueSummaryLabel([taken({ edge: 0.021 })])).toMatch(/^1 Value Bet · Ø Vorteil \+2,1.%$/);
  });

  it("reads a stake, and weighs the averages by the stakes once each has one", () => {
    expect(readTakenValueBets({ taken: [{ key: "k", ...taken({}), stake: 20 }] }).get("k")?.stake).toBe(20);
    const list = [taken({ edge: 0.02, stake: 300, price: 3.3, closing: 3 }), taken({ edge: 0.08, stake: 100, price: 2, closing: 2 })];
    // Edge: (0,02 × 300 + 0,08 × 100) / 400 = 3,5 %; CLV: (10 % × 300 + 0) / 400 = 7,5 %.
    expect(valueSummaryLabel(list)).toMatch(/^2 Value Bets · Ø Vorteil \+3,5.% · Ø \+7,5.% gegenüber dem Schlusskurs \(2\)$/);
  });

  it("says what the stakes are expected to win at the edge taken", () => {
    expect(expectedLabel(taken({ stake: 20, edge: 0.045 }))).toBe("erwartet +0,90 €");
    expect(expectedLabel(taken({}))).toBeNull();
    expect(stakesSummaryLabel([taken({ stake: 20, edge: 0.045 }), taken({ stake: 130, edge: 0.04 }), taken({})])).toBe("Einsatz 150,00 € · erwartet +6,10 €");
    expect(stakesSummaryLabel([taken({})])).toBeNull();
  });

  it("adds the played value bets still held this month to the server's results", () => {
    const now = new Date("2026-11-04T21:00:00Z");
    const results = { month: "2026-11", count: 2, staked: 100, expected: 3, clvSum: 4, clvStake: 100 };
    const held = [
      // Played this month: 100 € at +4 %, closing 3,00 against 3,30 taken (+10 %).
      taken({ startTime: "2026-11-04T19:45:00Z", stake: 100, edge: 0.04, price: 3.3, closing: 3 }),
      // Not played yet, without a stake, of October: left out.
      taken({ startTime: "2026-11-05T19:45:00Z", stake: 50 }),
      taken({ startTime: "2026-11-04T19:45:00Z" }),
      taken({ startTime: "2026-10-31T19:45:00Z", stake: 50 }),
    ];
    // Clv: (4 + 100 × 10 %) / 200 = 7 %.
    expect(monthValueLabel(results, held, now)).toMatch(/^November: 3 Value Bets · 200,00 € Einsatz · erwartet \+7,00 € · Ø \+7,0.% gegenüber dem Schlusskurs$/);
    expect(monthValueLabel({ ...results, month: "2026-10" }, [], now)).toBeNull();
    expect(monthValueLabel(null, [taken({ startTime: "2026-11-04T19:45:00Z", stake: 20, edge: 0.05 })], now)).toBe("November: 1 Value Bet · 20,00 € Einsatz · erwartet +1,00 €");
  });

  it("reads the server's results, and none that are not", () => {
    const results = { month: "2026-11", count: 1, staked: 20, expected: 1, clvSum: 0, clvStake: 0 };
    expect(readValueBetResults({ results })).toEqual(results);
    expect(readValueBetResults({ results: { ...results, staked: "20" } })).toBeNull();
    expect(readValueBetResults({ taken: [] })).toBeNull();
  });
});
