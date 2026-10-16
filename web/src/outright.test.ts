import { describe, it, expect } from "vitest";
import { isOutright, outrightRows } from "./outright";
import type { EventWithOdds } from "./types";

const at = "2026-09-20T10:00:00.000Z";
const event = (byBookmaker: EventWithOdds["byBookmaker"]): EventWithOdds => ({
  id: "e",
  sport: "formule 1",
  competition: "",
  startTime: at,
  participants: ["GP de Bahreïn"],
  byBookmaker,
});
const race = event({
  merkurbets: { scrapedAt: at, odds: [{ market: "Vainqueur", selection: "Russell", price: 4.5 }] },
  leovegas: {
    scrapedAt: at,
    odds: [
      { market: "Vainqueur", selection: "Russell", price: 4.25 },
      { market: "Vainqueur", selection: "Antonelli", price: 2.25 },
    ],
  },
});

describe("isOutright", () => {
  it("tells a winner-among-N market from a match", () => {
    expect(isOutright(race)).toBe(true);
    expect(isOutright(event({ leovegas: { scrapedAt: at, odds: [{ market: "1X2", selection: "1", price: 2 }] } }))).toBe(false);
  });
});

describe("outrightRows", () => {
  it("gives one row per competitor, favourite first, with each bookmaker's price and the best one", () => {
    expect(outrightRows(race, ["leovegas", "merkurbets"])).toEqual([
      { competitor: "Antonelli", prices: { leovegas: 2.25 }, best: 2.25 },
      { competitor: "Russell", prices: { leovegas: 4.25, merkurbets: 4.5 }, best: 4.5 },
    ]);
  });

  it("leaves out the unticked bookmakers and the competitors only they price", () => {
    expect(outrightRows(race, ["merkurbets"])).toEqual([{ competitor: "Russell", prices: { merkurbets: 4.5 }, best: 4.5 }]);
    expect(outrightRows(race, [])).toEqual([]);
  });
});
