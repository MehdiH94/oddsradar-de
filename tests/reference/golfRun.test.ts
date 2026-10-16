import { describe, it, expect, beforeEach, vi } from "vitest";
import { gunzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { openDb } from "../../src/db/client";
import { getLatestEvents, getValueBets, saveMarketOdds, upsertCanonicalEvents } from "../../src/db/repository";
import { getEventDetail } from "../../src/db/eventDetail";
import { readBetclicMarkets, readBetclicMatchPage } from "../../src/scraper/betclicMarkets";
import { matchEvents } from "../../src/matcher/match";
import { parseEventPlayerMarkets, parsePriceFrames } from "../../src/reference/exchange";
import { runGolfReferenceCycle } from "../../src/reference/golfRun";
import { RawEvent } from "../../src/types";

// The exchange's golf search and winner prices of 6/10/2026 (13:00 UTC), against
// the five bookmakers' real tournaments the same day, all dates moved on by the
// time since: the listing counts from the real clock.
const read = (path: string) => JSON.parse(gunzipSync(readFileSync(join(__dirname, path))).toString());
const SHIFT = Date.now() - Date.parse("2026-10-06T13:00:00.000Z");
const moved = (iso: string) => new Date(Date.parse(iso) + SHIFT).toISOString();
const SEARCH = (() => {
  const body = read("fixtures/exchange-golf-search.json.gz");
  return { ...body, content: body.content.map((e: { openDate: number }) => ({ ...e, openDate: e.openDate + SHIFT })) };
})();
const PRICES = parsePriceFrames(read("fixtures/exchange-golf-frames.json.gz"));
const OURS = matchEvents(read("../matcher/fixtures/golf-winners-2026-10-06.json.gz") as Record<string, RawEvent[]>).map((e) => ({
  ...e,
  startTime: moved(e.startTime),
}));
const NOW = new Date();
// The tournaments' Top 5, 10 and 20 (their details and prices), and Betclic's of Baycurrent Classic.
const DETAILS = read("fixtures/exchange-golf-details.json.gz") as Record<string, unknown>;
const TOP_PRICES = parsePriceFrames(read("fixtures/exchange-golf-top-frames.json.gz"));
const BETCLIC_BAYCURRENT = readBetclicMarkets([
  readBetclicMatchPage(gunzipSync(readFileSync(join(__dirname, "../scraper/fixtures/markets/betclic-golf-baycurrent.bin.gz")))),
]);

describe("the golf reference cycle", () => {
  let db: DatabaseSync;
  let searches: { query: string; size?: number }[];
  let priced: string[][];
  const search = async (query: string, opts?: { size?: number }) => {
    searches.push({ query, size: opts?.size });
    return SEARCH;
  };
  const prices = async (markets: { marketId: string }[]) => {
    priced.push(markets.map((m) => m.marketId).sort());
    return PRICES;
  };
  const cycle = (now = NOW, override: Partial<Parameters<typeof runGolfReferenceCycle>[1]> = {}) =>
    runGolfReferenceCycle(db, {
      search,
      prices,
      // No Top N, unless a test gives some: never the exchange's own listing.
      playerMarkets: async () => [],
      playersCheckedAt: new Map(),
      now,
      oddsMaxAgeMs: 10 * 365 * 24 * 3600e3,
      ...override,
    });
  const rows = () =>
    db
      .prepare("SELECT e.participants AS tournament, r.market, r.selection, r.fair, r.back, r.lay, r.matched FROM reference_markets r JOIN events e ON e.id = r.event_id ORDER BY e.id, r.selection")
      .all() as { tournament: string; market: string; selection: string; fair: number | null; back: number | null; lay: number | null; matched: number }[];
  const tournaments = (rs: { tournament: string }[]) => [...new Set(rs.map((r) => JSON.parse(r.tournament)[0]))].sort();

  beforeEach(() => {
    db = openDb(":memory:");
    searches = [];
    priced = [];
    vi.spyOn(console, "log").mockImplementation(() => {});
    upsertCanonicalEvents(db, OURS);
  });

  it("prices the tournaments starting within 7 days with one search, and leaves the majors months away", async () => {
    await cycle();
    expect(searches).toEqual([{ query: "Golf", size: 50 }]);
    // The week's two tournaments only (the Masters is in April 2027).
    expect(priced).toHaveLength(1);
    expect(priced[0]).toHaveLength(2);
    expect(priced[0]).toContain("1.263390572"); // Baycurrent Classic's winner market
    const all = rows();
    expect(tournaments(all)).toEqual(["Baycurrent Classic 2026", "Open d'Espagne 2026"]);
    expect(new Set(all.map((r) => r.market))).toEqual(new Set(["Vainqueur"]));
    expect(all.filter((r) => r.tournament.includes("Baycurrent")).length).toBeGreaterThan(60);
    expect(all.some((r) => r.fair !== null)).toBe(true);
  });

  it("prices again each cycle, and keeps the last prices when the exchange does not answer", async () => {
    await cycle();
    const before = rows();
    await cycle(new Date(NOW.getTime() + 5 * 60_000), { prices: async () => new Map() });
    expect(rows()).toEqual(before);
  });

  it("fails on a search that fails, leaving the last prices", async () => {
    await cycle();
    const before = rows();
    await expect(cycle(NOW, { search: async () => Promise.reject(new Error("HTTP 500")) })).rejects.toThrow("HTTP 500");
    expect(rows()).toEqual(before);
  });

  it("does nothing, not even a search, when no tournament starts within 7 days", async () => {
    await cycle(new Date(NOW.getTime() + 400 * 24 * 3600e3));
    expect(searches).toEqual([]);
    expect(rows()).toEqual([]);
  });

  it("gives the listing the fair odds of a tournament's players, as the reference", async () => {
    await cycle();
    const listed = getLatestEvents(db, { sport: "golf", oddsMaxAgeMs: 10 * 365 * 24 * 3600e3 }).events;
    const baycurrent = listed.find((e) => e.participants[0] === "Baycurrent Classic 2026")!;
    expect(baycurrent.reference?.market).toBe("Vainqueur");
    expect(Object.keys(baycurrent.reference!.fair).length).toBeGreaterThan(15);
    expect(baycurrent.reference!.matched).toBeGreaterThan(10_000);
    // The majors months away have none.
    expect(listed.find((e) => /Augusta/.test(e.participants[0]))?.reference).toBeNull();
  });

  describe("Top N", () => {
    const LONG = { oddsMaxAgeMs: 10 * 365 * 24 * 3600e3, marketsMaxAgeMs: 10 * 365 * 24 * 3600e3 };
    const ID = () => (db.prepare("SELECT id FROM events WHERE participants LIKE '%Baycurrent%'").get() as { id: string }).id;
    const playerMarkets = async (exchangeEventId: string) => parseEventPlayerMarkets(DETAILS[exchangeEventId]);
    const withTop = (override: Partial<Parameters<typeof runGolfReferenceCycle>[1]> = {}) =>
      cycle(NOW, { playerMarkets, prices: async () => new Map([...PRICES, ...TOP_PRICES]), playersCheckedAt: new Map(), marketsMaxAgeMs: LONG.marketsMaxAgeMs, ...override });
    const players = () =>
      db.prepare("SELECT market, runner, player, fair, back, lay FROM reference_player_odds WHERE event_id = ? ORDER BY market, runner").all(ID()) as {
        market: string;
        runner: string;
        player: string | null;
        fair: number | null;
        back: number | null;
        lay: number | null;
      }[];

    beforeEach(() => {
      saveMarketOdds(db, [{ eventId: ID(), bookmakerId: "betclic", odds: BETCLIC_BAYCURRENT }], new Date().toISOString());
    });

    it("prices them as the players' markets of the tournament, each player under the bookmakers' name for him", async () => {
      await withTop();

      const rows = players();
      expect([...new Set(rows.map((r) => r.market))]).toEqual(["golf_top|10", "golf_top|20", "golf_top|5"]);
      const top5 = rows.filter((r) => r.market === "golf_top|5");
      expect(top5.filter((r) => r.player !== null).length).toBeGreaterThan(60);
      expect(top5.find((r) => r.runner === "Xander Schauffele")).toMatchObject({ player: "Xander Schauffele" });
      // Fair odds for those with a tight back and lay, as for a match's scorers.
      expect(top5.filter((r) => r.fair !== null).length).toBeGreaterThan(5);
    });

    it("lists the exchange's markets of a tournament once in half an hour, and keeps them when its listing fails", async () => {
      const asked: string[] = [];
      const listed = async (id: string) => {
        asked.push(id);
        return playerMarkets(id);
      };
      const checked = new Map<string, number>();
      await withTop({ playerMarkets: listed, playersCheckedAt: checked });
      await withTop({ playerMarkets: listed, playersCheckedAt: checked, now: new Date(NOW.getTime() + 5 * 60_000) });
      expect(asked.filter((id) => id === "36155980")).toHaveLength(1);

      vi.spyOn(console, "error").mockImplementation(() => {});
      await withTop({ playerMarkets: async () => Promise.reject(new Error("HTTP 500")), playersCheckedAt: new Map() });
      expect(players().length).toBeGreaterThan(100);
    });

    it("gives the tournament's page the fair odds of its Top 5's players", async () => {
      await withTop();
      const detail = getEventDetail(db, ID(), LONG)!;
      const top5 = detail.sections.flatMap((s) => s.markets).find((m) => m.key === "golf_top|5")!;

      expect(top5.lines[0].outcomes.filter((o) => o.fair !== undefined).length).toBeGreaterThan(5);
    });

    it("finds a bookmaker's price 30% above a player's fair odds in his Top 5, as a value bet", async () => {
      await withTop();
      const { player, fair } = db
        .prepare("SELECT player, fair FROM reference_player_odds WHERE event_id = ? AND market = 'golf_top|5' AND fair IS NOT NULL AND player IS NOT NULL ORDER BY fair DESC LIMIT 1")
        .get(ID()) as { player: string; fair: number };
      db.prepare("UPDATE event_market_odds SET price = ? WHERE event_id = ? AND bookmaker_id = 'betclic' AND market = 'golf_top|5' AND selection = ?").run(fair * 1.3, ID(), player);

      const bets = getValueBets(db, LONG).bets.filter((b) => b.market === "golf_top|5");
      expect(bets).toHaveLength(1);
      expect(bets[0]).toMatchObject({ marketLabel: "In the Top 5", label: player, bookmaker: "betclic", basis: "fair", fair });
      expect(bets[0].edge).toBeCloseTo(0.3, 9);
    });
  });

  describe("value bets", () => {
    const LONG = { oddsMaxAgeMs: 10 * 365 * 24 * 3600e3, marketsMaxAgeMs: 10 * 365 * 24 * 3600e3 };
    // Two players of Baycurrent Classic with fair odds, and Betclic's price of each moved to a given edge.
    async function withEdges(first: number, second: number) {
      await cycle();
      const id = (db.prepare("SELECT id FROM events WHERE participants LIKE '%Baycurrent%'").get() as { id: string }).id;
      const [one, two] = db
        .prepare("SELECT selection, fair FROM reference_markets WHERE event_id = ? AND fair IS NOT NULL ORDER BY fair LIMIT 2")
        .all(id) as { selection: string; fair: number }[];
      const move = db.prepare("UPDATE event_bookmaker_odds SET price = ? WHERE event_id = ? AND bookmaker_id = 'betclic' AND selection = ?");
      move.run(one.fair * (1 + first), id, one.selection);
      move.run(two.fair * (1 + second), id, two.selection);
      return { one, two };
    }

    it("finds a bookmaker's price 20% above a player's fair odds, from 5% up", async () => {
      const { one, two } = await withEdges(0.2, 0.03);
      const { bets } = getValueBets(db, LONG);
      expect(bets).toHaveLength(1);
      expect(bets[0]).toMatchObject({
        market: "Vainqueur",
        marketLabel: "Tournament winner",
        selection: one.selection,
        label: one.selection,
        bookmaker: "betclic",
        basis: "fair",
        fair: one.fair,
      });
      expect(bets[0].edge).toBeCloseTo(0.2, 9);
      expect(bets.map((b) => b.selection)).not.toContain(two.selection);
    });

    it("gives the listing a tournament's best edge, a value bet or not", async () => {
      const { one } = await withEdges(0.2, 0.03);
      const baycurrent = getLatestEvents(db, { sport: "golf", ...LONG }).events.find((e) => e.participants[0] === "Baycurrent Classic 2026")!;
      expect(baycurrent.value).toMatchObject({ selection: one.selection, bookmaker: "betclic" });
      expect(baycurrent.value!.edge).toBeCloseTo(0.2, 9);
      expect(baycurrent.reference?.minEdge).toBe(0.05);
    });
  });
});
