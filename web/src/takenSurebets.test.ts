import { describe, it, expect } from "vitest";
import { closingLabel, closingSummaryLabel, closingValue, lockedLabel, hasExchangeLeg, profitLabel, readTaken, summaryLabel, surebetKey, takenLabel, takenLegs } from "./takenSurebets";
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

  it("sums up the taken surebets: how many, their average payout and the profit expected", () => {
    expect(summaryLabel([{ payoutRate: 1.02 }, { payoutRate: 1.03 }, { payoutRate: null }])).toBe(
      "3 Surebets · Ø +2,5\u00a0% · 5,00 € erwartet bei 100 € je Surebet"
    );
    expect(summaryLabel([{ payoutRate: null }])).toBe("1 Surebet");
  });
});

describe("closing prices", () => {
  it("keeps a surebet's legs as taken, with its market", () => {
    expect(takenLegs(lay)[0]).toEqual({ market: "1X2", selection: "2", source: "twentybet", side: "back", price: 3.32 });
  });

  it("says a back's closing price and how far it was taken above it, or below", () => {
    const leg = { market: "1X2", selection: "2", source: "twentybet", side: "back" as const, price: 3.32 };
    expect(closingLabel({ ...leg, closing: 3 })).toMatch(/^Schlusskurs bei 20bet 3,00 \(\+10,7.%\)$/);
    expect(closingLabel({ ...leg, closing: 3.5 })).toMatch(/^Schlusskurs bei 20bet 3,50 \(−5,1.%\)$/);
    expect(closingLabel({ ...leg, closing: null })).toBeNull();
    expect(closingLabel(leg)).toBeNull();
  });

  it("reads the legs and their closing prices from the server", () => {
    const read = readTaken({ taken: [{ key: "k", legs: [{ market: "1X2", selection: "2", source: "twentybet", side: "back", price: 3.32, closing: 3.2 }, { side: "back" }] }] });
    expect(read.get("k")?.legs).toEqual([{ market: "1X2", selection: "2", source: "twentybet", side: "back", price: 3.32, closing: 3.2 }]);
    expect(readTaken({ taken: [{ key: "old" }] }).get("old")).not.toHaveProperty("legs");
  });
});

describe("closing line value", () => {
  const back = { market: "1X2", selection: "1", source: "twentybet", side: "back" as const, price: 2.2, closing: 2 };
  const lay = { market: "1X2", selection: "2", source: "exchange", side: "lay" as const, price: 3.2, closing: 3.52 };

  it("is a back taken above its close, a lay taken below it", () => {
    expect(closingValue(back)).toBeCloseTo(0.1);
    expect(closingValue(lay)).toBeCloseTo(0.1);
    expect(closingValue({ ...lay, closing: 2.88 })).toBeCloseTo(-0.1);
    expect(closingValue({ ...back, closing: null })).toBeNull();
    expect(closingLabel(lay)).toMatch(/^Schlusskurs Lay an der Börse 3,52 \(\+10,0.%\)$/);
  });

  it("is averaged over every leg with a closing price", () => {
    expect(closingSummaryLabel([{ legs: [back, { ...lay, closing: 2.88 }] }, { legs: [{ ...back, closing: null }] }, {}])).toMatch(
      /^Ø \+0,0.% gegenüber dem Schlusskurs \(2 Wetten\)$/
    );
    expect(closingSummaryLabel([{ legs: [back] }])).toMatch(/^Ø \+10,0.% gegenüber dem Schlusskurs \(1 Wette\)$/);
    expect(closingSummaryLabel([{ legs: [{ ...back, closing: null }] }, {}])).toBeNull();
  });
});

describe("lockedLabel", () => {
  const back = (source: string, price: number) => ({ market: "1X2", selection: source, source, side: "back" as const, price });

  it("is the least any back winning pays, less all that was staked", () => {
    const legs = [back("twentybet", 2.1), back("leovegas", 2.05)];
    expect(lockedLabel(legs, [50, 52])).toBe("Gesichert: +3,00 € bei 102,00 € Einsatz");
    expect(lockedLabel(legs, [60, 40])).toBe("Möglicher Verlust: −18,00 € bei 100,00 € Einsatz");
  });

  it("says nothing until every stake is written down, nor with a lay", () => {
    expect(lockedLabel([back("twentybet", 2.1), back("leovegas", 2.05)], [50, null])).toBeNull();
    expect(lockedLabel([back("twentybet", 2.1), { ...back("exchange", 2.2), side: "lay" as const }], [50, 50])).toBeNull();
    expect(lockedLabel(undefined, [50])).toBeNull();
  });
});
