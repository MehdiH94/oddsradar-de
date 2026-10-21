import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { EntainReply, ENTAIN_SPORTS, entainUrl } from "../../src/scraper/entain";
import { ODDSET } from "../../src/scraper/oddset";
import { fetchSportingbet, parseSportingbetFixtures, SPORTINGBET, sportingbetScraper } from "../../src/scraper/sportingbet";

// Real answers of Sportingbet.de's API (www.sportingbet.de/cds-api/bettingoffer/fixtures,
// in English, 21/10/2026): each sport's first 6 matches before kick-off (with
// an NBA's, an NHL's) and a live one, their main market and one other.
const reply = (name: string): EntainReply => JSON.parse(readFileSync(join(__dirname, `fixtures/sportingbet-${name}.json`), "utf8"));
const FOOTBALL = reply("football");
const TENNIS = reply("tennis");
const BASKETBALL = reply("basketball");
const ICE_HOCKEY = reply("ice-hockey");
const AMERICAN_FOOTBALL = reply("american-football");
const HANDBALL = reply("handball");
const VOLLEYBALL = reply("volleyball");

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const priceOf = (event: { odds: { selection: string; price: number }[] }, selection: string) =>
  event.odds.find((o) => o.selection === selection)?.price;

describe("parseSportingbetFixtures", () => {
  it("reads a football match's result in ordinary time, its prices net of the 5% the site takes off a win, and leaves the live match out", () => {
    const events = parseSportingbetFixtures(FOOTBALL, "4");
    expect(events).toHaveLength(6);
    const [first, second] = events;
    expect(first).toMatchObject({
      sport: "football",
      competition: "I Divizion",
      participants: ["Khankendi FK", "Energetik Mingechevir"],
      startTime: "2026-10-21T11:00:00.000Z",
      sourceId: "2:7896599",
    });
    expect(first.odds.every((o) => o.market === "1X2")).toBe(true);
    // The site's 2.45 / 3.10 / 2.55, less 5%.
    expect([priceOf(second, "Shahdagh Samur Gusar"), priceOf(second, "Draw"), priceOf(second, "Sabail FK")]).toEqual([2.328, 2.945, 2.423]);
  });

  it("reads a tennis match's winner, its players without their country", () => {
    const events = parseSportingbetFixtures(TENNIS, "5");
    expect(events).toHaveLength(6);
    const kostyuk = events.find((e) => e.sourceId === "20032957")!;
    expect(kostyuk.participants).toEqual(["Ekaterina Alexandrova", "Marta Kostyuk"]);
    // "E. Alexandrova" 2.25, "Mart. Kostyuk" 1.62, by the participants' ids.
    expect(kostyuk.odds.map((o) => [o.market, o.selection, o.price])).toEqual([
      ["Vainqueur du match", "Ekaterina Alexandrova", 2.137],
      ["Vainqueur du match", "Marta Kostyuk", 1.539],
    ]);
  });

  it("puts the home team first in an American match, its prices by the teams' nicknames", () => {
    const nba = parseSportingbetFixtures(BASKETBALL, "7").find((e) => e.competition === "NBA")!;
    // "Atlanta Hawks at Orlando Magic": "Hawks" 2.18, "Magic" 1.70.
    expect(nba.participants).toEqual(["Orlando Magic", "Atlanta Hawks"]);
    expect([priceOf(nba, "Orlando Magic"), priceOf(nba, "Atlanta Hawks")]).toEqual([1.615, 2.071]);
    const nhl = parseSportingbetFixtures(ICE_HOCKEY, "12").find((e) => e.competition === "NHL")!;
    expect(nhl.participants).toEqual(["Ottawa Senators", "Florida Panthers"]);
    expect(nhl.odds.map((o) => o.selection).sort()).toEqual(["Draw", "Florida Panthers", "Ottawa Senators"]);
    const nfl = parseSportingbetFixtures(AMERICAN_FOOTBALL, "11");
    expect(nfl).toHaveLength(6);
    // "New England Patriots @ Chicago Bears", its teams typed home and away.
    expect(nfl[0]).toMatchObject({ sport: "football américain", participants: ["Chicago Bears", "New England Patriots"] });
  });

  it("reads an ice hockey game's and a handball match's result, a volleyball match's winner", () => {
    for (const [r, sport, outcomes] of [
      [ICE_HOCKEY, "12", 3],
      [HANDBALL, "16", 3],
      [VOLLEYBALL, "18", 2],
    ] as const) {
      const events = parseSportingbetFixtures(r, sport);
      expect(events.length).toBeGreaterThanOrEqual(5);
      expect(events.filter((e) => e.odds.length === outcomes).length).toBeGreaterThanOrEqual(4);
      for (const e of events) expect(e.odds.some((o) => o.selection === "Draw")).toBe(outcomes === 3);
    }
    // "SSC Schwerin (Women)": the women's team marked "(W)".
    expect(parseSportingbetFixtures(VOLLEYBALL, "18")[1].participants).toEqual(["SSC Schwerin (W)", "Schwarz-Weiss Erfurt (W)"]);
  });
});

describe("fetchSportingbet", () => {
  const empty: EntainReply = { fixtures: [], totalCount: 0 };

  it("asks Sportingbet.de's API with its own access id and the site's headers", async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        urls.push(url);
        const headers = init?.headers as Record<string, string>;
        expect(headers["x-bwin-browser-url"]).toBe("https://www.sportingbet.de/de/sports");
        expect(headers.referer).toBe("https://www.sportingbet.de/de/sports");
        return new Response(JSON.stringify(url.includes("sportIds=4&") ? FOOTBALL : empty));
      })
    );

    const events = await fetchSportingbet({ delayMs: 0 });

    expect(events).toHaveLength(6);
    expect(urls).toHaveLength(Object.keys(ENTAIN_SPORTS).length);
    const football = new URL(urls[0]);
    expect(football.origin + football.pathname).toBe("https://www.sportingbet.de/cds-api/bettingoffer/fixtures");
    expect(football.searchParams.get("x-bwin-accessid")).toBe(SPORTINGBET.accessId);
    expect(SPORTINGBET.accessId).not.toBe(ODDSET.accessId);
    expect(football.searchParams.get("country")).toBe("DE");
    expect(new URL(entainUrl(SPORTINGBET, "16", 0)).searchParams.get("offerMapping")).toBe("Filtered");
    expect(sportingbetScraper.id).toBe("sportingbet");
  });

  it("fails when every sport fails, so that the cycle retries it", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>", { status: 403 })));
    await expect(fetchSportingbet({ delayMs: 0 })).rejects.toThrow("every sportingbet sport failed");
  });
});
