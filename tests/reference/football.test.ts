import { describe, it, expect } from "vitest";
import { gunzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseMarketKey } from "../../src/markets/catalog";
import { parsePriceFrames } from "../../src/reference/exchange";
import { footballPoints, parseFootballMarkets, FootballMarkets } from "../../src/reference/football";
import { tennisPrices } from "../../src/reference/tennis";

// Real captures of the exchange (8/10/2026): the markets of FC Heidenheim v
// Kaiserslautern, 20 hours before its kick-off (event/details: 33 markets), and
// the price frames of each of them.
const read = (name: string) => JSON.parse(gunzipSync(readFileSync(join(__dirname, "fixtures", name))).toString());
const DETAILS = read("exchange-football-details.json.gz");
const FRAMES = read("exchange-football-frames.json.gz");

const markets = parseFootballMarkets(DETAILS) as FootballMarkets;
const byKey = (points: ReturnType<typeof footballPoints>) => {
  const grouped = new Map<string, Map<string, (typeof points)[number]>>();
  for (const p of points) {
    if (!grouped.has(p.market)) grouped.set(p.market, new Map());
    grouped.get(p.market)!.set(p.selection, p);
  }
  return grouped;
};
const typeOf = (marketId: string) => markets.markets.find((m) => m.marketId === marketId)?.type;

describe("a football match's markets on the exchange", () => {
  it("reads the teams as the exchange names them, home first, and the home runner of the match odds", () => {
    expect(markets.teams).toEqual(["FC Heidenheim", "Kaiserslautern"]);
    expect(markets.homeSelectionId).toBe(3237590);
  });

  it("lists those we have a family for, not the main market, the three-way handicaps, nor the odd/even", () => {
    const types = markets.markets.map((m) => m.type);
    expect(types).toEqual(
      expect.arrayContaining(["OVER_UNDER_25", "ASIAN_HANDICAP", "BOTH_TEAMS_TO_SCORE", "CORRECT_SCORE", "DOUBLE_CHANCE", "DRAW_NO_BET"])
    );
    for (const left of ["MATCH_ODDS", "TEAM_A_1", "TEAM_B_2", "ODD_OR_EVEN", "ALT_TOTAL_GOALS"]) expect(types).not.toContain(left);
  });

  it("returns nothing for an answer that is not a match's", () => {
    expect(parseFootballMarkets({})).toBeUndefined();
    expect(parseFootballMarkets({ eventInfo: { name: "No separator" }, marketCatalogues: [] })).toBeUndefined();
  });
});

describe("our outcomes of a football match, priced by the exchange's runners", () => {
  const points = footballPoints(markets, false);
  const t = byKey(points);

  it("reads each line of the totals, the match's, a half's and a team's", () => {
    expect(typeOf(t.get("total_goals|2.5")!.get("over")!.marketId)).toBe("OVER_UNDER_25");
    expect(t.get("total_goals|2.5")!.get("under")!.marketId).toBe(t.get("total_goals|2.5")!.get("over")!.marketId);
    expect(t.has("total_goals|0.5") && t.has("total_goals|8.5")).toBe(true);
    expect(typeOf(t.get("ht_total_goals|1.5")!.get("over")!.marketId)).toBe("FIRST_HALF_GOALS_15");
  });

  it("reads the Asian handicap's half lines with the first team's line, and leaves out the whole and quarter ones", () => {
    const home = t.get("handicap|-1.5")!.get("1")!;
    const away = t.get("handicap|-1.5")!.get("2")!;
    expect(home).toMatchObject({ selectionId: 3237590, line: -1.5 });
    expect(away).toMatchObject({ selectionId: 14075, line: 1.5 });
    expect(home.marketId).toBe(away.marketId);
    expect(t.get("handicap|1.5")!.get("1")).toMatchObject({ line: 1.5 });
    expect([...t.keys()].filter((k) => k.startsWith("handicap|")).every((k) => Math.abs(Number(k.split("|")[1]) % 1) === 0.5)).toBe(true);
  });

  it("reads the results, the chances and the score", () => {
    expect(t.get("double_chance")!.get("1X")!.selectionId).toBe(6384646);
    expect(t.get("double_chance")!.get("X2")!.selectionId).toBe(6384647);
    expect(t.get("double_chance")!.get("12")!.selectionId).toBe(6384648);
    expect(t.get("draw_no_bet")!.get("1")!.selectionId).toBe(3237590);
    expect(t.get("ht_1X2")!.get("X")!.selectionId).toBe(58805);
    expect(t.get("btts")!.get("yes")).toBeDefined();
    expect(t.get("ht_ft")!.get("1/X")!.selectionId).toBe(3237591);
    expect(t.get("ht_ft")!.get("2/2")!.selectionId).toBe(473970);
    expect(t.get("correct_score")!.get("0-1")).toBeDefined();
    expect(t.get("ht_correct_score")!.get("2-1")!.selectionId).toBe(6);
    // "Any Unquoted": the half's every other score.
    expect(t.get("ht_correct_score")!.get("other")!.selectionId).toBe(4506345);
    // The full-time score's three buckets of "any other" are not our single "other".
    expect(t.get("correct_score")!.has("other")).toBe(false);
  });

  it("reads a team's win to nil and the combinations of a result with both teams scoring or a total", () => {
    expect(t.get("win_to_nil@1")!.get("yes")!.selectionId).toBe(30246);
    expect(t.has("win_to_nil@2")).toBe(true);
    expect(t.get("result_btts")!.get("1&yes")!.selectionId).toBe(13968936);
    expect(t.get("result_btts")!.get("X&no")!.selectionId).toBe(2041283);
    expect(t.get("result_total|2.5")!.get("2&over")!.selectionId).toBe(7287624);
    expect(t.get("result_total|2.5")!.get("1&under")!.selectionId).toBe(23572079);
  });

  it("gives only keys of the catalog's families", () => {
    expect([...t.keys()].every((k) => parseMarketKey(k).kind === "family")).toBe(true);
  });

  it("turns our teams round when the exchange lists them the other way", () => {
    const reversed = byKey(footballPoints(markets, true));
    // Our first team is the exchange's away side.
    expect(reversed.get("double_chance")!.get("1X")!.selectionId).toBe(6384647);
    expect(reversed.get("double_chance")!.get("X2")!.selectionId).toBe(6384646);
    expect(reversed.get("draw_no_bet")!.get("1")!.selectionId).toBe(14075);
    expect(reversed.get("handicap|1.5")!.get("1")).toMatchObject({ selectionId: 14075, line: 1.5 });
    expect(reversed.get("handicap|1.5")!.get("2")).toMatchObject({ selectionId: 3237590, line: -1.5 });
    expect(reversed.get("ht_ft")!.get("2/X")!.selectionId).toBe(3237591);
    expect(reversed.get("result_btts")!.get("2&yes")!.selectionId).toBe(13968936);
    expect(reversed.get("win_to_nil@2")!.get("yes")!.selectionId).toBe(30246);
    expect(reversed.get("correct_score")!.get("1-0")).toBeDefined();
  });
});

describe("the fair odds of a football match's markets", () => {
  const rows = tennisPrices(footballPoints(markets, false), parsePriceFrames(FRAMES));

  it("prices the outcomes the exchange quotes", () => {
    expect(rows.length).toBeGreaterThan(40);
    expect(rows.some((r) => r.market === "total_goals|2.5" && r.back !== undefined)).toBe(true);
  });

  it("makes fair odds only of a market whose every outcome is reliably priced, summing to 100%", () => {
    const byMarket = new Map<string, number[]>();
    for (const r of rows) if (r.fair !== undefined) byMarket.set(r.market, [...(byMarket.get(r.market) ?? []), r.fair]);
    expect(byMarket.size).toBeGreaterThan(0);
    for (const [market, fairs] of byMarket) {
      expect(fairs.reduce((sum, f) => sum + 1 / f, 0), market).toBeCloseTo(1, 2);
    }
    // The chances overlap: no fair odds for a double chance.
    expect(rows.filter((r) => r.market === "double_chance" && r.fair !== undefined)).toEqual([]);
  });
});
