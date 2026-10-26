import { describe, it, expect } from "vitest";
import { hasExchangeLeg, readTaken, surebetKey, takenLabel } from "./takenSurebets";
import type { Surebet } from "./types";

const lay: Surebet = {
  eventId: "gala-fener",
  sport: "football",
  competition: "Süper Lig",
  startTime: "2099-01-01T18:30:00.000Z",
  participants: ["Galatasaray", "Fenerbahçe"],
  marketCount: 50,
  market: "1X2",
  marketLabel: "Ergebnis",
  kind: "lay",
  payoutRate: 1.02,
  profit: 2,
  toVerify: false,
  thin: false,
  legs: [
    { selection: "2", label: "Fenerbahçe", source: "twentybet", side: "back", price: 3.32, stake: 50 },
    { selection: "2", label: "Fenerbahçe", source: "exchange", side: "lay", price: 3.2, stake: 52, liability: 114.4 },
  ],
};

describe("the taken surebets", () => {
  it("names a surebet by its match, market and legs, not their prices", () => {
    expect(surebetKey(lay)).toBe("gala-fener:1X2:2@twentybet:back|2@exchange:lay");
    const moved = { ...lay, legs: lay.legs.map((l) => ({ ...l, price: l.price + 0.1 })) };
    expect(surebetKey(moved)).toBe(surebetKey(lay));
  });

  it("says what the surebet was, for the reminder", () => {
    expect(takenLabel(lay)).toBe("Galatasaray - Fenerbahçe, Ergebnis: Fenerbahçe @ 20bet 3,32 / Lay Fenerbahçe @ Börse 3,20");
  });

  it("knows a surebet with a bet at the exchange", () => {
    expect(hasExchangeLeg(lay)).toBe(true);
    expect(hasExchangeLeg({ ...lay, legs: [lay.legs[0]] })).toBe(false);
  });

  it("reads the server's list, and nothing from an answer it doesn't know", () => {
    expect(readTaken({ taken: [{ key: "a", remind: true }, { key: "b", remind: false }, { remind: true }] })).toEqual(
      new Map([
        ["a", { remind: true }],
        ["b", { remind: false }],
      ])
    );
    expect(readTaken(null).size).toBe(0);
    expect(readTaken({ taken: "a" }).size).toBe(0);
  });
});
