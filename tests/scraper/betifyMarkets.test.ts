import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { RawOdds } from "../../src/types";
import { playerMarketKey } from "../../src/markets/catalog";
import { fetchBetifyMarkets, readBetifyEventMarkets } from "../../src/scraper/betbyMarkets";
import { BetbyMarketDescriptions } from "../../src/scraper/betby";

// Real captures of the API Betify's sportsbook reads (Betby's, 14/10/2026), the
// answer to a match's page: every market of the match (`event/fr/<id>`) and
// their descriptions (`descriptions/.../event/<id>/fr`), cut to the markets
// this reads, a few lines of each and a few players. The tennis match's total
// of sets and its score in sets are those of other matches.
const fixture = (sport: string) => JSON.parse(readFileSync(join(__dirname, `fixtures/betify-event-${sport}.json`), "utf8"));
const GLOBAL: BetbyMarketDescriptions = JSON.parse(readFileSync(join(__dirname, "fixtures/betify-market-descriptions.json"), "utf8"));
const FOOTBALL = fixture("football");
const TENNIS = fixture("tennis");
const BASKETBALL = fixture("basketball");
// A golf championship's page (the SAS Championship, 73 players, cut to ten of each market).
const GOLF_ID = "2721752993635639312";
const GOLF = JSON.parse(readFileSync(join(__dirname, "fixtures/betify-outrights.json"), "utf8")).details[GOLF_ID];

const idOf = (f: { event: { events: Record<string, unknown> } }) => Object.keys(f.event.events)[0];
const read = (f: typeof FOOTBALL): RawOdds[] => readBetifyEventMarkets(idOf(f), f.event, f.descriptions, GLOBAL);
const price = (odds: RawOdds[], market: string, selection: string): number | undefined =>
  odds.find((o) => o.market === market && o.selection === selection)?.price;
const of = (odds: RawOdds[], market: string) => Object.fromEntries(odds.filter((o) => o.market === market).map((o) => [o.selection, o.price]));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("readBetifyEventMarkets, football", () => {
  const odds = read(FOOTBALL);

  it("reads the totals by period and by team, on half lines only", () => {
    expect(of(odds, "team_goals@1|1.5")).toEqual({ over: 3.9, under: 1.21 });
    expect(of(odds, "ht_total_goals|1.5")).toEqual({ over: 2.18, under: 1.61 });
    expect(of(odds, "ht_total_goals|2.5")).toEqual({ over: 4.8, under: 1.14 });
    // A quarter line (2.75) and a whole line (2, 3) refund or split a stake: no other bookmaker lists them.
    const lines = odds.filter((o) => /^(team_goals@[12]|total_goals|ht_total_goals)\|/.test(o.market)).map((o) => Number(o.market.split("|")[1]));
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.every((l) => Math.abs(l % 1) === 0.5)).toBe(true);
  });

  it("reads the handicap on the first team's line, leaving out the quarter and whole lines", () => {
    expect(of(odds, "ht_handicap|0.5")).toEqual({ "1": 1.9, "2": 1.8 });
    expect(of(odds, "ht_handicap|-0.5")).toEqual({ "1": 5.6, "2": 1.11 });
    expect(odds.filter((o) => o.market.startsWith("handicap|")).every((o) => Math.abs(Number(o.market.split("|")[1]) % 1) === 0.5)).toBe(true);
  });

  it("reads the results, the chances and the refunds", () => {
    expect(of(odds, "double_chance")).toEqual({ X2: 1.06, "12": 1.15, "1X": 2.88 });
    expect(of(odds, "draw_no_bet")).toEqual({ "1": 5.6, "2": 1.12 });
    expect(of(odds, "ht_1X2")).toEqual({ "1": 6.6, X: 2.58, "2": 1.79 });
    expect(price(odds, "ht_ft", "1/1")).toBe(12);
    expect(price(odds, "ht_ft", "X/X")).toBe(7.5);
    expect(price(odds, "ht_ft", "1/2")).toBe(20);
  });

  it("reads both teams scoring, the first and last team to score, the best half", () => {
    expect(of(odds, "btts")).toEqual({ yes: 1.76, no: 1.95 });
    expect(of(odds, "first_team_to_score")).toEqual({ "1": 3.4, "2": 1.35, none: 14 });
    expect(of(odds, "ht_first_team_to_score")).toEqual({ "1": 4.5, "2": 1.72, none: 3.75 });
    expect(of(odds, "last_team_to_score")).toEqual({ "1": 3.5, "2": 1.38, none: 16 });
    expect(of(odds, "highest_scoring_half")).toEqual({ "1st": 2.95, "2nd": 1.95, equal: 3.8 });
  });

  it("reads the counts, the bands and the minutes of goals", () => {
    expect(price(odds, "exact_goals", "3")).toBe(3.8);
    expect(price(odds, "exact_goals", "7")).toBe(28);
    expect(of(odds, "goal_bands")).toEqual({ "0-1": 4.5, "2-3": 2.05, "4-6": 2.45, "7+": 15 });
    expect(price(odds, "first_goal_minute_10", "1-10")).toBe(3.95);
    expect(price(odds, "first_goal_minute_10", "21-30")).toBe(6.25);
    expect(price(odds, "first_goal_minute_10", "none")).toBe(15);
    expect(odds.some((o) => o.market.startsWith("team_exact_goals@1") && o.selection === "0")).toBe(true);
    expect(odds.some((o) => o.market === "ht_exact_goals")).toBe(true);
  });

  it("reads the scores as home-away", () => {
    expect(price(odds, "correct_score", "1-0")).toBe(20);
    expect(price(odds, "correct_score", "0-0")).toBe(15);
    expect(price(odds, "ht_correct_score", "0-0")).toBe(3.4);
  });

  it("reads the combinations of a result, a chance and a total or both teams scoring", () => {
    expect(of(odds, "result_total|2.5")).toEqual({
      "1&under": 15,
      "X&under": 6.5,
      "2&under": 4.2,
      "1&over": 11.5,
      "X&over": 14,
      "2&over": 1.88,
    });
    expect(price(odds, "ht_result_total|1.5", "1&under")).toBe(8.25);
    expect(of(odds, "result_btts")).toEqual({ "1&yes": 12, "1&no": 14, "X&yes": 6.25, "X&no": 16, "2&yes": 2.75, "2&no": 2.45 });
    expect(price(odds, "ht_result_btts", "2&no")).toBe(2.1);
    expect(price(odds, "dc_total|2.5", "X2&over")).toBe(1.7);
    expect(price(odds, "dc_total|2.5", "X2&under")).toBe(2.7);
    expect(price(odds, "dc_total|2.5", "1X&over")).toBe(6.75);
    expect(price(odds, "dc_btts", "1X&yes")).toBe(4.3);
    expect(price(odds, "dc_btts", "X2&no")).toBe(2.2);
  });

  it("reads the first team to score with the result, and no goal", () => {
    const raw = FOOTBALL.event.events[idOf(FOOTBALL)].markets["50060"][""] as Record<string, { k: string }>;
    const prices = of(odds, "first_goal_result");
    expect(Object.keys(prices).sort()).toEqual(["1>1", "1>2", "1>X", "2>1", "2>2", "2>X", "none"].sort());
    expect(Object.values(prices).sort((a, b) => a - b)).toEqual(Object.values(raw).map((o) => Number(o.k)).sort((a, b) => a - b));
  });

  it("reads a team's own yes-or-no markets, a price at 0 (blocked) being left out", () => {
    expect(of(odds, "score_both_halves@1")).toEqual({ yes: 6.2, no: 1.09 });
    expect(of(odds, "win_either_half@1")).toEqual({ yes: 3.5, no: 1.3 });
    expect(of(odds, "win_to_nil@1")).toEqual({ yes: 9.5, no: 1.02 });
    expect(of(odds, "clean_sheet@1")).toEqual({ yes: 8.6, no: 1.04 });
    expect(of(odds, "ht_clean_sheet@1")).toEqual({ yes: 2.55, no: 1.47 });
    // "no" is at 0.0 in the capture.
    expect(of(odds, "win_both_halves@1")).toEqual({ yes: 11 });
  });

  it("reads the players' markets by name, without the no-scorer outcome", () => {
    expect(price(odds, "anytime_scorer", "Brian Brobbey")).toBe(1.91);
    expect(price(odds, "first_scorer", "Brian Brobbey")).toBe(4.5);
    expect(odds.some((o) => o.market === "last_scorer")).toBe(true);
    expect(odds.some((o) => o.market === "scorer_team_wins")).toBe(true);
    expect(odds.some((o) => o.market === "scorer_both_halves")).toBe(true);
    expect(odds.filter((o) => /^(anytime|first|last)_scorer$/.test(o.market)).some((o) => /aucun|pas de/i.test(o.selection))).toBe(false);
    // 2 goals or more, 3 or more; the player's first goal is the scorer market's.
    expect(price(odds, "scorer_goals|2", "Wilson Isidor")).toBe(5);
    expect(price(odds, "scorer_goals|3", "Wilson Isidor")).toBe(25);
    expect(odds.some((o) => o.market === "scorer_goals|1")).toBe(false);
    expect(price(odds, "decisive_player", "Wilson Isidor")).toBe(1.6);
  });

  it("leaves out the main market, the markets no family covers, and the markets of other things", () => {
    expect(odds.some((o) => o.market === "1X2")).toBe(false);
    const known = new Set(odds.map((o) => o.market.split("|")[0].split("#")[0]));
    // Corners (166), cards (150122) and the parity of goals (26) have no family.
    for (const market of known) expect(market).not.toMatch(/corner|card|odd|even/i);
  });

  it("gives only real prices", () => {
    expect(odds.every((o) => o.price > 1 && Number.isFinite(o.price))).toBe(true);
  });
});

describe("readBetifyEventMarkets, tennis", () => {
  const odds = read(TENNIS);

  it("reads the games, the handicaps and the sets", () => {
    expect(of(odds, "total_games|22.5")).toEqual({ over: 2.08, under: 1.64 });
    expect(of(odds, "games_handicap|-4.5")).toEqual({ "1": 2.16, "2": 1.58 });
    expect(of(odds, "set_handicap|1.5")).toEqual({ "1": 1.04, "2": 7.6 });
    expect(of(odds, "total_sets|2.5")).toEqual({ over: 2.4, under: 1.48 });
  });

  it("reads the winner of each of the first two sets, and the first set's games", () => {
    expect(of(odds, "set1_winner")).toEqual({ "1": 1.29, "2": 3.3 });
    expect(of(odds, "set1_total_games|12.5")).toEqual({ over: 4, under: 1.19 });
    expect(of(odds, "set1_games_handicap|1.5")).toEqual({ "1": 1.15, "2": 4.5 });
  });

  it("reads the score in sets as home-away", () => {
    const scores = of(odds, "set_betting");
    expect(Object.keys(scores).every((s) => /^\d-\d$/.test(s))).toBe(true);
    expect(scores["2-0"]).toBeGreaterThan(1);
  });

  it("leaves out the match winner, which is the listing's", () => {
    expect(odds.some((o) => o.market === "Vainqueur du match")).toBe(false);
  });
});

describe("readBetifyEventMarkets, basketball", () => {
  const odds = read(BASKETBALL);

  it("reads the match's totals and handicap, overtime included", () => {
    expect(of(odds, "total_points|183.5")).toEqual({ over: 5.4, under: 1.14 });
    expect(of(odds, "spread|8.5")).toEqual({ "1": 1.34, "2": 3.15 });
    expect(price(odds, "team_points@1|83.5", "over")).toBe(1.86);
    expect(of(odds, "winner_total|167.5")).toEqual({ "1&over": 3.5, "2&over": 3.2, "1&under": 3.95, "2&under": 3.5 });
  });

  it("reads the first half's and the quarters', a blocked price being left out", () => {
    expect(of(odds, "ht_spread|0.5")).toEqual({ "1": 1.86, "2": 1.86 });
    expect(of(odds, "ht_total_points|84.5")).toEqual({ over: 1.94, under: 1.79 });
    expect(of(odds, "q1_total_points|42.5")).toEqual({ over: 1.94, under: 1.79 });
    expect(of(odds, "q1_team_points@1|20.5")).toEqual({ over: 1.75, under: 1.98 });
    expect(of(odds, "q1_spread|0.5")).toEqual({ "1": 1.86, "2": 1.86 });
    // The draw is at 0.0 in the capture.
    expect(of(odds, "q1_1X2")).toEqual({ "1": 1.95, "2": 1.8 });
  });

  it("reads a player's ladder as the over of N - 0.5", () => {
    expect(price(odds, playerMarketKey("player_points", "Devon Hall", 9.5), "over")).toBe(1.43);
    expect(price(odds, playerMarketKey("player_points", "Devon Hall", 17.5), "over")).toBe(4.6);
    for (const family of ["player_assists", "player_rebounds", "player_threes", "player_pra"]) {
      expect(odds.some((o) => o.market.startsWith(`${family}#`) && o.selection === "over"), family).toBe(true);
    }
  });

  it("reads a market a player, the player in its variant's title", () => {
    const market = playerMarketKey("player_points", "Alec Peters", 9.5);
    expect(of(odds, market)).toEqual({ over: 1.77, under: 1.9 });
    for (const family of ["player_assists", "player_rebounds", "player_threes", "player_pra"]) {
      expect(odds.some((o) => o.market.startsWith(`${family}#`) && o.selection === "under"), family).toBe(true);
    }
  });

  it("leaves out the match winner, which is the listing's", () => {
    expect(odds.some((o) => o.market === "Vainqueur du match")).toBe(false);
  });
});

describe("readBetifyEventMarkets, golf", () => {
  const odds = readBetifyEventMarkets(GOLF_ID, GOLF.event, GOLF.descriptions, GLOBAL);

  it("reads a tournament's Top N and its round leader as the catalog's, one price a player", () => {
    expect([...new Set(odds.map((o) => o.market))].sort()).toEqual(["golf_round_leader|1", "golf_top|10", "golf_top|5"]);
    for (const market of ["golf_top|10", "golf_top|5", "golf_round_leader|1"]) {
      const rows = odds.filter((o) => o.market === market);
      expect(rows).toHaveLength(10);
      expect(rows.every((o) => o.price > 1 && o.selection.trim().length > 0)).toBe(true);
    }
  });

  it("names the players as the match's descriptions do", () => {
    const names = new Set(odds.filter((o) => o.market === "golf_top|10").map((o) => o.selection));
    const described = GOLF.descriptions.markets["2000061"].variants;
    const known = new Set(Object.values(described).flatMap((v) => (v as { outcomes: { name: string }[] }[])[0].outcomes.map((o) => o.name)));
    expect([...names].every((n) => known.has(n))).toBe(true);
  });

  it("leaves out the winner, which is the listing's, and the markets of no family", () => {
    expect(odds.some((o) => o.market === "Vainqueur" || o.market === "golf_winner")).toBe(false);
  });
});

describe("readBetifyEventMarkets, edge cases", () => {
  it("is empty for a sport without a table, for a match no longer listed and for garbage", () => {
    const other = JSON.parse(JSON.stringify(FOOTBALL.event));
    other.sports = { "1": { name: "Cricket 24" } };
    expect(readBetifyEventMarkets(idOf(FOOTBALL), other, FOOTBALL.descriptions, GLOBAL)).toEqual([]);
    expect(readBetifyEventMarkets("1", { version: 0 }, {}, GLOBAL)).toEqual([]);
    expect(readBetifyEventMarkets("1", null as never, undefined as never, GLOBAL)).toEqual([]);
  });

  it("reads a market from the global descriptions when the match's own do not carry it", () => {
    const bare = { markets: {} };
    const odds = readBetifyEventMarkets(idOf(FOOTBALL), FOOTBALL.event, bare, GLOBAL);
    expect(of(odds, "btts")).toEqual({ yes: 1.76, no: 1.95 });
    // The players' names are only in the match's own descriptions.
    expect(odds.some((o) => o.market === "anytime_scorer")).toBe(false);
  });

  it("skips a market it cannot read and keeps the others", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const broken = JSON.parse(JSON.stringify(FOOTBALL.event));
    broken.events[idOf(FOOTBALL)].markets["29"] = null;
    const odds = readBetifyEventMarkets(idOf(FOOTBALL), broken, FOOTBALL.descriptions, GLOBAL);
    expect(odds.some((o) => o.market === "btts")).toBe(false);
    expect(odds.some((o) => o.market === "draw_no_bet")).toBe(true);
    warn.mockRestore();
  });
});

const API = "https://api-h-c7818b61-608.sptpub.com";
const BRAND = "2245581113223421952";

function stubServer(failing: Record<string, number> = {}) {
  const calls: string[] = [];
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
  const eventIds = { football: idOf(FOOTBALL), tennis: idOf(TENNIS) };
  const routes: Record<string, () => Response> = {
    "https://flex.betify10.sh/fr/sport/launch": () => json({ result: { brand_id: BRAND, script: "https://betify.sptpub.com/bt-renderer.min.js" } }),
    "https://betify.sptpub.com/bt-renderer.min.js": () => new Response(`n=r("${API}")`, { status: 200 }),
    [`${API}/api/v3/descriptions/brand/${BRAND}/markets/fr`]: () => json(GLOBAL),
    [`${API}/api/v4/prematch/brand/${BRAND}/event/fr/${eventIds.football}`]: () => json(FOOTBALL.event),
    [`${API}/api/v3/descriptions/brand/${BRAND}/event/${eventIds.football}/fr`]: () => json(FOOTBALL.descriptions),
    [`${API}/api/v4/prematch/brand/${BRAND}/event/fr/${eventIds.tennis}`]: () => json(TENNIS.event),
    [`${API}/api/v3/descriptions/brand/${BRAND}/event/${eventIds.tennis}/fr`]: () => json(TENNIS.descriptions),
    [`${API}/api/v4/prematch/brand/${BRAND}/event/fr/${GOLF_ID}`]: () => json(GOLF.event),
    [`${API}/api/v3/descriptions/brand/${BRAND}/event/${GOLF_ID}/fr`]: () => json(GOLF.descriptions),
    // A match that started: the answer holds no event.
    [`${API}/api/v4/prematch/brand/${BRAND}/event/fr/999`]: () => json({ version: 0, events: {} }),
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      calls.push(url);
      const status = Object.entries(failing).find(([part]) => url.includes(part))?.[1];
      if (status) return new Response("", { status });
      const route = routes[url];
      return route ? route() : new Response("not found", { status: 404 });
    })
  );
  return { calls, eventIds };
}

describe("fetchBetifyMarkets", () => {
  it("reads each match's markets and its descriptions, by the match's id", async () => {
    const { calls, eventIds } = stubServer();
    const markets = await fetchBetifyMarkets([eventIds.football, eventIds.tennis]);
    expect(of(markets.get(eventIds.football) ?? [], "btts")).toEqual({ yes: 1.76, no: 1.95 });
    expect(of(markets.get(eventIds.tennis) ?? [], "total_games|22.5")).toEqual({ over: 2.08, under: 1.64 });
    expect(calls).toContain(`${API}/api/v4/prematch/brand/${BRAND}/event/fr/${eventIds.football}`);
    expect(calls).toContain(`${API}/api/v3/descriptions/brand/${BRAND}/event/${eventIds.football}/fr`);
  });

  it("reads a golf tournament's markets with its own descriptions, which name its players", async () => {
    const { calls } = stubServer();
    const markets = await fetchBetifyMarkets([GOLF_ID]);
    expect(markets.get(GOLF_ID)?.some((o) => o.market === "golf_top|10")).toBe(true);
    expect(calls).toContain(`${API}/api/v3/descriptions/brand/${BRAND}/event/${GOLF_ID}/fr`);
  });

  it("asks nothing for no id", async () => {
    const { calls } = stubServer();
    expect((await fetchBetifyMarkets([])).size).toBe(0);
    expect(calls).toEqual([]);
  });

  it("gives an empty list for a match that is gone, and keeps the others", async () => {
    const { eventIds } = stubServer();
    const markets = await fetchBetifyMarkets([eventIds.football, "999"]);
    expect(markets.get("999") ?? []).toEqual([]);
    expect(markets.get(eventIds.football)?.length).toBeGreaterThan(0);
  });

  it("loses only the match whose request failed", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { eventIds } = stubServer();
    stubServer({ [`event/fr/${eventIds.tennis}`]: 500 });
    const markets = await fetchBetifyMarkets([eventIds.football, eventIds.tennis]);
    expect(markets.has(eventIds.tennis)).toBe(false);
    expect(markets.get(eventIds.football)?.length).toBeGreaterThan(0);
    warn.mockRestore();
  });

  it("fails when every match's request does, so the cycle is told", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { eventIds } = stubServer({ "/event/fr/": 503 });
    await expect(fetchBetifyMarkets([eventIds.football, eventIds.tennis])).rejects.toThrow(/every/);
    warn.mockRestore();
  });

  it("fails when the market descriptions are not answered", async () => {
    const { eventIds } = stubServer({ "/markets/fr": 500 });
    await expect(fetchBetifyMarkets([eventIds.football])).rejects.toThrow(/HTTP 500/);
  });
});
