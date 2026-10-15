import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { join } from "node:path";
import { familiesOf, parseMarketKey, sectionsOf } from "../../src/markets/catalog";
import { fetchUnibetMarkets, readUnibetMarkets } from "../../src/scraper/unibetMarkets";
import { UnibetPage } from "../../src/scraper/unibet";
import { RawOdds } from "../../src/types";

// Real answer of Unibet's route for the markets of given events (6/10/2026,
// /lvs-api/ff/<ids>): Baycurrent Classic, Open d'Espagne and the Masters 2027.
const PAGE: UnibetPage = JSON.parse(
  gunzipSync(readFileSync(join(__dirname, "fixtures/unibet-golf-markets.json.gz"))).toString()
);
const byMarket = (odds: RawOdds[]) => {
  const markets = new Map<string, RawOdds[]>();
  for (const o of odds) markets.set(o.market, [...(markets.get(o.market) ?? []), o]);
  return markets;
};

describe("readUnibetMarkets", () => {
  const baycurrent = byMarket(readUnibetMarkets(PAGE, "e3386187"));
  const espana = byMarket(readUnibetMarkets(PAGE, "e3386260"));

  it("reads a tournament's Top 5 and 10 and the leader after the 1st round, as the catalog's", () => {
    expect([...baycurrent.keys()].filter((m) => !m.startsWith("golf_best_")).sort()).toEqual(["golf_round_leader|1", "golf_top|10", "golf_top|5"]);
    // 73 listed, 72 of them priced and shown.
    expect(baycurrent.get("golf_top|5")).toHaveLength(72);
    expect(baycurrent.get("golf_round_leader|1")).toHaveLength(72);
    expect(espana.get("golf_top|10")).toHaveLength(136);
  });

  it("names the players as it does for the winner, the initials spaced from the surname", () => {
    const names = baycurrent.get("golf_top|5")!.map((o) => o.selection);
    expect(names).toContain("X. Schauffele");
    expect(names).toContain("Bridgeman, Jacob");
    expect(baycurrent.get("golf_top|5")).toContainEqual({ market: "golf_top|5", selection: "X. Schauffele", price: expect.any(Number) });
  });

  it("leaves the winner to the listing, and reads the best of a nationality as the catalog's", () => {
    const all = [...baycurrent.values()].flat();
    expect(all.some((o) => o.market === "Vainqueur")).toBe(false);
    expect([...baycurrent.keys()].filter((m) => m.startsWith("golf_best_")).sort()).toEqual(["golf_best_americain", "golf_best_japonais"]);
    expect(baycurrent.get("golf_best_americain")).toHaveLength(43);
    // Unibet's own spellings of the nationalities: "Sud Africain", "Francais", "Ecossais".
    expect([...espana.keys()].filter((m) => m.startsWith("golf_best_"))).toEqual(
      expect.arrayContaining(["golf_best_sud_africain", "golf_best_francais", "golf_best_ecossais", "golf_best_suedois"])
    );
  });

  it("reads no market of an event that is not in the page, nor of one with the winner only", () => {
    expect(readUnibetMarkets(PAGE, "e999")).toEqual([]);
    expect(readUnibetMarkets(PAGE, "e3339815")).toEqual([]);
  });
});

describe("fetchUnibetMarkets", () => {
  afterEach(() => vi.unstubAllGlobals());
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  it("asks for the markets of every event in one request, with the anonymous token", async () => {
    const fetchMock = vi.fn(async (url: string) => (url.endsWith("/acc/token") ? json({ hsToken: "tok" }) : json(PAGE)));
    vi.stubGlobal("fetch", fetchMock);

    const markets = await fetchUnibetMarkets(["e3386187", "e3386260"]);

    expect([...markets.keys()].sort()).toEqual(["e3386187", "e3386260"]);
    expect(markets.get("e3386187")!.length).toBeGreaterThan(200);
    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url).toContain("/ff/e3386187,e3386260?");
    expect(url).toContain("showMarketTypeGroups=true");
    expect(init.headers).toMatchObject({ "x-lvs-hstoken": "tok" });
  });

  it("asks for five events at most per request, one request after the other", async () => {
    // A football match is about 1 MB: the events of a cycle come a few at a time.
    vi.useFakeTimers();
    const fetchMock = vi.fn(async (url: string) =>
      url.endsWith("/acc/token") ? json({ hsToken: "tok" }) : json(url.includes("e3386187") ? PAGE : { items: {} })
    );
    vi.stubGlobal("fetch", fetchMock);

    const ids = ["e3386187", "e2", "e3", "e4", "e5", "e6", "e7"];
    const promise = fetchUnibetMarkets(ids);
    await vi.runAllTimersAsync();
    const markets = await promise;
    vi.useRealTimers();

    expect([...markets.keys()]).toEqual(ids);
    expect(markets.get("e3386187")!.length).toBeGreaterThan(200);
    const asked = fetchMock.mock.calls.filter(([url]) => !String(url).endsWith("/acc/token")).map(([url]) => String(url));
    expect(asked).toHaveLength(2);
    expect(asked[0]).toContain("/ff/e3386187,e2,e3,e4,e5?");
    expect(asked[1]).toContain("/ff/e6,e7?");
    // One token for both.
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/acc/token"))).toHaveLength(1);
  });

  it("keeps the events of the requests that answered when a later one fails", async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.endsWith("/acc/token") ? json({ hsToken: "tok" }) : url.includes("/ff/e6") ? json({}, 500) : json(PAGE)
      )
    );
    const promise = fetchUnibetMarkets(["e3386187", "e2", "e3", "e4", "e5", "e6", "e7"]);
    await vi.runAllTimersAsync();
    const markets = await promise;
    vi.useRealTimers();
    expect([...markets.keys()]).toEqual(["e3386187", "e2", "e3", "e4", "e5"]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("asks nothing for no event, and fails on an answer that is not one, for the cycle to log", async () => {
    const fetchMock = vi.fn(async () => json({}, 500));
    vi.stubGlobal("fetch", fetchMock);
    expect((await fetchUnibetMarkets([])).size).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
    await expect(fetchUnibetMarkets(["e3386187"])).rejects.toThrow();
  });
});

// Real answers of the same route for a football match and a tennis match
// (8/10/2026): Santos - Flamengo (425 markets; the players' of its scorers,
// passers and shots, of 21 outcomes and more, are left out of the fixture) and
// Sakamoto - Rublev (62). Unibet gives a market its type (`markettypeId`) and
// its period (100 the match, 102 and 103 its halves; 113, 114 and 115 a tennis
// match, its first and its second set); a line sits in an outcome's `spread`
// ("Plus 2.5") or in its title ("[+1,5]"); its prices are French decimals.
const match = (name: "football" | "tennis"): UnibetPage =>
  JSON.parse(gunzipSync(readFileSync(join(__dirname, `fixtures/unibet-${name}-markets.json.gz`))).toString());

const table = (odds: RawOdds[]) => {
  const grouped = new Map<string, Record<string, number>>();
  for (const o of odds) grouped.set(o.market, { ...(grouped.get(o.market) ?? {}), [o.selection]: o.price });
  return grouped;
};

describe("readUnibetMarkets, a football match", () => {
  const t = table(readUnibetMarkets(match("football"), "e3380539"));

  it("reads the totals of the match, a team's and the halves', by line", () => {
    expect(t.get("total_goals|2.5")).toEqual({ over: 1.52, under: 2.05 });
    expect(t.get("total_goals|0.5")).toEqual({ over: 1.02, under: 10 });
    expect(t.get("ht_total_goals|1.5")).toEqual({ over: 2.1, under: 1.5 });
    expect(t.has("2h_total_goals|0.5")).toBe(true);
    // "Santos" is the first team, "Flamengo" the second.
    expect(t.get("team_goals@1|0.5")).toEqual({ over: 1.32, under: 2.5 });
    expect(t.get("team_goals@2|0.5")).toEqual({ over: 1.1, under: 4 });
    expect(t.get("ht_team_goals@1|0.5")).toEqual({ over: 2.1, under: 1.45 });
    expect(t.get("ht_team_goals@2|0.5")).toEqual({ over: 1.55, under: 1.95 });
  });

  it("reads the handicap with the first team's line, not the three-way one", () => {
    expect(t.get("handicap|-0.5")).toEqual({ "1": 3, "2": 1.18 });
    expect(t.get("handicap|0.5")).toEqual({ "1": 1.8, "2": 1.6 });
    expect(t.get("handicap|1.5")).toEqual({ "1": 1.3, "2": 2.5 });
    // "1 N 2 Handicap [-1]" has a draw's outcome: another bet.
    expect([...t.keys()].filter((k) => /^(ht_|2h_)?handicap\|-?\d+$/.test(k))).toEqual([]);
  });

  it("reads the results, the chances and the refund, by period", () => {
    expect(t.get("double_chance")).toEqual({ "1X": 1.85, X2: 1.2, "12": 1.24 });
    expect(t.get("draw_no_bet")).toEqual({ "1": 2.65, "2": 1.28 });
    expect(t.get("ht_1X2")).toEqual({ "1": 4.2, X: 2.3, "2": 2.15 });
    expect(t.get("2h_1X2")).toEqual({ "1": 3.5, X: 2.5, "2": 1.93 });
    expect(t.get("btts")).toEqual({ yes: 1.5, no: 2 });
    expect(t.has("ht_btts") && t.has("2h_btts") && t.has("ht_double_chance") && t.has("2h_double_chance")).toBe(true);
    expect(t.get("ht_ft")?.["1/1"]).toBe(7);
    expect(t.get("ht_ft")?.["1/X"]).toBe(15);
    expect(t.get("ht_ft")?.["1/2"]).toBe(23);
  });

  it("reads who scores first and last, the half with the most goals, the counts and bands of goals", () => {
    expect(t.get("first_team_to_score")).toEqual({ "1": 2.45, "2": 1.55, none: 15 });
    expect(t.get("last_team_to_score")).toEqual({ "1": 2.25, "2": 1.48, none: 13.5 });
    expect(t.has("ht_first_team_to_score") && t.has("2h_first_team_to_score")).toBe(true);
    expect(t.get("highest_scoring_half")).toEqual({ "1st": 2.75, "2nd": 1.94, equal: 3.3 });
    expect(t.get("goal_bands")).toEqual({ "0-1": 4.1, "2-3": 1.93, "4-6": 2.45, "7+": 20 });
    expect(t.get("exact_goals")).toMatchObject({ "0": 12, "1": 4.8, "5": 6.2, "6+": 6.9 });
    expect(t.get("team_exact_goals@1")).toEqual({ "0": 2.5, "1": 2.2, "2": 3.55, "3+": 6.5 });
    expect(t.get("team_exact_goals@2")).toEqual({ "0": 4.95, "1": 2.75, "2": 2.85, "3+": 2.6 });
    expect(t.get("ht_exact_goals")).toEqual({ "0": 2.85, "1": 2.25, "2+": 1.98 });
  });

  it("reads the minute of the first goal, by the band's end", () => {
    expect(t.get("first_goal_minute_10")).toMatchObject({ "1-10": 3.35, "11-20": 3.8, "81-90": 21, none: 13 });
    expect(t.get("first_goal_minute_15")).toMatchObject({ "1-15": 2.5, "31-45": 4.25, "46-60": 7.6, "76-90": 15, none: 13.5 });
  });

  it("reads the scores, the margin of victory, and the first goal with the result", () => {
    expect(t.get("correct_score")?.["1-0"]).toBe(12);
    expect(t.get("ht_correct_score")?.["1-0"]).toBe(5.1);
    expect(t.get("ht_correct_score")?.other).toBe(8.8);
    expect(t.get("winning_margin")).toEqual({
      X: 2.85,
      "1:3+": 23,
      "1:2": 10.5,
      "1:1": 4.85,
      "2:1": 3.05,
      "2:2": 4.05,
      "2:3+": 4.35,
    });
    expect(t.get("first_goal_result")).toEqual({
      "1>1": 4.25,
      "1>X": 7.7,
      "1>2": 8.8,
      "2>2": 1.85,
      "2>X": 7.7,
      "2>1": 18,
      none: 13.5,
    });
  });

  it("reads a result or a double chance with a total or both teams scoring", () => {
    expect(t.get("result_total|1.5")).toMatchObject({ "1&over": 4.4, "X&over": 3.9, "2&over": 1.83, "1&under": 13.5 });
    expect(t.get("result_btts")).toMatchObject({ "1&yes": 6.2, "1&no": 7.8, "X&yes": 4.05, "X&no": 14 });
    expect(t.get("dc_btts")).toMatchObject({ "1X&yes": 2.5, "1X&no": 4.95, "12&yes": 2.05, "12&no": 2.25 });
    expect(t.get("dc_total|1.5")).toEqual({
      "1X&under": 6.4,
      "1X&over": 2.1,
      "12&under": 4.95,
      "12&over": 1.38,
      "X2&under": 4.9,
      "X2&over": 1.35,
    });
  });

  it("reads a team's clean sheet, win to nil and halves", () => {
    expect(t.get("clean_sheet@1")).toEqual({ yes: 4, no: 1.08 });
    expect(t.get("clean_sheet@2")).toEqual({ yes: 2.5, no: 1.3 });
    expect(t.get("win_to_nil@1")).toEqual({ yes: 4.5, no: 1.05 });
    // Unibet does not price "Non" of the first team's two halves: only "Oui".
    expect(t.get("win_both_halves@1")).toEqual({ yes: 6 });
    expect(t.get("win_both_halves@2")).toEqual({ yes: 3.5, no: 1.12 });
    expect(t.get("win_either_half@1")).toEqual({ yes: 2.05, no: 1.45 });
    expect(t.get("win_either_half@2")).toEqual({ yes: 1.33, no: 2.35 });
    expect(t.get("score_both_halves@1")).toEqual({ yes: 3.5, no: 1.12 });
  });

  it("leaves out the main market (the listing's) and every market no family covers", () => {
    expect(t.has("1X2")).toBe(false);
    expect([...t.keys()].every((k) => parseMarketKey(k).kind === "family")).toBe(true);
    expect(t.size).toBeGreaterThan(55);
  });
});

describe("readUnibetMarkets, a tennis match", () => {
  const t = table(readUnibetMarkets(match("tennis"), "e3386851"));

  it("reads the totals of games, a player's, the set's, and the aces", () => {
    expect(t.get("total_games|22.5")).toEqual({ over: 1.72, under: 1.72 });
    expect(t.get("total_games|18.5")).toEqual({ over: 1.12, under: 3.7 });
    expect(t.get("set1_total_games|9.5")).toEqual({ over: 1.5, under: 2 });
    expect(t.get("player_games@1|10.5")).toEqual({ over: 1.6, under: 1.9 });
    expect(t.get("player_games@2|11.5")).toEqual({ over: 1.1, under: 4 });
    // Unibet hides and suspends the "Moins" of its aces (1.01): only "Plus" is a bet.
    expect(t.get("total_aces|18.5")).toEqual({ over: 1.6 });
    expect(t.get("player_aces@2|8.5")).toEqual({ over: 1.6 });
    expect(t.get("player_aces@1|9.5")).toEqual({ over: 1.6 });
  });

  it("reads the handicaps of sets and of games, with the first player's line", () => {
    expect(t.get("set_handicap|1.5")).toEqual({ "1": 1.59, "2": 1.72 });
    expect(t.get("set_handicap|-1.5")).toEqual({ "1": 3.55, "2": 1.08 });
    expect(t.get("games_handicap|1.5")).toEqual({ "1": 2.35, "2": 1.33 });
    expect(t.get("set1_games_handicap|2.5")).toEqual({ "1": 1.25, "2": 2.45 });
  });

  it("reads the sets: their score, their number, a set's winner and score, the first set and the match", () => {
    expect(t.get("set_betting")).toEqual({ "2-0": 5.1, "2-1": 5.7, "0-2": 1.78, "1-2": 3.15 });
    expect(t.get("exact_sets")).toEqual({ "2": 1.4, "3": 2.1 });
    expect(t.get("set1_winner")).toEqual({ "1": 2.4, "2": 1.35 });
    expect(t.get("set2_winner")).toEqual({ "1": 2.35, "2": 1.35 });
    expect(t.get("set1_correct_score")).toMatchObject({ "6-0": 100, "0-6": 50, "7-6": 4.95 });
    expect(t.get("set1_match")).toEqual({ "1/1": 3.35, "1/2": 5.3, "2/1": 9.5, "2/2": 1.41 });
  });

  it("reads a player winning a set, the winner with the total of games, and a 6-0 set", () => {
    expect(t.get("win_a_set@1")).toEqual({ yes: 1.65, no: 1.8 });
    expect(t.get("win_a_set@2")).toEqual({ yes: 1.09, no: 4.1 });
    expect(t.get("winner_total_games|22.5")).toEqual({ "1&over": 4.55, "1&under": 7.3, "2&over": 2.45, "2&under": 2.15 });
    expect(t.get("bagel")).toEqual({ yes: 4.7 });
  });

  it("leaves out the winner (the listing's) and what no family covers", () => {
    expect(t.has("Vainqueur du match")).toBe(false);
    expect([...t.keys()].every((k) => parseMarketKey(k).kind === "family")).toBe(true);
  });
});

describe("readUnibetMarkets, other cases", () => {
  it("reads nothing of an event of another sport, or one the page does not hold", () => {
    expect(readUnibetMarkets(match("football"), "e1")).toEqual([]);
    // Rugby union's page has the match's result and a three-way handicap only.
    const rugby = match("football");
    rugby.items!.e3380539.path = { Sport: "Rugby" };
    expect(readUnibetMarkets(rugby, "e3380539")).toEqual([]);
  });
});

// Real answers for an NHL match (Washington - Montréal, 1 230 items), an NFL one
// (Denver - Seattle, 1 006) and a handball one (Wetzlar - Erlangen, 99), 14/10/2026.
const sportPage = (name: "hockey" | "american-football" | "handball"): UnibetPage =>
  JSON.parse(gunzipSync(readFileSync(join(__dirname, `fixtures/unibet-${name}-markets.json.gz`))).toString());
// A market is a family of the sport, in a section of its match page.
const placed = (odds: RawOdds[], sport: string) => {
  const sections = new Set(sectionsOf(sport).map((s) => s.key));
  const families = new Set(familiesOf(sport).map((f) => f.key));
  return odds.every(({ market }) => {
    const parsed = parseMarketKey(market);
    return parsed.kind === "family" && sections.has(parsed.family.section) && families.has(parsed.family.key);
  });
};

describe("readUnibetMarkets, an ice hockey match", () => {
  const odds = readUnibetMarkets(sportPage("hockey"), "e3383172");
  const t = table(odds);

  it("reads only markets the catalog has for ice hockey, in its sections", () => {
    expect(odds.length).toBeGreaterThan(100);
    expect(placed(odds, "hockey sur glace")).toBe(true);
  });

  it("reads the regular time's handicap, totals, double chance and both teams scoring, half lines only", () => {
    expect(t.get("handicap|-0.5")).toEqual({ "1": 2, "2": 1.5 });
    expect(t.get("handicap|1.5")).toEqual({ "1": 1.28, "2": 2.6 });
    expect(t.get("total_goals|5.5")).toEqual({ over: 1.4, under: 2.25 });
    // "6 buts" is a whole line, a push refunded.
    expect([...t.keys()].some((k) => k === "total_goals|6" || k === "total_goals|7")).toBe(false);
    expect(t.get("double_chance")).toEqual({ "1X": 1.43, X2: 1.5, "12": 1.2 });
    expect(t.get("btts")).toEqual({ yes: 1.03, no: 4.75 });
    // The 1 N 2 and the three-way handicaps are others.
    expect(t.has("1X2")).toBe(false);
  });

  it("reads a team's goals by the team in the title, in regular time and the whole match", () => {
    expect(t.get("team_goals@1|2.5")).toEqual({ over: 1.4, under: 2.25 });
    expect(t.get("team_goals@2|2.5")).toEqual({ over: 1.45, under: 2.1 });
    // "Match" includes the overtime and the shootout: its goals over a line come lower.
    expect(t.get("ot_team_goals@1|2.5")).toEqual({ over: 1.35, under: 2.4 });
    expect(t.get("ot_team_goals@2|3.5")).toEqual({ over: 1.95, under: 1.55 });
  });

  it("reads each third's result, refund, double chance, handicap, totals and teams' goals", () => {
    expect(t.get("p1_1X2")).toEqual({ "1": 2.45, X: 2.6, "2": 2.6 });
    expect(t.get("p3_1X2")).toEqual({ "1": 2.25, X: 3.15, "2": 2.4 });
    expect(t.get("p2_draw_no_bet")).toEqual({ "1": 1.65, "2": 1.75 });
    expect(t.get("p1_double_chance")).toEqual({ "1X": 1.27, X2: 1.29, "12": 1.27 });
    expect(t.get("p1_handicap|-0.5")).toEqual({ "1": 2.3, "2": 1.38 });
    expect(t.get("p3_total_goals|1.5")).toEqual({ over: 1.33, under: 2.35 });
    expect(t.get("p2_team_goals@1|1.5")).toEqual({ over: 2.35, under: 1.33 });
  });

  it("leaves out the players' markets", () => {
    expect([...t.keys()].some((k) => /scorer|player/.test(k))).toBe(false);
  });
});

describe("readUnibetMarkets, an American football match", () => {
  const odds = readUnibetMarkets(sportPage("american-football"), "e3366610");
  const t = table(odds);

  it("reads only markets the catalog has for American football, in its sections", () => {
    expect(odds.length).toBeGreaterThan(150);
    expect(placed(odds, "football américain")).toBe(true);
  });

  it("reads the match's handicap and totals, overtime included, and a team's points", () => {
    expect(t.get("spread|-12.5")).toEqual({ "1": 4.15, "2": 1.06 });
    expect(t.get("spread|2.5")).toEqual({ "1": 1.78, "2": 1.62 });
    expect(t.get("total_points|42.5")).toEqual({ over: 1.83, under: 1.58 });
    expect(t.get("team_points@1|19.5")).toEqual({ over: 1.75, under: 1.73 });
    expect(t.get("team_points@2|20.5")).toEqual({ over: 1.72, under: 1.76 });
  });

  it("reads the first half's result, refund, handicap and totals", () => {
    expect(t.get("ht_1X2")).toEqual({ "1": 2.1, X: 7.8, "2": 1.69 });
    expect(t.get("ht_draw_no_bet")).toEqual({ "1": 1.95, "2": 1.55 });
    expect(t.get("ht_spread|0.5")).toEqual({ "1": 1.72, "2": 1.72 });
    expect(t.get("ht_total_points|20.5")).toEqual({ over: 1.8, under: 1.65 });
  });

  it("reads each quarter's result, refund, handicap and totals", () => {
    expect(t.get("q2_1X2")).toEqual({ "1": 2.15, X: 5, "2": 1.94 });
    expect(t.get("q4_draw_no_bet")).toEqual({ "1": 1.75, "2": 1.65 });
    expect(t.get("q1_spread|-2.5")).toEqual({ "1": 2.35, "2": 1.33 });
    expect(t.get("q3_total_points|7.5")).toEqual({ over: 1.9, under: 1.55 });
  });

  it("leaves out the regular time's and the second half's bets, whose time is not the match's, and the players'", () => {
    expect([...t.keys()].some((k) => k.startsWith("2h_"))).toBe(false);
    // "1 N 2" in regular time (a draw at 11.50) is not the listing's winner, overtime included.
    expect(t.has("1X2")).toBe(false);
    expect([...t.keys()].some((k) => /player|scorer/.test(k))).toBe(false);
  });
});

describe("readUnibetMarkets, a handball match", () => {
  const odds = readUnibetMarkets(sportPage("handball"), "e3380773");
  const t = table(odds);

  it("reads only markets the catalog has for handball, in its sections", () => {
    expect(odds.length).toBeGreaterThan(40);
    expect(placed(odds, "handball")).toBe(true);
  });

  it("reads the totals, the refund on a draw, the handicap with the first team's line, and a team's goals", () => {
    expect(t.get("total_goals|59.5")).toEqual({ over: 1.72, under: 1.72 });
    expect(t.get("draw_no_bet")).toEqual({ "1": 1.91, "2": 1.55 });
    expect(t.get("handicap|0.5")).toEqual({ "1": 1.72, "2": 1.72 });
    expect(t.get("handicap|-0.5")).toEqual({ "1": 2.1, "2": 1.45 });
    expect(t.get("team_goals@1|29.5")).toEqual({ over: 1.78, under: 1.72 });
    expect(t.get("team_goals@2|30.5")).toEqual({ over: 1.9, under: 1.62 });
  });

  it("reads the halves' results and refunds, the first half's handicap and total, half-time / full-time", () => {
    expect(t.get("ht_1X2")).toEqual({ "1": 2.1, X: 7, "2": 1.8 });
    expect(t.get("2h_1X2")).toEqual({ "1": 2.05, X: 7.1, "2": 1.75 });
    expect(t.get("2h_draw_no_bet")).toEqual({ "1": 1.8, "2": 1.6 });
    expect(t.get("ht_handicap|1.5")).toEqual({ "1": 1.42, "2": 2.2 });
    expect(t.get("ht_total_goals|29.5")).toEqual({ over: 1.8, under: 1.65 });
    expect(t.get("ht_ft")).toMatchObject({ "1/1": 3, "2/2": 2.3 });
    expect(t.get("highest_scoring_half")).toEqual({ "1st": 2.05, "2nd": 1.7, equal: 12 });
  });
});
