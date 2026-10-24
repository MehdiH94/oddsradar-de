import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  fetchNeobet,
  NEOBET_PAGE_SIZE,
  NEOBET_REGIONS,
  NEOBET_SPORTS,
  NeobetMatch,
  NeobetRegionCache,
  parseNeobetMatches,
  readNeobetRegions,
  sportToSurvey,
} from "../../src/scraper/neobet";

// Real answers of neobet's program (neobet.de/.sportsbet/program/matches,
// language=en, 24/10/2026): a region's first matches of a sport, live ones
// included, without the teams' jersey images.
const matches = (name: string): NeobetMatch[] => JSON.parse(readFileSync(join(__dirname, `fixtures/neobet-${name}.json`), "utf8"));
const FOOTBALL = matches("football-es");
const TENNIS = matches("tennis");
const ICE_HOCKEY = matches("icehockey-us");
const BASKETBALL = matches("basketball-us");

describe("parseNeobetMatches", () => {
  it("reads a football match's result in regular time, labelled with the teams, net of the 5% tax", () => {
    const events = parseNeobetMatches(FOOTBALL, "Football");
    const clasico = events.find((e) => e.sourceId === "NEO|FB-4091933")!;
    expect(clasico).toMatchObject({
      sport: "football",
      competition: "La Liga",
      startTime: "2026-10-25T20:00:00.000Z",
      participants: ["FC Barcelona", "Real Madrid"],
    });
    // 1.6, 5.4 and 4.2 on the site.
    expect(clasico.odds).toEqual([
      { market: "1X2", selection: "FC Barcelona", price: 1.52 },
      { market: "1X2", selection: "Draw", price: 5.13 },
      { market: "1X2", selection: "Real Madrid", price: 3.99 },
    ]);
  });

  it("leaves the live matches out", () => {
    const ids = parseNeobetMatches(FOOTBALL, "Football").map((e) => e.sourceId);
    expect(ids).toEqual(["NEO|FB-4091933", "NEO|FB-4091925"]);
  });

  it("takes the match's result, not a handicap of the same form", () => {
    const [match] = FOOTBALL;
    const handicapFirst: NeobetMatch = { ...match, contestStatus: { name: "Pregame" }, betmarkets: [...match.betmarkets!].reverse() };
    expect(parseNeobetMatches([handicapFirst], "Football")[0].odds.map((o) => o.price)).toEqual([1.52, 5.13, 3.99]);
    const noResult: NeobetMatch = { ...handicapFirst, betmarkets: match.betmarkets!.filter((m) => m.bettingType !== "MatchWin") };
    expect(parseNeobetMatches([noResult], "Football")).toEqual([]);
  });

  it("reads the winner of a tennis match, ice hockey's and basketball's, overtime included", () => {
    expect(parseNeobetMatches(TENNIS, "Tennis").find((e) => e.sourceId === "NEO|TN-610459")).toMatchObject({
      sport: "tennis",
      competition: "Vienna",
      participants: ["Khachanov, Karen", "Alcaraz, Carlos"],
      odds: [
        { market: "Vainqueur du match", selection: "Khachanov, Karen", price: 4.845 },
        { market: "Vainqueur du match", selection: "Alcaraz, Carlos", price: 1.092 },
      ],
    });
    const nhl = parseNeobetMatches(ICE_HOCKEY, "Icehockey");
    expect(nhl).toHaveLength(4);
    expect(nhl[0]).toMatchObject({ sport: "hockey sur glace", participants: ["Edmonton Oilers", "Toronto Maple Leafs"] });
    expect(nhl[0].odds.map((o) => o.price)).toEqual([1.444, 2.233]);
    expect(parseNeobetMatches(BASKETBALL, "Basketball")[0]).toMatchObject({ sport: "basketball", competition: "NBA" });
  });

  it("keeps only the matches of the sport asked, as an answer fills up with others", () => {
    expect(parseNeobetMatches([...FOOTBALL, ...ICE_HOCKEY], "Icehockey")).toHaveLength(4);
  });

  it("leaves a match out whose outcomes are not its sport's, and goes on", () => {
    const [match] = ICE_HOCKEY;
    const threeWay: NeobetMatch = {
      ...match,
      betmarkets: [{ bettingType: "MatchWin", odds: [{ key: "1", odds: 2 }, { key: "X", odds: 4 }, { key: "2", odds: 3 }] }],
    };
    expect(parseNeobetMatches([threeWay, ICE_HOCKEY[1]], "Icehockey").map((e) => e.sourceId)).toEqual([ICE_HOCKEY[1].id]);
  });
});

// A program answering by region and league from the given matches, as the API
// does: at most 50, those of the region (or of its league) first, then others.
function fakeProgram(all: NeobetMatch[]) {
  const asked: Record<string, string>[] = [];
  const get = async (params: Record<string, string>) => {
    asked.push(params);
    const own = all.filter((m) => m.sport === params.sport && m.region === params.region && (!params.league || m.league === params.league));
    const others = all.filter((m) => !own.includes(m));
    return [...own, ...others].slice(0, NEOBET_PAGE_SIZE);
  };
  return { get, asked };
}

const footballMatch = (i: number, region: string, league: string): NeobetMatch => ({
  ...FOOTBALL[0],
  id: `NEO|FB-${region}-${i}`,
  region,
  league,
  contestStatus: { name: "Pregame" },
});

describe("readNeobetRegions", () => {
  it("reads each region, and a full region league by league", async () => {
    const spain = [
      ...Array.from({ length: 40 }, (_, i) => footballMatch(i, "ES", "La Liga")),
      ...Array.from({ length: 30 }, (_, i) => footballMatch(100 + i, "ES", "La Liga 2")),
    ];
    const germany = Array.from({ length: 5 }, (_, i) => footballMatch(i, "DE", "Bundesliga"));
    const { get, asked } = fakeProgram([...spain, ...germany]);
    const read = await readNeobetRegions("Football", ["ES", "DE", "IT"], { get, delayMs: 0, concurrency: 1 });
    expect(read.matches.size).toBe(75);
    expect(read.regions).toEqual(["ES", "DE"]);
    expect(asked).toEqual([
      { sport: "Football", region: "ES" },
      { sport: "Football", region: "ES", league: "La Liga" },
      { sport: "Football", region: "ES", league: "La Liga 2" },
      { sport: "Football", region: "DE" },
      { sport: "Football", region: "IT" },
    ]);
  });
});

describe("fetchNeobet", () => {
  it("looks for one sport's regions a cycle, then asks only the regions with matches", async () => {
    const { get, asked } = fakeProgram([...FOOTBALL, ...ICE_HOCKEY]);
    const cache: NeobetRegionCache = { bySport: new Map() };
    let now = 0;
    const first = await fetchNeobet({ get, delayMs: 0, cache, now: () => now });
    expect(asked).toHaveLength(NEOBET_REGIONS.length);
    expect(first.map((e) => e.sport)).toEqual(["football", "football"]);
    expect(cache.bySport.get("Football")?.regions).toEqual(["ES"]);

    asked.length = 0;
    now = 5 * 60 * 1000;
    const second = await fetchNeobet({ get, delayMs: 0, cache, now: () => now });
    // Football's one region, and every region for tennis, the next sport.
    expect(asked.filter((p) => p.sport === "Football")).toEqual([{ sport: "Football", region: "ES" }]);
    expect(asked.filter((p) => p.sport === "Tennis")).toHaveLength(NEOBET_REGIONS.length);
    expect(second).toHaveLength(2);
  });

  it("fails when every sport does", async () => {
    const get = async () => {
      throw new Error("HTTP 503");
    };
    await expect(fetchNeobet({ get, delayMs: 0, cache: { bySport: new Map() }, now: () => 0 })).rejects.toThrow("every neobet sport failed");
  });
});

describe("sportToSurvey", () => {
  it("takes a sport never looked for, then the one looked for longest ago once its hour is over", () => {
    const sports = Object.keys(NEOBET_SPORTS);
    const hour = 60 * 60 * 1000;
    const cache: NeobetRegionCache = { bySport: new Map(sports.map((s, i) => [s, { regions: [], at: i * 1000 }])) };
    expect(sportToSurvey(cache, hour - 1)).toBeUndefined();
    expect(sportToSurvey(cache, hour + 5000)).toBe(sports[0]);
    cache.bySport.delete(sports[3]);
    expect(sportToSurvey(cache, 0)).toBe(sports[3]);
  });
});
