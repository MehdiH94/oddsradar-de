import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { DatabaseSync } from "node:sqlite";
import { openDb } from "../../src/db/client";
import { forgetStartedEvents, upsertCanonicalEvents } from "../../src/db/repository";
import { loadReferences, saveReferenceOdds } from "../../src/db/reference";
import { ExchangeMatch, MarketPrices, parsePriceFrames, parseSearch } from "../../src/reference/exchange";
import { runReferenceCycle } from "../../src/reference/run";
import { CanonicalEvent } from "../../src/types";

const fixture = (name: string) =>
  JSON.parse(gunzipSync(readFileSync(`${__dirname}/fixtures/exchange-${name}.json.gz`)).toString());
const searches = fixture("search");
const allPrices = parsePriceFrames(fixture("frames"));

// No players' markets on the exchange: the 1X2 alone.
const noPlayers = async () => [];

const POLAND_U21 = 1790784000000;
const PARIS_WOMEN = 1790786700000;
// Five hours before the first match: both start within 48 h.
const NOW = new Date(POLAND_U21 - 5 * 60 * 60 * 1000);
const minutesLater = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);
const LONG_AGO = "2000-01-01T00:00:00.000Z";

function event(id: string, participants: string[], startMs: number): CanonicalEvent {
  return {
    id,
    sport: "football",
    competition: "",
    startTime: new Date(startMs).toISOString(),
    participants,
    byBookmaker: {
      betclic: [
        { market: "1X2", selection: "1", price: 1.5 },
        { market: "1X2", selection: "X", price: 4.2 },
        { market: "1X2", selection: "2", price: 6 },
      ],
    },
  };
}

// The exchange's searches from the captures: "poland" and "paris" find the
// matches below, anything else nothing.
function searcher(results: Record<string, unknown> = { poland: searches.poland, paris: searches.arsenal }) {
  const asked: string[] = [];
  const fn = async (query: string): Promise<ExchangeMatch[]> => {
    asked.push(query);
    return parseSearch(results[query] ?? { content: [] });
  };
  return Object.assign(fn, { asked });
}

// The captured prices of the markets asked for.
function pricer(prices: Map<string, MarketPrices> = allPrices) {
  const asked: string[][] = [];
  const fn = async (markets: { marketId: string }[]) => {
    asked.push(markets.map((m) => m.marketId));
    return new Map(markets.filter((m) => prices.has(m.marketId)).map((m) => [m.marketId, prices.get(m.marketId)!]));
  };
  return Object.assign(fn, { asked });
}

const sources = (db: DatabaseSync) =>
  Object.fromEntries(
    (db.prepare("SELECT event_id, market_id, selections FROM reference_sources").all() as {
      event_id: string;
      market_id: string;
      selections: string;
    }[]).map((r) => [r.event_id, { marketId: r.market_id, selections: JSON.parse(r.selections) }])
  );

describe("runReferenceCycle", () => {
  let db: DatabaseSync;
  let searchedAt: Map<string, number>;

  beforeEach(() => {
    db = openDb(":memory:");
    searchedAt = new Map();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    upsertCanonicalEvents(db, [
      event("pol", ["Pologne (U21)", "Suède (U21)"], POLAND_U21),
      event("paris", ["Paris FC F.", "Arsenal F."], PARIS_WOMEN),
      event("nowhere", ["Nulle Part", "Ailleurs"], PARIS_WOMEN),
    ]);
  });

  it("finds our matches on the exchange by their teams' names, and keeps which runner is which outcome", async () => {
    const search = searcher();
    await runReferenceCycle(db, { playerMarkets: noPlayers, search, prices: pricer(), now: NOW, searchedAt });

    expect(sources(db)).toEqual({
      pol: { marketId: "1.263073956", selections: { "1": 210090, X: 58805, "2": 210088 } },
      paris: { marketId: "1.263007014", selections: { "1": 15228979, X: 58805, "2": 802851 } },
    });
    // Soonest first; the home team, then the away team when that finds nothing.
    expect(search.asked).toEqual(["poland", "nulle", "ailleurs", "paris"]);
  });

  it("stores the fair odds of every match found, and none for the others", async () => {
    await runReferenceCycle(db, { playerMarkets: noPlayers, search: searcher(), prices: pricer(), now: NOW, searchedAt });

    const references = loadReferences(db, ["pol", "paris", "nowhere"], LONG_AGO);
    expect([...references.keys()].sort()).toEqual(["paris", "pol"]);
    const total = 1 / 1.505 + 1 / 5.2 + 1 / 7;
    expect(references.get("pol")?.fair["1"]).toBeCloseTo(1.505 * total, 6);
    expect(references.get("pol")?.fair.X).toBeCloseTo(5.2 * total, 6);
    expect(references.get("pol")?.fair["2"]).toBeCloseTo(7 * total, 6);
    expect(references.get("pol")?.matched).toBeCloseTo(6364.77);
  });

  it("never makes an event of the exchange's matches", async () => {
    await runReferenceCycle(db, { playerMarkets: noPlayers, search: searcher(), prices: pricer(), now: NOW, searchedAt });
    expect((db.prepare("SELECT COUNT(*) AS n FROM events").get() as { n: number }).n).toBe(3);
    expect((db.prepare("SELECT COUNT(*) AS n FROM event_bookmaker_odds").get() as { n: number }).n).toBe(9);
  });

  it("prices the matches found without searching them again", async () => {
    await runReferenceCycle(db, { playerMarkets: noPlayers, search: searcher(), prices: pricer(), now: NOW, searchedAt });
    const search = searcher();
    const prices = pricer();
    await runReferenceCycle(db, { playerMarkets: noPlayers, search, prices, now: minutesLater(5), searchedAt });

    expect(search.asked).toEqual([]);
    expect(prices.asked).toEqual([["1.263073956", "1.263007014"]]);
  });

  it("searches a match it didn't find again half an hour later", async () => {
    await runReferenceCycle(db, { playerMarkets: noPlayers, search: searcher(), prices: pricer(), now: NOW, searchedAt });
    const soon = searcher();
    await runReferenceCycle(db, { playerMarkets: noPlayers, search: soon, prices: pricer(), now: minutesLater(29), searchedAt });
    const later = searcher();
    await runReferenceCycle(db, { playerMarkets: noPlayers, search: later, prices: pricer(), now: minutesLater(31), searchedAt });

    expect(soon.asked).toEqual([]);
    expect(later.asked).toEqual(["nulle", "ailleurs"]);
  });

  it("drops a match's fair odds when too few bettors are left on its market", async () => {
    await runReferenceCycle(db, { playerMarkets: noPlayers, search: searcher(), prices: pricer(), now: NOW, searchedAt });
    const thin = new Map(allPrices);
    const poland = allPrices.get("1.263073956")!;
    thin.set("1.263073956", { ...poland, runners: new Map([...poland.runners, [210090, { back: 1.49, lay: 2 }]]) });
    await runReferenceCycle(db, { playerMarkets: noPlayers, search: searcher(), prices: pricer(thin), now: minutesLater(5), searchedAt });

    expect([...loadReferences(db, ["pol", "paris"], LONG_AGO).keys()]).toEqual(["paris"]);
  });

  it("keeps a match's last fair odds when the exchange doesn't answer for its market", async () => {
    await runReferenceCycle(db, { playerMarkets: noPlayers, search: searcher(), prices: pricer(), now: NOW, searchedAt });
    await runReferenceCycle(db, { playerMarkets: noPlayers, search: searcher(), prices: pricer(new Map()), now: minutesLater(5), searchedAt });

    expect([...loadReferences(db, ["pol", "paris"], LONG_AGO).keys()].sort()).toEqual(["paris", "pol"]);
  });

  it("carries on past a failed search", async () => {
    const search = Object.assign(
      async (query: string) => {
        if (query === "paris") throw new Error("HTTP 500");
        return parseSearch(query === "poland" ? searches.poland : { content: [] });
      },
      {}
    );
    await runReferenceCycle(db, { playerMarkets: noPlayers, search, prices: pricer(), now: NOW, searchedAt });

    expect(Object.keys(sources(db))).toEqual(["pol"]);
  });

  it("keeps each runner on its team when our match lists its teams the other way round later", async () => {
    await runReferenceCycle(db, { playerMarkets: noPlayers, search: searcher(), prices: pricer(), now: NOW, searchedAt });
    // The same match (the same id), its teams now the other way round.
    upsertCanonicalEvents(db, [event("pol", ["Suède (U21)", "Pologne (U21)"], POLAND_U21)]);
    const search = searcher();
    await runReferenceCycle(db, { playerMarkets: noPlayers, search, prices: pricer(), now: minutesLater(5), searchedAt });

    expect(search.asked).toEqual([]);
    expect(sources(db).pol).toEqual({ marketId: "1.263073956", selections: { "1": 210088, X: 58805, "2": 210090 } });
    // Sweden, the exchange's underdog, is now our "1".
    const total = 1 / 1.505 + 1 / 5.2 + 1 / 7;
    expect(loadReferences(db, ["pol"], LONG_AGO).get("pol")?.fair["1"]).toBeCloseTo(7 * total, 6);
  });

  it("searches again a match found before the order of its teams was kept: Norvège (U21) - Israël (U21)", async () => {
    // Production, 6/10/2026: the exchange's runners kept the other way round
    // from our teams. The exchange's Norway U21 favourite (1.67 / 1.71) stood
    // for Israel, every bookmaker's Israel at 3.93 to 4.65 a value bet and a
    // surebet against its lay.
    const KICK_OFF = Date.parse("2026-10-06T16:45:00.000Z");
    upsertCanonicalEvents(db, [event("nor", ["Norvège (U21)", "Israël (U21)"], KICK_OFF)]);
    db.prepare(
      `INSERT INTO reference_sources (event_id, exchange_event_id, market_id, selections, seen_at)
       VALUES ('nor', '36155729', '1.263378660', '{"1":209704,"X":58805,"2":210058}', '2026-10-05T16:45:00.000Z')`
    ).run();
    const norway = {
      content: [
        {
          id: "36155729",
          name: "Norway U21 v Israel U21",
          eventTypeId: "1",
          openDate: KICK_OFF,
          inPlay: false,
          topMarkets: [
            {
              marketId: "1.263378660",
              description: { marketType: "MATCH_ODDS" },
              runners: [
                { selectionId: 210058, runnerName: "Norway U21", sortPriority: 1 },
                { selectionId: 209704, runnerName: "Israel U21", sortPriority: 2 },
                { selectionId: 58805, runnerName: "The Draw", sortPriority: 3 },
              ],
            },
          ],
        },
      ],
    };
    const prices = new Map<string, MarketPrices>([
      [
        "1.263378660",
        {
          runners: new Map([
            [210058, { back: 1.67, lay: 1.71 }],
            [58805, { back: 4.3, lay: 4.6 }],
            [209704, { back: 5.2, lay: 5.6 }],
          ]),
          matched: 218.02,
        },
      ],
    ]);
    const search = searcher({ norway });
    await runReferenceCycle(db, {
      playerMarkets: noPlayers,
      search,
      prices: pricer(prices),
      now: new Date(KICK_OFF - 11 * 60 * 60 * 1000),
      searchedAt,
    });

    expect(search.asked).toContain("norway");
    expect(sources(db).nor.selections).toEqual({ "1": 210058, X: 58805, "2": 209704 });
    const fair = loadReferences(db, ["nor"], LONG_AGO).get("nor")!.fair;
    expect(fair["1"]).toBeCloseTo(1.693, 3);
    expect(fair["2"]).toBeCloseTo(5.409, 3);
  });

  it("places an exchange's match on one of our matches only, the first one it finds", async () => {
    // A second match of the same names 15 minutes later (a youth side under its
    // club's name, 16/10/2026): the exchange's match is the first one's.
    upsertCanonicalEvents(db, [event("pol-later", ["Pologne (U21)", "Suède (U21)"], POLAND_U21 + 15 * 60_000)]);
    await runReferenceCycle(db, { playerMarkets: noPlayers, search: searcher(), prices: pricer(), now: NOW, searchedAt });
    expect(Object.keys(sources(db)).sort()).toEqual(["paris", "pol"]);
  });

  it("only looks at football matches starting within 7 days", async () => {
    upsertCanonicalEvents(db, [{ ...event("tennis", ["Pologne", "Suède"], POLAND_U21), sport: "tennis" }]);
    const search = searcher();
    // 7 days later is between the two kick-offs.
    const now = new Date(POLAND_U21 - 7 * 24 * 60 * 60 * 1000 + 20 * 60_000);
    await runReferenceCycle(db, { playerMarkets: noPlayers, search, prices: pricer(), now, searchedAt });
    expect(search.asked).toEqual(["poland"]);
  });

  describe("beyond 48 h", () => {
    // Three days before the first match.
    const FAR = new Date(POLAND_U21 - 72 * 60 * 60 * 1000);
    const later = (minutes: number) => new Date(FAR.getTime() + minutes * 60_000);

    it("prices the matches found every other cycle, and never lists their players' markets", async () => {
      const pricedAt = new Map<string, number>();
      const listed: string[] = [];
      const playerMarkets = async (exchangeEventId: string) => {
        listed.push(exchangeEventId);
        return [];
      };
      const prices = pricer();
      for (const minutes of [0, 5, 10, 15]) {
        await runReferenceCycle(db, { playerMarkets, search: searcher(), prices, now: later(minutes), searchedAt, pricedAt });
      }
      // At 0 and 10 minutes; at 5 and 15 nothing to price, so nothing asked.
      expect(prices.asked).toEqual([
        ["1.263073956", "1.263007014"],
        ["1.263073956", "1.263007014"],
      ]);
      expect(listed).toEqual([]);
      expect([...loadReferences(db, ["pol", "paris"], LONG_AGO).keys()].sort()).toEqual(["paris", "pol"]);
    });

    it("prices a match every cycle once it is within 48 h", async () => {
      const pricedAt = new Map<string, number>();
      const prices = pricer();
      // 48 h and 2 minutes before Poland, both are beyond 48 h; 5 minutes
      // later Poland is within, Paris (45 minutes after it) is not.
      const at = (minutes: number) => new Date(POLAND_U21 - 48 * 60 * 60 * 1000 - 2 * 60_000 + minutes * 60_000);
      await runReferenceCycle(db, { playerMarkets: noPlayers, search: searcher(), prices, now: at(0), searchedAt, pricedAt });
      await runReferenceCycle(db, { playerMarkets: noPlayers, search: searcher(), prices, now: at(5), searchedAt, pricedAt });
      expect(prices.asked).toEqual([["1.263073956", "1.263007014"], ["1.263073956"]]);
    });

    it("searches a match it didn't find again 2 hours later, not half an hour", async () => {
      await runReferenceCycle(db, { playerMarkets: noPlayers, search: searcher(), prices: pricer(), now: FAR, searchedAt });
      const soon = searcher();
      await runReferenceCycle(db, { playerMarkets: noPlayers, search: soon, prices: pricer(), now: later(31), searchedAt });
      const after = searcher();
      await runReferenceCycle(db, { playerMarkets: noPlayers, search: after, prices: pricer(), now: later(121), searchedAt });
      expect(soon.asked).toEqual([]);
      expect(after.asked).toEqual(["nulle", "ailleurs"]);
    });
  });
});

describe("reference storage", () => {
  it("replaces a match's reference, and forgets it with the match", () => {
    const db = openDb(":memory:");
    upsertCanonicalEvents(db, [event("pol", ["Pologne (U21)", "Suède (U21)"], POLAND_U21)]);
    const odds = {
      fair: { "1": 1.5, X: 5, "2": 7 } as const,
      back: { "1": 1.49, X: 5.1, "2": 6.8 } as const,
      lay: { "1": 1.52, X: 5.3, "2": 7.2 } as const,
      matched: 100,
    };
    saveReferenceOdds(db, "pol", odds, "2026-09-30T10:00:00.000Z");
    saveReferenceOdds(db, "pol", { ...odds, fair: { "1": 1.6, X: 4.8, "2": 6.5 } }, "2026-09-30T10:05:00.000Z");
    expect(loadReferences(db, ["pol"], LONG_AGO).get("pol")).toEqual({
      market: "1X2",
      fair: { "1": 1.6, X: 4.8, "2": 6.5 },
      matched: 100,
      scrapedAt: "2026-09-30T10:05:00.000Z",
    });
    // Too old for the listing.
    expect(loadReferences(db, ["pol"], "2026-09-30T10:06:00.000Z").size).toBe(0);

    forgetStartedEvents(db, new Date(POLAND_U21 + 1).toISOString());
    expect(loadReferences(db, ["pol"], LONG_AGO).size).toBe(0);
  });
});
