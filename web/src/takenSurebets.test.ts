import { describe, it, expect } from "vitest";
import { hasExchangeLeg, profitLabel, readTaken, surebetKey, takenLabel } from "./takenSurebets";
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
    const a = { key: "a", remind: true, eventId: "e1", startTime: "2026-11-01T18:00:00.000Z", label: "A - B, Ergebnis: …", remindedAt: "2026-11-01T17:00:00.000Z" };
    expect(readTaken({ taken: [a, { key: "b", remind: false }, { remind: true }] })).toEqual(
      new Map([
        ["a", { remind: true, eventId: "e1", startTime: a.startTime, label: a.label, remindedAt: a.remindedAt, payoutRate: null }],
        ["b", { remind: false, eventId: "", startTime: "", label: "", remindedAt: null, payoutRate: null }],
      ])
    );
    expect(readTaken({ taken: [{ key: "c", payoutRate: 1.024 }] }).get("c")?.payoutRate).toBe(1.024);
    expect(readTaken(null).size).toBe(0);
    expect(readTaken({ taken: "a" }).size).toBe(0);
  });

  it("says what a taken surebet was worth, in German numbers", () => {
    expect(profitLabel(1.024)).toBe("+2,4\u00a0% · 2,40 € auf 100 €");
  });
});
