import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { DatabaseSync } from "node:sqlite";
import { openDb } from "../../src/db/client";
import { forgetStartedEvents, saveMarketOdds, upsertCanonicalEvents } from "../../src/db/repository";
import { getPlayerStats } from "../../src/db/playerStats";
import { MarketPrices, parseEventPlayerMarkets, parsePriceFrames, parseSearch } from "../../src/reference/exchange";
import { runReferenceCycle } from "../../src/reference/run";

// France v Italy as the exchange listed it on 2026-10-01: its event/details
// answer (its players' markets among 59) and the socket's frames for its
// Match Odds, Over/Under 2.5 and Player To Score, whose players had backs
// only (2.39 € each). A few players are given tighter prices on top.
const fixture = (name: string) =>
  JSON.parse(gunzipSync(readFileSync(`${__dirname}/fixtures/exchange-${name}.json.gz`)).toString());
const details = fixture("details");
const KICK_OFF: number = details.marketCatalogues[0].event.openDate;
const NOW = new Date(KICK_OFF - 30 * 60 * 60 * 1000);
const later = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);
// The bookmakers' prices below are saved at the real time, not the cycle's.
const ANY_AGE = 1e13;
const TO_SCORE = "1.263076777";
const DEMBELE = 10536894;
const DOUE = 43172153;
const BARCOLA = 40994502;
const KEAN = 11978344;

// The captured prices, with Dembélé's tight and well backed (2.00 / 2.06,
// 50 € and 40 €), Doué's tight but thin (5 €), Barcola's wider (2.68 / 3.10,
// 12 € and 15 €) and Kean's far apart.
function prices(overrides: Record<number, [number, number, number, number]> = {}): Map<string, MarketPrices> {
  const runner = ([back, lay, backSize, laySize]: [number, number, number, number]) => ({
    catb: [[back, backSize]],
    catl: [[lay, laySize]],
  });
  const tight: Record<number, [number, number, number, number]> = {
    [DEMBELE]: [2, 2.06, 50, 40],
    [DOUE]: [2.56, 2.6, 5, 5],
    [BARCOLA]: [2.68, 3.1, 12, 15],
    [KEAN]: [4, 9, 30, 30],
    ...overrides,
  };
  const frame = { id: TO_SCORE, rc: Object.entries(tight).map(([id, p]) => ({ id: Number(id), ...runner(p) })), tv: 1234 };
  return parsePriceFrames([...fixture("details-frames"), frame]);
}

const matchOdds = details.marketCatalogues.find((m: { description: { marketType: string } }) => m.description.marketType === "MATCH_ODDS");
const search = async () =>
  parseSearch({ content: [{ id: "36131173", name: "France v Italy", eventTypeId: "1", inPlay: false, openDate: KICK_OFF, topMarkets: [matchOdds] }] });

function lister(answer: () => unknown = () => details) {
  const asked: string[] = [];
  return Object.assign(
    async (id: string) => {
      asked.push(id);
      return parseEventPlayerMarkets(answer());
    },
    { asked }
  );
}

function pricer(map: Map<string, MarketPrices>) {
  const asked: string[][] = [];
  return Object.assign(
    async (markets: { marketId: string }[]) => {
      asked.push(markets.map((m) => m.marketId));
      return new Map(markets.filter((m) => map.has(m.marketId)).map((m) => [m.marketId, map.get(m.marketId)!]));
    },
    { asked }
  );
}

describe("the players' markets in the reference cycle", () => {
  let db: DatabaseSync;
  let searchedAt: Map<string, number>;
  let playersCheckedAt: Map<string, number>;
  const cycle = (now: Date, playerMarkets = lister(), map = prices()) =>
    runReferenceCycle(db, {
      search,
      playerMarkets,
      prices: pricer(map),
      now,
      oddsMaxAgeMs: ANY_AGE,
      marketsMaxAgeMs: ANY_AGE,
      searchedAt,
      playersCheckedAt,
    });
  const odds = () =>
    Object.fromEntries(
      (db.prepare("SELECT runner, player, back, lay, fair FROM reference_player_odds WHERE market = 'anytime_scorer'").all() as {
        runner: string;
        player: string | null;
        back: number | null;
        lay: number | null;
        fair: number | null;
      }[]).map((r) => [r.runner, r])
    );

  beforeEach(() => {
    db = openDb(":memory:");
    searchedAt = new Map();
    playersCheckedAt = new Map();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    upsertCanonicalEvents(db, [
      {
        id: "fra-ita",
        sport: "football",
        competition: "Ligue des Nations UEFA",
        startTime: new Date(KICK_OFF).toISOString(),
        participants: ["France", "Italie"],
        byBookmaker: {
          betclic: [
            { market: "1X2", selection: "1", price: 1.4 },
            { market: "1X2", selection: "X", price: 5.2 },
            { market: "1X2", selection: "2", price: 7 },
          ],
        },
      },
    ]);
    // The bookmakers' scorers, by their own spelling.
    saveMarketOdds(
      db,
      [
        {
          eventId: "fra-ita",
          bookmakerId: "winamax",
          odds: [
            { market: "anytime_scorer", selection: "Ousmane Dembélé", price: 2.2 },
            { market: "anytime_scorer", selection: "Désiré Doué", price: 2.8 },
            { market: "anytime_scorer", selection: "Bradley Barcola", price: 3 },
            { market: "anytime_scorer", selection: "Moïse Kean", price: 9 },
          ],
        },
        { eventId: "fra-ita", bookmakerId: "betclic", odds: [{ market: "anytime_scorer", selection: "Ousmane Dembélé", price: 1.95 }] },
      ],
      new Date().toISOString()
    );
  });

  it("lists a match's players' markets, then again half an hour later", async () => {
    const first = lister();
    await cycle(NOW, first);
    const soon = lister();
    await cycle(later(29), soon);
    const after = lister();
    await cycle(later(31), after);
    expect([first.asked, soon.asked, after.asked]).toEqual([["36131173"], [], ["36131173"]]);
  });

  it("prices them with the 1X2 in one read", async () => {
    const map = prices();
    const read = pricer(map);
    await runReferenceCycle(db, { search, playerMarkets: lister(), prices: read, now: NOW, oddsMaxAgeMs: ANY_AGE, searchedAt, playersCheckedAt });
    // The 1X2, then the scorer, first scorer, 2 goals and hat-trick markets.
    expect(read.asked).toEqual([["1.263076828", "1.263076777", "1.263076775", "1.263076747", "1.263076748"]]);
  });

  it("names each player as the bookmakers do, and keeps fair odds of reliable prices only", async () => {
    await cycle(NOW);
    const rows = odds();
    expect(rows["Ousmane Dembele"]).toEqual({
      runner: "Ousmane Dembele",
      player: "Ousmane Dembélé",
      back: 2,
      lay: 2.06,
      fair: expect.closeTo(2.03, 10),
    });
    // Tight but thin, 20% apart with too little money, far apart: not shown.
    expect(rows["Desire Doue"]).toMatchObject({ player: "Désiré Doué", fair: null });
    expect(rows["Bradley Barcola"]).toMatchObject({ player: "Bradley Barcola", fair: null });
    expect(rows["Moise Kean"]).toMatchObject({ player: "Moïse Kean", fair: null });
    // A back alone, and a player no bookmaker prices.
    expect(rows["Esteban Lepaul"]).toMatchObject({ player: null, back: 2.36, lay: null, fair: null });
    expect(Object.keys(rows)).toHaveLength(48);
  });

  it("shows fair odds from 20% apart with 20 € on both sides", async () => {
    await cycle(NOW, lister(), prices({ [BARCOLA]: [2.5, 3, 20, 25] }));
    expect(odds()["Bradley Barcola"].fair).toBeCloseTo(2.75, 10);
    await cycle(later(5), lister(), prices({ [BARCOLA]: [2.5, 3.01, 20, 25] }));
    expect(odds()["Bradley Barcola"].fair).toBeNull();
  });

  it("counts each player's reads at every level, and keeps a market's prices when it doesn't answer", async () => {
    await cycle(NOW);
    await cycle(later(5));
    const unanswered = prices();
    unanswered.delete(TO_SCORE);
    await cycle(later(10), lister(), unanswered);
    expect(odds()["Ousmane Dembele"].fair).toBeCloseTo(2.03, 10);

    const stats = Object.fromEntries(
      (db
        .prepare(
          "SELECT runner, reads, priced, loose, shown, spread, strict, best_spread AS bestSpread, best_size AS bestSize, first_strict_at AS firstStrict, last_strict_at AS lastStrict FROM reference_player_stats WHERE market = 'anytime_scorer'"
        )
        .all() as { runner: string }[]).map((r) => [r.runner, r])
    );
    expect(stats["Ousmane Dembele"]).toEqual({
      runner: "Ousmane Dembele",
      reads: 2,
      priced: 2,
      loose: 2,
      shown: 2,
      spread: 2,
      strict: 2,
      bestSpread: expect.closeTo(0.03, 10),
      bestSize: 40,
      firstStrict: expect.any(String),
      lastStrict: expect.any(String),
    });
    expect(stats["Desire Doue"]).toMatchObject({ priced: 2, loose: 0, shown: 0, spread: 2, strict: 0, firstStrict: null });
    expect(stats["Bradley Barcola"]).toMatchObject({ priced: 2, loose: 2, shown: 0, spread: 0, strict: 0 });
    expect(stats["Moise Kean"]).toMatchObject({ priced: 2, loose: 0, shown: 0, spread: 0, strict: 0 });
    expect(stats["Esteban Lepaul"]).toMatchObject({ reads: 2, priced: 0, bestSpread: null, bestSize: 0 });
  });

  const signals = () =>
    db
      .prepare(
        "SELECT player, bookmaker, basis, cycles, best_edge AS bestEdge, best_price AS bestPrice, best_reference AS bestReference, reference_bookmaker AS referenceBookmaker FROM reference_player_signals ORDER BY player, bookmaker"
      )
      .all();

  it("weighs every bookmaker price against the fair odds, else the lay, else the other bookmaker", async () => {
    // Lepaul and an unknown player: no lay on the exchange, both bookmakers.
    saveMarketOdds(
      db,
      [
        {
          eventId: "fra-ita",
          bookmakerId: "betclic",
          odds: [
            { market: "anytime_scorer", selection: "Ousmane Dembélé", price: 1.95 },
            { market: "anytime_scorer", selection: "Esteban Lepaul", price: 5 },
            { market: "anytime_scorer", selection: "Inconnu", price: 10 },
          ],
        },
        {
          eventId: "fra-ita",
          bookmakerId: "winamax",
          odds: [
            { market: "anytime_scorer", selection: "Ousmane Dembélé", price: 2.2 },
            { market: "anytime_scorer", selection: "Désiré Doué", price: 2.8 },
            { market: "anytime_scorer", selection: "Bradley Barcola", price: 3 },
            { market: "anytime_scorer", selection: "Moïse Kean", price: 9 },
            { market: "anytime_scorer", selection: "Esteban Lepaul", price: 3.5 },
            { market: "anytime_scorer", selection: "Inconnu", price: 9 },
          ],
        },
      ],
      new Date().toISOString()
    );
    await cycle(NOW);
    expect(signals()).toEqual([
      // Doué's Winamax 2.80: 7.7% above his lay of 2.60, his prices too thin
      // for fair odds.
      {
        player: "Désiré Doué",
        bookmaker: "winamax",
        basis: "lay",
        cycles: 1,
        bestEdge: expect.closeTo(2.8 / 2.6 - 1, 10),
        bestPrice: 2.8,
        bestReference: 2.6,
        referenceBookmaker: null,
      },
      // Lepaul has no lay: Betclic's 5.00 is 43% above Winamax's 3.50.
      {
        player: "Esteban Lepaul",
        bookmaker: "betclic",
        basis: "bookmaker",
        cycles: 1,
        bestEdge: expect.closeTo(5 / 3.5 - 1, 10),
        bestPrice: 5,
        bestReference: 3.5,
        referenceBookmaker: "winamax",
      },
      // Counted from 10% against a bookmaker: 11% here.
      {
        player: "Inconnu",
        bookmaker: "betclic",
        basis: "bookmaker",
        cycles: 1,
        bestEdge: expect.closeTo(10 / 9 - 1, 10),
        bestPrice: 10,
        bestReference: 9,
        referenceBookmaker: "winamax",
      },
      // Dembélé's Winamax 2.20: 8.4% above his fair 2.03.
      {
        player: "Ousmane Dembélé",
        bookmaker: "winamax",
        basis: "fair",
        cycles: 1,
        bestEdge: expect.closeTo(2.2 / 2.03 - 1, 10),
        bestPrice: 2.2,
        bestReference: expect.closeTo(2.03, 10),
        referenceBookmaker: null,
      },
    ]);
    // Barcola's 3.00 is under his lay of 3.10, Kean's 9.00 at his; Betclic's
    // 1.95 under Dembélé's fair odds.
    expect(db.prepare("SELECT * FROM reference_player_cycles").get()).toMatchObject({
      value_bets: 1,
      strict_value_bets: 1,
      lay_bets: 1,
      // Inconnu's 11% isn't shown.
      suspects: 1,
    });
  });

  it("keeps a signal's best edge and its count of cycles", async () => {
    await cycle(NOW);
    // Dembélé's prices move out: 2.10 / 2.14, 2.12 mid.
    await cycle(later(5), lister(), prices({ [DEMBELE]: [2.1, 2.14, 50, 40] }));
    expect(signals()).toContainEqual(
      expect.objectContaining({
        player: "Ousmane Dembélé",
        basis: "fair",
        cycles: 2,
        bestEdge: expect.closeTo(2.2 / 2.03 - 1, 10),
        bestReference: expect.closeTo(2.03, 10),
      })
    );
  });

  it("keeps the best money and the first reliable read when prices thin out", async () => {
    await cycle(NOW);
    // Dembélé's prices then thin out: 5 € a side.
    await cycle(later(5), lister(), prices({ [DEMBELE]: [2, 2.06, 5, 5] }));
    const row = db
      .prepare(
        "SELECT strict, best_size AS bestSize, first_strict_at AS firstStrict, last_strict_at AS lastStrict FROM reference_player_stats WHERE runner = 'Ousmane Dembele' AND market = 'anytime_scorer'"
      )
      .get() as { strict: number; bestSize: number; firstStrict: string | null; lastStrict: string | null };
    expect(row.strict).toBe(1);
    expect(row.bestSize).toBe(40);
    expect(row.firstStrict).not.toBeNull();
    expect(row.firstStrict).toBe(row.lastStrict);
  });

  it("counts a price from 1% above the fair odds, shows it from 5%", async () => {
    // Dembélé's fair odds are 2.03: Betclic's 2.05 is 0.99% above, 2.06 1.5%.
    const betclic = (price: number) =>
      saveMarketOdds(
        db,
        [{ eventId: "fra-ita", bookmakerId: "betclic", odds: [{ market: "anytime_scorer", selection: "Ousmane Dembélé", price }] }],
        new Date().toISOString()
      );
    const betclicSignals = () => (signals() as { bookmaker: string }[]).filter((s) => s.bookmaker === "betclic");
    betclic(2.05);
    await cycle(NOW);
    expect(betclicSignals()).toEqual([]);
    betclic(2.06);
    await cycle(later(5));
    expect(betclicSignals()).toEqual([expect.objectContaining({ player: "Ousmane Dembélé", basis: "fair" })]);
    // Counted, not shown: only Winamax's 8.4%.
    expect((db.prepare("SELECT value_bets FROM reference_player_cycles ORDER BY at DESC").get() as { value_bets: number }).value_bets).toBe(1);
  });

  it("tells the value bets on prices as tight as a 1X2's from the others", async () => {
    // Barcola's prices 2.50 / 2.90, 25 € a side: shown, 16% apart. Winamax's
    // 3.00 is 11% above their 2.70 mid.
    await cycle(NOW, lister(), prices({ [BARCOLA]: [2.5, 2.9, 25, 25] }));
    expect(db.prepare("SELECT value_bets, strict_value_bets FROM reference_player_cycles").get()).toEqual({
      value_bets: 2,
      strict_value_bets: 1,
    });
  });

  it("logs each cycle's totals", async () => {
    await cycle(NOW);
    expect(db.prepare("SELECT * FROM reference_player_cycles").all()).toEqual([
      {
        at: expect.any(String),
        matches: 1,
        markets: 1,
        runners: 48,
        priced: 4,
        loose: 2,
        shown: 1,
        spread: 2,
        strict: 1,
        players: 4,
        value_bets: 1,
        strict_value_bets: 1,
        lay_bets: 1,
        suspects: 0,
      },
    ]);
  });

  it("weighs the bookmakers of a match the exchange doesn't list", async () => {
    upsertCanonicalEvents(db, [
      {
        id: "petit",
        sport: "football",
        competition: "National",
        startTime: new Date(KICK_OFF + 3600e3).toISOString(),
        participants: ["Petit", "Club"],
        byBookmaker: { betclic: [{ market: "1X2", selection: "1", price: 2 }] },
      },
    ]);
    saveMarketOdds(
      db,
      [
        { eventId: "petit", bookmakerId: "winamax", odds: [{ market: "first_scorer", selection: "Buteur Fou", price: 20 }] },
        { eventId: "petit", bookmakerId: "betclic", odds: [{ market: "first_scorer", selection: "Buteur Fou", price: 12 }] },
      ],
      new Date().toISOString()
    );
    // The exchange finds nothing this time.
    await runReferenceCycle(db, {
      search: async () => [],
      playerMarkets: lister(),
      prices: pricer(prices()),
      now: NOW,
      oddsMaxAgeMs: ANY_AGE,
      marketsMaxAgeMs: ANY_AGE,
      searchedAt,
      playersCheckedAt,
    });
    // France - Italie's players too, now against each other's bookmaker: only
    // Buteur Fou's 20 (+67%) is far enough above to show as suspect.
    expect(signals()).toEqual([
      expect.objectContaining({ player: "Buteur Fou", bookmaker: "winamax", basis: "bookmaker", bestReference: 12 }),
      expect.objectContaining({ player: "Ousmane Dembélé", bookmaker: "winamax", basis: "bookmaker", bestReference: 1.95 }),
    ]);
    expect(db.prepare("SELECT markets, suspects FROM reference_player_cycles").get()).toEqual({ markets: 0, suspects: 1 });
    // Counted, never shown on the site.
    expect(getPlayerStats(db, "2000-01-01T00:00:00.000Z").list.find((b) => b.player === "Buteur Fou")).toMatchObject({
      basis: "bookmaker",
      shown: false,
    });
  });

  it("keeps the last markets when listing them fails", async () => {
    await cycle(NOW);
    const failing = Object.assign(async () => {
      throw new Error("HTTP 503");
    }, {});
    await cycle(later(31), failing);
    expect(odds()["Ousmane Dembele"].fair).toBeCloseTo(2.03, 10);
    expect((db.prepare("SELECT COUNT(*) AS n FROM reference_player_markets").get() as { n: number }).n).toBe(4);
  });

  it("forgets the prices with the match, never the stats", async () => {
    await cycle(NOW);
    forgetStartedEvents(db, new Date(KICK_OFF + 1).toISOString());
    expect((db.prepare("SELECT COUNT(*) AS n FROM reference_player_odds").get() as { n: number }).n).toBe(0);
    expect((db.prepare("SELECT COUNT(*) AS n FROM reference_player_markets").get() as { n: number }).n).toBe(0);
    const summary = getPlayerStats(db, "2000-01-01T00:00:00.000Z");
    expect([summary.totals.runners, summary.list.length]).toEqual([48, 2]);
  });

  it("sums it all up since a time", async () => {
    // Betclic's 2.06 on Dembélé: 1.5% above his fair odds, counted, not shown.
    saveMarketOdds(
      db,
      [{ eventId: "fra-ita", bookmakerId: "betclic", odds: [{ market: "anytime_scorer", selection: "Ousmane Dembélé", price: 2.06 }] }],
      new Date().toISOString()
    );
    await cycle(NOW);
    await cycle(later(5));
    const summary = getPlayerStats(db, "2000-01-01T00:00:00.000Z");
    expect(summary.cycles).toBe(2);
    expect(summary.totals).toEqual({
      matches: 1,
      markets: 1,
      runners: 48,
      players: 4,
      runnersEver: { priced: 4, loose: 2, shown: 1, spread: 2, strict: 1 },
      reads: { all: 96, priced: 8, loose: 4, shown: 2, spread: 4, strict: 2 },
    });
    // Dembélé's 8.4% against his fair odds, Doué's 7.7% against his lay.
    expect(summary.signals).toEqual({
      fair: { "1%": 2, "3%": 1, "5%": 1, "10%": 0, "20%": 0 },
      lay: { "1%": 1, "3%": 1, "5%": 1, "10%": 0, "20%": 0 },
      bookmaker: { "10%": 0, "20%": 0, "30%": 0, "50%": 0 },
    });
    expect(summary.matches).toEqual([
      {
        eventId: "fra-ita",
        participants: ["France", "Italie"],
        competition: "Ligue des Nations UEFA",
        startTime: new Date(KICK_OFF).toISOString(),
        markets: 1,
        runners: 48,
        shownRunners: 1,
        shownReads: 2,
        matched: 1234,
        shownSignals: { fair: 1, lay: 1, bookmaker: 0 },
      },
    ]);
    expect(summary.byCompetition).toEqual([
      { competition: "Ligue des Nations UEFA", matches: 1, runners: 48, shownRunners: 1, matched: 1234 },
    ]);
    // Shown first, then by edge.
    expect(summary.list.map((b) => [b.player, b.bookmaker, b.basis, b.shown, b.participants.join(" - ")])).toEqual([
      ["Ousmane Dembélé", "winamax", "fair", true, "France - Italie"],
      ["Désiré Doué", "winamax", "lay", true, "France - Italie"],
      ["Ousmane Dembélé", "betclic", "fair", false, "France - Italie"],
    ]);
    // By the hour the cycles ran.
    expect(summary.hours.every((h) => /^\d{4}-\d\d-\d\dT\d\d$/.test(h.hour))).toBe(true);
    expect(Math.max(...summary.hours.map((h) => h.shown))).toBe(1);
    expect(Math.max(...summary.hours.map((h) => h.layBets))).toBe(1);
    // Nothing since after the last read.
    const empty = getPlayerStats(db, new Date(Date.now() + 60_000).toISOString());
    expect([empty.cycles, empty.totals.runners, empty.list.length]).toEqual([0, 0, 0]);
  });
});
