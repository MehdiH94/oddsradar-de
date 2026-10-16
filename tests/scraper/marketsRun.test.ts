import { describe, it, expect, beforeEach, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { openDb } from "../../src/db/client";
import { saveMarketOdds, upsertCanonicalEvents } from "../../src/db/repository";
import { runMarketsCycle, MarketsFetcher, MARKET_FETCHERS, MARKETS_BY_BOOKMAKER } from "../../src/scraper/marketsRun";
import { MARKET_SPORTS, playerMarketKey } from "../../src/markets/catalog";
import { CanonicalEvent, RawOdds } from "../../src/types";

const hoursFromNow = (h: number) => new Date(Date.now() + h * 60 * 60 * 1000).toISOString();

function event(overrides: Partial<CanonicalEvent> = {}): CanonicalEvent {
  return {
    id: "bvb",
    sport: "football",
    competition: "Bundesliga",
    startTime: hoursFromNow(5),
    participants: ["Borussia Dortmund", "Werder Brême"],
    byBookmaker: { betclic: [{ market: "1X2", selection: "1", price: 1.33 }] },
    sources: {
      betclic: { sourceId: "b1", participants: ["Borussia Dortmund", "Werder Brême"] },
      winamax: { sourceId: "w1", participants: ["Borussia Dortmund", "Werder Brême"] },
    },
    ...overrides,
  };
}

// A fetcher answering the given prices for the given ids, recording what it
// was asked for.
function fetcher(byId: Record<string, RawOdds[]>): MarketsFetcher & { asked: string[][] } {
  const asked: string[][] = [];
  const fn = async (ids: readonly string[]) => {
    asked.push([...ids]);
    return new Map(ids.filter((id) => byId[id]).map((id) => [id, byId[id]]));
  };
  return Object.assign(fn, { asked });
}

function stored(db: DatabaseSync, bookmaker: string): Record<string, number> {
  const rows = db
    .prepare("SELECT market, selection, price FROM event_market_odds WHERE bookmaker_id = ?")
    .all(bookmaker) as { market: string; selection: string; price: number }[];
  return Object.fromEntries(rows.map((r) => [`${r.market} ${r.selection}`, r.price]));
}

describe("MARKET_FETCHERS", () => {
  it("has the markets of every bookmaker the listing reads", () => {
    expect(Object.keys(MARKET_FETCHERS).sort()).toEqual(["betclic", "leovegas", "winamax"]);
  });
});

describe("MARKETS_BY_BOOKMAKER", () => {
  it("names the sports each bookmaker's markets are read for, among the catalog's", () => {
    expect(Object.keys(MARKETS_BY_BOOKMAKER).sort()).toEqual(Object.keys(MARKET_FETCHERS).sort());
    for (const sports of Object.values(MARKETS_BY_BOOKMAKER)) for (const sport of sports) expect(MARKET_SPORTS).toContain(sport);
  });

  it("gives the sports beyond the base to the bookmakers that have a reader for them only", () => {
    const readers = Object.entries(MARKETS_BY_BOOKMAKER).filter(([, sports]) => sports.has("hockey sur glace"));
    expect(readers.map(([bookmaker]) => bookmaker)).toEqual(["leovegas"]);
    // Winamax and Betclic have no table for them: Betclic would read their markets as football's.
    expect(MARKETS_BY_BOOKMAKER.betclic.has("handball")).toBe(false);
  });
});

describe("runMarketsCycle", () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = openDb(":memory:");
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it("stores each bookmaker's markets under the event, asking each by its own id", async () => {
    upsertCanonicalEvents(db, [event()]);
    const winamax = fetcher({ w1: [{ market: "btts", selection: "yes", price: 1.5 }] });
    const betclic = fetcher({ b1: [{ market: "btts", selection: "yes", price: 1.52 }] });

    await runMarketsCycle(db, { fetchers: { winamax, betclic } });

    expect(winamax.asked).toEqual([["w1"]]);
    expect(betclic.asked).toEqual([["b1"]]);
    expect(stored(db, "winamax")).toEqual({ "btts yes": 1.5 });
    expect(stored(db, "betclic")).toEqual({ "btts yes": 1.52 });
  });

  it("stores a football match's markets of every bookmaker that has them, beside Winamax's and Betclic's", async () => {
    const teams = ["Borussia Dortmund", "Werder Brême"];
    upsertCanonicalEvents(db, [
      event({
        sources: {
          betclic: { sourceId: "b1", participants: teams },
          betsson: { sourceId: "4291432.1", participants: teams },
          vbet: { sourceId: "31142978", participants: teams },
          unibet: { sourceId: "e3380539", participants: teams },
          netbet: { sourceId: "12087507", participants: teams },
        },
      }),
    ]);
    const prices = { betsson: 1.45, vbet: 1.86, unibet: 1.52, netbet: 1.02 };
    const fetchers = {
      betsson: fetcher({ "4291432.1": [{ market: "total_goals|2.5", selection: "over", price: prices.betsson }] }),
      vbet: fetcher({ "31142978": [{ market: "total_goals|2.5", selection: "over", price: prices.vbet }] }),
      unibet: fetcher({ e3380539: [{ market: "total_goals|2.5", selection: "over", price: prices.unibet }] }),
      netbet: fetcher({ "12087507": [{ market: "total_goals|2.5", selection: "over", price: prices.netbet }] }),
    };

    await runMarketsCycle(db, { fetchers });

    expect(fetchers.betsson.asked).toEqual([["4291432.1"]]);
    expect(fetchers.netbet.asked).toEqual([["12087507"]]);
    for (const [bookmaker, price] of Object.entries(prices)) {
      expect(stored(db, bookmaker), bookmaker).toEqual({ "total_goals|2.5 over": price });
    }
  });

  it("asks a bookmaker only for the sports it reads: not Betclic for an ice hockey match", async () => {
    upsertCanonicalEvents(db, [
      event({
        id: "nhl",
        sport: "hockey sur glace",
        competition: "NHL",
        participants: ["Washington Capitals", "Montréal Canadiens"],
        sources: {
          betclic: { sourceId: "b-nhl", participants: ["Washington Capitals", "Montréal Canadiens"] },
          pmu: { sourceId: "p-nhl", participants: ["Washington Capitals", "Montréal Canadiens"] },
        },
      }),
    ]);
    const betclic = fetcher({ "b-nhl": [{ market: "btts", selection: "yes", price: 1.5 }] });
    const pmu = fetcher({ "p-nhl": [{ market: "total_goals|5.5", selection: "over", price: 1.9 }] });

    await runMarketsCycle(db, { fetchers: { betclic, pmu } });

    expect(betclic.asked.flat()).toEqual([]);
    expect(pmu.asked).toEqual([["p-nhl"]]);
    expect(stored(db, "betclic")).toEqual({});
    expect(stored(db, "pmu")).toEqual({ "total_goals|5.5 over": 1.9 });
  });

  it("reads a golf tournament's markets within 7 days, where a match's are within 48 hours", async () => {
    const tournament = (id: string, hours: number): CanonicalEvent =>
      event({
        id,
        sport: "golf",
        competition: "",
        participants: [`Tournament ${id}`],
        startTime: hoursFromNow(hours),
        byBookmaker: { betclic: [{ market: "Vainqueur", selection: "Xander Schauffele", price: 10 }] },
        sources: { betclic: { sourceId: `b-${id}`, participants: [`Tournament ${id}`] } },
      });
    upsertCanonicalEvents(db, [
      tournament("soon", 5 * 24),
      tournament("far", 10 * 24),
      // A match 4 days away is beyond its 48 hours.
      event({ id: "later", startTime: hoursFromNow(4 * 24), sources: { betclic: { sourceId: "b-later", participants: ["Borussia Dortmund", "Werder Brême"] } } }),
    ]);
    const top5: RawOdds[] = [{ market: "golf_top|5", selection: "Xander Schauffele", price: 2.9 }];
    const betclic = fetcher({ "b-soon": top5, "b-far": top5, "b-later": [{ market: "btts", selection: "yes", price: 1.5 }] });

    await runMarketsCycle(db, { fetchers: { betclic } });

    expect(betclic.asked).toEqual([["b-soon"]]);
    expect(stored(db, "betclic")).toEqual({ "golf_top|5 Xander Schauffele": 2.9 });
  });

  it("asks each bookmaker for the events it lists, a tournament's Top N and a match's markets alike", async () => {
    upsertCanonicalEvents(db, [
      event({
        id: "match",
        sources: { vbet: { sourceId: "v-match", participants: ["Borussia Dortmund", "Werder Brême"] }, betclic: { sourceId: "b1", participants: ["Borussia Dortmund", "Werder Brême"] } },
      }),
      event({
        id: "open",
        sport: "golf",
        competition: "",
        participants: ["Open d'Espagne 2026"],
        startTime: hoursFromNow(48),
        byBookmaker: { betclic: [{ market: "Vainqueur", selection: "Ludvig Aberg", price: 8.5 }] },
        sources: {
          betclic: { sourceId: "b-open", participants: ["Open d'Espagne 2026"] },
          vbet: { sourceId: "v-open", participants: ["Open d'Espagne"] },
          unibet: { sourceId: "e3386260", participants: ["Open d'Espagne 2026"] },
        },
      }),
    ]);
    // Betclic seeds the players' names: Unibet's "L. Aberg" is its "Ludvig Aberg".
    const betclic = fetcher({ "b-open": [{ market: "golf_top|5", selection: "Ludvig Aberg", price: 3 }] });
    const vbet = fetcher({ "v-open": [{ market: "golf_top|10", selection: "Ludvig Aberg", price: 2.2 }] });
    const unibet = fetcher({ e3386260: [{ market: "golf_top|5", selection: "L. Aberg", price: 3.1 }] });

    await runMarketsCycle(db, { fetchers: { betclic, vbet, unibet } });

    // Vbet's football and tennis matches have every market a family covers (src/scraper/vbetMarkets.ts).
    expect(vbet.asked.flat().sort()).toEqual(["v-match", "v-open"]);
    expect(unibet.asked).toEqual([["e3386260"]]);
    expect(stored(db, "vbet")).toEqual({ "golf_top|10 Ludvig Aberg": 2.2 });
    expect(stored(db, "unibet")).toEqual({ "golf_top|5 Ludvig Aberg": 3.1 });
  });

  it("names a player after the seed in each market, though a bookmaker spells him two ways in them", async () => {
    upsertCanonicalEvents(db, [
      event({
        id: "open",
        sport: "golf",
        competition: "",
        participants: ["Baycurrent Classic 2026"],
        startTime: hoursFromNow(48),
        byBookmaker: { betclic: [{ market: "Vainqueur", selection: "Xander Schauffele", price: 10 }] },
        sources: {
          betclic: { sourceId: "b-open", participants: ["Baycurrent Classic 2026"] },
          winamax: { sourceId: "w-open", participants: ["Baycurrent Classic 2026"] },
        },
      }),
    ]);
    const betclic = fetcher({
      "b-open": [
        { market: "golf_top|5", selection: "Xander Schauffele", price: 2.9 },
        { market: "golf_best_americain", selection: "Xander Schauffele", price: 7.5 },
      ],
    });
    // Winamax: "Surname, First" in the Top 5, "First Surname" in the best American.
    const winamax = fetcher({
      "w-open": [
        { market: "golf_top|5", selection: "Schauffele, Xander", price: 2.8 },
        { market: "golf_best_americain", selection: "Xander Schauffele", price: 8 },
      ],
    });

    await runMarketsCycle(db, { fetchers: { betclic, winamax } });

    expect(stored(db, "winamax")).toEqual({
      "golf_top|5 Xander Schauffele": 2.8,
      "golf_best_americain Xander Schauffele": 8,
    });
  });

  it("turns round a bookmaker that lists the teams the other way", async () => {
    upsertCanonicalEvents(db, [
      event({ sources: { winamax: { sourceId: "w1", participants: ["Werder Brême", "Borussia Dortmund"] } } }),
    ]);
    const winamax = fetcher({
      w1: [
        { market: "double_chance", selection: "1X", price: 2.8 },
        { market: "team_goals@1|1.5", selection: "over", price: 1.26 },
        { market: "correct_score", selection: "2-1", price: 16 },
        { market: "winning_margin", selection: "1:2", price: 19 },
        { market: "wx:Quelle équipe va marquer ?", selection: "Seulement Werder", price: 2.5 },
        { market: "handicap|-1.5", selection: "1", price: 7.75 },
        { market: "header_goal", selection: "no@1", price: 1.04 },
      ],
    });

    await runMarketsCycle(db, { fetchers: { winamax } });

    expect(stored(db, "winamax")).toEqual({
      "double_chance X2": 2.8,
      "team_goals@2|1.5 over": 1.26,
      "correct_score 1-2": 16,
      "winning_margin 2:2": 19,
      "wx:Quelle équipe va marquer ? Seulement Werder": 2.5,
      // Werder -1.5 is Dortmund +1.5.
      "handicap|1.5 2": 7.75,
      "header_goal no@2": 1.04,
    });
  });

  it("names each player after the seed bookmaker, so one player's prices share a row", async () => {
    upsertCanonicalEvents(db, [event()]);
    const betclic = fetcher({ b1: [{ market: "anytime_scorer", selection: "Vinícius Júnior", price: 2.1 }] });
    const winamax = fetcher({
      w1: [
        { market: "anytime_scorer", selection: "Vinicius Junior", price: 2.2 },
        { market: "first_scorer", selection: "Vinicius Junior", price: 5.5 },
        { market: "anytime_scorer", selection: "Kylian Mbappé", price: 1.8 },
      ],
    });

    await runMarketsCycle(db, { fetchers: { winamax, betclic } });

    expect(stored(db, "winamax")).toEqual({
      "anytime_scorer Vinícius Júnior": 2.2,
      "first_scorer Vinícius Júnior": 5.5,
      "anytime_scorer Kylian Mbappé": 1.8,
    });
  });

  it("names a pair of players after the seed bookmaker's full names, in name order", async () => {
    upsertCanonicalEvents(db, [event()]);
    const betclic = fetcher({
      b1: [
        { market: "anytime_scorer", selection: "João Félix", price: 2.2 },
        { market: "anytime_scorer", selection: "Rasmus Højlund", price: 2.9 },
        { market: "scorer_double_chance", selection: "R. Højlund / J. Félix", price: 1.8 },
      ],
    });
    const winamax = fetcher({ w1: [{ market: "scorer_double_chance", selection: "J. Felix / R. Hojlund", price: 1.78 }] });

    await runMarketsCycle(db, { fetchers: { winamax, betclic } });

    expect(stored(db, "winamax")).toEqual({ "scorer_double_chance João Félix / Rasmus Højlund": 1.78 });
    expect(stored(db, "betclic")["scorer_double_chance João Félix / Rasmus Højlund"]).toBe(1.8);
  });

  it("names each player of a statistic after the seed bookmaker, in the market's key, so his lines share a card", async () => {
    upsertCanonicalEvents(db, [
      event({
        sport: "basketball",
        participants: ["Barcelone", "Zalgiris"],
        sources: {
          betclic: { sourceId: "b1", participants: ["Barcelone", "Zalgiris"] },
          winamax: { sourceId: "w1", participants: ["Barcelone", "Zalgiris"] },
          betsson: { sourceId: "s1", participants: ["Barcelone", "Zalgiris"] },
        },
      }),
    ]);
    const line = (player: string, stat = "player_points", at = 4.5) => [
      { market: playerMarketKey(stat, player, at), selection: "over", price: 1.7 },
      { market: playerMarketKey(stat, player, at), selection: "under", price: 1.7 },
    ];
    const betclic = fetcher({ b1: [...line("Edgaras Ulanovas"), ...line("Maodo Lo", "player_assists", 3.5)] });
    const winamax = fetcher({
      w1: [...line("E. Ulanovas"), { market: "top_scorer", selection: "Maodo Lo", price: 12 }, ...line("Joel Parra", "player_rebounds", 3.5)],
    });
    // A bookmaker's own two spellings of a player, one a statistic.
    const betsson = fetcher({
      s1: [...line("Ulanovas, Edgaras"), ...line("Lo, Maodo", "player_assists", 3.5), ...line("Lo, M.", "player_threes", 1.5)],
    });

    await runMarketsCycle(db, { fetchers: { betclic, winamax, betsson } });

    expect(Object.keys(stored(db, "winamax")).sort()).toEqual([
      "player_points#Edgaras Ulanovas|4.5 over",
      "player_points#Edgaras Ulanovas|4.5 under",
      // Betclic lists no Joel Parra: his own spelling stays.
      "player_rebounds#Joel Parra|3.5 over",
      "player_rebounds#Joel Parra|3.5 under",
      "top_scorer Maodo Lo",
    ]);
    expect(Object.keys(stored(db, "betsson")).sort()).toEqual([
      "player_assists#Maodo Lo|3.5 over",
      "player_assists#Maodo Lo|3.5 under",
      "player_points#Edgaras Ulanovas|4.5 over",
      "player_points#Edgaras Ulanovas|4.5 under",
      // "Lo, M.": the same player as "Lo, Maodo", in another statistic.
      "player_threes#Maodo Lo|1.5 over",
      "player_threes#Maodo Lo|1.5 under",
    ]);
  });

  it("turns round the winner of a basketball match too: it is no family, but its teams swap", async () => {
    upsertCanonicalEvents(db, [
      event({
        sport: "basketball",
        participants: ["Barcelone", "Zalgiris"],
        sources: { unibet: { sourceId: "u1", participants: ["Zalgiris", "Barcelone"] } },
      }),
    ]);
    const unibet = fetcher({
      u1: [
        { market: "Vainqueur du match", selection: "1", price: 1.94 },
        { market: "Vainqueur du match", selection: "2", price: 1.69 },
        { market: "1X2", selection: "X", price: 12 },
        { market: "1X2", selection: "1", price: 2.05 },
      ],
    });

    await runMarketsCycle(db, { fetchers: { unibet } });

    // Unibet's first side, Zalgiris, is the event's second.
    expect(stored(db, "unibet")).toEqual({
      "Vainqueur du match 2": 1.94,
      "Vainqueur du match 1": 1.69,
      "1X2 X": 12,
      "1X2 2": 2.05,
    });
  });

  it("asks only for the football, basketball and main tours' tennis matches starting within 48 h that a bookmaker listed lately", async () => {
    // One kick-off for all, so that the order falls to their ids.
    const startTime = hoursFromNow(5);
    const tennis = (id: string, competition: string) =>
      event({ id, sport: "tennis", competition, startTime, participants: [`${id} A`, `${id} B`], sources: { winamax: { sourceId: `w-${id}`, participants: [] } } });
    upsertCanonicalEvents(db, [
      event({ id: "soon", startTime }),
      event({ id: "later", startTime: hoursFromNow(60), sources: { winamax: { sourceId: "w-later", participants: [] } } }),
      tennis("atp", "Tokyo ATP"),
      tennis("challenger", "Challenger Rennes"),
      event({ id: "baseball", sport: "baseball", sources: { winamax: { sourceId: "w-baseball", participants: [] } } }),
    ]);
    db.prepare("UPDATE event_sources SET seen_at = ? WHERE event_id = 'soon' AND bookmaker_id = 'betclic'").run(
      new Date(Date.now() - 60 * 60 * 1000).toISOString()
    );
    const winamax = fetcher({});
    const betclic = fetcher({});

    await runMarketsCycle(db, { fetchers: { winamax, betclic } });

    // By kick-off, then id.
    expect(winamax.asked).toEqual([["w-atp", "w1"]]);
    expect(betclic.asked).toEqual([[]]);
  });

  it("replaces a bookmaker's markets at each read: one it no longer offers goes at once", async () => {
    upsertCanonicalEvents(db, [event()]);
    const before = fetcher({
      w1: [
        { market: "btts", selection: "yes", price: 1.5 },
        { market: "wx:Écart de buts (handicap) (-1,5)", selection: "Dortmund -1.5", price: 1.76 },
      ],
    });
    await runMarketsCycle(db, { fetchers: { winamax: before } });

    const after = fetcher({ w1: [{ market: "btts", selection: "yes", price: 1.55 }] });
    await runMarketsCycle(db, { fetchers: { winamax: after } });

    expect(stored(db, "winamax")).toEqual({ "btts yes": 1.55 });
  });

  it("keeps one bookmaker's markets when the other fails", async () => {
    upsertCanonicalEvents(db, [event()]);
    vi.spyOn(console, "error").mockImplementation(() => {});
    const betclic = fetcher({ b1: [{ market: "btts", selection: "no", price: 2.07 }] });
    saveMarketOdds(db, [{ eventId: "bvb", bookmakerId: "winamax", odds: [{ market: "btts", selection: "yes", price: 1.5 }] }], new Date().toISOString());
    const winamax: MarketsFetcher = async () => {
      throw new Error("socket closed");
    };

    await runMarketsCycle(db, { fetchers: { winamax, betclic } });

    expect(stored(db, "betclic")).toEqual({ "btts no": 2.07 });
    // Its previous read stands, until it is too old.
    expect(stored(db, "winamax")).toEqual({ "btts yes": 1.5 });
  });

  it("forgets the prices and sources of matches started over a day ago", async () => {
    upsertCanonicalEvents(db, [event({ id: "old", startTime: hoursFromNow(-30) }), event()]);
    saveMarketOdds(db, [{ eventId: "old", bookmakerId: "winamax", odds: [{ market: "btts", selection: "yes", price: 1.5 }] }], new Date().toISOString());

    await runMarketsCycle(db, { fetchers: {} });

    for (const table of ["event_bookmaker_odds", "event_market_odds", "event_sources"]) {
      const left = db.prepare(`SELECT DISTINCT event_id AS id FROM ${table}`).all() as { id: string }[];
      expect(left.map((r) => r.id), table).toEqual(table === "event_market_odds" ? [] : ["bvb"]);
    }
  });

  it("forgets the stats and alerts older than 180 days at the end of the cycle", async () => {
    const day = 24 * 60 * 60 * 1000;
    const insert = db.prepare(
      `INSERT INTO reference_player_cycles (at, matches, markets, runners, priced, loose, spread, strict, players, value_bets, strict_value_bets)
       VALUES (?, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1)`
    );
    insert.run(new Date(Date.now() - 200 * day).toISOString());
    insert.run(new Date(Date.now() - 100 * day).toISOString());
    vi.spyOn(console, "log").mockImplementation(() => {});

    await runMarketsCycle(db, { fetchers: {} });

    const left = db.prepare("SELECT COUNT(*) AS n FROM reference_player_cycles").get() as { n: number };
    expect(left.n).toBe(1);
  });

  it("reads and saves the matches a few at a time", async () => {
    const events = Array.from({ length: 30 }, (_, i) =>
      event({ id: `m${i}`, participants: [`Home ${i}`, `Away ${i}`], sources: { winamax: { sourceId: `w${i}`, participants: [`Home ${i}`, `Away ${i}`] } } })
    );
    upsertCanonicalEvents(db, events);
    const winamax = fetcher(Object.fromEntries(events.map((_, i) => [`w${i}`, [{ market: "btts", selection: "yes", price: 1.5 }]])));

    await runMarketsCycle(db, { fetchers: { winamax } });

    expect(winamax.asked.map((ids) => ids.length)).toEqual([25, 5]);
    expect(Object.keys(stored(db, "winamax"))).toEqual(["btts yes"]);
    const saved = db.prepare("SELECT COUNT(*) AS n FROM event_market_odds WHERE market = 'btts'").get() as { n: number };
    expect(saved.n).toBe(30);
  });
});
