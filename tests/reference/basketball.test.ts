import { describe, it, expect } from "vitest";
import { gunzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { coversEveryCase, parseMarketKey } from "../../src/markets/catalog";
import { parsePriceFrames } from "../../src/reference/exchange";
import { basketballPoints, BasketballMarket, parseBasketballMarkets } from "../../src/reference/basketball";
import { tennisPrices } from "../../src/reference/tennis";

// Real captures of the exchange (9/10/2026): the markets of FC Barcelona v BC
// Zalgiris Kaunas (Euroleague), 5 hours before its tip-off (event/details:
// the Moneyline, the Handicap with 72 lines and the Total Points with 141),
// and the price frames of each of them.
const read = (name: string) => JSON.parse(gunzipSync(readFileSync(join(__dirname, "fixtures", name))).toString());
const DETAILS = read("exchange-basketball-details.json.gz");
const FRAMES = read("exchange-basketball-frames.json.gz");

// The runners of the Moneyline: FC Barcelona and Zalgiris.
const BARCELONA = 278533;
const ZALGIRIS = 11387338;
const markets = parseBasketballMarkets(DETAILS) as BasketballMarket[];

const byKey = (points: ReturnType<typeof basketballPoints>) => {
  const grouped = new Map<string, Map<string, (typeof points)[number]>>();
  for (const p of points) {
    if (!grouped.has(p.market)) grouped.set(p.market, new Map());
    grouped.get(p.market)!.set(p.selection, p);
  }
  return grouped;
};

describe("a basketball match's markets on the exchange", () => {
  it("lists the handicap and the total points, not the moneyline, which the sports cycle prices", () => {
    expect(markets.map((m) => m.type).sort()).toEqual(["COMBINED_TOTAL", "HANDICAP"]);
    const handicap = markets.find((m) => m.type === "HANDICAP")!;
    const total = markets.find((m) => m.type === "COMBINED_TOTAL")!;
    expect(handicap.runners).toHaveLength(144);
    expect(total.runners).toHaveLength(282);
    expect(handicap.runners[0]).toEqual({ selectionId: BARCELONA, handicap: -35.5 });
    expect(total.runners[0]).toEqual({ selectionId: 7017824, handicap: 120.5, side: "UNDER" });
  });

  it("returns nothing for an answer that is not an event's", () => {
    expect(parseBasketballMarkets({})).toEqual([]);
    expect(parseBasketballMarkets({ marketCatalogues: [{ description: { marketType: "HANDICAP" }, marketId: 7, runners: [] }] })).toEqual([]);
  });
});

describe("our outcomes of a basketball match, priced by the exchange's runners", () => {
  const points = basketballPoints(markets, { "1": BARCELONA, "2": ZALGIRIS });
  const t = byKey(points);

  it("reads each runner's own handicap as the first team's line: Barcelona -6.5 is \"1\" at -6.5, Zalgiris +6.5 \"2\"", () => {
    const home = t.get("spread|-6.5")!.get("1")!;
    const away = t.get("spread|-6.5")!.get("2")!;
    expect(home).toMatchObject({ selectionId: BARCELONA, line: -6.5 });
    expect(away).toMatchObject({ selectionId: ZALGIRIS, line: 6.5 });
    expect(home.marketId).toBe(away.marketId);
    // 72 lines, from -35.5 to 35.5, each with both sides.
    expect([...t.keys()].filter((k) => k.startsWith("spread|"))).toHaveLength(72);
  });

  it("reads the total points as over and under each line", () => {
    const over = t.get("total_points|174.5")!.get("over")!;
    const under = t.get("total_points|174.5")!.get("under")!;
    expect(over).toMatchObject({ selectionId: 7017823, line: 174.5 });
    expect(under).toMatchObject({ selectionId: 7017824, line: 174.5 });
    expect([...t.keys()].filter((k) => k.startsWith("total_points|"))).toHaveLength(141);
  });

  it("turns the handicap round when our first team is the exchange's second", () => {
    const reversed = byKey(basketballPoints(markets, { "1": ZALGIRIS, "2": BARCELONA }));
    // Zalgiris +6.5 is now our first team's line, its own.
    expect(reversed.get("spread|6.5")!.get("1")).toMatchObject({ selectionId: ZALGIRIS, line: 6.5 });
    expect(reversed.get("spread|6.5")!.get("2")).toMatchObject({ selectionId: BARCELONA, line: -6.5 });
    expect(reversed.get("total_points|174.5")!.get("over")!.selectionId).toBe(7017823);
  });

  it("keeps only the lines asked for, the ones some bookmaker lists", () => {
    const only = new Set(["spread|-6.5", "total_points|174.5", "total_points|175.5"]);
    const some = basketballPoints(markets, { "1": BARCELONA, "2": ZALGIRIS }, only);
    expect([...new Set(some.map((p) => p.market))].sort()).toEqual(["spread|-6.5", "total_points|174.5", "total_points|175.5"]);
    expect(some).toHaveLength(6);
  });

  it("leaves out a line of a whole number, which refunds a push, and a runner of neither team", () => {
    const odd: BasketballMarket[] = [
      {
        marketId: "1.1",
        type: "HANDICAP",
        runners: [
          { selectionId: BARCELONA, handicap: -6 },
          { selectionId: ZALGIRIS, handicap: 6 },
          { selectionId: 999, handicap: -6.5 },
        ],
      },
      { marketId: "1.2", type: "COMBINED_TOTAL", runners: [{ selectionId: 1, handicap: 174, side: "OVER" }] },
    ];
    expect(basketballPoints(odd, { "1": BARCELONA, "2": ZALGIRIS })).toEqual([]);
  });

  it("makes only keys the catalog knows, with their line", () => {
    for (const p of points) {
      const parsed = parseMarketKey(p.market);
      expect(parsed.kind, p.market).toBe("family");
      if (parsed.kind === "family") expect(parsed.line, p.market).toBeDefined();
    }
  });
});

describe("a basketball match's prices on the exchange", () => {
  const frames = parsePriceFrames(FRAMES);
  const rows = tennisPrices(basketballPoints(markets, { "1": BARCELONA, "2": ZALGIRIS }), frames);
  const at = (market: string, selection: string) => rows.find((r) => r.market === market && r.selection === selection);

  it("prices the lines that have money, with back, lay and what is matched", () => {
    expect(rows.length).toBeGreaterThan(100);
    // The total points market had 10,198 EUR matched; the handicap, 206.
    expect(at("total_points|174.5", "over")).toMatchObject({ matched: 10198.14 });
    expect(at("spread|-6.5", "1")).toMatchObject({ matched: 206.12 });
    for (const r of rows) expect(r.back !== undefined || r.lay !== undefined, `${r.market} ${r.selection}`).toBe(true);
  });

  it("gives fair odds to a line whose both sides are reliably priced: their chances add up to 100%", () => {
    const withFair = rows.filter((r) => r.fair !== undefined);
    expect(withFair.length).toBeGreaterThan(0);
    const byMarket = new Map<string, number[]>();
    for (const r of withFair) byMarket.set(r.market, [...(byMarket.get(r.market) ?? []), 1 / r.fair!]);
    for (const [market, chances] of byMarket) {
      // Both outcomes of a handicap or a total.
      expect(chances, market).toHaveLength(2);
      expect(chances[0] + chances[1], market).toBeCloseTo(1, 10);
      expect(coversEveryCase(market.split("|")[0], withFair.filter((r) => r.market === market).map((r) => r.selection))).toBe(true);
    }
  });
});
