import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { readWinamaxMarkets, WinamaxMatchReply } from "../../src/scraper/winamaxMarkets";
import { readBetclicMarkets, readBetclicMatchPage } from "../../src/scraper/betclicMarkets";
import { eventMarketOdds } from "../../src/scraper/marketsRun";
import { parseMarketKey } from "../../src/markets/catalog";
import { RawOdds } from "../../src/types";

// Every market of two golf tournaments at Winamax and Betclic, captured live on
// 6/10/2026: Baycurrent Classic and the Open d'Espagne, which Winamax titles
// "Open de España 2026 - Top 5". Winamax's reply to "match:<id>" and Betclic's
// one page of each tournament.
const FIXTURES = "tests/scraper/fixtures/markets";
const gz = (name: string) => gunzipSync(readFileSync(`${FIXTURES}/${name}`));
const winamax = (tournament: "baycurrent" | "open-espana"): WinamaxMatchReply => JSON.parse(gz(`winamax-golf-${tournament}.json.gz`).toString());
const betclic = (tournament: "baycurrent" | "open-espana") => readBetclicMarkets([readBetclicMatchPage(gz(`betclic-golf-${tournament}.bin.gz`))]);

const WINAMAX_IDS = { baycurrent: "1000244716", "open-espana": "1000245211" } as const;
const byMarket = (odds: RawOdds[]) => {
  const markets = new Map<string, RawOdds[]>();
  for (const o of odds) markets.set(o.market, [...(markets.get(o.market) ?? []), o]);
  return markets;
};
const catalogued = (odds: RawOdds[]) => [...new Set(odds.map((o) => o.market))].filter((m) => parseMarketKey(m).kind === "family").sort();

describe("a golf tournament's markets at Winamax", () => {
  const baycurrent = byMarket(readWinamaxMarkets(winamax("baycurrent"), WINAMAX_IDS.baycurrent));
  const espana = byMarket(readWinamaxMarkets(winamax("open-espana"), WINAMAX_IDS["open-espana"]));

  it("reads the Top 5, 10 and 20 and the leader after the 1st round, by their number of winners and title", () => {
    expect([...baycurrent.keys()].filter((m) => !m.startsWith("golf_best_")).sort()).toEqual([
      "golf_round_leader|1",
      "golf_top|10",
      "golf_top|20",
      "golf_top|5",
    ]);
    expect(baycurrent.get("golf_top|5")).toHaveLength(72);
    expect(baycurrent.get("golf_top|5")).toContainEqual({ market: "golf_top|5", selection: "Schauffele, Xander", price: expect.any(Number) });
    expect(baycurrent.get("golf_round_leader|1")).toHaveLength(72);
  });

  it("reads them whatever the tournament's title for them, which Winamax prefixes", () => {
    // "Open de España 2026 - Top 10"
    expect([...espana.keys()].filter((m) => !m.startsWith("golf_best_")).sort()).toEqual([
      "golf_round_leader|1",
      "golf_top|10",
      "golf_top|20",
      "golf_top|5",
    ]);
    expect(espana.get("golf_top|10")!.length).toBeGreaterThan(100);
  });

  it("leaves the winner to the listing, and reads the best of a nationality as the catalog's", () => {
    const winners = [...baycurrent.values()].flat().filter((o) => o.market === "Vainqueur");
    expect(winners).toEqual([]);
    expect([...baycurrent.keys()].filter((m) => m.startsWith("golf_best_")).sort()).toEqual([
      "golf_best_americain",
      "golf_best_anglais",
      "golf_best_asiatique",
      "golf_best_australien",
      "golf_best_canadien",
      "golf_best_europeen",
      "golf_best_europeen_continental",
      "golf_best_grande_bretagne_irlande",
      "golf_best_japonais",
      "golf_best_scandinave",
      "golf_best_sud_africain",
      "golf_best_sud_coreen",
    ]);
    expect(baycurrent.get("golf_best_americain")).toHaveLength(43);
    // Every Winamax market of the tournament is the catalog's: none left under its own name.
    expect([...baycurrent.keys()].filter((m) => m.startsWith("wx:"))).toEqual([]);
  });
});

describe("a golf tournament's markets at Betclic", () => {
  const baycurrent = byMarket(betclic("baycurrent"));
  const espana = byMarket(betclic("open-espana"));

  it("reads the Top 5, 10 and 20 and the leader after the 1st round by their titles", () => {
    expect(catalogued([...baycurrent.values()].flat()).filter((m) => !m.startsWith("golf_best_"))).toEqual(["golf_round_leader|1", "golf_top|10", "golf_top|20", "golf_top|5"]);
    expect(baycurrent.get("golf_top|5")).toHaveLength(72);
    expect(baycurrent.get("golf_top|5")).toContainEqual({ market: "golf_top|5", selection: "Xander Schauffele", price: 2.9 });
    expect(espana.get("golf_top|20")).toHaveLength(130);
    expect(espana.get("golf_round_leader|1")).toHaveLength(132);
  });

  it("leaves the winner to the listing, and reads the best of a nationality as the catalog's", () => {
    expect([...baycurrent.keys()]).not.toContain("bc:Vainqueur Compétition");
    expect([...baycurrent.keys()].filter((m) => m.startsWith("golf_best_")).sort()).toEqual([
      "golf_best_americain",
      "golf_best_anglais",
      "golf_best_australien",
      "golf_best_canadien",
      "golf_best_japonais",
      "golf_best_sud_africain",
      "golf_best_sud_coreen",
    ]);
    expect(baycurrent.get("golf_best_americain")).toHaveLength(43);
    expect([...baycurrent.keys()].filter((m) => m.startsWith("bc:"))).toEqual([]);
  });
});

describe("the two bookmakers' players on one row", () => {
  it("puts the best American's players of both bookmakers on one row", () => {
    const odds = eventMarketOdds(
      ["Baycurrent Classic 2026"],
      { betclic: { sourceId: "b", participants: ["Baycurrent Classic 2026"] }, winamax: { sourceId: "w", participants: ["PGA Tour 2026 - Baycurrent Classic"] } },
      {
        betclic: new Map([["b", betclic("baycurrent")]]),
        winamax: new Map([["w", readWinamaxMarkets(winamax("baycurrent"), WINAMAX_IDS.baycurrent)]]),
      }
    );
    const names = (bookmaker: string) => odds[bookmaker].filter((o) => o.market === "golf_best_americain").map((o) => o.selection);
    // Winamax's "Wallace, Matt" style names are Betclic's "Matt Wallace".
    expect(names("winamax").filter((n) => names("betclic").includes(n)).length).toBeGreaterThan(38);
  });

  it("names a Top 5's players after Betclic's spelling, the seed's, at Winamax", () => {
    const odds = eventMarketOdds(
      ["Baycurrent Classic 2026"],
      { betclic: { sourceId: "b", participants: ["Baycurrent Classic 2026"] }, winamax: { sourceId: "w", participants: ["PGA Tour 2026 - Baycurrent Classic"] } },
      {
        betclic: new Map([["b", betclic("baycurrent")]]),
        winamax: new Map([["w", readWinamaxMarkets(winamax("baycurrent"), WINAMAX_IDS.baycurrent)]]),
      }
    );
    const top5 = (bookmaker: string) => odds[bookmaker].filter((o) => o.market === "golf_top|5").map((o) => o.selection);
    const shared = top5("winamax").filter((name) => top5("betclic").includes(name));
    // Winamax's "Schauffele, Xander" is Betclic's "Xander Schauffele" now.
    expect(shared).toContain("Xander Schauffele");
    expect(shared.length).toBeGreaterThan(65);
  });
});
