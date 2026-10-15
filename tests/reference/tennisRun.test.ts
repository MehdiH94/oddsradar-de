import { describe, it, expect, beforeEach, vi } from "vitest";
import { gunzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { openDb } from "../../src/db/client";
import { getLatestEvents, getValueBets, saveMarketOdds, upsertCanonicalEvents } from "../../src/db/repository";
import { getEventDetail } from "../../src/db/eventDetail";
import { parsePriceFrames } from "../../src/reference/exchange";
import { parseTennisMarkets, TennisExchangeEvent } from "../../src/reference/tennis";
import { runTennisReferenceCycle } from "../../src/reference/tennisRun";
import { isGem } from "../../src/alerts/gems";
import { CanonicalEvent } from "../../src/types";

// Vekic - Swiatek on the exchange (4/10/2026): its markets and prices.
const FIXTURES = join(__dirname, "fixtures");
const read = (name: string) => JSON.parse(gunzipSync(readFileSync(join(FIXTURES, name))).toString());
const DETAILS = read("exchange-tennis-details.json.gz");
const FRAMES = read("exchange-tennis-frames.json.gz");
const NOW = new Date();
const later = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);
const KICK_OFF = new Date(NOW.getTime() + 5 * 3600e3).toISOString();

function match(id: string, participants: string[], competition = "Pékin WTA", winner = [8.5, 1.14]): CanonicalEvent {
  return {
    id,
    sport: "tennis",
    competition,
    startTime: KICK_OFF,
    participants,
    byBookmaker: {
      winamax: [
        { market: "Vainqueur du match", selection: "1", price: winner[0] },
        { market: "Vainqueur du match", selection: "2", price: winner[1] },
      ],
    },
  };
}

describe("the tennis reference cycle", () => {
  let db: DatabaseSync;
  let searches: string[];
  let listed: string[];
  const search = async (query: string): Promise<TennisExchangeEvent[]> => {
    searches.push(query);
    return query === "vekic" || query === "swiatek" ? [{ eventId: "36146908", players: ["Vekic", "Iga Swiatek"] }] : [];
  };
  const markets = async (id: string) => {
    listed.push(id);
    return parseTennisMarkets(DETAILS);
  };
  const prices = async () => parsePriceFrames(FRAMES);
  const cycle = (now = NOW) => runTennisReferenceCycle(db, { search, markets, prices, now, oddsMaxAgeMs: 24 * 3600e3, searchedAt: new Map() });

  beforeEach(() => {
    db = openDb(":memory:");
    searches = [];
    listed = [];
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it("places a main tour's match, lists its markets and prices them", async () => {
    upsertCanonicalEvents(db, [match("vs", ["Donna Vekic", "Iga Swiatek"]), match("itf", ["Donna Vekic", "Iga Swiatek"], "ITF Monastir")]);
    await cycle();
    expect(searches).toEqual(["vekic"]);
    expect(listed).toEqual(["36146908"]);
    const rows = db.prepare("SELECT event_id AS e, market, selection, fair FROM reference_markets").all() as {
      e: string;
      market: string;
      selection: string;
      fair: number | null;
    }[];
    expect(new Set(rows.map((r) => r.e))).toEqual(new Set(["vs"]));
    expect(rows.filter((r) => r.fair !== null).map((r) => `${r.market} ${r.selection}`).sort()).toEqual([
      "Vainqueur du match 1",
      "Vainqueur du match 2",
      "games_handicap|5.5 1",
      "games_handicap|5.5 2",
      "games_handicap|6.5 1",
      "games_handicap|6.5 2",
      "total_games|17.5 over",
      "total_games|17.5 under",
      "total_games|18.5 over",
      "total_games|18.5 under",
      "total_games|19.5 over",
      "total_games|19.5 under",
    ]);

    // Listed again after half an hour only.
    await cycle(later(10));
    expect(listed).toHaveLength(1);
    await cycle(later(31));
    expect(listed).toHaveLength(2);
    expect(searches).toEqual(["vekic"]);
  });

  it("turns the exchange's players round when our match names them the other way", async () => {
    upsertCanonicalEvents(db, [match("sv", ["Iga Swiatek", "Donna Vekic"], "Pékin WTA", [1.14, 8.5])]);
    await cycle();
    const fair = (market: string, selection: string) =>
      (db.prepare("SELECT fair FROM reference_markets WHERE market = ? AND selection = ?").get(market, selection) as { fair: number }).fair;
    // Swiatek -5.5 games is now player 1's line.
    expect(fair("games_handicap|-5.5", "1")).toBeLessThan(fair("games_handicap|-5.5", "2"));
    expect(fair("Vainqueur du match", "1")).toBeLessThan(1.2);
  });

  it("keeps each player's prices on them when our match lists its players the other way round later", async () => {
    upsertCanonicalEvents(db, [match("vs", ["Donna Vekic", "Iga Swiatek"])]);
    await cycle();
    const fair = (selection: string) =>
      (db.prepare("SELECT fair FROM reference_markets WHERE market = 'Vainqueur du match' AND selection = ?").get(selection) as {
        fair: number;
      }).fair;
    expect(fair("2")).toBeLessThan(1.2);
    // The same match (the same id), Swiatek now first.
    upsertCanonicalEvents(db, [match("vs", ["Iga Swiatek", "Donna Vekic"], "Pékin WTA", [1.14, 8.5])]);
    await cycle(later(5));
    expect(searches).toEqual(["vekic"]);
    expect(fair("1")).toBeLessThan(1.2);
    expect(fair("2")).toBeGreaterThan(5);
  });

  it("searches again a match found before the order of its players was kept", async () => {
    upsertCanonicalEvents(db, [match("vs", ["Donna Vekic", "Iga Swiatek"])]);
    db.prepare(
      `INSERT INTO reference_tennis_sources (event_id, exchange_event_id, reversed, seen_at)
       VALUES ('vs', '36146908', 1, '2026-10-05T10:00:00.000Z')`
    ).run();
    await cycle();
    expect(searches).toEqual(["vekic"]);
    expect(db.prepare("SELECT reversed, participants FROM reference_tennis_sources").get()).toEqual({
      reversed: 0,
      participants: JSON.stringify(["Donna Vekic", "Iga Swiatek"]),
    });
  });

  it("searches a match the exchange doesn't list again after half an hour only", async () => {
    upsertCanonicalEvents(db, [match("x", ["Coco Gauff", "Xinran Sun"])]);
    const searchedAt = new Map<string, number>();
    const run = (now: Date) => runTennisReferenceCycle(db, { search, markets, prices, now, oddsMaxAgeMs: 24 * 3600e3, searchedAt });
    await run(NOW);
    expect(searches).toEqual(["gauff", "sun"]);
    await run(later(10));
    expect(searches).toHaveLength(2);
    await run(later(31));
    expect(searches).toHaveLength(4);
  });

  describe("its value bets", () => {
    beforeEach(async () => {
      upsertCanonicalEvents(db, [match("vs", ["Donna Vekic", "Iga Swiatek"], "Pékin WTA", [9.6, 1.12])]);
      await cycle();
      saveMarketOdds(
        db,
        [
          {
            eventId: "vs",
            bookmakerId: "winamax",
            odds: [
              // Vekic +5.5 games: 2.55 is 8% above the fair 2.36.
              { market: "games_handicap|5.5", selection: "1", price: 2.55 },
              { market: "games_handicap|5.5", selection: "2", price: 1.55 },
              // Over 20.5 games: no fair odds (2.6/3.35), 3.6 is 7.5% above the lay 3.35.
              { market: "total_games|20.5", selection: "over", price: 3.6 },
              { market: "total_games|20.5", selection: "under", price: 1.25 },
            ],
          },
        ],
        new Date().toISOString()
      );
    });

    it("marks them on the match's page, the winner's as a 1X2's", () => {
      const detail = getEventDetail(db, "vs")!;
      const market = (key: string) => detail.sections.flatMap((s) => s.markets).find((m) => m.key === key)!;
      const outcome = (key: string, o: string) => market(key).lines.flatMap((l) => l.outcomes).find((x) => x.key === o)!;
      // Winamax's 9.60 on Vekic, 7.7% above her fair 8.91.
      expect(outcome("Vainqueur du match", "1")).toMatchObject({ fair: expect.closeTo(8.911, 2), edges: { winamax: expect.closeTo(9.6 / 8.911 - 1, 2) } });
      expect(outcome("games_handicap|5.5", "1")).toMatchObject({ fair: expect.closeTo(2.36, 2), edges: { winamax: expect.closeTo(0.081, 2) } });
      expect(outcome("games_handicap|5.5", "2").edges).toEqual({});
      const lines = market("total_games").lines;
      expect(lines.find((l) => l.line === 20.5)!.outcomes.find((o) => o.key === "over")).toMatchObject({
        fair: 3.35,
        fairIsCeiling: true,
        edges: { winamax: expect.closeTo(3.6 / 3.35 - 1, 10) },
      });
    });

    it("lists them in the category, and the match by value in the listing", () => {
      const bets = getValueBets(db, { sort: "value" }).bets.map((b) => [b.marketLabel, b.label, b.basis, Number(b.edge.toFixed(3))]);
      expect(bets).toEqual([
        ["Games handicap: Donna Vekic +5.5", "Donna Vekic does not lose, or loses by at most 5 games", "fair", 0.08],
        ["Match winner", "Donna Vekic", "fair", 0.077],
        ["Total games (20.5 games)", "Over 20.5", "lay", 0.075],
      ]);
      const listed = getLatestEvents(db, { sport: "tennis", sort: "value" }).events[0];
      expect(listed.reference?.fair["1"]).toBeCloseTo(8.911, 2);
      expect(listed.value).toMatchObject({ selection: "1", bookmaker: "winamax" });
    });

    it("makes a gem of the winner from 5%, of the other markets from 15%", () => {
      expect(isGem({ market: "Vainqueur du match", edge: 0.077 })).toBe(true);
      expect(isGem({ market: "games_handicap|5.5", edge: 0.081 })).toBe(false);
      expect(isGem({ market: "total_games|20.5", edge: 0.15 })).toBe(true);
    });
  });
});
