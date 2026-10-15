import { describe, it, expect } from "vitest";
import { gunzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parsePriceFrames } from "../../src/reference/exchange";
import { EXCHANGE_SPORTS, parseSportSearch, placeSportEvent, sportPrices } from "../../src/reference/sports";

// The exchange's searches and prices of every head-to-head sport (4/10/2026):
// [{ sport, ours: our match, term, body: the search's answer }].
const FIXTURES = join(__dirname, "fixtures");
const read = (name: string) => JSON.parse(gunzipSync(readFileSync(join(FIXTURES, name))).toString());
const SEARCHES: { sport: string; term: string; body: unknown }[] = read("exchange-sports-search.json.gz");
const FRAMES = read("exchange-sports-frames.json.gz");
const answer = (term: string) => SEARCHES.find((s) => s.term === term)!.body;
const parse = (sport: string, term: string) => parseSportSearch(answer(term), EXCHANGE_SPORTS[sport]);

describe("parseSportSearch", () => {
  it("reads a sport's matches, the US 'away @ home' turned round, and its main market's runners", () => {
    expect(parse("football américain", "minnesota")).toEqual([
      {
        eventId: "36104925",
        participants: ["Minnesota Vikings", "Miami Dolphins"],
        startTime: "2026-10-04T20:06:00.000Z",
        marketId: "1.263067516",
        runners: { home: 50191, away: 50201 },
      },
    ]);
    // The basketball of a search that also finds NFL and baseball matches.
    expect(parse("basketball", "angeles").map((e) => e.participants)).toEqual([
      ["Los Angeles Clippers", "Golden State Warriors"],
      ["Sacramento Kings", "Los Angeles Lakers"],
    ]);
  });

  it("finds a runner by its name whatever the case: the exchange writes a team 'BC' in its event and 'Bc' in its market", () => {
    // FC Barcelona v BC Zalgiris Kaunas (9/10/2026): the Moneyline's runners are "FC Barcelona" and "Bc Zalgiris Kaunas".
    const search = read("exchange-basketball-search.json.gz");
    const [barca] = parseSportSearch(search, EXCHANGE_SPORTS.basketball).filter((e) => e.eventId === "36134736");
    expect(barca).toMatchObject({
      participants: ["FC Barcelona", "BC Zalgiris Kaunas"],
      marketId: "1.263161443",
      runners: { home: 278533, away: 11387338 },
    });
  });

  it("takes an ice hockey match's 60-minute 1X2, its tie as the draw", () => {
    expect(parse("hockey sur glace", "budejovice")).toEqual([
      expect.objectContaining({
        participants: ["Ceske Budejovice", "HC Kometa Brno"],
        marketId: "1.263238684",
        runners: { home: 616939, away: 3292293, draw: 60104 },
      }),
      expect.objectContaining({
        participants: ["HC Plzen", "Ceske Budejovice"],
        runners: { home: 536204, away: 616939, draw: 60104 },
      }),
    ]);
    expect(parse("rugby à xv", "francais")[0].runners).toEqual({
      home: 233949,
      away: 632441,
      draw: 246289,
    });
  });

  it("leaves out the matches in play, the other sports and the markets without every runner", () => {
    // The search's only NFL matches had started.
    expect(parse("football américain", "daniel")).toEqual([]);
    expect(parse("baseball", "volkanovski")).toEqual([]);
    // A rugby 1X2 without its draw.
    const body = structuredClone(answer("perpignan")) as {
      content: { topMarkets: { runners: unknown[] }[] }[];
    };
    body.content[0].topMarkets[0].runners.pop();
    expect(parseSportSearch(body, EXCHANGE_SPORTS["rugby à xv"])).toEqual([]);
    // A 3-way market for a winner: a fight's with its draw.
    expect(parseSportSearch(answer("iglesias"), { ...EXCHANGE_SPORTS.mma, eventTypeId: "6" })).toEqual([]);
    expect(parseSportSearch(answer("iglesias"), { ...EXCHANGE_SPORTS["rugby à xv"], eventTypeId: "6" })).toHaveLength(1);
  });
});

describe("placeSportEvent", () => {
  const lightning = parse("hockey sur glace", "lightning");
  const kickOff = "2026-10-05T23:00:00.000Z";

  it("finds our match by its teams, whichever side the exchange lists them on", () => {
    const target = {
      eventId: "e",
      participants: ["Tampa Bay Lightning", "Philadelphia Flyers"],
      startTime: kickOff,
    };
    expect(placeSportEvent("hockey sur glace", target, lightning)).toEqual({
      event: lightning[0],
      selections: { "1": 25609, "2": 25589, X: 60104 },
    });
    const reversed = {
      ...target,
      participants: ["Philadelphia Flyers", "Tampa Bay Lightning"],
    };
    expect(placeSportEvent("hockey sur glace", reversed, lightning)?.selections).toEqual({
      "1": 25589,
      "2": 25609,
      X: 60104,
    });
  });

  it("refuses a match starting at another time, or another sport's", () => {
    const later = {
      eventId: "e",
      participants: ["Tampa Bay Lightning", "Philadelphia Flyers"],
      startTime: "2026-10-06T01:00:00.000Z",
    };
    expect(placeSportEvent("hockey sur glace", later, lightning)).toBeNull();
    expect(placeSportEvent("boxe", { ...later, startTime: kickOff }, lightning)).toBeNull();
  });

  it("finds a fight by its fighters' names, abbreviated and an hour apart", () => {
    const fights = parse("mma", "volkanovski");
    const target = {
      eventId: "f",
      participants: ["A. Volkanovski", "M. Evloev"],
      startTime: "2026-10-24T19:30:00.000Z",
    };
    expect(placeSportEvent("mma", target, fights)?.selections).toEqual({
      "1": 13218881,
      "2": 23782153,
    });
    expect(
      placeSportEvent("mma", { ...target, participants: ["M. Evloev", "A. Volkanovski"] }, fights)?.selections
    ).toEqual({
      "1": 23782153,
      "2": 13218881,
    });
    expect(placeSportEvent("mma", { ...target, participants: ["A. Volkanovski", "Petr Yan"] }, fights)).toBeNull();
  });
});

describe("sportPrices", () => {
  const prices = parsePriceFrames(FRAMES);
  const basketball = EXCHANGE_SPORTS.basketball;

  it("gives a winner's fair odds, its two outcomes' mid prices without the margin", () => {
    const rows = sportPrices(basketball, { "1": 75136141, "2": 18147292 }, prices.get("1.263275130"));
    expect(rows.map((r) => [r.market, r.selection, r.back, r.lay])).toEqual([
      ["Vainqueur du match", "1", 1.96, 1.99],
      ["Vainqueur du match", "2", 2.02, 2.04],
    ]);
    const total = 1 / 1.975 + 1 / 2.03;
    expect(rows[0].fair).toBeCloseTo(1.975 * total, 9);
    expect(rows[1].fair).toBeCloseTo(2.03 * total, 9);
    expect(rows[0].matched).toBeCloseTo(5064.79, 2);
  });

  it("keeps the prices without fair odds when a side's spread is over 10%", () => {
    // Trabzonspor 3.05 / 3.45.
    const rows = sportPrices(basketball, { "1": 1312085, "2": 88422646 }, prices.get("1.263265078"));
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.fair === undefined)).toBe(true);
    // The rugby draw without a lay.
    expect(
      sportPrices(
        EXCHANGE_SPORTS["rugby à xv"],
        { "1": 233949, X: 246289, "2": 632441 },
        prices.get("1.263346305")
      ).every((r) => r.fair === undefined)
    ).toBe(true);
    expect(sportPrices(basketball, { "1": 1, "2": 2 }, undefined)).toEqual([]);
  });
});
