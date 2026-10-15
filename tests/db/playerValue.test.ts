import { describe, it, expect } from "vitest";
import { PLAYER_VALUE_MIN_EDGE, playerSignals, SUSPECT_MIN_GAP } from "../../src/db/playerValue";

const prices = (byBookmaker: Record<string, Record<string, number>>) =>
  new Map(Object.entries(byBookmaker).map(([b, players]) => [b, new Map(Object.entries(players))]));

describe("playerSignals", () => {
  it("shows value bets from 5% and suspect prices from 30%", () => {
    expect(PLAYER_VALUE_MIN_EDGE).toBe(0.05);
    expect(SUSPECT_MIN_GAP).toBe(0.3);
  });

  it("weighs a price against the fair odds first, the lay only without them", () => {
    const exchange = new Map([
      ["A", { fair: 2, lay: 2.2 }],
      ["B", { lay: 2.2 }],
    ]);
    const signals = playerSignals(exchange, prices({ winamax: { A: 2.15, B: 2.31 } }));
    // A: 7.5% above its fair odds (under its lay); B: 5% above its lay.
    expect(signals).toEqual([
      { player: "A", bookmaker: "winamax", price: 2.15, basis: "fair", reference: 2, edge: expect.closeTo(0.075, 10) },
      { player: "B", bookmaker: "winamax", price: 2.31, basis: "lay", reference: 2.2, edge: expect.closeTo(0.05, 10) },
    ]);
    // Under the thresholds: nothing.
    expect(playerSignals(exchange, prices({ winamax: { A: 2.09, B: 2.3 } }))).toEqual([]);
  });

  it("compares the bookmakers only when the exchange has nothing for the player", () => {
    const signals = playerSignals(
      new Map([["A", { fair: 2 }]]),
      prices({ winamax: { A: 3, C: 4 }, betclic: { A: 2, C: 3 }, unibet: { C: 2.5 } })
    );
    // A has fair odds: Betclic's 2.00 isn't compared to Winamax's 3.00. C:
    // Winamax's 4.00 against the best other, Betclic's 3.00.
    expect(signals).toEqual([
      { player: "A", bookmaker: "winamax", price: 3, basis: "fair", reference: 2, edge: expect.closeTo(0.5, 10) },
      {
        player: "C",
        bookmaker: "winamax",
        price: 4,
        basis: "bookmaker",
        reference: 3,
        referenceBookmaker: "betclic",
        edge: expect.closeTo(1 / 3, 10),
      },
    ]);
    // A player priced by one bookmaker alone: nothing to compare.
    expect(playerSignals(new Map(), prices({ winamax: { D: 50 } }))).toEqual([]);
  });

  it("counts at other thresholds when asked", () => {
    const signals = playerSignals(new Map([["A", { fair: 2 }]]), prices({ winamax: { A: 2.03 } }), { fair: 0.01, lay: 0.01, bookmaker: 0.1 });
    expect(signals.map((s) => s.basis)).toEqual(["fair"]);
  });
});
