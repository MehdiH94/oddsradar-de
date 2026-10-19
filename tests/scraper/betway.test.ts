import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  BETWAY_SPORTS,
  BetwayCategoryDetails,
  BetwayEventList,
  BetwayMarkets,
  BetwayPost,
  fetchBetway,
  forgetBetwayLists,
  groupsOf,
  parseBetwayMarkets,
} from "../../src/scraper/betway";

// Real answers of Betway.de's API (betway.de/de/services/api/events/v2, in
// English, 19/10/2026): football's competitions (four countries, three groups
// each), the Bundesliga's matches, and main markets: six Bundesliga matches,
// NBA and Euroleague games and a virtual one, NHL games, tennis matches.
const fixture = <T>(name: string): T => JSON.parse(readFileSync(join(__dirname, `fixtures/betway-${name}.json`), "utf8"));
const CATEGORY = fixture<BetwayCategoryDetails>("category-soccer");
const GROUP = fixture<BetwayEventList>("group-bundesliga");
const SOCCER = fixture<BetwayMarkets>("markets-soccer");
const BASKETBALL = fixture<BetwayMarkets>("markets-basketball");
const HOCKEY = fixture<BetwayMarkets>("markets-hockey");
const TENNIS = fixture<BetwayMarkets>("markets-tennis");
const NOW = Date.parse("2026-10-19T12:00:00Z");

beforeEach(() => forgetBetwayLists());
afterEach(() => vi.restoreAllMocks());

const priceOf = (event: { odds: { selection: string; price: number }[] }, selection: string) =>
  event.odds.find((o) => o.selection === selection)?.price;
const changed = <T>(r: T, edit: (copy: T) => void): T => {
  const copy = structuredClone(r);
  edit(copy);
  return copy;
};

describe("parseBetwayMarkets", () => {
  it("reads a football match's result in ordinary time, its prices net of the 5.3% tax", () => {
    const events = parseBetwayMarkets(SOCCER, "soccer", NOW);
    expect(events).toHaveLength(6);
    const [stuttgart] = events;
    expect(stuttgart).toMatchObject({
      sport: "football",
      competition: "Bundesliga",
      participants: ["Stuttgart", "Borussia M'gladbach"],
      startTime: "2026-10-23T18:30:00.000Z",
      sourceId: "17260272",
    });
    // The site's 1.35 / 5.50 / 6.00, net of the tax.
    expect([priceOf(stuttgart, "Stuttgart"), priceOf(stuttgart, "Draw"), priceOf(stuttgart, "Borussia M'gladbach")]).toEqual([1.278, 5.209, 5.682]);
    expect(stuttgart.odds.every((o) => o.market === "1X2")).toBe(true);
  });

  it("reads basketball's winner under both its names, and leaves its virtual games out", () => {
    const events = parseBetwayMarkets(BASKETBALL, "basketball", NOW);
    // Five games: the NBA's two ("money-line"), the Euroleague's two
    // ("basketball-match-winner"), not the video game's.
    expect(events.map((e) => e.competition)).toEqual(["NBA", "NBA", "Euroleague", "Euroleague"]);
    expect(events.every((e) => e.odds.every((o) => o.market === "Vainqueur du match"))).toBe(true);
  });

  it("keeps an American match's home team first, though its prices are listed away team first", () => {
    const [pistons] = parseBetwayMarkets(BASKETBALL, "basketball", NOW);
    expect(pistons.participants).toEqual(["Detroit Pistons", "Boston Celtics"]);
    const [rangers] = parseBetwayMarkets(HOCKEY, "ice-hockey", NOW);
    expect(rangers.participants).toEqual(["New York Rangers", "Anaheim Ducks"]);
    expect([priceOf(rangers, "New York Rangers"), priceOf(rangers, "Draw"), priceOf(rangers, "Anaheim Ducks")]).toEqual([1.989, 3.788, 2.604]);
  });

  it("reads a tennis match's winner", () => {
    const events = parseBetwayMarkets(TENNIS, "tennis", NOW);
    expect(events.length).toBeGreaterThan(0);
    for (const e of events) expect(e.odds.map((o) => o.selection)).toEqual(e.participants);
  });

  it("leaves out a match started, live or suspended, and refuses a side that names another team", () => {
    expect(parseBetwayMarkets(SOCCER, "soccer", Date.parse("2026-10-23T19:00:00Z"))).toHaveLength(5);
    const suspended = changed(SOCCER, (copy) => {
      copy.Markets![0].IsSuspended = true;
      copy.Events![1].IsLive = true;
    });
    expect(parseBetwayMarkets(suspended, "soccer", NOW)).toHaveLength(4);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const swapped = changed(SOCCER, (copy) => {
      const groups = copy.Markets![0].OutcomeGroups!;
      [groups.home, groups.away] = [groups.away, groups.home];
    });
    expect(parseBetwayMarkets(swapped, "soccer", NOW).map((e) => e.sourceId)).not.toContain("17260272");
  });
});

describe("fetchBetway", () => {
  // The API as the fixtures answer it: football's competitions and the
  // Bundesliga's matches; nothing in the other sports.
  function fakeApi(calls: string[]): BetwayPost {
    return (async (method: string, body: Record<string, unknown>) => {
      calls.push(`${method} ${body.CategoryCName ?? ""} ${body.GroupCName ?? ""}`.trim());
      const football = body.CategoryCName === "soccer";
      if (method === "GetCategoryDetails") return football ? CATEGORY : { SubCategories: [] };
      if (method === "GetGroup") return body.GroupCName === "bundesliga" ? GROUP : { EventSummaries: [] };
      if (method === "GetUpcoming") return { EventSummaries: [] };
      const [set] = body.EventMarketSets as { EventIds: number[]; MarketCNames: string[] }[];
      expect(set.MarketCNames).toEqual(["win-draw-win"]);
      return { ...SOCCER, Events: SOCCER.Events!.filter((e) => set.EventIds.includes(e.Id!)) };
    }) as BetwayPost;
  }

  it("lists each competition's matches, then reads their main market", async () => {
    const calls: string[] = [];
    const events = await fetchBetway({ post: fakeApi(calls), now: () => NOW, delayMs: 0 });
    expect(events).toHaveLength(6);
    const football = calls.filter((c) => c.includes(" soccer") || c.startsWith("GetEventsWith"));
    expect(football[0]).toBe("GetCategoryDetails soccer");
    // Every listed group with matches, the virtual "esoccer" left out.
    expect(football.filter((c) => c.startsWith("GetGroup")).length).toBe(groupsOf(CATEGORY).length);
    expect(groupsOf(CATEGORY).some((g) => g.sub === "esoccer")).toBe(false);
    expect(calls.filter((c) => c.startsWith("GetEventsWithMultipleMarkets"))).toHaveLength(1);
  });

  it("reads the competitions again only every 30 minutes, the next 24 hours' matches every time", async () => {
    const calls: string[] = [];
    await fetchBetway({ post: fakeApi(calls), now: () => NOW, delayMs: 0 });
    calls.length = 0;
    await fetchBetway({ post: fakeApi(calls), now: () => NOW + 10 * 60 * 1000, delayMs: 0 });
    expect(calls.some((c) => c.startsWith("GetCategoryDetails") || c.startsWith("GetGroup"))).toBe(false);
    expect(calls.filter((c) => c.startsWith("GetUpcoming"))).toHaveLength(Object.keys(BETWAY_SPORTS).length);
    calls.length = 0;
    await fetchBetway({ post: fakeApi(calls), now: () => NOW + 31 * 60 * 1000, delayMs: 0 });
    expect(calls).toContain("GetCategoryDetails soccer");
  });

  it("fails when every sport fails, so that the cycle retries it", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const failing = (async () => {
      throw new Error("refused");
    }) as BetwayPost;
    await expect(fetchBetway({ post: failing, now: () => NOW, delayMs: 0 })).rejects.toThrow("every betway sport failed");
  });
});
