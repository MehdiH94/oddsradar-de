import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { openDb } from "../../src/db/client";
import { saveMarketOdds, upsertCanonicalEvents } from "../../src/db/repository";
import { saveReferenceOdds } from "../../src/db/reference";
import { recordRunnerRead } from "../../src/db/playerStats";
import { createServer } from "./authedServer";
import { recordSentGems, setAlertState } from "../../src/db/alerts";
import { CanonicalEvent } from "../../src/types";

describe("GET /api/events", () => {
  let db: DatabaseSync;
  const hoursFromNow = (h: number) => new Date(Date.now() + h * 60 * 60 * 1000).toISOString();

  beforeEach(() => {
    db = openDb(":memory:");
    const events: CanonicalEvent[] = [
      {
        id: "evt1",
        sport: "football",
        competition: "Ligue 1",
        startTime: hoursFromNow(2),
        participants: ["PSG", "OM"],
        byBookmaker: { winamax: [{ market: "1X2", selection: "1", price: 1.5 }] },
      },
      {
        id: "evt2",
        sport: "tennis",
        competition: "ATP Paris",
        startTime: hoursFromNow(26),
        participants: ["Nadal", "Alcaraz"],
        byBookmaker: { betclic: [{ market: "winner", selection: "Nadal", price: 2.1 }] },
      },
    ];
    upsertCanonicalEvents(db, events);
  });

  it("returns all events with their bookmakers' odds, wrapped in a pagination envelope", async () => {
    const res = await request(createServer(db)).get("/api/events");
    expect(res.status).toBe(200);
    expect(res.body.events).toHaveLength(2);
    expect(res.body).toMatchObject({ total: 2, page: 1, pageSize: 20 });
  });

  it("keeps only the matches with a players' market, on ?players=1", async () => {
    saveMarketOdds(
      db,
      [{ eventId: "evt1", bookmakerId: "winamax", odds: [{ market: "anytime_scorer", selection: "Dembélé", price: 2.2 }] }],
      new Date().toISOString()
    );
    const res = await request(createServer(db)).get("/api/events?players=1");
    expect(res.body.events.map((e: { id: string }) => e.id)).toEqual(["evt1"]);
    expect(res.body.total).toBe(1);
  });

  it("sorts by value on ?sort=value, and lists the value bets on /api/value-bets", async () => {
    const fair = { "1": 1.4, X: 4, "2": 7 };
    // Later than evt1, with a bigger edge.
    upsertCanonicalEvents(db, [
      {
        id: "evt3",
        sport: "football",
        competition: "Ligue 1",
        startTime: hoursFromNow(30),
        participants: ["Lens", "Lille"],
        byBookmaker: { winamax: [{ market: "1X2", selection: "1", price: 2 }] },
      },
    ]);
    for (const id of ["evt1", "evt3"]) {
      saveReferenceOdds(db, id, { fair, back: fair, lay: fair, matched: 10 }, new Date().toISOString());
    }
    const res = await request(createServer(db)).get("/api/events?sort=value");
    expect(res.body.events.map((e: { id: string }) => e.id)).toEqual(["evt3", "evt1", "evt2"]);
    expect(res.body.events[1].value).toEqual({ edge: expect.closeTo(1.5 / 1.4 - 1, 10), selection: "1", bookmaker: "winamax" });

    const bets = await request(createServer(db)).get("/api/value-bets");
    expect(bets.status).toBe(200);
    expect(bets.body.bets.map((b: { eventId: string }) => b.eventId)).toEqual(["evt3", "evt1"]);
    const soonest = await request(createServer(db)).get("/api/value-bets?sort=start");
    expect(soonest.body.bets.map((b: { eventId: string }) => b.eventId)).toEqual(["evt1", "evt3"]);
    expect((await request(createServer(db)).get("/api/value-bets?q=psg")).body).toEqual({
      bets: [expect.objectContaining({ eventId: "evt1", selection: "1", bookmaker: "winamax", price: 1.5, fair: 1.4 })],
      total: 1,
      surebets: [],
    });
    expect((await request(createServer(db)).get("/api/value-bets?bookmakers=betclic")).body).toEqual({
      bets: [],
      total: 0,
      surebets: [],
    });
  });

  it("lists a value bet a surebet holds as that surebet only", async () => {
    // Winamax's 2.30 on PSG laid at 2.08 on the exchange: a surebet, no
    // longer a value bet too. Its 4.00 on OM, 5% above the fair 3.80 and
    // under the lay 4.20, is a value bet only.
    upsertCanonicalEvents(db, [
      {
        id: "evt1",
        sport: "football",
        competition: "Ligue 1",
        startTime: hoursFromNow(2),
        participants: ["PSG", "OM"],
        byBookmaker: {
          winamax: [
            { market: "1X2", selection: "1", price: 2.3 },
            { market: "1X2", selection: "X", price: 3.1 },
            { market: "1X2", selection: "2", price: 4 },
          ],
        },
      },
    ]);
    saveReferenceOdds(
      db,
      "evt1",
      {
        fair: { "1": 2.06, X: 3.6, "2": 3.8 },
        back: { "1": 2.04, X: 3.5, "2": 3.7 },
        lay: { "1": 2.08, X: 3.7, "2": 4.2 },
        laySize: { "1": 100, X: 100, "2": 100 },
        matched: 5000,
      },
      new Date().toISOString()
    );
    const res = await request(createServer(db)).get("/api/value-bets");
    expect(res.body.surebets.map((s: { kind: string; legs: { selection: string }[] }) => [s.kind, s.legs[0].selection])).toEqual([
      ["lay", "1"],
    ]);
    expect(res.body.bets.map((b: { selection: string; bookmaker: string }) => [b.selection, b.bookmaker])).toEqual([["2", "winamax"]]);
    expect(res.body.total).toBe(1);
  });

  it("still lists the value bets when the surebets fail", async () => {
    const fair = { "1": 1.4, X: 4, "2": 7 };
    saveReferenceOdds(db, "evt1", { fair, back: fair, lay: fair, matched: 10 }, new Date().toISOString());
    db.exec("DROP TABLE surebet_markets");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await request(createServer(db)).get("/api/value-bets");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ bets: [expect.objectContaining({ eventId: "evt1" })], total: 1, surebets: [] });
    expect(error).toHaveBeenCalledWith("[surebets]", expect.objectContaining({ message: expect.stringContaining("surebet_markets") }));
    error.mockRestore();
  });

  it("lists the surebets with the value bets, among the ticked bookmakers", async () => {
    // 1 / (1/2.2 + 1/2.1): 107.4%.
    upsertCanonicalEvents(db, [
      {
        id: "sure",
        sport: "basketball",
        competition: "NBA",
        startTime: hoursFromNow(10),
        participants: ["Lakers", "Celtics"],
        byBookmaker: {
          winamax: [
            { market: "Vainqueur du match", selection: "1", price: 2.2 },
            { market: "Vainqueur du match", selection: "2", price: 1.7 },
          ],
          betclic: [
            { market: "Vainqueur du match", selection: "1", price: 1.9 },
            { market: "Vainqueur du match", selection: "2", price: 2.1 },
          ],
        },
      },
    ]);
    const res = await request(createServer(db)).get("/api/value-bets");
    expect(res.body.surebets).toEqual([
      expect.objectContaining({
        eventId: "sure",
        market: "Vainqueur du match",
        kind: "bookmakers",
        payoutRate: expect.closeTo(1 / (1 / 2.2 + 1 / 2.1), 10),
        toVerify: false,
        legs: [
          expect.objectContaining({ selection: "1", label: "Lakers", source: "winamax", price: 2.2 }),
          expect.objectContaining({ selection: "2", label: "Celtics", source: "betclic", price: 2.1 }),
        ],
      }),
    ]);
    expect((await request(createServer(db)).get("/api/value-bets?bookmakers=winamax")).body.surebets).toEqual([]);
  });

  it("sums up the players' markets since a time, the last 3 days by default", async () => {
    recordRunnerRead(
      db,
      {
        eventId: "evt1",
        market: "anytime_scorer",
        runner: "Kylian Mbappe",
        player: "Kylian Mbappé",
        reliability: { priced: true, loose: true, shown: true, spread: true, strict: true },
        spread: 0.02,
        size: 50,
        matched: 900,
      },
      new Date().toISOString()
    );
    const res = await request(createServer(db)).get("/api/stats/players");
    expect(res.status).toBe(200);
    expect(res.body.totals).toMatchObject({ matches: 1, runners: 1, runnersEver: { strict: 1 } });
    expect(Date.parse(res.body.since)).toBeCloseTo(Date.now() - 3 * 24 * 60 * 60 * 1000, -4);
    const later = await request(createServer(db)).get(`/api/stats/players?since=${new Date(Date.now() + 60_000).toISOString()}`);
    expect(later.body.totals.runners).toBe(0);
    expect((await request(createServer(db)).get("/api/stats/players?since=nonsense")).body.totals.runners).toBe(1);
  });

  it("filters by sport", async () => {
    const res = await request(createServer(db)).get("/api/events?sport=tennis");
    expect(res.status).toBe(200);
    expect(res.body.events).toHaveLength(1);
    expect(res.body.events[0].id).toBe("evt2");
    expect(res.body.total).toBe(1);
  });

  it("paginates results", async () => {
    const db2 = openDb(":memory:");
    const manyEvents: CanonicalEvent[] = Array.from({ length: 25 }, (_, i) => ({
      id: `evt-page-${i}`,
      sport: "football",
      competition: "Ligue 1",
      startTime: hoursFromNow(1 + i * 0.01),
      participants: [`Team ${i}A`, `Team ${i}B`],
      byBookmaker: { winamax: [{ market: "1X2", selection: "1", price: 1.5 }] },
    }));
    upsertCanonicalEvents(db2, manyEvents);

    const page1 = await request(createServer(db2)).get("/api/events?pageSize=20");
    expect(page1.body.events).toHaveLength(20);
    expect(page1.body).toMatchObject({ total: 25, page: 1, pageSize: 20 });

    const page2 = await request(createServer(db2)).get("/api/events?pageSize=20&page=2");
    expect(page2.body.events).toHaveLength(5);
    expect(page2.body.page).toBe(2);
  });

  it("answers an absurdly large page with an empty page and the real total, not a 500", async () => {
    // Previously (page - 1) * pageSize overflowed SQLite's 64-bit integer
    // range and the bind threw, so Express answered 500 with a stack trace.
    for (const page of ["1e18", "9007199254740993", "Infinity", "1e308"]) {
      const res = await request(createServer(db)).get(`/api/events?page=${page}`);
      expect(res.status, `page=${page}`).toBe(200);
      expect(res.body.events, `page=${page}`).toEqual([]);
      expect(res.body.total, `page=${page}`).toBe(2);
    }
  });

  it("falls back to sane defaults for malformed or out-of-range page/pageSize values", async () => {
    for (const qs of ["page=abc", "page=-5", "page=0", "page=0.5", "pageSize=0.5", "pageSize=-1", "pageSize=abc"]) {
      const res = await request(createServer(db)).get(`/api/events?${qs}`);
      expect(res.status, qs).toBe(200);
      expect(res.body.page, qs).toBe(1);
      expect(res.body.pageSize, qs).toBe(20);
      expect(res.body.events, qs).toHaveLength(2);
    }

    const huge = await request(createServer(db)).get("/api/events?pageSize=1e18");
    expect(huge.status).toBe(200);
    expect(huge.body.pageSize).toBe(100);
  });

  it("still serves the API as JSON now that static file serving is mounted", async () => {
    const res = await request(createServer(db)).get("/api/events");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/application\/json/);
    expect(Array.isArray(res.body.events)).toBe(true);
  });

  it("404s on an unknown path instead of crashing when the frontend build is absent", async () => {
    const res = await request(createServer(db)).get("/definitely-not-a-real-asset.js");
    expect(res.status).toBe(404);
  });

  describe("the frontend's own pages", () => {
    let webDist: string;

    beforeEach(() => {
      webDist = mkdtempSync(path.join(tmpdir(), "coteradar-web-"));
      writeFileSync(path.join(webDist, "index.html"), "<!doctype html><title>CoteRadar</title>");
    });

    afterEach(() => rmSync(webDist, { recursive: true, force: true }));

    it("serves index.html at /, and at /odds so that a reload or a shared link finds the dashboard", async () => {
      const app = createServer(db, {}, { webDist });
      for (const url of ["/", "/odds", "/odds/", "/odds?sport=value-bets&sort=value"]) {
        const res = await request(app).get(url);
        expect(res.status, url).toBe(200);
        expect(res.headers["content-type"], url).toMatch(/text\/html/);
        expect(res.text, url).toContain("<title>CoteRadar</title>");
      }
    });

    it("serves it at /freebets too, with the settings in its address", async () => {
      const app = createServer(db, {}, { webDist });
      for (const url of ["/freebets", "/freebets/", "/freebets?mode=exchange&bookmaker=betclic&sports=football"]) {
        const res = await request(app).get(url);
        expect(res.status, url).toBe(200);
        expect(res.text, url).toContain("<title>CoteRadar</title>");
      }
    });

    it("still 404s on any other path, and on an unknown API route", async () => {
      const app = createServer(db, {}, { webDist });
      expect((await request(app).get("/definitely-not-a-page")).status).toBe(404);
      expect((await request(app).get("/odds/other")).status).toBe(404);
      expect((await request(app).get("/api/definitely-not-a-route")).status).toBe(404);
    });

    it("404s at /odds when the frontend build is absent", async () => {
      const res = await request(createServer(db, {}, { webDist: path.join(webDist, "missing") })).get("/odds");
      expect(res.status).toBe(404);
    });
  });
});

describe("GET /api/events sorting", () => {
  let db: DatabaseSync;
  const hoursFromNow = (h: number) => new Date(Date.now() + h * 60 * 60 * 1000).toISOString();
  const event = (id: string, startInHours: number, winamax: number, betclic: number): CanonicalEvent => ({
    id,
    sport: "tennis",
    competition: "",
    startTime: hoursFromNow(startInHours),
    participants: [id, "Rival"],
    byBookmaker: {
      winamax: [
        { market: "Vainqueur du match", selection: "1", price: winamax },
        { market: "Vainqueur du match", selection: "2", price: winamax },
      ],
      betclic: [
        { market: "Vainqueur du match", selection: "1", price: betclic },
        { market: "Vainqueur du match", selection: "2", price: betclic },
      ],
    },
  });

  beforeEach(() => {
    db = openDb(":memory:");
    // TRJ with both bookmakers: soon 95 %, later 100 %. Winamax alone: 95 %, 80 %.
    upsertCanonicalEvents(db, [event("soon", 1, 1.9, 1.7), event("later", 2, 1.6, 2.0)]);
  });

  const ids = (body: { events: { id: string }[] }) => body.events.map((e) => e.id);

  it("sorts by TRJ with sort=trj, by kick-off otherwise", async () => {
    const byTrj = await request(createServer(db)).get("/api/events?sort=trj");
    expect(ids(byTrj.body)).toEqual(["later", "soon"]);
    expect(byTrj.body.events[0].payoutRate).toBeCloseTo(1, 10);

    for (const query of ["", "?sort=start", "?sort=bogus"]) {
      const res = await request(createServer(db)).get(`/api/events${query}`);
      expect(ids(res.body)).toEqual(["soon", "later"]);
    }
  });

  it("computes TRJ from the bookmakers listed in the bookmakers parameter", async () => {
    const winamaxOnly = await request(createServer(db)).get("/api/events?sort=trj&bookmakers=winamax");
    expect(ids(winamaxOnly.body)).toEqual(["soon", "later"]);
    expect(winamaxOnly.body.events[0].payoutRate).toBeCloseTo(0.95, 10);

    const none = await request(createServer(db)).get("/api/events?sort=trj&bookmakers=");
    expect(none.body.events.map((e: { payoutRate: number | null }) => e.payoutRate)).toEqual([null, null]);
  });
});

describe("withdrawn odds", () => {
  it("applies the odds max age the server was created with", async () => {
    const db = openDb(":memory:");
    upsertCanonicalEvents(db, [
      {
        id: "evt1",
        sport: "football",
        competition: "Ligue 1",
        startTime: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
        participants: ["PSG", "OM"],
        byBookmaker: { winamax: [{ market: "1X2", selection: "1", price: 1.5 }] },
      },
    ]);
    db.prepare("UPDATE event_bookmaker_odds SET scraped_at = ?").run(
      new Date(Date.now() - 20 * 60 * 1000).toISOString()
    );

    const byDefault = createServer(db);
    expect((await request(byDefault).get("/api/events")).body.total).toBe(0);
    expect((await request(byDefault).get("/api/sports")).body).toEqual([]);
    expect((await request(byDefault).get("/api/events/suggestions?q=psg")).body).toEqual([]);

    const lenient = createServer(db, { oddsMaxAgeMs: 60 * 60 * 1000 });
    expect((await request(lenient).get("/api/events")).body.total).toBe(1);
    expect((await request(lenient).get("/api/sports")).body).toEqual(["football"]);
    expect((await request(lenient).get("/api/events/suggestions?q=psg")).body).toEqual(["PSG - OM"]);
  });
});

describe("GET /api/sports", () => {
  let db: DatabaseSync;
  const hoursFromNow = (h: number) => new Date(Date.now() + h * 60 * 60 * 1000).toISOString();

  beforeEach(() => {
    db = openDb(":memory:");
    upsertCanonicalEvents(db, [
      {
        id: "evt1",
        sport: "football",
        competition: "Ligue 1",
        startTime: hoursFromNow(2),
        participants: ["PSG", "OM"],
        byBookmaker: { winamax: [{ market: "1X2", selection: "1", price: 1.5 }] },
      },
      {
        id: "evt2",
        sport: "tennis",
        competition: "ATP Paris",
        startTime: hoursFromNow(3),
        participants: ["Nadal", "Alcaraz"],
        byBookmaker: { betclic: [{ market: "winner", selection: "Nadal", price: 2.1 }] },
      },
    ]);
  });

  it("returns every distinct sport with data, sorted alphabetically", async () => {
    const res = await request(createServer(db)).get("/api/sports");
    expect(res.status).toBe(200);
    expect(res.body).toEqual(["football", "tennis"]);
  });

  it("omits sports whose only events have already started", async () => {
    // Events are never deleted. A sport string that only survives on stale
    // rows -- e.g. "hockey", the pre-migration Winamax scraper's label for what
    // is now "hockey sur glace" -- must not linger in the select forever,
    // offering a filter that /api/events would answer with zero matches.
    upsertCanonicalEvents(db, [
      {
        id: "stale-hockey",
        sport: "hockey",
        competition: "KHL",
        startTime: hoursFromNow(-30),
        participants: ["AK Bars Kazan", "Lada Togliatti"],
        byBookmaker: { winamax: [{ market: "1X2", selection: "1", price: 1.45 }] },
      },
      {
        // Same rule as /api/events: a match in progress (live) is no longer
        // listed there, so its sport is not selectable either.
        id: "in-progress-basketball",
        sport: "basketball",
        competition: "NBL",
        startTime: hoursFromNow(-1),
        participants: ["Perth Wildcats", "Sydney Kings"],
        byBookmaker: { winamax: [{ market: "Vainqueur du match", selection: "1", price: 1.8 }] },
      },
    ]);

    const res = await request(createServer(db)).get("/api/sports");
    expect(res.status).toBe(200);
    expect(res.body).toEqual(["football", "tennis"]);

    for (const sport of ["hockey", "basketball"]) {
      const events = await request(createServer(db)).get(`/api/events?sport=${sport}`);
      expect(events.body.total).toBe(0);
    }
  });
});

describe("event search", () => {
  let db: DatabaseSync;
  const hoursFromNow = (h: number) => new Date(Date.now() + h * 60 * 60 * 1000).toISOString();
  const event = (id: string, sport: string, participants: string[], startInHours: number): CanonicalEvent => ({
    id,
    sport,
    competition: "",
    startTime: hoursFromNow(startInHours),
    participants,
    byBookmaker: { winamax: [{ market: "1X2", selection: "1", price: 1.5 }] },
  });

  beforeEach(() => {
    db = openDb(":memory:");
    upsertCanonicalEvents(db, [
      event("psg-om", "football", ["PSG", "OM"], 2),
      event("psg-lens", "football", ["PSG", "Lens"], 5),
      event("biel", "football", ["Biélorussie U21", "Danemark U21"], 3),
      event("psg-hb", "handball", ["PSG Handball", "Nantes"], 4),
      event("stale", "football", ["PSG", "Lyon"], -30),
    ]);
  });

  it("filters /api/events by participants, case- and accent-insensitively, soonest first", async () => {
    const res = await request(createServer(db)).get("/api/events?q=psg");
    expect(res.body.events.map((e: { id: string }) => e.id)).toEqual(["psg-om", "psg-hb", "psg-lens"]);
    expect(res.body.total).toBe(3);

    const accents = await request(createServer(db)).get("/api/events?q=bielorussie");
    expect(accents.body.events.map((e: { id: string }) => e.id)).toEqual(["biel"]);
  });

  it("narrows to one event when searching a suggestion's full label, and combines with the sport filter", async () => {
    const exact = await request(createServer(db)).get(`/api/events?q=${encodeURIComponent("PSG - OM")}`);
    expect(exact.body.events.map((e: { id: string }) => e.id)).toEqual(["psg-om"]);

    const handball = await request(createServer(db)).get("/api/events?q=psg&sport=handball");
    expect(handball.body.events.map((e: { id: string }) => e.id)).toEqual(["psg-hb"]);
  });

  it("paginates search results with the filtered total", async () => {
    const res = await request(createServer(db)).get("/api/events?q=psg&pageSize=2&page=2");
    expect(res.body.events.map((e: { id: string }) => e.id)).toEqual(["psg-lens"]);
    expect(res.body).toMatchObject({ total: 3, page: 2, pageSize: 2 });
  });

  it("ignores a query with nothing searchable in it", async () => {
    const res = await request(createServer(db)).get(`/api/events?q=${encodeURIComponent(" - ")}`);
    expect(res.body.total).toBe(4);
  });

  it("suggests matching fresh event labels, soonest first", async () => {
    const res = await request(createServer(db)).get("/api/events/suggestions?q=psg");
    expect(res.status).toBe(200);
    expect(res.body).toEqual(["PSG - OM", "PSG Handball - Nantes", "PSG - Lens"]);

    const football = await request(createServer(db)).get("/api/events/suggestions?q=psg&sport=football");
    expect(football.body).toEqual(["PSG - OM", "PSG - Lens"]);
  });

  it("suggests nothing for a query shorter than two characters", async () => {
    for (const q of ["", "p", " - "]) {
      const res = await request(createServer(db)).get(`/api/events/suggestions?q=${encodeURIComponent(q)}`);
      expect(res.body, q).toEqual([]);
    }
  });
});

describe("GET /api/events/:id", () => {
  const hoursFromNow = (h: number) => new Date(Date.now() + h * 60 * 60 * 1000).toISOString();

  function seeded(): DatabaseSync {
    const db = openDb(":memory:");
    upsertCanonicalEvents(db, [
      {
        id: "bvb",
        sport: "football",
        competition: "Bundesliga",
        startTime: hoursFromNow(5),
        participants: ["Borussia Dortmund", "Werder Brême"],
        byBookmaker: {
          betclic: [{ market: "1X2", selection: "1", price: 1.33 }],
          winamax: [{ market: "1X2", selection: "1", price: 1.29 }],
        },
      },
    ]);
    saveMarketOdds(db, [{ eventId: "bvb", bookmakerId: "winamax", odds: [{ market: "btts", selection: "yes", price: 1.5 }] }], new Date().toISOString());
    return db;
  }

  it("answers a match's every market, in sections", async () => {
    const res = await request(createServer(seeded())).get("/api/events/bvb");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: "bvb", participants: ["Borussia Dortmund", "Werder Brême"] });
    expect(res.body.sections.map((s: { key: string }) => s.key)).toEqual(["result", "goals"]);
  });

  it("keeps to the requested bookmakers", async () => {
    const res = await request(createServer(seeded())).get("/api/events/bvb?bookmakers=betclic");
    expect(res.body.sections.map((s: { key: string }) => s.key)).toEqual(["result"]);
  });

  it("answers 404 for a match it doesn't know", async () => {
    const res = await request(createServer(seeded())).get("/api/events/nope");
    expect(res.status).toBe(404);
  });

  it("still answers the suggestions route", async () => {
    const res = await request(createServer(seeded())).get("/api/events/suggestions?q=dort");
    expect(res.body).toEqual(["Borussia Dortmund - Werder Brême"]);
  });
});

describe("GET /api/alerts", () => {
  it("says whether the worker has a webhook, its last failure and the gems sent, never the webhook", async () => {
    const db = openDb(":memory:");
    expect((await request(createServer(db)).get("/api/alerts")).body).toEqual({ configured: false, lastError: null, sent: [] });

    setAlertState(db, "configured", "1");
    setAlertState(db, "hello_for", "fingerprint");
    setAlertState(db, "last_error", "HTTP 404");
    setAlertState(db, "last_error_at", "2026-10-02T09:00:00.000Z");
    const gem = {
      eventId: "fra-ita",
      market: "1X2",
      selection: "1",
      bookmaker: "winamax",
      basis: "fair",
      price: 2.1,
      fair: 2,
      edge: 0.05,
      label: "France",
      marketLabel: "Résultat du match",
      matchLabel: "France - Italie",
      startTime: "2026-10-02T18:45:00.000Z",
    };
    recordSentGems(db, [
      { ...gem, sentAt: "2026-10-02T08:00:00.000Z" },
      { ...gem, bookmaker: "betclic", sentAt: "2026-10-02T08:05:00.000Z" },
    ]);
    const res = await request(createServer(db)).get("/api/alerts");
    expect(res.body).toEqual({
      configured: true,
      lastError: { at: "2026-10-02T09:00:00.000Z", message: "HTTP 404" },
      sent: [
        { ...gem, bookmaker: "betclic", sentAt: "2026-10-02T08:05:00.000Z" },
        { ...gem, sentAt: "2026-10-02T08:00:00.000Z" },
      ],
    });
    expect(JSON.stringify(res.body)).not.toContain("fingerprint");
  });
});

describe("GET /api/value-bets cache", () => {
  it("serves the same answer within valueBetsCacheMs, and recomputes without it", async () => {
    const db = openDb(":memory:");
    const start = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    const event = (id: string): CanonicalEvent => ({
      id,
      sport: "football",
      competition: "Ligue 1",
      startTime: start,
      participants: ["PSG", "OM"],
      byBookmaker: { winamax: [{ market: "1X2", selection: "1", price: 2 }] },
    });
    upsertCanonicalEvents(db, [event("evt1")]);
    const cached = createServer(db, {}, { valueBetsCacheMs: 60_000 });
    const uncached = createServer(db);
    const first = await request(cached).get("/api/value-bets?q=psg");
    expect(first.body.total).toBe(0);
    const fair = { "1": 1.5, X: 4, "2": 6 };
    saveReferenceOdds(db, "evt1", { fair, back: fair, lay: fair, matched: 1000 }, new Date().toISOString());
    expect((await request(cached).get("/api/value-bets?q=psg")).body).toEqual(first.body);
    expect((await request(uncached).get("/api/value-bets?q=psg")).body.total).toBe(1);
  });
});

describe("the winners of the competitions", () => {
  const hoursFromNow = (h: number) => new Date(Date.now() + h * 60 * 60 * 1000).toISOString();
  const prices = (best: number) => [
    { market: "Vainqueur", selection: "Paris Saint-Germain", price: best },
    { market: "Vainqueur", selection: "Olympique de Marseille", price: 3.2 },
    { market: "Vainqueur", selection: "AS Monaco", price: 4 },
  ];
  let db: DatabaseSync;

  beforeEach(() => {
    db = openDb(":memory:");
    upsertCanonicalEvents(db, [
      {
        id: "match",
        sport: "football",
        competition: "Ligue 1",
        startTime: hoursFromNow(2),
        participants: ["PSG", "OM"],
        byBookmaker: { winamax: [{ market: "1X2", selection: "1", price: 1.5 }] },
      },
      {
        id: "l1",
        sport: "football",
        competition: "Ligue 1 McDonald's®",
        startTime: hoursFromNow(24 * 200),
        participants: ["Ligue 1 2026/2027"],
        byBookmaker: { unibet: prices(1.5), vbet: prices(1.45) },
      },
    ]);
  });

  it("are not among the matches, but listed on ?kind=competition", async () => {
    const matches = await request(createServer(db)).get("/api/events?sport=football");
    expect(matches.body.events.map((e: { id: string }) => e.id)).toEqual(["match"]);
    expect((await request(createServer(db)).get("/api/sports")).body).toEqual(["football"]);

    const winners = await request(createServer(db)).get("/api/events?kind=competition");
    expect(winners.status).toBe(200);
    expect(winners.body.total).toBe(1);
    expect(winners.body.events[0]).toMatchObject({ id: "l1", sport: "football", participants: ["Ligue 1 2026/2027"] });
    expect(Object.keys(winners.body.events[0].byBookmaker).sort()).toEqual(["unibet", "vbet"]);
  });

  it("are searched and suggested on their own, and an unknown kind is the matches", async () => {
    const found = await request(createServer(db)).get("/api/events?kind=competition&q=ligue");
    expect(found.body.events.map((e: { id: string }) => e.id)).toEqual(["l1"]);
    expect((await request(createServer(db)).get("/api/events/suggestions?q=ligue")).body).toEqual([]);
    expect((await request(createServer(db)).get("/api/events/suggestions?q=ligue&kind=competition")).body).toEqual(["Ligue 1 2026/2027"]);
    const other = await request(createServer(db)).get("/api/events?kind=whatever");
    expect(other.body.events.map((e: { id: string }) => e.id)).toEqual(["match"]);
  });

  it("are listed with the matches on ?kind=all, narrowed to a competition by ?competition=", async () => {
    const ids = (body: { events: { id: string }[] }) => body.events.map((e) => e.id);
    const all = await request(createServer(db)).get("/api/events?sport=football&kind=all");
    expect(ids(all.body)).toEqual(["match", "l1"]);
    expect(all.body.total).toBe(2);

    const ligue1 = await request(createServer(db)).get("/api/events?sport=football&kind=all&competition=Ligue%201");
    expect(ids(ligue1.body)).toEqual(["match", "l1"]);
    const none = await request(createServer(db)).get("/api/events?sport=football&kind=all&competition=Ligue%202");
    expect(none.body.total).toBe(0);

    const suggestions = await request(createServer(db)).get("/api/events/suggestions?q=ligue&kind=all&competition=Ligue%201");
    expect(suggestions.body).toEqual(["Ligue 1 2026/2027"]);
  });

  it("have their competition listed for the filter, a sport's when given", async () => {
    expect((await request(createServer(db)).get("/api/competitions?sport=football")).body).toEqual(["Ligue 1"]);
    expect((await request(createServer(db)).get("/api/competitions")).body).toEqual(["Ligue 1"]);
    expect((await request(createServer(db)).get("/api/competitions?sport=tennis")).body).toEqual([]);
  });

  it("have a page of their own, with every market of the winner", async () => {
    const detail = await request(createServer(db)).get("/api/events/l1");
    expect(detail.status).toBe(200);
    expect(detail.body.participants).toEqual(["Ligue 1 2026/2027"]);
    // Its competition link leads to the matches' filter by that name.
    expect(detail.body.competitionFilter).toBe("Ligue 1");
    expect((await request(createServer(db)).get("/api/events/match")).body.competitionFilter).toBe("Ligue 1");
  });
});
