import { describe, it, expect, vi, afterEach } from "vitest";
import { gunzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseEventPlayerMarkets, parsePriceFrames, searchEvents } from "../../src/reference/exchange";
import { golfPrices, parseGolfSearch, placeGolfTournament } from "../../src/reference/golf";
import { matchEvents } from "../../src/matcher/match";
import { RawEvent } from "../../src/types";

// The exchange's answers on 6/10/2026: its search for "Golf" (11 events) and the
// socket's frames for the Winner market of each tournament (8).
const read = (name: string) => JSON.parse(gunzipSync(readFileSync(join(__dirname, "fixtures", name))).toString());
const SEARCH = read("exchange-golf-search.json.gz");
const PRICES = parsePriceFrames(read("exchange-golf-frames.json.gz"));

// The five bookmakers' real winners the same day, as our events.
const OURS = matchEvents(
  JSON.parse(gunzipSync(readFileSync(join(__dirname, "../matcher/fixtures/golf-winners-2026-10-06.json.gz"))).toString()) as Record<
    string,
    RawEvent[]
  >
);
const target = (title: RegExp) => {
  const event = OURS.find((e) => title.test(e.participants[0]))!;
  return {
    participants: event.participants,
    startTime: event.startTime,
    competitors: [...new Set(Object.values(event.byBookmaker).flatMap((odds) => odds.map((o) => o.selection)))],
  };
};

describe("parseGolfSearch", () => {
  const tournaments = parseGolfSearch(SEARCH);

  it("lists the tournaments with a winner market, not the match bets or 3 balls beside them", () => {
    expect(tournaments.map((t) => t.name).sort()).toEqual([
      "Constellation Furyk & Friends 2026",
      "DPW Tour Open de Espana 2026",
      "PGA Baycurrent Classic 2026",
      "PGA US Open 2027",
      "PGA USPGA Championship 2027",
      "The Masters 2027",
      "The Open Championship 2027",
      "The Ryder Cup 2027",
    ]);
  });

  it("gives a tournament its id, its start, its winner market and its runners", () => {
    const baycurrent = tournaments.find((t) => t.name === "PGA Baycurrent Classic 2026")!;
    expect(baycurrent).toMatchObject({
      eventId: "36155980",
      startTime: "2026-10-07T23:45:00.000Z",
      marketId: "1.263390572",
    });
    expect(Object.keys(baycurrent.runners)).toHaveLength(72);
    expect(baycurrent.runners[21082036]).toBe("Xander Schauffele");
  });

  it("leaves out a tournament under way", () => {
    const body = structuredClone(SEARCH);
    body.content.find((e: { name: string }) => e.name === "PGA Baycurrent Classic 2026").inPlay = true;
    expect(parseGolfSearch(body).map((t) => t.name)).not.toContain("PGA Baycurrent Classic 2026");
    expect(parseGolfSearch({})).toEqual([]);
  });
});

describe("placeGolfTournament", () => {
  const tournaments = parseGolfSearch(SEARCH);
  const placed = (title: RegExp) => placeGolfTournament(target(title), tournaments)?.name;

  it("finds each tournament under the exchange's title, the dates being a few days apart", () => {
    expect(placed(/Baycurrent/)).toBe("PGA Baycurrent Classic 2026");
    expect(placed(/Espagne/)).toBe("DPW Tour Open de Espana 2026");
    expect(placed(/Augusta/)).toBe("The Masters 2027");
    expect(placed(/USPGA/)).toBe("PGA USPGA Championship 2027");
    expect(placed(/^US Open/)).toBe("PGA US Open 2027");
    expect(placed(/Open Championship/)).toBe("The Open Championship 2027");
    expect(placed(/Ryder/)).toBe("The Ryder Cup 2027");
  });

  it("finds nothing for a tournament the exchange does not list", () => {
    expect(placed(/Solheim/)).toBeUndefined();
  });
});

describe("golfPrices", () => {
  const baycurrent = parseGolfSearch(SEARCH).find((t) => t.name === "PGA Baycurrent Classic 2026")!;
  const ours = target(/Baycurrent/).competitors;
  const rows = golfPrices(baycurrent, ours, PRICES.get(baycurrent.marketId));
  const row = (name: string) => rows.find((r) => r.selection === name);

  it("prices each runner under our spelling of his name, on the winner market", () => {
    expect(new Set(rows.map((r) => r.market))).toEqual(new Set(["Vainqueur"]));
    // 72 runners, 70 of them aligned on the bookmakers' names.
    expect(rows.length).toBeGreaterThan(60);
    expect(rows.every((r) => ours.includes(r.selection))).toBe(true);
    expect(row("Xander Schauffele")).toMatchObject({ back: expect.any(Number), lay: expect.any(Number) });
    expect(rows.every((r) => r.matched === PRICES.get(baycurrent.marketId)!.matched)).toBe(true);
  });

  it("gives fair odds to the runners whose prices are tight enough, the mid price between back and lay", () => {
    const withFair = rows.filter((r) => r.fair !== undefined);
    // 28 of the 72 have at most 20% between back and lay with 20 EUR on both sides.
    expect(withFair.length).toBeGreaterThan(15);
    expect(withFair.length).toBeLessThan(rows.length);
    for (const r of withFair) {
      expect(r.lay! / r.back! - 1).toBeLessThanOrEqual(0.2 + 1e-9);
      expect(Math.min(r.backSize!, r.laySize!)).toBeGreaterThanOrEqual(20);
      // The chances add up to about 100% (0.997 that day): no scaling down.
      expect(r.fair).toBeCloseTo((r.back! + r.lay!) / 2, 6);
    }
  });

  it("gives no fair odds for a thin market, nor prices for a market the exchange did not answer", () => {
    const masters = parseGolfSearch(SEARCH).find((t) => t.name === "The Masters 2027")!;
    const thin = golfPrices(masters, target(/Augusta/).competitors, PRICES.get(masters.marketId));
    expect(thin.filter((r) => r.fair !== undefined).length).toBeLessThanOrEqual(1);
    expect(golfPrices(baycurrent, ours, undefined)).toEqual([]);
  });

  it("scales the fair odds so that the chances add up to 100% when the exchange's mid prices add up to more", () => {
    const market = PRICES.get(baycurrent.marketId)!;
    const inflated = {
      matched: market.matched,
      runners: new Map([...market.runners].map(([id, p]) => [id, { ...p, back: p.back && p.back / 1.1, lay: p.lay && p.lay / 1.1 }])),
    };
    const scaled = golfPrices(baycurrent, ours, inflated);
    const plain = rows.filter((r) => r.fair !== undefined);
    const mid = (r: { back?: number; lay?: number }) => (r.back! + r.lay!) / 2;
    // Every price 10% shorter: the fair odds are the mids times what the chances add up to.
    for (const r of scaled.filter((x) => x.fair !== undefined).slice(0, 5)) expect(r.fair!).toBeGreaterThan(mid(r) * 1.05);
    expect(plain.length).toBeGreaterThan(0);
  });
});

describe("a golf tournament's Top N on the exchange", () => {
  const DETAILS = read("exchange-golf-details.json.gz");

  it("lists them as the players' markets of the tournament, not its winner, round leader or each way", () => {
    const markets = parseEventPlayerMarkets(DETAILS["36155980"]);
    expect(markets.map((m) => m.market).sort()).toEqual(["golf_top|10", "golf_top|20", "golf_top|5"]);
    expect(Object.keys(markets[0].runners)).toHaveLength(72);
    expect(Object.values(markets[0].runners)).toContain("Xander Schauffele");
    expect(parseEventPlayerMarkets(DETAILS["36155984"]).map((m) => m.market).sort()).toEqual(["golf_top|10", "golf_top|20", "golf_top|5"]);
  });
});

describe("searchEvents, a golf listing", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("asks for all of the exchange's events at once, not its first 10", async () => {
    const asked: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      asked.push(url);
      return { ok: true, status: 200, json: async () => ({ content: [] }) };
    });
    await searchEvents("Golf", { size: 50 });
    await searchEvents("Dortmund");
    expect(asked[0]).toContain("query=Golf&page=0&size=50");
    expect(asked[1]).not.toContain("size=");
  });
});
