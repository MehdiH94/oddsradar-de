import { describe, it, expect, vi, afterEach } from "vitest";
import { gunzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { familiesOf, parseMarketKey, sectionsOf } from "../../src/markets/catalog";
import { fetchGenybetMarkets, fetchNetbetMarkets, readNetbetMarkets } from "../../src/scraper/sportncoMarkets";

// Real answers of NetBet's SportNCo API to the "event_market_list" component of
// a match (8/10/2026): Borussia Dortmund - Werder Brême (69 markets) and
// Mannarino - Cobolli (ATP Shanghai, 21). A market holds one bet per line, its
// title naming the line ("Plus ou moins de 2.5 buts ?") and the period ("en
// 1ère mi-temps"); a price of 1 is a market left open without a price.
const load = (name: "football" | "tennis" | "hockey" | "rugby" | "american-football" | "handball") =>
  JSON.parse(gunzipSync(readFileSync(join(__dirname, `fixtures/sportnco-netbet-event-${name}.json.gz`))).toString());

const priceTable = (odds: { market: string; selection: string; price: number }[]) => {
  const table = new Map<string, Record<string, number>>();
  for (const o of odds) table.set(o.market, { ...(table.get(o.market) ?? {}), [o.selection]: o.price });
  return table;
};

describe("readNetbetMarkets, a football match", () => {
  const t = priceTable(readNetbetMarkets(load("football")));

  it("reads the totals of the match, a team's and the halves', by line", () => {
    expect(t.get("total_goals|1.5")).toEqual({ over: 1.02, under: 5.9 });
    // Plus de 0.5 is at 1: a price that is not one.
    expect(t.get("total_goals|0.5")).toEqual({ under: 19 });
    expect(t.get("ht_total_goals|1.5")).toEqual({ over: 1.77, under: 1.55 });
    expect(t.get("2h_total_goals|1.5")).toEqual({ over: 1.35, under: 1.97 });
    expect(t.get("team_goals@1|1.5")).toEqual({ over: 1.13, under: 3.05 });
    expect(t.get("team_goals@2|0.5")).toEqual({ over: 1.39, under: 2.05 });
    expect(t.get("ht_team_goals@1|0.5")).toEqual({ over: 1.18, under: 2.5 });
    expect(t.get("ht_team_goals@2|0.5")).toEqual({ over: 2.42, under: 1.21 });
    expect(t.get("2h_team_goals@2|0.5")).toEqual({ over: 1.88, under: 1.42 });
    // The shots' totals are not goals'.
    expect([...t.keys()].filter((k) => k.startsWith("total_goals|")).every((k) => Number(k.split("|")[1]) < 10)).toBe(true);
  });

  it("reads the handicap with the first team's line, not the three-way one", () => {
    expect(t.get("handicap|-3.5")).toEqual({ "1": 4.8, "2": 1.05 });
    expect(t.get("handicap|-4.5")).toEqual({ "1": 8.5 });
    expect(t.get("ht_handicap|-1.5")).toEqual({ "1": 3.1, "2": 1.13 });
    expect(t.get("ht_handicap|-0.5")).toEqual({ "1": 1.48, "2": 1.85 });
    expect([...t.keys()].filter((k) => /^(ht_|2h_)?handicap\|-?\d+$/.test(k))).toEqual([]);
  });

  it("reads the results, the chances and the refunds, by period", () => {
    expect(t.get("double_chance")).toEqual({ X2: 2.92 });
    expect(t.get("ht_double_chance")).toEqual({ X2: 1.83, "12": 1.18 });
    expect(t.get("ht_1X2")).toEqual({ "1": 1.48, X: 2.5, "2": 6 });
    expect(t.get("2h_1X2")).toEqual({ "1": 1.39, X: 2.97, "2": 5.5 });
    expect(t.get("draw_no_bet")).toEqual({ "1": 1.01, "2": 6 });
    expect(t.get("ht_draw_no_bet")).toEqual({ "1": 1.04, "2": 4.1 });
    expect(t.get("2h_draw_no_bet")).toEqual({ "1": 1.06, "2": 3.9 });
    expect(t.get("btts")).toEqual({ yes: 1.55, no: 1.97 });
    expect(t.get("ht_btts")).toEqual({ yes: 2.92, no: 1.14 });
    expect(t.get("ht_ft")).toMatchObject({ "1/1": 1.47, "1/X": 11.5, "1/2": 28, "2/1": 10.5, "X/1": 3.5 });
  });

  it("reads who scores first and last, and the counts of goals", () => {
    expect(t.get("first_team_to_score")).toEqual({ "1": 1.15, "2": 3.1, none: 20 });
    expect(t.get("last_team_to_score")).toEqual({ "1": 1.17, "2": 3.05, none: 20 });
    expect(t.get("exact_goals")).toEqual({ "0": 21, "1": 8, "2": 4.4, "3": 4.1, "4": 4.3, "5": 6.1, "6": 9.5, "7+": 10.5 });
    expect(t.get("ht_exact_goals")).toEqual({ "0": 3.85, "1": 2.57, "2": 3.1, "3": 5.8, "4": 13.5, "5+": 23 });
    expect(t.get("2h_exact_goals")).toEqual({ "0": 5.4, "1": 3.05, "2": 3.05, "3": 4.5, "4": 8.5, "5+": 13.5 });
    expect(t.get("team_exact_goals@1")).toEqual({ "0": 9.5, "1": 3.85, "2": 2.97, "3+": 1.61 });
    expect(t.get("team_exact_goals@2")).toEqual({ "0": 2.02, "1": 2.05, "2": 4, "3+": 9.5 });
  });

  it("reads the scores of the match and of the first half", () => {
    expect(t.get("correct_score")).toMatchObject({ "1-0": 5.7, "0-0": 10.5, "0-1": 11.5, "2-1": 4.4 });
    expect(t.get("ht_correct_score")).toMatchObject({ "1-0": 2.3, "0-0": 2.75, "0-1": 5.1 });
  });

  it("reads a result or a double chance with a total or both teams scoring", () => {
    expect(t.get("result_total|1.5")).toEqual({
      "1&over": 1.15,
      "X&over": 5.3,
      "2&over": 7,
      "1&under": 8,
      "X&under": 23,
      "2&under": 22,
    });
    expect(t.get("result_btts")).toEqual({ "1&yes": 2.2, "X&yes": 5.5, "2&yes": 10, "1&no": 2.07, "X&no": 17, "2&no": 12 });
    expect(t.get("dc_total|1.5")).toEqual({
      "X2&over": 2.65,
      "12&over": 1.03,
      "1X&under": 4.8,
      "X2&under": 8.5,
      "12&under": 4.9,
    });
  });

  it("reads a team's win to nil and clean sheet by half", () => {
    expect(t.get("win_to_nil@1")).toEqual({ yes: 2.17, no: 1.34 });
    expect(t.get("win_to_nil@2")).toEqual({ yes: 14.5 });
    expect(t.get("ht_clean_sheet@1")).toEqual({ yes: 1.18, no: 2.1 });
    expect(t.get("ht_clean_sheet@2")).toEqual({ yes: 2.22, no: 1.13 });
    expect(t.get("2h_clean_sheet@1")).toEqual({ yes: 1.28, no: 1.81 });
  });

  it("leaves out the main market (the listing's) and every market no family covers", () => {
    expect(t.has("1X2")).toBe(false);
    expect([...t.keys()].every((k) => parseMarketKey(k).kind === "family")).toBe(true);
    expect(t.size).toBeGreaterThan(40);
  });
});

describe("readNetbetMarkets, a tennis match", () => {
  const t = priceTable(readNetbetMarkets(load("tennis")));

  it("reads the totals of games, of sets, a player's and the first set's", () => {
    expect(t.get("total_games|19.5")).toEqual({ over: 1.27, under: 2.6 });
    expect(t.get("total_games|20.5")).toEqual({ over: 1.38, under: 2.25 });
    expect(t.get("total_sets|2.5")).toEqual({ over: 2.25, under: 1.37 });
    expect(t.get("set1_total_games|8.5")).toEqual({ over: 1.07, under: 3.85 });
    expect(t.get("set1_total_games|9.5")).toEqual({ over: 1.55, under: 1.81 });
    expect(t.get("player_games@1|11.5")).toEqual({ over: 1.53, under: 1.81 });
    expect(t.get("player_games@1|12.5")).toEqual({ over: 2, under: 1.42 });
    expect(t.get("player_games@2|12.5")).toEqual({ over: 1.63, under: 1.7 });
  });

  it("reads the handicaps of games, of the first set's games and of sets", () => {
    expect(t.get("games_handicap|2.5")).toEqual({ "1": 1.83, "2": 1.53 });
    expect(t.get("games_handicap|3.5")).toEqual({ "1": 1.53, "2": 1.83 });
    expect(t.get("set1_games_handicap|-1.5")).toEqual({ "1": 2.7, "2": 1.21 });
    expect(t.get("set1_games_handicap|1.5")).toEqual({ "1": 1.65, "2": 1.67 });
    expect(t.get("set_handicap|-1.5")).toEqual({ "1": 3.45, "2": 1.05 });
    expect(t.get("set_handicap|1.5")).toEqual({ "1": 1.42, "2": 1.85 });
  });

  it("reads the sets: their score and number, a set's winner, a player winning one, and the winner's total", () => {
    expect(t.get("set_betting")).toEqual({ "2-0": 3.1, "0-2": 1.63, "2-1": 3.85, "1-2": 2.55 });
    expect(t.get("exact_sets")).toEqual({ "2": 1.43, "3": 1.97 });
    expect(t.get("set1_winner")).toEqual({ "1": 2.17, "2": 1.4 });
    expect(t.get("set2_winner")).toEqual({ "1": 2.07, "2": 1.39 });
    expect(t.get("win_a_set@1")).toEqual({ yes: 1.48, no: 2.02 });
    expect(t.get("win_a_set@2")).toEqual({ yes: 1.1, no: 3.8 });
    expect(t.get("winner_total_games|22.5")).toEqual({ "1&over": 4.1, "1&under": 4.8, "2&over": 2.67, "2&under": 2.2 });
  });

  it("leaves out the winner (the listing's) and what no family covers", () => {
    expect(t.has("Vainqueur du match")).toBe(false);
    expect([...t.keys()].every((k) => parseMarketKey(k).kind === "family")).toBe(true);
  });
});

// A market lands in a section of the sport's match page, and is a family of it.
const placed = (odds: { market: string }[], sport: string) => {
  const sections = new Set(sectionsOf(sport).map((s) => s.key));
  const families = new Set(familiesOf(sport).map((f) => f.key));
  return odds.every(({ market }) => {
    const parsed = parseMarketKey(market);
    return parsed.kind === "family" && sections.has(parsed.family.section) && families.has(parsed.family.key);
  });
};

// Real answers for an ice hockey match (Grizzly Adams Wolfsburg - Krefeld Pinguine,
// DEL, 28 markets), a rugby union one (Gloucester - Bordeaux Bègles, 2), an NFL one
// (Denver Broncos - Seattle Seahawks, 121) and a handball one (Hsg Wetzlar - Hc
// Erlangen, 26), 14/10/2026.
describe("readNetbetMarkets, an ice hockey match", () => {
  const odds = readNetbetMarkets(load("hockey"));
  const t = priceTable(odds);

  it("reads only markets the catalog has for ice hockey, in its sections", () => {
    expect(odds.length).toBeGreaterThan(50);
    expect(placed(odds, "hockey sur glace")).toBe(true);
  });

  it("keeps the regular time's bets apart from those that include the overtime and the shootout", () => {
    expect(t.get("handicap|-0.5")).toEqual({ "1": 1.61, "2": 1.67 });
    expect(t.get("ot_handicap|-1.5")).toEqual({ "1": 2.02, "2": 1.37 });
    expect(t.get("ot_total_goals|5.5")).toEqual({ over: 1.6, under: 1.72 });
    // NetBet's totals of goals are all the overtime's: none is read as the regular time's.
    expect([...t.keys()].some((k) => k.startsWith("total_goals|"))).toBe(false);
    expect(t.get("team_goals@1|2.5")).toEqual({ over: 1.3, under: 2.22 });
    expect(t.get("team_goals@2|1.5")).toEqual({ over: 1.2, under: 2.6 });
  });

  it("reads the refund on a draw and the double chance, in regular time", () => {
    expect(t.get("draw_no_bet")).toEqual({ "1": 1.24, "2": 2.42 });
    expect(t.get("double_chance")).toEqual({ "1X": 1.07, X2: 1.8, "12": 1.01 });
  });

  it("reads each period's result, refund, handicap and totals", () => {
    expect(t.get("p1_1X2")).toEqual({ "1": 2.05, X: 2.45, "2": 2.95 });
    expect(t.get("p3_1X2")).toEqual({ "1": 1.93, X: 2.72, "2": 2.82 });
    expect(t.get("p2_draw_no_bet")).toEqual({ "1": 1.34, "2": 2.05 });
    expect(t.get("p1_handicap|-0.5")).toEqual({ "1": 2, "2": 1.37 });
    expect(t.get("p1_total_goals|1.5")).toEqual({ over: 1.61, under: 1.67 });
    expect(t.get("p3_total_goals|1.5")).toEqual({ over: 1.37, under: 2.02 });
  });

  it("leaves out the listing's result and the scores", () => {
    expect(t.has("1X2")).toBe(false);
    expect([...t.keys()].some((k) => k.includes("score"))).toBe(false);
  });
});

describe("readNetbetMarkets, a rugby union match", () => {
  it("reads the first half's result, the match's being the listing's", () => {
    const odds = readNetbetMarkets(load("rugby"));
    expect(priceTable(odds).get("ht_1X2")).toEqual({ "1": 3.05, X: 9.5, "2": 1.28 });
    expect(odds).toHaveLength(3);
    expect(placed(odds, "rugby à xv")).toBe(true);
  });
});

describe("readNetbetMarkets, an American football match", () => {
  const odds = readNetbetMarkets(load("american-football"));
  const t = priceTable(odds);

  it("reads only markets the catalog has for American football, in its sections", () => {
    expect(odds.length).toBeGreaterThan(100);
    expect(placed(odds, "football américain")).toBe(true);
  });

  it("reads the handicap and the totals of the match, overtime included, by line", () => {
    expect(t.get("spread|-10.5")).toEqual({ "1": 5.5, "2": 1.05 });
    expect(t.get("spread|3.5")).toEqual({ "1": 1.55, "2": 2.02 });
    expect(t.get("total_points|44.5")).toEqual({ over: 2.17, under: 1.34 });
    // Plus de 28.5 is at 1: a price that is not one.
    expect(t.get("total_points|28.5")).toEqual({ under: 4.9 });
    expect(t.get("team_points@1|19.5")).toEqual({ over: 1.63, under: 1.67 });
    expect(t.get("team_points@2|21.5")).toEqual({ over: 1.7, under: 1.62 });
    expect(t.get("overtime")).toEqual({ yes: 10.5 });
  });

  it("reads the first half's result, refund, handicap and totals", () => {
    expect(t.get("ht_1X2")).toEqual({ "1": 2, X: 7.75, "2": 1.68 });
    expect(t.get("ht_draw_no_bet")).toEqual({ "1": 1.81, "2": 1.53 });
    expect(t.get("ht_spread|0.5")).toEqual({ "1": 1.62, "2": 1.68 });
    expect(t.get("ht_total_points|20.5")).toEqual({ over: 1.73, under: 1.61 });
  });

  it("reads the second half only where it says the overtime is in", () => {
    expect(t.get("2h_draw_no_bet")).toEqual({ "1": 1.82, "2": 1.53 });
    expect(t.get("2h_spread|0.5")).toEqual({ "1": 1.67, "2": 1.63 });
    // "Qui va gagner la 2ème mi-temps ?" leaves the overtime out, a draw possible; and a
    // team's points in it do not say.
    expect(t.has("2h_1X2")).toBe(false);
    expect([...t.keys()].some((k) => k.startsWith("2h_team_points"))).toBe(false);
  });

  it("reads each quarter's result, refund, handicap and totals, and the highest quarter", () => {
    expect(t.get("q2_1X2")).toEqual({ "1": 2.07, X: 5.3, "2": 1.83 });
    expect(t.get("q1_draw_no_bet")).toEqual({ "1": 1.73, "2": 1.58 });
    expect(t.get("q1_spread|0.5")).toEqual({ "1": 1.39, "2": 2.07 });
    expect(t.get("q1_total_points|7.5")).toEqual({ over: 1.83, under: 1.52 });
    expect(t.get("q1_team_points@1|0.5")).toEqual({ over: 1.43, under: 1.97 });
    expect(t.get("highest_quarter")).toMatchObject({ q1: 7.5, q2: 2.02, q3: 5.8, tie: 7.5 });
  });

  it("leaves out the players' yards, the touchdowns, and the listing's winner", () => {
    expect([...t.keys()].some((k) => k.startsWith("player_"))).toBe(false);
    expect(t.has("1X2")).toBe(false);
  });
});

describe("readNetbetMarkets, a handball match", () => {
  const odds = readNetbetMarkets(load("handball"));
  const t = priceTable(odds);

  it("reads only markets the catalog has for handball, in its sections", () => {
    expect(odds.length).toBeGreaterThan(40);
    expect(placed(odds, "handball")).toBe(true);
  });

  it("reads the totals, a team's, the handicap with the first team's line, and the double chance", () => {
    expect(t.get("total_goals|59.5")).toEqual({ over: 1.67, under: 1.65 });
    expect(t.get("team_goals@1|29.5")).toEqual({ over: 1.7, under: 1.68 });
    expect(t.get("team_goals@2|30.5")).toEqual({ over: 1.83, under: 1.55 });
    expect(t.get("handicap|0.5")).toEqual({ "1": 1.65, "2": 1.71 });
    expect(t.get("double_chance")).toEqual({ "1X": 1.67, X2: 1.4 });
    // The three-way handicaps ("(0:2)") are left out.
    expect([...t.keys()].filter((k) => k.startsWith("handicap|"))).toEqual(["handicap|0.5"]);
  });

  it("reads the halves, half-time / full-time and the half with most goals", () => {
    expect(t.get("ht_1X2")).toEqual({ "1": 1.97, X: 6.75, "2": 1.73 });
    expect(t.get("2h_1X2")).toEqual({ "1": 2.07, X: 6.75, "2": 1.82 });
    expect(t.get("ht_handicap|1.5")).toEqual({ "1": 1.34, "2": 2.25 });
    expect(t.get("ht_total_goals|29.5")).toEqual({ over: 1.78, under: 1.58 });
    expect(t.get("ht_ft")).toMatchObject({ "1/1": 3, "2/2": 2.37, "X/X": 30 });
    expect(t.get("highest_scoring_half")).toEqual({ "1st": 2, "2nd": 1.63, equal: 11.5 });
  });
});

describe("readNetbetMarkets, other cases", () => {
  it("reads nothing of another sport or an answer without an event", () => {
    const snooker = load("football");
    const event = JSON.stringify(snooker).replace('"label":"Football"', '"label":"Snooker"');
    expect(readNetbetMarkets(JSON.parse(event))).toEqual([]);
    expect(readNetbetMarkets({ components: [] })).toEqual([]);
  });
});

describe("fetchNetbetMarkets", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("asks for each match's markets by its id, as its own page", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const { context } = JSON.parse(String(init?.body));
      const reply = context.url_key === "/evenement/12087507" ? load("football") : load("tennis");
      return new Response(JSON.stringify(reply), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const markets = await fetchNetbetMarkets(["12087507", "12209277"]);

    expect([...markets.keys()]).toEqual(["12087507", "12209277"]);
    expect(markets.get("12087507")!.some((o) => o.market === "total_goals|1.5")).toBe(true);
    expect(markets.get("12209277")!.some((o) => o.market === "total_games|19.5")).toBe(true);
    const asked = fetchMock.mock.calls.map(([, init]) => JSON.parse(String(init?.body)));
    expect(asked.map((a) => a.context.url_key)).toEqual(["/evenement/12087507", "/evenement/12209277"]);
    expect(asked[0].components).toEqual([{ tree_compo_key: "event_market_list", params: null }]);
  });

  it("keeps the other matches' markets when one fails, and fails when all do", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) =>
        JSON.parse(String(init?.body)).context.url_key.endsWith("bad")
          ? new Response("{}", { status: 503 })
          : new Response(JSON.stringify(load("football")), { status: 200 })
      )
    );
    const markets = await fetchNetbetMarkets(["12087507", "bad"]);
    expect([...markets.keys()]).toEqual(["12087507"]);
    expect(warn).toHaveBeenCalled();

    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 503 })));
    await expect(fetchNetbetMarkets(["a", "b"])).rejects.toThrow(/every netbet match failed/);
    warn.mockRestore();
  });

  it("asks for nothing when given nothing", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect((await fetchNetbetMarkets([])).size).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("fetchGenybetMarkets", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("asks Genybet's API for each match's markets, and reads them as NetBet's", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(load("football")), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const markets = await fetchGenybetMarkets(["12087507"]);

    expect(markets.get("12087507")!.some((o) => o.market === "total_goals|1.5")).toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://ws.genybet.fr/component/data");
    expect((init.headers as Record<string, string>).referer).toBe("https://www.genybet.fr/");
    expect(JSON.parse(String(init.body)).context.url_key).toBe("/evenement/12087507");
  });

  it("fails, naming Genybet, when every match does", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 403 })));
    await expect(fetchGenybetMarkets(["a", "b"])).rejects.toThrow(/every genybet match failed/);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("[markets:genybet]"), expect.anything());
    warn.mockRestore();
  });
});
