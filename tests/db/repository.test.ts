import { describe, it, expect, beforeEach } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { openDb } from "../../src/db/client";
import {
  upsertCanonicalEvents,
  getLatestEvents,
  getDistinctSports,
  getEventSuggestions,
  getCompetitions,
  oddsMaxAgeForPollInterval,
  saveMarketOdds,
  forgetOldStats,
  getMarketTargets,
} from "../../src/db/repository";
import { getSurebets } from "../../src/db/surebets";
import { getReferenceTargets } from "../../src/db/reference";
import { CanonicalEvent } from "../../src/types";

describe("repository", () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = openDb(":memory:");
  });

  // Relative to "now": getLatestEvents only returns events that have not already
  // started, so a hard-coded timestamp would make these tests start failing on
  // their own once the wall clock moved past it.
  const hoursFromNow = (h: number) => new Date(Date.now() + h * 60 * 60 * 1000).toISOString();

  const sampleEvent: CanonicalEvent = {
    id: "evt1",
    sport: "football",
    competition: "Ligue 1",
    startTime: hoursFromNow(2),
    participants: ["PSG", "OM"],
    byBookmaker: {
      winamax: [{ market: "1X2", selection: "1", price: 1.5 }],
      betclic: [{ market: "1X2", selection: "1", price: 1.55 }],
    },
  };

  it("stores and retrieves an event with odds from multiple bookmakers", () => {
    upsertCanonicalEvents(db, [sampleEvent]);

    const { events } = getLatestEvents(db);

    expect(events).toHaveLength(1);
    expect(events[0].id).toBe("evt1");
    expect(events[0].participants).toEqual(["PSG", "OM"]);
    expect(events[0].byBookmaker.winamax.odds).toEqual([{ market: "1X2", selection: "1", price: 1.5 }]);
    expect(events[0].byBookmaker.betclic.odds).toEqual([{ market: "1X2", selection: "1", price: 1.55 }]);
    expect(events[0].byBookmaker.winamax.scrapedAt).toBeTypeOf("string");
  });

  it("updates the price on re-upsert instead of duplicating rows", () => {
    upsertCanonicalEvents(db, [sampleEvent]);
    const updated: CanonicalEvent = {
      ...sampleEvent,
      byBookmaker: { winamax: [{ market: "1X2", selection: "1", price: 1.6 }] },
    };
    upsertCanonicalEvents(db, [updated]);

    const { events } = getLatestEvents(db);
    expect(events).toHaveLength(1);
    expect(events[0].byBookmaker.winamax.odds).toEqual([{ market: "1X2", selection: "1", price: 1.6 }]);
  });

  it("filters by sport", () => {
    upsertCanonicalEvents(db, [
      sampleEvent,
      { ...sampleEvent, id: "evt2", sport: "tennis", participants: ["Nadal", "Alcaraz"] },
    ]);

    const { events } = getLatestEvents(db, { sport: "tennis" });
    expect(events).toHaveLength(1);
    expect(events[0].id).toBe("evt2");
  });

  it("excludes events that started long enough ago to be finished", () => {
    upsertCanonicalEvents(db, [
      { ...sampleEvent, id: "finished", startTime: hoursFromNow(-30) },
      { ...sampleEvent, id: "upcoming", startTime: hoursFromNow(2) },
    ]);

    const { events } = getLatestEvents(db);

    expect(events.map((e) => e.id)).toEqual(["upcoming"]);
  });

  it("drops a match as soon as it starts: only pre-match odds are listed", () => {
    const oneMinute = 1 / 60;
    upsertCanonicalEvents(db, [
      { ...sampleEvent, id: "live", participants: ["Lens", "Lille"], startTime: hoursFromNow(-oneMinute) },
      { ...sampleEvent, id: "about-to-start", startTime: hoursFromNow(oneMinute) },
    ]);

    const page = getLatestEvents(db);

    expect(page.events.map((e) => e.id)).toEqual(["about-to-start"]);
    expect(page.total).toBe(1);
    expect(getLatestEvents(db, { sort: "trj" }).events.map((e) => e.id)).toEqual(["about-to-start"]);
    expect(getLatestEvents(db, { q: "lens" }).total).toBe(0);
    expect(getEventSuggestions(db, { q: "lens" })).toEqual([]);
  });

  it("applies the sport filter and the freshness filter together, not one instead of the other", () => {
    upsertCanonicalEvents(db, [
      { ...sampleEvent, id: "old-tennis", sport: "tennis", startTime: hoursFromNow(-30) },
      { ...sampleEvent, id: "new-tennis", sport: "tennis", startTime: hoursFromNow(2) },
      { ...sampleEvent, id: "new-football", sport: "football", startTime: hoursFromNow(2) },
    ]);

    const { events } = getLatestEvents(db, { sport: "tennis" });

    // The stale tennis match must be dropped by the time filter, and the fresh
    // football match by the sport filter -- an earlier version of this query
    // replaced one condition with the other instead of ANDing them.
    expect(events.map((e) => e.id)).toEqual(["new-tennis"]);
  });

  describe("odds a bookmaker no longer lists", () => {
    // upsertCanonicalEvents stamps odds with the current time; this backdates
    // them, as if the worker's recent cycles had stopped returning them.
    const ageOdds = (eventId: string, bookmakerId: string, minutes: number) =>
      db
        .prepare("UPDATE event_bookmaker_odds SET scraped_at = ? WHERE event_id = ? AND bookmaker_id = ?")
        .run(new Date(Date.now() - minutes * 60 * 1000).toISOString(), eventId, bookmakerId);

    beforeEach(() => {
      upsertCanonicalEvents(db, [
        sampleEvent,
        { ...sampleEvent, id: "evt2", sport: "tennis", participants: ["Nadal", "Alcaraz"] },
      ]);
    });

    it("drops an event once none of its bookmakers has refreshed it for three cycles", () => {
      ageOdds("evt1", "winamax", 20);
      ageOdds("evt1", "betclic", 20);

      const { events, total } = getLatestEvents(db);

      expect(events.map((e) => e.id)).toEqual(["evt2"]);
      expect(total).toBe(1);
    });

    it("hides one bookmaker's withdrawn odds on an event the other still lists", () => {
      ageOdds("evt1", "winamax", 20);

      const { events } = getLatestEvents(db);

      const evt1 = events.find((e) => e.id === "evt1");
      expect(Object.keys(evt1!.byBookmaker)).toEqual(["betclic"]);
    });

    it("keeps odds that missed a single scrape cycle", () => {
      ageOdds("evt1", "winamax", 10);

      const { events } = getLatestEvents(db);

      const evt1 = events.find((e) => e.id === "evt1");
      expect(Object.keys(evt1!.byBookmaker).sort()).toEqual(["betclic", "winamax"]);
    });

    it("measures the cutoff against the configured odds max age", () => {
      ageOdds("evt1", "winamax", 20);
      ageOdds("evt1", "betclic", 20);

      const { total } = getLatestEvents(db, { oddsMaxAgeMs: 60 * 60 * 1000 });

      expect(total).toBe(2);
    });

    it("stops offering the event's sport and label once it is withdrawn", () => {
      ageOdds("evt2", "winamax", 20);
      ageOdds("evt2", "betclic", 20);

      expect(getDistinctSports(db)).toEqual(["football"]);
      expect(getEventSuggestions(db, { q: "nadal" })).toEqual([]);
      expect(getLatestEvents(db, { q: "nadal" }).total).toBe(0);
      expect(getEventSuggestions(db, { q: "psg" })).toEqual(["PSG - OM"]);
    });
  });

  describe("oddsMaxAgeForPollInterval", () => {
    it("allows three scrape cycles", () => {
      expect(oddsMaxAgeForPollInterval(5)).toBe(15 * 60 * 1000);
      expect(oddsMaxAgeForPollInterval(10)).toBe(30 * 60 * 1000);
    });

    it("falls back to the worker's default interval on an unusable value", () => {
      for (const value of [Number.NaN, 0, -1, Number.POSITIVE_INFINITY]) {
        expect(oddsMaxAgeForPollInterval(value)).toBe(15 * 60 * 1000);
      }
    });
  });

  describe("sorting", () => {
    const at = (id: string, startInHours: number, winamax: [number, number, number], betclic?: [number, number, number]) => {
      const odds = ([one, draw, two]: [number, number, number]) => [
        { market: "1X2", selection: "1", price: one },
        { market: "1X2", selection: "X", price: draw },
        { market: "1X2", selection: "2", price: two },
      ];
      return {
        ...sampleEvent,
        id,
        participants: [id, "Rival"],
        startTime: hoursFromNow(startInHours),
        byBookmaker: betclic ? { winamax: odds(winamax), betclic: odds(betclic) } : { winamax: odds(winamax) },
      };
    };

    beforeEach(() => {
      upsertCanonicalEvents(db, [
        // TRJ 93.75 % (2.50 and 3.00 at Winamax, 3.00 at Betclic), soonest.
        at("low", 1, [2.5, 3.0, 2.9], [2.4, 2.9, 3.0]),
        // TRJ 100 %, each best price 3.00, on both sites.
        at("high", 2, [3.0, 2.7, 3.0], [2.7, 3.0, 2.7]),
        // No draw price: no TRJ.
        { ...sampleEvent, id: "none", participants: ["none", "Rival"], startTime: hoursFromNow(3) },
        // TRJ 100 %, like "high", but a later kick-off.
        at("tie", 4, [3.0, 3.0, 2.9], [2.9, 2.9, 3.0]),
      ]);
    });

    const ids = (page: { events: { id: string }[] }) => page.events.map((e) => e.id);

    it("lists by kick-off by default and reports each match's TRJ", () => {
      const page = getLatestEvents(db);

      expect(ids(page)).toEqual(["low", "high", "none", "tie"]);
      expect(page.events.find((e) => e.id === "high")!.payoutRate).toBeCloseTo(1, 10);
      expect(page.events.find((e) => e.id === "none")!.payoutRate).toBeNull();
    });

    it("ranks by TRJ, highest first, ties by kick-off and matches without one last", () => {
      expect(ids(getLatestEvents(db, { sort: "trj" }))).toEqual(["high", "tie", "low", "none"]);
    });

    it("ranks every match before paging, not just the current page", () => {
      expect(ids(getLatestEvents(db, { sort: "trj", pageSize: 2, page: 1 }))).toEqual(["high", "tie"]);
      const second = getLatestEvents(db, { sort: "trj", pageSize: 2, page: 2 });
      expect(ids(second)).toEqual(["low", "none"]);
      expect(second.total).toBe(4);
    });

    it("computes the TRJ, and the rank, from the requested bookmakers only", () => {
      // Winamax alone: a single site, so no TRJ at all (the owner, 25/10/2026:
      // every outcome can't be bet at one bookmaker), and the kick-off order.
      const page = getLatestEvents(db, { sort: "trj", bookmakers: ["winamax"] });
      expect(ids(page)).toEqual(["low", "high", "none", "tie"]);
      expect(page.events.map((e) => e.payoutRate)).toEqual([null, null, null, null]);
    });

    it("combines TRJ ranking with the sport filter and the search", () => {
      // "o" matches "low" and "none" only.
      expect(ids(getLatestEvents(db, { sort: "trj", q: "o" }))).toEqual(["low", "none"]);
      expect(getLatestEvents(db, { sort: "trj", sport: "tennis" }).total).toBe(0);
    });
  });

  it("records where each bookmaker lists an event, and when it last did", () => {
    const sources = { betclic: { sourceId: "b1", participants: ["PSG", "OM"] } };
    upsertCanonicalEvents(db, [{ ...sampleEvent, sources }]);
    const first = db.prepare("SELECT * FROM event_sources").all() as Record<string, string>[];
    upsertCanonicalEvents(db, [{ ...sampleEvent, sources: { betclic: { sourceId: "b2", participants: ["PSG", "OM"] } } }]);
    const second = db.prepare("SELECT * FROM event_sources").all() as Record<string, string>[];

    expect(first).toEqual([
      { event_id: "evt1", bookmaker_id: "betclic", source_id: "b1", participants: '["PSG","OM"]', seen_at: expect.any(String) },
    ]);
    expect(second).toHaveLength(1);
    expect(second[0].source_id).toBe("b2");
    expect(second[0].seen_at >= first[0].seen_at).toBe(true);
  });
});

describe("an event keeps its id when another bookmaker seeds it", () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = openDb(":memory:");
  });

  const startTime = new Date(Date.now() + 10 * 60 * 60 * 1000).toISOString();

  // Betclic and Winamax seed the matcher in that order (SEED_BOOKMAKERS): the
  // id of an event comes from the names of whichever of them lists it, so one
  // match gets a new id in a cycle where Betclic leaves it out.
  const cycle = (id: string, participants: string[], sources: Record<string, string>, price = 2): CanonicalEvent => ({
    id,
    sport: "basketball",
    competition: "BNXT League",
    startTime,
    participants,
    byBookmaker: Object.fromEntries(Object.keys(sources).map((b) => [b, [{ market: "1X2", selection: "1", price }]])),
    sources: Object.fromEntries(Object.entries(sources).map(([b, sourceId]) => [b, { sourceId, participants }])),
  });

  const storedIds = () => getLatestEvents(db).events.map((e) => e.id);

  it("stores the match under its first id when Winamax seeds it a cycle later", () => {
    upsertCanonicalEvents(db, [cycle("betclic-seed", ["Groningen", "Spirou Charleroi"], { betclic: "b1", winamax: "w1", betsson: "s1" })]);
    upsertCanonicalEvents(db, [cycle("winamax-seed", ["Donar Groningue", "Spirou Basket"], { winamax: "w1", betsson: "s1" }, 2.75)]);

    const { events } = getLatestEvents(db);

    expect(events.map((e) => e.id)).toEqual(["betclic-seed"]);
    expect(events[0].byBookmaker.winamax.odds[0].price).toBe(2.75);
  });

  it("settles on one id for a match already stored twice, whoever seeds it", () => {
    // Stored twice, as it was before the fix: two ids that both know Winamax's w1.
    upsertCanonicalEvents(db, [cycle("b", ["Groningen", "Spirou Charleroi"], { betclic: "b1", winamax: "w1" })]);
    upsertCanonicalEvents(db, [cycle("a", ["Donar Groningue", "Spirou Basket"], { winamax: "w2", betsson: "s1" })]);
    db.prepare("UPDATE event_sources SET source_id = 'w1' WHERE event_id = 'a' AND bookmaker_id = 'winamax'").run();
    db.prepare("UPDATE event_bookmaker_odds SET scraped_at = '2000-01-01T00:00:00.000Z'").run();

    upsertCanonicalEvents(db, [cycle("b", ["Groningen", "Spirou Charleroi"], { betclic: "b1", winamax: "w1" })]);
    upsertCanonicalEvents(db, [cycle("a", ["Donar Groningue", "Spirou Basket"], { winamax: "w1", betsson: "s1" })]);

    const refreshed = db.prepare("SELECT DISTINCT event_id AS id FROM event_bookmaker_odds WHERE scraped_at > '2001'").all() as { id: string }[];
    expect(refreshed.map((r) => r.id)).toEqual(["a"]);
  });

  it("keeps two events apart when no bookmaker lists them under the same id", () => {
    upsertCanonicalEvents(db, [cycle("first", ["Groningen", "Spirou Charleroi"], { betclic: "b1", winamax: "w1" })]);
    upsertCanonicalEvents(db, [cycle("second", ["Groningen", "Spirou Charleroi"], { betclic: "b2", winamax: "w2" })]);

    expect(storedIds().sort()).toEqual(["first", "second"]);
  });

  it("does not take a source id of another sport for the same match", () => {
    upsertCanonicalEvents(db, [cycle("hoops", ["Groningen", "Spirou Charleroi"], { winamax: "w1" })]);
    upsertCanonicalEvents(db, [{ ...cycle("football", ["Groningen", "Spirou Charleroi"], { winamax: "w1" }), sport: "football" }]);

    expect(storedIds().sort()).toEqual(["football", "hoops"]);
  });

  it("does not reuse an id when the sides come the other way round", () => {
    // The odds are "1" and "2" of the seed's order: under the old id they would
    // read the other way round next to the prices still stored.
    upsertCanonicalEvents(db, [cycle("betclic-seed", ["Groningen", "Spirou Charleroi"], { betclic: "b1", winamax: "w1" })]);
    upsertCanonicalEvents(db, [cycle("winamax-seed", ["Spirou Basket", "Donar Groningue"], { winamax: "w1" })]);

    expect(storedIds().sort()).toEqual(["betclic-seed", "winamax-seed"]);
  });

  it("keeps the id the matcher gives to an event nobody listed before", () => {
    upsertCanonicalEvents(db, [cycle("fresh", ["Groningen", "Spirou Charleroi"], { betclic: "b1" })]);

    expect(storedIds()).toEqual(["fresh"]);
  });
});

describe("the winner of a match that a bookmaker's markets cycle gives", () => {
  // Unibet's list gives a basketball match's result in regular time (a 1X2), its
  // winner, overtime included, only comes with the match's markets: the others
  // list that winner, and the table compares it.
  let db: DatabaseSync;
  const hoursFromNow = (h: number) => new Date(Date.now() + h * 60 * 60 * 1000).toISOString();
  const minutesAgo = (m: number) => new Date(Date.now() - m * 60 * 1000).toISOString();
  const winner = (a: number, b: number) => [
    { market: "Vainqueur du match", selection: "1", price: a },
    { market: "Vainqueur du match", selection: "2", price: b },
  ];
  const basketball: CanonicalEvent = {
    id: "barca",
    sport: "basketball",
    competition: "Euroligue",
    startTime: hoursFromNow(3),
    participants: ["Barcelone", "Zalgiris"],
    byBookmaker: {
      unibet: [
        { market: "1X2", selection: "1", price: 1.77 },
        { market: "1X2", selection: "X", price: 12 },
        { market: "1X2", selection: "2", price: 2.05 },
      ],
      winamax: winner(1.72, 1.98),
    },
  };
  const unibetWinner = [
    { eventId: "barca", bookmakerId: "unibet", odds: [...winner(1.69, 1.94), { market: "1X2", selection: "X", price: 12.5 }] },
  ];

  beforeEach(() => {
    db = openDb(":memory:");
    upsertCanonicalEvents(db, [basketball]);
  });

  it("is listed beside the main market of a bookmaker whose list gives another", () => {
    saveMarketOdds(db, unibetWinner, new Date().toISOString());

    const [event] = getLatestEvents(db).events;

    // Only the winner: the 1X2 the markets cycle gives is no listing market, and the list's own is kept.
    expect(event.byBookmaker.unibet.odds).toEqual([
      { market: "1X2", selection: "1", price: 1.77 },
      { market: "1X2", selection: "2", price: 2.05 },
      { market: "1X2", selection: "X", price: 12 },
      ...winner(1.69, 1.94),
    ]);
    // The table's TRJ is the winner's, over both bookmakers: Winamax has
    // both best prices, so Unibet's 1.69 on "1" (the cheaper to give up) stands in.
    expect(event.payoutRate).toBeCloseTo(1 / (1 / 1.69 + 1 / 1.98), 10);
  });

  it("is not listed for a bookmaker that no longer lists the match", () => {
    saveMarketOdds(db, unibetWinner, new Date().toISOString());
    db.prepare("UPDATE event_bookmaker_odds SET scraped_at = ? WHERE bookmaker_id = 'unibet'").run(minutesAgo(30));

    const [event] = getLatestEvents(db).events;

    expect(Object.keys(event.byBookmaker)).toEqual(["winamax"]);
  });

  it("does not replace a winner the list gives itself, nor outlive the markets cycle's three cycles", () => {
    saveMarketOdds(db, [{ eventId: "barca", bookmakerId: "winamax", odds: winner(1.5, 2.5) }], new Date().toISOString());
    saveMarketOdds(db, unibetWinner, minutesAgo(50));

    const [event] = getLatestEvents(db).events;

    expect(event.byBookmaker.winamax.odds).toEqual(winner(1.72, 1.98));
    expect(event.byBookmaker.unibet.odds.map((o) => o.market)).toEqual(["1X2", "1X2", "1X2"]);
  });
});

describe("only the matches with players' markets", () => {
  let db: DatabaseSync;
  const hoursFromNow = (h: number) => new Date(Date.now() + h * 60 * 60 * 1000).toISOString();
  const minutesAgo = (m: number) => new Date(Date.now() - m * 60 * 1000).toISOString();
  const match = (id: string, startInHours: number, participants = [id, "Rival"]): CanonicalEvent => ({
    id,
    sport: "football",
    competition: "Ligue 1",
    startTime: hoursFromNow(startInHours),
    participants,
    byBookmaker: {
      winamax: [
        { market: "1X2", selection: "1", price: 2 },
        { market: "1X2", selection: "X", price: 3 },
        { market: "1X2", selection: "2", price: 4 },
      ],
    },
  });
  const ids = (page: { events: { id: string }[] }) => page.events.map((e) => e.id);

  beforeEach(() => {
    db = openDb(":memory:");
    upsertCanonicalEvents(db, [
      match("scorers", 1),
      match("goals", 2),
      match("assists", 3),
      match("stale", 4),
      match("unrecognized", 5),
      match("betclic", 6, ["Paris FC", "Lens"]),
    ]);
    const now = new Date().toISOString();
    saveMarketOdds(
      db,
      [
        { eventId: "scorers", bookmakerId: "winamax", odds: [{ market: "anytime_scorer", selection: "Mbappé", price: 1.8 }] },
        { eventId: "goals", bookmakerId: "winamax", odds: [{ market: "total_goals|2.5", selection: "over", price: 1.7 }] },
        // A market with a line: "decisive_player_times|2".
        { eventId: "assists", bookmakerId: "winamax", odds: [{ market: "decisive_player_times|2", selection: "Dembélé", price: 6 }] },
        { eventId: "unrecognized", bookmakerId: "winamax", odds: [{ market: "wx:Buteur de 1' à 10'", selection: "Mbappé", price: 12 }] },
        { eventId: "betclic", bookmakerId: "betclic", odds: [{ market: "first_scorer", selection: "Kebbal", price: 7 }] },
      ],
      now
    );
    saveMarketOdds(db, [{ eventId: "stale", bookmakerId: "winamax", odds: [{ market: "anytime_scorer", selection: "Ben Seghir", price: 3 }] }], minutesAgo(50));
  });

  it("keeps the matches with a current price for a scorer, an assister or a decisive player", () => {
    const page = getLatestEvents(db, { sort: "start", players: true });

    // Not "goals" (no player), "stale" (too old) nor "unrecognized" (no family).
    expect(ids(page)).toEqual(["scorers", "assists", "betclic"]);
    expect(page.total).toBe(3);
    expect(getLatestEvents(db, { sort: "start" }).total).toBe(6);
  });

  it("goes with the search, the TRJ sort and the pages", () => {
    // "Rival" is in five matches' names, two of them with players.
    expect(ids(getLatestEvents(db, { players: true, q: "rival" }))).toEqual(["scorers", "assists"]);
    expect(ids(getLatestEvents(db, { players: true, sort: "trj" })).sort()).toEqual(["assists", "betclic", "scorers"]);
    const second = getLatestEvents(db, { players: true, sort: "start", pageSize: 2, page: 2 });
    expect(ids(second)).toEqual(["betclic"]);
    expect(second.total).toBe(3);
  });

  it("counts only the ticked bookmakers' players' markets", () => {
    expect(ids(getLatestEvents(db, { players: true, sort: "start", bookmakers: ["betclic"] }))).toEqual(["betclic"]);
    expect(getLatestEvents(db, { players: true, bookmakers: [] }).total).toBe(0);
  });
});

describe("forgetOldStats", () => {
  const OLD = "2026-01-01T00:00:00.000Z";
  const RECENT = "2026-10-01T00:00:00.000Z";
  const BEFORE = "2026-06-01T00:00:00.000Z";

  function seed(db: DatabaseSync, at: string, runner: string) {
    db.prepare(
      `INSERT INTO reference_player_stats (event_id, market, runner, reads, priced, loose, spread, strict, matched, first_seen_at, last_seen_at)
       VALUES ('e', 'anytime_scorer', ?, 1, 1, 1, 1, 1, 0, ?, ?)`
    ).run(runner, at, at);
    db.prepare(
      `INSERT INTO reference_player_signals (event_id, market, player, bookmaker, basis, cycles, best_edge, best_price, best_reference, first_seen_at, last_seen_at)
       VALUES ('e', 'anytime_scorer', ?, 'betclic', 'fair', 1, 0.1, 3, 2.7, ?, ?)`
    ).run(runner, at, at);
    db.prepare(
      `INSERT INTO reference_player_cycles (at, matches, markets, runners, priced, loose, spread, strict, players, value_bets, strict_value_bets)
       VALUES (?, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1)`
    ).run(at);
    db.prepare(
      `INSERT INTO gem_alerts (event_id, market, selection, bookmaker, basis, price, fair, edge, label, market_label, match_label, start_time, sent_at)
       VALUES ('e', 'anytime_scorer', ?, 'betclic', 'fair', 3, 2.7, 0.1, 'l', 'm', 'a - b', ?, ?)`
    ).run(runner, at, at);
  }

  const counts = (db: DatabaseSync) =>
    Object.fromEntries(
      ["reference_player_stats", "reference_player_signals", "reference_player_cycles", "gem_alerts"].map((t) => [
        t,
        (db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n,
      ])
    );

  it("deletes what was last touched before the date, in the four tables, and keeps the rest", () => {
    const db = openDb(":memory:");
    seed(db, OLD, "Old Player");
    seed(db, RECENT, "Recent Player");

    const forgotten = forgetOldStats(db, BEFORE);

    expect(forgotten).toBe(4);
    expect(counts(db)).toEqual({ reference_player_stats: 1, reference_player_signals: 1, reference_player_cycles: 1, gem_alerts: 1 });
    expect(db.prepare("SELECT runner FROM reference_player_stats").get()).toEqual({ runner: "Recent Player" });
  });

  it("counts a row from the last time it was seen, not the first", () => {
    const db = openDb(":memory:");
    seed(db, OLD, "Still Playing");
    db.prepare("UPDATE reference_player_stats SET last_seen_at = ?").run(RECENT);

    forgetOldStats(db, BEFORE);

    expect(counts(db).reference_player_stats).toBe(1);
  });

  it("does nothing on an empty database", () => {
    expect(forgetOldStats(openDb(":memory:"), BEFORE)).toBe(0);
  });
});

// The winner of a competition (Ligue 1, Roland-Garros): an event with one
// participant in a sport with head-to-heads. It is listed apart, in a category of
// its own, and kept out of the matches, the sports, the markets and reference cycles.
describe("the winners of the competitions", () => {
  let db: DatabaseSync;
  beforeEach(() => {
    db = openDb(":memory:");
  });
  const hoursFromNow = (h: number) => new Date(Date.now() + h * 60 * 60 * 1000).toISOString();
  const winner = (id: string, sport: string, title: string, startTime = hoursFromNow(24 * 200)): CanonicalEvent => ({
    id,
    sport,
    competition: title,
    startTime,
    participants: [title],
    byBookmaker: {
      unibet: [
        { market: "Vainqueur", selection: "Paris Saint-Germain", price: 1.5 },
        { market: "Vainqueur", selection: "Olympique de Marseille", price: 3.2 },
        { market: "Vainqueur", selection: "AS Monaco", price: 4 },
      ],
      vbet: [
        { market: "Vainqueur", selection: "Paris Saint-Germain", price: 1.45 },
        { market: "Vainqueur", selection: "Olympique de Marseille", price: 3.4 },
        { market: "Vainqueur", selection: "AS Monaco", price: 4.2 },
      ],
    },
    sources: { unibet: { sourceId: `u${id}`, participants: [title] }, vbet: { sourceId: `v${id}`, participants: [title] } },
  });
  const match: CanonicalEvent = {
    id: "match",
    sport: "football",
    competition: "Ligue 1",
    startTime: hoursFromNow(2),
    participants: ["PSG", "OM"],
    byBookmaker: { unibet: [{ market: "1X2", selection: "1", price: 1.5 }] },
    sources: { unibet: { sourceId: "um", participants: ["PSG", "OM"] } },
  };
  const race: CanonicalEvent = {
    id: "gp",
    sport: "formule 1",
    competition: "GP",
    startTime: hoursFromNow(48),
    participants: ["GP de Bahreïn"],
    byBookmaker: { unibet: [{ market: "Vainqueur", selection: "Verstappen", price: 2 }, { market: "Vainqueur", selection: "Norris", price: 3 }] },
  };

  it("are not among a sport's matches, nor its count, its suggestions or the sports", () => {
    upsertCanonicalEvents(db, [match, race, winner("l1", "football", "Ligue 1 2026/2027")]);

    const football = getLatestEvents(db, { sport: "football" });
    expect(football.total).toBe(1);
    expect(football.events.map((e) => e.id)).toEqual(["match"]);
    expect(getLatestEvents(db).total).toBe(2);
    expect(getEventSuggestions(db, { q: "ligue 1" })).toEqual([]);
    // A race's winner is still listed with its sport.
    expect(getDistinctSports(db)).toEqual(["football", "formule 1"]);
  });

  it("are listed with kind=competition, whatever their sport, soonest first", () => {
    upsertCanonicalEvents(db, [
      match,
      race,
      winner("l1", "football", "Ligue 1 2026/2027", hoursFromNow(24 * 220)),
      winner("rg", "tennis", "Roland-Garros (H) 2027", hoursFromNow(24 * 100)),
    ]);

    const page = getLatestEvents(db, { kind: "competition" });
    expect(page.total).toBe(2);
    expect(page.events.map((e) => [e.id, e.sport])).toEqual([["rg", "tennis"], ["l1", "football"]]);
    expect(page.events[1].byBookmaker.vbet.odds).toContainEqual({ market: "Vainqueur", selection: "Paris Saint-Germain", price: 1.45 });
    expect(getLatestEvents(db, { kind: "competition", sport: "tennis" }).events.map((e) => e.id)).toEqual(["rg"]);
    expect(getLatestEvents(db, { kind: "competition", q: "roland" }).events.map((e) => e.id)).toEqual(["rg"]);
    expect(getEventSuggestions(db, { q: "ligue 1", kind: "competition" })).toEqual(["Ligue 1 2026/2027"]);
  });

  it("are listed with the matches with kind=all, whatever the sport asked", () => {
    upsertCanonicalEvents(db, [
      match,
      race,
      winner("l1", "football", "Ligue 1 2026/2027", hoursFromNow(24 * 220)),
      winner("rg", "tennis", "Roland-Garros (H) 2027", hoursFromNow(24 * 100)),
    ]);

    expect(getLatestEvents(db, { kind: "all" }).events.map((e) => e.id)).toEqual(["match", "gp", "rg", "l1"]);
    expect(getLatestEvents(db, { kind: "all", sport: "football" }).events.map((e) => e.id)).toEqual(["match", "l1"]);
    expect(getLatestEvents(db, { kind: "all", sport: "football", q: "ligue 1" }).events.map((e) => e.id)).toEqual(["l1"]);
    expect(getEventSuggestions(db, { q: "ligue 1", kind: "all" })).toEqual(["Ligue 1 2026/2027"]);
    // The sports of the list: one with nothing but its winner is one of them.
    expect(getDistinctSports(db)).toEqual(["football", "formule 1", "tennis"]);
  });

  describe("by competition", () => {
    const cup: CanonicalEvent = { ...match, id: "cup", competition: "Coupe de France", participants: ["Lens", "Lille"] };
    const l2: CanonicalEvent = { ...match, id: "l2", competition: "Ligue 2", startTime: hoursFromNow(5), participants: ["Caen", "Laval"] };

    it("keep a competition's matches and its winner, the season and the case left out", () => {
      upsertCanonicalEvents(db, [match, cup, l2, winner("l1", "football", "Ligue 1 2026/2027"), winner("cdf", "football", "Coupe de France 26/27")]);

      expect(getLatestEvents(db, { kind: "all", competition: "Ligue 1" }).events.map((e) => e.id)).toEqual(["match", "l1"]);
      expect(getLatestEvents(db, { kind: "all", competition: "ligue 1" }).total).toBe(2);
      expect(getLatestEvents(db, { kind: "all", competition: "Coupe de France" }).events.map((e) => e.id)).toEqual(["cup", "cdf"]);
      // The winner's own `competition` is a bookmaker's name for it: its title counts.
      upsertCanonicalEvents(db, [{ ...winner("l1", "football", "Ligue 1 2026/2027"), competition: "Ligue 1 McDonald's®" }]);
      expect(getLatestEvents(db, { kind: "all", competition: "Ligue 1" }).events.map((e) => e.id)).toEqual(["match", "l1"]);
      // Without kind=all, a competition's winner is still not in its matches.
      expect(getLatestEvents(db, { competition: "Ligue 1" }).events.map((e) => e.id)).toEqual(["match"]);
    });

    it("page, sort, search and suggest within it", () => {
      upsertCanonicalEvents(db, [match, cup, l2, winner("l1", "football", "Ligue 1 2026/2027")]);

      const page = getLatestEvents(db, { kind: "all", competition: "Ligue 1", pageSize: 1, page: 2 });
      expect(page.total).toBe(2);
      expect(page.events.map((e) => e.id)).toEqual(["l1"]);
      expect(getLatestEvents(db, { kind: "all", competition: "Ligue 1", sort: "trj" }).events.map((e) => e.id)).toEqual(["l1", "match"]);
      expect(getLatestEvents(db, { kind: "all", competition: "Ligue 1", q: "psg" }).events.map((e) => e.id)).toEqual(["match"]);
      expect(getEventSuggestions(db, { q: "ligue", kind: "all", competition: "Ligue 1" })).toEqual(["Ligue 1 2026/2027"]);
    });

    it("are listed for the filter, each once, a sport's when asked", () => {
      upsertCanonicalEvents(db, [
        match,
        cup,
        l2,
        race,
        winner("l1", "football", "Ligue 1 2026/2027"),
        winner("rg", "tennis", "Roland-Garros (H) 2027"),
      ]);

      expect(getCompetitions(db, { sport: "football" })).toEqual(["Coupe de France", "Ligue 1", "Ligue 2"]);
      expect(getCompetitions(db)).toEqual(["Coupe de France", "GP", "Ligue 1", "Ligue 2", "Roland-Garros (H)"]);
      expect(getCompetitions(db, { sport: "golf" })).toEqual([]);
    });
  });

  it("have a TRJ, the best price of each contender", () => {
    upsertCanonicalEvents(db, [winner("l1", "football", "Ligue 1 2026/2027")]);
    const [event] = getLatestEvents(db, { kind: "competition", sort: "trj" }).events;
    // 1 / (1 / 1.5 + 1 / 3.4 + 1 / 4.2): each contender's best price.
    expect(event.payoutRate).toBeCloseTo(1 / (1 / 1.5 + 1 / 3.4 + 1 / 4.2), 5);
  });

  it("are not asked for their markets, though a golf tournament, one participant too, is", () => {
    const golf: CanonicalEvent = {
      ...race,
      id: "golf",
      sport: "golf",
      participants: ["Open d'Espagne 2026"],
      startTime: hoursFromNow(24),
      sources: { unibet: { sourceId: "ug", participants: ["Open d'Espagne 2026"] } },
    };
    upsertCanonicalEvents(db, [winner("l1", "football", "Ligue 1 2026/2027", hoursFromNow(24)), match, golf]);
    const targets = getMarketTargets(db, {
      sports: ["football", "golf"],
      from: new Date().toISOString(),
      to: hoursFromNow(24 * 7),
      seenSince: hoursFromNow(-1),
    });
    expect(targets.map((t) => t.eventId).sort()).toEqual(["golf", "match"]);
  });

  it("are not compared as surebets, as a race's winner is", () => {
    // Each bookmaker's field adds up to 1 or more, and their best prices to 0.92.
    const arbitrage = (event: CanonicalEvent): CanonicalEvent => ({
      ...event,
      byBookmaker: {
        unibet: ["A", "B", "C"].map((selection, i) => ({ market: "Vainqueur", selection, price: i === 0 ? 3.4 : 2.5 })),
        vbet: ["A", "B", "C"].map((selection, i) => ({ market: "Vainqueur", selection, price: i === 0 ? 2.5 : 3.2 })),
      },
    });
    upsertCanonicalEvents(db, [arbitrage(winner("l1", "football", "Ligue 1 2026/2027")), arbitrage({ ...race, id: "gp2" })]);
    expect(getSurebets(db).map((s) => s.eventId)).toEqual(["gp2"]);
  });

  it("are not reference targets", () => {
    upsertCanonicalEvents(db, [winner("l1", "football", "Ligue 1 2026/2027", hoursFromNow(24)), match]);
    const targets = getReferenceTargets(db, { from: new Date().toISOString(), to: hoursFromNow(48), oddsSince: hoursFromNow(-1) });
    expect(targets.map((t) => t.eventId)).toEqual(["match"]);
  });
});
