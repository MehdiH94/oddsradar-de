import { describe, it, expect, vi, afterEach } from "vitest";
import { gunzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseMarketKey } from "../../src/markets/catalog";
import { fractionalToDecimal } from "../../src/scraper/betsson";
import { fetchBetssonMarkets, readBetssonEventMarkets } from "../../src/scraper/betssonMarkets";

// Real answers of Betsson's content service to the "event" of a match
// (8/10/2026): Santos - Flamengo (Brasileirao, 148 markets) and Sakamoto -
// Rublev (ATP Shanghai, 27 markets). Betsson names a market by its own code
// (`idefmarkettype`), its prices are fractions, and its selections carry the
// teams' names ("FC Santos ou Match nul") and the lines ("Moins de 2.5").
const load = (name: string) =>
  JSON.parse(gunzipSync(readFileSync(join(__dirname, `fixtures/betsson-event-${name}.json.gz`))).toString());

// A price given as the fraction the service gives.
const d = (up: number, down: number) => fractionalToDecimal(String(up), String(down));

const priceTable = (odds: { market: string; selection: string; price: number }[]) => {
  const table = new Map<string, Record<string, number>>();
  for (const o of odds) table.set(o.market, { ...(table.get(o.market) ?? {}), [o.selection]: o.price });
  return table;
};

describe("readBetssonEventMarkets, a football match", () => {
  const table = priceTable(readBetssonEventMarkets(load("football")));

  it("reads the goals' totals, a team's and the halves', by line, half goals only", () => {
    expect(table.get("total_goals|2.5")).toEqual({ over: d(9, 20), under: d(28, 25) });
    expect([...table.keys()].filter((k) => k.startsWith("total_goals|")).length).toBe(3);
    expect(table.get("team_goals@1|0.5")).toEqual({ over: d(31, 100), under: d(38, 25) });
    expect(table.get("team_goals@2|0.5")).toEqual({ over: d(9, 100), under: d(31, 10) });
    expect(table.get("ht_total_goals|0.5")).toEqual({ over: d(21, 100), under: d(91, 50) });
    expect(table.has("2h_total_goals|0.5")).toBe(true);
    expect(table.has("ht_team_goals@1|0.5")).toBe(true);
    expect(table.has("2h_team_goals@2|0.5")).toBe(true);
  });

  it("reads the two-way handicap with the first team's line, not the three-way one beside it", () => {
    expect(table.get("handicap|-0.5")).toEqual({ "1": d(23, 10), "2": d(9, 50) });
    expect(table.get("ht_handicap|-0.5")).toEqual({ "1": d(5, 2), "2": d(4, 25) });
    expect(table.has("2h_handicap|-0.5")).toBe(true);
    // "Handicap 1:0" has three outcomes, a draw's among them: another bet.
    expect([...table.keys()].filter((k) => /^(ht_|2h_)?handicap\|-?\d+$/.test(k))).toEqual([]);
  });

  it("reads the results, the chances and the refunds, by period", () => {
    expect(table.get("double_chance")).toEqual({ "1X": d(17, 25), "12": d(9, 50), X2: d(4, 25) });
    expect(table.get("draw_no_bet")).toEqual({ "1": d(42, 25), "2": d(27, 100) });
    expect(table.get("ht_1X2")).toEqual({ "1": d(16, 5), X: d(33, 25), "2": d(28, 25) });
    expect(table.get("2h_1X2")).toEqual({ "1": d(57, 20), X: d(43, 25), "2": d(103, 100) });
    expect(table.has("ht_double_chance") && table.has("2h_double_chance")).toBe(true);
    expect(table.has("ht_draw_no_bet") && table.has("2h_draw_no_bet")).toBe(true);
    expect(table.get("btts")).toEqual({ yes: d(49, 100), no: d(21, 20) });
    expect(table.has("ht_btts") && table.has("2h_btts")).toBe(true);
  });

  it("reads who scores first and last, and the half with the most goals", () => {
    expect(table.get("first_team_to_score")).toEqual({ "1": d(131, 100), "2": d(1, 2), none: d(27, 2) });
    expect(table.get("last_team_to_score")).toEqual({ "1": d(28, 25), "2": d(43, 100), none: d(23, 2) });
    expect(table.has("ht_first_team_to_score") && table.has("2h_first_team_to_score")).toBe(true);
    expect(table.get("highest_scoring_half")).toEqual({ "1st": d(9, 5), "2nd": d(24, 25), equal: d(12, 5) });
  });

  it("reads the goals' counts and bands, and the minute of the first goal", () => {
    expect(table.get("exact_goals")?.["0"]).toBe(d(25, 2));
    expect(table.get("exact_goals")?.["6+"]).toBe(d(127, 20));
    expect(table.get("team_exact_goals@1")).toEqual({ "0": d(33, 20), "1": d(13, 10), "2": d(14, 5), "3+": d(119, 20) });
    expect(table.get("goal_bands")).toEqual({ "0-1": d(11, 4), "2-3": d(4, 5), "4-5": d(8, 5), "6+": d(59, 10) });
    expect(table.get("first_goal_minute_15")?.["1-15"]).toBe(d(69, 50));
    expect(table.get("first_goal_minute_15")?.none).toBe(d(25, 2));
    expect(table.get("first_goal_minute_10")?.["1-10"]).toBe(d(47, 20));
    expect(table.get("first_goal_minute_10")?.["81-90"]).toBe(d(20, 1));
  });

  it("reads the half-time / full-time, the scores and the margin of victory", () => {
    expect(table.get("ht_ft")?.["1/1"]).toBe(d(116, 25));
    expect(table.get("ht_ft")?.["1/X"]).toBe(d(1101, 100));
    expect(table.get("ht_ft")?.["X/X"]).toBe(d(393, 100));
    expect(table.get("ht_ft")?.["2/2"]).toBe(d(29, 25));
    expect(table.get("correct_score")?.["0-0"]).toBe(d(1113, 100));
    expect(table.get("correct_score")?.["4-1"]).toBe(d(931, 10));
    expect(table.get("ht_correct_score")?.["0-0"]).toBe(d(97, 50));
    expect(table.get("ht_correct_score")?.other).toBe(d(167, 20));
    expect(table.get("winning_margin")).toEqual({
      "1:1": d(81, 20),
      "1:2": d(10, 1),
      "1:3+": d(24, 1),
      "2:1": d(43, 20),
      "2:2": d(63, 20),
      "2:3+": d(69, 20),
      X: d(39, 20),
    });
  });

  it("reads a result and a total, both teams scoring, and who scores first with the result", () => {
    expect(table.get("result_total|1.5")).toEqual({
      "1&under": d(23, 2),
      "1&over": d(61, 20),
      "X&under": d(23, 2),
      "X&over": d(13, 5),
      "2&under": d(133, 20),
      "2&over": d(18, 25),
    });
    expect(table.get("result_btts")?.["1&yes"]).toBe(d(24, 5));
    expect(table.get("result_btts")?.["X&no"]).toBe(d(25, 2));
    expect(table.get("ht_result_btts")?.["1&yes"]).toBe(d(35, 2));
    expect(table.get("first_goal_result")?.["1>1"]).toBe(d(47, 20));
    expect(table.get("first_goal_result")?.none).toBe(d(19, 2));
  });

  it("reads a team's clean sheet, win to nil, and its halves", () => {
    expect(table.get("clean_sheet@1")).toEqual({ yes: d(3, 1), no: d(9, 100) });
    expect(table.get("win_to_nil@1")).toEqual({ yes: d(19, 5), no: d(1, 25) });
    expect(table.get("win_both_halves@1")).toEqual({ yes: d(49, 10), no: d(1, 100) });
    expect(table.get("win_either_half@1")).toEqual({ yes: d(123, 100), no: d(49, 100) });
    expect(table.get("score_both_halves@1")).toEqual({ yes: d(5, 2), no: d(13, 100) });
    expect(table.has("clean_sheet@2") && table.has("win_to_nil@2")).toBe(true);
  });

  it("leaves out the main market (the listing's) and every market no family covers", () => {
    expect(table.has("1X2")).toBe(false);
    expect([...table.keys()].every((k) => parseMarketKey(k).kind === "family")).toBe(true);
    expect(table.size).toBeGreaterThan(55);
  });
});

describe("readBetssonEventMarkets, a tennis match", () => {
  const table = priceTable(readBetssonEventMarkets(load("tennis")));

  it("reads the totals and the handicaps of games and of sets, half lines only", () => {
    expect(table.get("total_games|22.5")).toEqual({ under: d(3, 4), over: d(7, 10) });
    expect(table.has("total_games|21.5") && table.has("total_games|23.5")).toBe(true);
    expect(table.get("games_handicap|3.5")).toEqual({ "1": d(13, 20), "2": d(4, 5) });
    expect(table.get("set_handicap|-1.5")).toEqual({ "1": d(17, 5), "2": d(11, 100) });
    expect(table.get("set_handicap|1.5")).toEqual({ "1": d(17, 25), "2": d(87, 100) });
    expect(table.get("player_games@1|11.5")).toEqual({ under: d(81, 100), over: d(73, 100) });
    expect(table.get("player_games@2|12.5")).toEqual({ under: d(109, 100), over: d(53, 100) });
    expect(table.get("total_sets|2.5")).toEqual({ under: d(47, 100), over: d(123, 100) });
  });

  it("reads the sets: their score, their number, a set's winner, its total and its score", () => {
    expect(table.get("set_betting")).toEqual({ "2-0": d(15, 4), "2-1": d(87, 20), "1-2": d(2, 1), "0-2": d(19, 25) });
    expect(table.get("exact_sets")).toEqual({ "2": d(9, 20), "3": d(59, 50) });
    expect(table.get("set1_winner")).toEqual({ "1": d(73, 50), "2": d(19, 50) });
    expect(table.get("set2_winner")).toEqual({ "1": d(137, 100), "2": d(37, 100) });
    expect(table.get("set1_total_games|9.5")).toEqual({ under: d(51, 50), over: d(12, 25) });
    expect(table.get("set1_correct_score")?.["6-0"]).toBe(d(100, 1));
    expect(table.get("set1_correct_score")?.["2-6"]).toBe(d(131, 20));
    expect(table.get("set1_match")).toEqual({
      "1/1": d(21, 10),
      "2/1": d(77, 10),
      "1/2": d(4, 1),
      "2/2": d(2, 5),
    });
  });

  it("reads a player winning a set, the 6-0 set, and the winner with the total of games", () => {
    expect(table.get("win_a_set@1")).toEqual({ yes: d(13, 20), no: d(21, 25) });
    expect(table.get("win_a_set@2")).toEqual({ yes: d(1, 10), no: d(63, 20) });
    expect(table.get("bagel")).toEqual({ yes: d(11, 2), no: d(1, 100) });
    expect(table.get("winner_total_games|22.5")).toEqual({
      "1&under": d(57, 10),
      "2&under": d(111, 100),
      "1&over": d(13, 4),
      "2&over": d(137, 100),
    });
  });

  it("leaves out the winner (the listing's) and what no family covers", () => {
    expect(table.has("Vainqueur du match")).toBe(false);
    expect([...table.keys()].every((k) => parseMarketKey(k).kind === "family")).toBe(true);
  });
});

describe("readBetssonEventMarkets, other cases", () => {
  it("reads nothing from a sport it has no markets of, or an answer without an event", () => {
    const handball = { data: { ...load("football").data, idfosporttype: "HBL" } };
    expect(readBetssonEventMarkets(handball)).toEqual([]);
    expect(readBetssonEventMarkets({ errorType: "CONTENT_NOT_FOUND", data: ["event", "1.1"] })).toEqual([]);
    expect(readBetssonEventMarkets({})).toEqual([]);
  });

  it("drops an outcome without a price", () => {
    const football = load("football");
    const draw = football.data.markets.find((m: { idefmarkettype: string }) => m.idefmarkettype === "10").selections[0];
    draw.currentpriceup = null;
    const dc = priceTable(readBetssonEventMarkets(football)).get("double_chance");
    expect(dc).toEqual({ "12": d(9, 50), X2: d(4, 25) });
  });
});

describe("fetchBetssonMarkets", () => {
  afterEach(() => vi.unstubAllGlobals());

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  it("asks for each match's event, and reads each as its sport's", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const { contentId } = JSON.parse(String(init?.body));
      return json(contentId.id === "4291432.1" ? load("football") : load("tennis"));
    });
    vi.stubGlobal("fetch", fetchMock);

    const markets = await fetchBetssonMarkets(["4291432.1", "4301363.1"]);

    expect([...markets.keys()].sort()).toEqual(["4291432.1", "4301363.1"]);
    expect(markets.get("4291432.1")!.some((o) => o.market === "total_goals|2.5")).toBe(true);
    expect(markets.get("4301363.1")!.some((o) => o.market === "total_games|22.5")).toBe(true);
    const asked = fetchMock.mock.calls.map(([, init]) => JSON.parse(String(init?.body)).contentId);
    expect(asked).toEqual([
      { type: "event", id: "4291432.1" },
      { type: "event", id: "4301363.1" },
    ]);
  });

  it("keeps the other matches' markets when one fails, and fails when all do", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) =>
        JSON.parse(String(init?.body)).contentId.id === "bad" ? json({}, 500) : json(load("football"))
      )
    );
    const markets = await fetchBetssonMarkets(["4291432.1", "bad"]);
    expect([...markets.keys()]).toEqual(["4291432.1"]);
    expect(warn).toHaveBeenCalled();

    vi.stubGlobal("fetch", vi.fn(async () => json({}, 500)));
    await expect(fetchBetssonMarkets(["a", "b"])).rejects.toThrow(/every betsson match failed/);
    warn.mockRestore();
  });

  it("asks for nothing when given nothing", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect((await fetchBetssonMarkets([])).size).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
