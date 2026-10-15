import { describe, it, expect } from "vitest";
import { getBestBookmakers } from "./bestOdds";
import type { EventWithOdds } from "./types";

const event: EventWithOdds = {
  id: "evt1",
  sport: "football",
  competition: "Ligue 1",
  startTime: "2026-09-21T19:00:00.000Z",
  participants: ["PSG", "OM"],
  byBookmaker: {
    winamax: { scrapedAt: "2026-09-20T10:00:00.000Z", odds: [{ market: "1X2", selection: "1", price: 1.5 }] },
    betclic: { scrapedAt: "2026-09-20T10:00:00.000Z", odds: [{ market: "1X2", selection: "1", price: 1.65 }] },
  },
};

describe("getBestBookmakers", () => {
  it("returns the bookmaker with the highest price for the given market/selection", () => {
    expect(getBestBookmakers(event, "1X2", "1")).toEqual(["betclic"]);
  });

  it("returns every bookmaker offering that highest price", () => {
    const tie: EventWithOdds = {
      ...event,
      byBookmaker: {
        winamax: { scrapedAt: "2026-09-20T10:00:00.000Z", odds: [{ market: "1X2", selection: "1", price: 1.65 }] },
        betclic: { scrapedAt: "2026-09-20T10:00:00.000Z", odds: [{ market: "1X2", selection: "1", price: 1.65 }] },
      },
    };
    expect(getBestBookmakers(tie, "1X2", "1")).toEqual(["winamax", "betclic"]);
  });

  it("returns nobody when no bookmaker offers that market/selection", () => {
    expect(getBestBookmakers(event, "over_under_2.5", "over")).toEqual([]);
  });

  it("only considers bookmakers in the given filter list", () => {
    // betclic has the higher price (1.65) but is excluded from the filter,
    // so the only remaining candidate, winamax, must win by default.
    expect(getBestBookmakers(event, "1X2", "1", ["winamax"])).toEqual(["winamax"]);
  });

  it("returns null when the filter list excludes every bookmaker offering it", () => {
    expect(getBestBookmakers(event, "1X2", "1", [])).toEqual([]);
  });
});
