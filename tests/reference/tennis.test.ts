import { describe, it, expect } from "vitest";
import { gunzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parsePriceFrames } from "../../src/reference/exchange";
import {
  parseTennisMarkets,
  parseTennisSearch,
  placeTennisMatch,
  playerSearchTerm,
  samePlayer,
  TennisMarkets,
  tennisPoints,
  tennisPrices,
} from "../../src/reference/tennis";

// Vekic - Swiatek on the exchange, every market and its prices (4/10/2026).
const FIXTURES = join(__dirname, "fixtures");
const read = (name: string) => JSON.parse(gunzipSync(readFileSync(join(FIXTURES, name))).toString());
const markets = parseTennisMarkets(read("exchange-tennis-details.json.gz")) as TennisMarkets;
const prices = parsePriceFrames(read("exchange-tennis-frames.json.gz"));
const byKey = (rows: ReturnType<typeof tennisPrices>) => new Map(rows.map((r) => [`${r.market} ${r.selection}`, r]));

describe("finding a tennis match on the exchange", () => {
  it("reads its tennis matches, singles only", () => {
    expect(
      parseTennisSearch({
        content: [
          { id: "1", eventTypeId: "2", name: "Vekic v Iga Swiatek", inPlay: false },
          { id: "2", eventTypeId: "2", name: "Krawczyk/Siegemund v Dabrowski/Routliffe", inPlay: false },
          { id: "3", eventTypeId: "2", name: "Sinner v Alcaraz", inPlay: true },
          { id: "4", eventTypeId: "1", name: "France v Italy", inPlay: false },
        ],
      })
    ).toEqual([{ eventId: "1", players: ["Vekic", "Iga Swiatek"] }]);
  });

  it("knows a player by their surname, an initial or a shorter first name", () => {
    expect(playerSearchTerm("Alex De Minaur")).toBe("minaur");
    expect(samePlayer("Iga Swiatek", "Iga Swiatek")).toBe(true);
    expect(samePlayer("Donna Vekic", "Vekic")).toBe(true);
    expect(samePlayer("Marie Bouzkova", "M Bouzkova")).toBe(true);
    expect(samePlayer("Iva Jovic", "I Jović")).toBe(true);
    expect(samePlayer("Xinran Sun", "Xin Sun")).toBe(true);
    expect(samePlayer("Alex De Minaur", "Alex de Minaur")).toBe(true);
    // Another player of the same surname.
    expect(samePlayer("Karolina Pliskova", "Kristyna Pliskova")).toBe(false);
    expect(samePlayer("Karolina Pliskova", "K Pliskova")).toBe(true);
    expect(samePlayer("Karolina Muchova", "Swiatek")).toBe(false);
  });

  it("places our match among the exchange's, whichever way round it names the players", () => {
    const candidates = [
      { eventId: "a", players: ["Sinner", "Alcaraz"] as [string, string] },
      { eventId: "b", players: ["Vekic", "Iga Swiatek"] as [string, string] },
    ];
    expect(placeTennisMatch(["Donna Vekic", "Iga Swiatek"], candidates)).toEqual({ event: candidates[1], reversed: false });
    expect(placeTennisMatch(["Iga Swiatek", "Donna Vekic"], candidates)).toEqual({ event: candidates[1], reversed: true });
    expect(placeTennisMatch(["Iga Swiatek", "Coco Gauff"], candidates)).toBeUndefined();
  });
});

describe("a tennis match's markets on the exchange", () => {
  it("lists those we have a family for", () => {
    expect(markets.players).toEqual(["Vekic", "Iga Swiatek"]);
    expect(markets.markets.map((m) => m.type).sort()).toEqual([
      "COMBINED_TOTAL",
      "HANDICAP",
      "MATCH_ODDS",
      "NUMBER_OF_SETS",
      "PLAYER_A_WIN_A_SET",
      "PLAYER_B_WIN_A_SET",
      "SET_BETTING",
      "SET_WINNER",
      "SET_WINNER",
    ]);
  });

  it("prices each line of its Asian markets on its own", () => {
    const handicap = markets.markets.find((m) => m.type === "HANDICAP")!;
    const lines = prices.get(handicap.marketId)!.lines!;
    // Swiatek -5.5 games, Vekic +5.5.
    expect(lines.get("12085633|-5.5")).toMatchObject({ back: 1.72, lay: 1.75 });
    expect(lines.get("6603941|5.5")).toMatchObject({ back: 2.32, lay: 2.4 });
  });

  it("gives each of our outcomes its runner, in our players' order", () => {
    const points = tennisPoints(markets, false);
    const of = (market: string, selection: string) => points.find((p) => p.market === market && p.selection === selection);
    expect(of("Vainqueur du match", "1")).toMatchObject({ selectionId: 6603944 });
    expect(of("Vainqueur du match", "2")).toMatchObject({ selectionId: 12085633 });
    // Vekic +5.5 is player 1 at +5.5; Swiatek -5.5 player 2 on that same line.
    expect(of("games_handicap|5.5", "1")).toMatchObject({ selectionId: 6603941, line: 5.5 });
    expect(of("games_handicap|5.5", "2")).toMatchObject({ selectionId: 12085633, line: -5.5 });
    expect(of("total_games|19.5", "over")).toMatchObject({ selectionId: 7698572, line: 19.5 });
    expect(points.some((p) => p.market === "total_games|20")).toBe(false);
    expect(points.filter((p) => p.market === "set_betting").map((p) => p.selection).sort()).toEqual(["0-2", "1-2", "2-0", "2-1"]);
    expect(points.filter((p) => p.market === "exact_sets").map((p) => p.selection)).toEqual(["2", "3"]);
    expect(of("win_a_set@1", "yes")).toBeDefined();
    expect(of("win_a_set@2", "no")).toBeDefined();
    expect(of("set1_winner", "2")).toBeDefined();

    // Our match naming Swiatek first: everything turned round.
    const reversed = tennisPoints(markets, true);
    const rev = (market: string, selection: string) => reversed.find((p) => p.market === market && p.selection === selection);
    expect(rev("Vainqueur du match", "1")).toMatchObject({ selectionId: 12085633 });
    expect(rev("games_handicap|-5.5", "1")).toMatchObject({ selectionId: 12085633, line: -5.5 });
    expect(rev("set_betting", "2-0")?.selectionId).toBe(of("set_betting", "0-2")?.selectionId);
    expect(rev("win_a_set@2", "yes")?.selectionId).toBe(of("win_a_set@1", "yes")?.selectionId);
  });

  it("makes fair odds of the markets priced reliably, their mids without the margin", () => {
    const rows = byKey(tennisPrices(tennisPoints(markets, false), prices));
    // The winner: 8.8/9 and 1.12/1.13, within 10%.
    const [one, two] = [rows.get("Vainqueur du match 1")!, rows.get("Vainqueur du match 2")!];
    expect(1 / one.fair! + 1 / two.fair!).toBeCloseTo(1, 10);
    expect(one.fair).toBeCloseTo(1 / ((2 / 17.8) / (2 / 17.8 + 2 / 2.25)), 10);
    // Vekic +5.5 at 2.32/2.40 (364 / 727 EUR), Swiatek -5.5 at 1.72/1.75.
    expect(rows.get("games_handicap|5.5 1")!.fair).toBeCloseTo(2.36 * (1 / 2.36 + 1 / 1.735), 10);
    expect(rows.get("total_games|18.5 over")!.fair).toBeDefined();
    // 20.5 games: 2.6/3.35 over, too far apart.
    expect(rows.get("total_games|20.5 over")).toMatchObject({ back: 2.6, lay: 3.35 });
    expect(rows.get("total_games|20.5 over")!.fair).toBeUndefined();
    // The sets: 4 EUR on 2-1 Vekic, too thin.
    expect(rows.get("set_betting 2-1")!.fair).toBeUndefined();
    expect([...rows.values()].filter((r) => r.fair !== undefined).length).toBe(12);
  });

  it("makes none of a market missing an outcome, whose others would be overpriced without it", () => {
    const tight = { back: 3.9, lay: 4, backSize: 100, laySize: 100 };
    const book = new Map([["m", { runners: new Map([[1, tight], [2, tight], [3, tight]]), matched: 500 }]]);
    const point = (selectionId: number, selection: string) => ({ market: "set_betting", selection, marketId: "m", selectionId });
    // 2-0, 2-1 and 1-2 priced, 0-2 not.
    const rows = tennisPrices([point(1, "2-0"), point(2, "2-1"), point(3, "1-2")], book);
    expect(rows.map((r) => r.fair)).toEqual([undefined, undefined, undefined]);
    const four = new Map([["m", { runners: new Map([[1, tight], [2, tight], [3, tight], [4, tight]]), matched: 500 }]]);
    expect(tennisPrices([point(1, "2-0"), point(2, "2-1"), point(3, "1-2"), point(4, "0-2")], four).map((r) => r.fair)).toEqual([
      expect.closeTo(4, 10),
      expect.closeTo(4, 10),
      expect.closeTo(4, 10),
      expect.closeTo(4, 10),
    ]);
  });
});
