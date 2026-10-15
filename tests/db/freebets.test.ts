import { beforeEach, describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { openDb } from "../../src/db/client";
import { upsertCanonicalEvents } from "../../src/db/repository";
import { saveReferenceMarkets, saveReferenceOdds } from "../../src/db/reference";
import { FREEBET_HORIZON_MS, loadFreebetMarkets } from "../../src/db/freebets";
import { CanonicalEvent } from "../../src/types";

const hoursFromNow = (h: number) => new Date(Date.now() + h * 3600e3).toISOString();
const minutesAgo = (m: number) => new Date(Date.now() - m * 60e3).toISOString();
const now = () => new Date().toISOString();

function event(id: string, sport: string, participants: string[], byBookmaker: CanonicalEvent["byBookmaker"], startTime = hoursFromNow(5)): CanonicalEvent {
  return { id, sport, competition: "Ligue 1", startTime, participants, byBookmaker };
}
const main = (market: string, prices: Record<string, number>) => Object.entries(prices).map(([selection, price]) => ({ market, selection, price }));

describe("loadFreebetMarkets", () => {
  let db: DatabaseSync;
  beforeEach(() => {
    db = openDb(":memory:");
  });

  it("lists a 1X2 and a winner with each bookmaker's price on every outcome, soonest first", () => {
    upsertCanonicalEvents(db, [
      event("tennis", "tennis", ["Ada", "Bob"], { winamax: main("Vainqueur du match", { "1": 1.8, "2": 2.1 }), betclic: main("Vainqueur du match", { "1": 1.75, "2": 2.2 }) }, hoursFromNow(30)),
      event("psg", "football", ["PSG", "OM"], { winamax: main("1X2", { "1": 2.3, X: 3.2, "2": 3.5 }), betclic: main("1X2", { "1": 2.25, X: 3.3, "2": 3.4 }) }),
    ]);
    const markets = loadFreebetMarkets(db);
    expect(markets.map((m) => m.eventId)).toEqual(["psg", "tennis"]);
    expect(markets[0]).toMatchObject({
      sport: "football",
      competition: "Ligue 1",
      participants: ["PSG", "OM"],
      market: "1X2",
      outcomes: ["1", "X", "2"],
      prices: { winamax: [2.3, 3.2, 3.5], betclic: [2.25, 3.3, 3.4] },
      exchange: {},
    });
    expect(markets[0].scrapedAt.winamax).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(markets[1]).toMatchObject({ market: "Vainqueur du match", outcomes: ["1", "2"], prices: { winamax: [1.8, 2.1], betclic: [1.75, 2.2] } });
  });

  it("leaves out a match that has started, one beyond the week, and one whose prices are stale", () => {
    const both = (a: number) => ({ winamax: main("1X2", { "1": a, X: 3, "2": 3 }), betclic: main("1X2", { "1": a, X: 3, "2": 3 }) });
    upsertCanonicalEvents(db, [
      event("ok", "football", ["A", "B"], both(2)),
      event("started", "football", ["C", "D"], both(2), hoursFromNow(-1)),
      event("far", "football", ["E", "F"], both(2), new Date(Date.now() + FREEBET_HORIZON_MS + 3600e3).toISOString()),
      event("edge", "football", ["G", "H"], both(2), new Date(Date.now() + FREEBET_HORIZON_MS - 3600e3).toISOString()),
      event("stale", "football", ["I", "J"], both(2)),
    ]);
    db.prepare("UPDATE event_bookmaker_odds SET scraped_at = ? WHERE event_id = 'stale'").run(minutesAgo(60));
    expect(loadFreebetMarkets(db).map((m) => m.eventId)).toEqual(["ok", "edge"]);
    // The listing's own freshness rule: a longer age keeps the stale one.
    expect(loadFreebetMarkets(db, { oddsMaxAgeMs: 2 * 60 * 60 * 1000 }).map((m) => m.eventId)).toContain("stale");
  });

  it("leaves out a race, whose winner is one among many", () => {
    upsertCanonicalEvents(db, [
      event("race", "cycling", ["Tour"], { winamax: main("Vainqueur", { A: 3, B: 4, C: 5 }), betclic: main("Vainqueur", { A: 3.1, B: 4.2, C: 5.5 }) }),
      event("ok", "football", ["A", "B"], { winamax: main("1X2", { "1": 2, X: 3, "2": 3 }), betclic: main("1X2", { "1": 2, X: 3, "2": 3 }) }),
    ]);
    expect(loadFreebetMarkets(db).map((m) => m.eventId)).toEqual(["ok"]);
  });

  it("does not use a bookmaker that does not price every outcome, nor a price of 1 or less", () => {
    upsertCanonicalEvents(db, [
      event("psg", "football", ["PSG", "OM"], {
        winamax: main("1X2", { "1": 2.3, X: 3.2, "2": 3.5 }),
        // Its draw is suspended.
        betclic: main("1X2", { "1": 2.25, "2": 3.4 }),
      }),
      event("ol", "football", ["OL", "OM"], {
        winamax: main("1X2", { "1": 2.3, X: 3.2, "2": 3.5 }),
        betclic: main("1X2", { "1": 1, X: 3.1, "2": 3.6 }),
      }),
    ]);
    for (const market of loadFreebetMarkets(db)) expect(Object.keys(market.prices)).toEqual(["winamax"]);
  });

  it("needs two bookmakers, or one of them and the exchange", () => {
    upsertCanonicalEvents(db, [
      event("one", "football", ["A", "B"], { winamax: main("1X2", { "1": 2, X: 3, "2": 3 }) }),
      event("two", "football", ["C", "D"], { winamax: main("1X2", { "1": 2, X: 3, "2": 3 }) }),
    ]);
    saveReferenceOdds(
      db,
      "two",
      { fair: { "1": 2, X: 3, "2": 3 }, back: { "1": 1.98, X: 2.98, "2": 2.98 }, lay: { "1": 2.02, X: 3.05, "2": 3.05 }, backSize: { "1": 50, X: 50, "2": 50 }, laySize: { "1": 40, X: 30, "2": 30 }, matched: 5000 },
      now()
    );
    expect(loadFreebetMarkets(db).map((m) => m.eventId)).toEqual(["two"]);
  });

  describe("the exchange's lay prices", () => {
    beforeEach(() => {
      upsertCanonicalEvents(db, [
        event("psg", "football", ["PSG", "OM"], { winamax: main("1X2", { "1": 2.3, X: 3.2, "2": 3.5 }), betclic: main("1X2", { "1": 2.25, X: 3.3, "2": 3.4 }) }),
        event("nba", "basketball", ["Lakers", "Celtics"], { winamax: main("Vainqueur du match", { "1": 2.3, "2": 1.6 }), betclic: main("Vainqueur du match", { "1": 2.2, "2": 1.65 }) }),
      ]);
    });
    const football = (laySize: Record<string, number>, scrapedAt = now()) =>
      saveReferenceOdds(
        db,
        "psg",
        { fair: { "1": 2.2, X: 3.5, "2": 4.4 }, back: { "1": 2.04, X: 3.75, "2": 4.6 }, lay: { "1": 2.08, X: 3.85, "2": 4.7 }, backSize: { "1": 50, X: 50, "2": 25 }, laySize, matched: 5000 },
        scrapedAt
      );

    it("reads a football 1X2's and another sport's main market", () => {
      football({ "1": 40, X: 30, "2": 30 });
      saveReferenceMarkets(
        db,
        "nba",
        [
          { market: "Vainqueur du match", selection: "1", back: 2.0, lay: 2.04, backSize: 100, laySize: 80, matched: 9000 },
          { market: "Vainqueur du match", selection: "2", back: 1.98, lay: 2.02, backSize: 100, laySize: 60, matched: 9000 },
        ],
        now()
      );
      const markets = loadFreebetMarkets(db);
      expect(markets.find((m) => m.eventId === "psg")!.exchange).toEqual({ "1": { lay: 2.08, laySize: 40 }, X: { lay: 3.85, laySize: 30 }, "2": { lay: 4.7, laySize: 30 } });
      expect(markets.find((m) => m.eventId === "nba")!.exchange).toEqual({ "1": { lay: 2.04, laySize: 80 }, "2": { lay: 2.02, laySize: 60 } });
    });

    it("leaves out an outcome with under 2 euros to lay, and prices that are stale", () => {
      football({ "1": 1.5, X: 30, "2": 2 });
      expect(Object.keys(loadFreebetMarkets(db).find((m) => m.eventId === "psg")!.exchange).sort()).toEqual(["2", "X"]);
      football({ "1": 40, X: 30, "2": 30 }, minutesAgo(60));
      expect(loadFreebetMarkets(db).find((m) => m.eventId === "psg")!.exchange).toEqual({});
    });
  });
});
