import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { join } from "node:path";
import { alignCompetitors, eventSimilarity, matchEvents, NAME_SIMILARITY_THRESHOLD } from "../../src/matcher/match";
import { RawEvent } from "../../src/types";

// The golf tournaments' winners of the five bookmakers, read by their own
// scrapers from real captures of 6/10/2026 (Winamax and Betclic live, Vbet,
// NetBet and Unibet from tests/scraper/fixtures). The bookmakers date and
// title a tournament their own way: the Masters is the 8th of April at Vbet
// and NetBet, the 14th at Unibet and the 15th at Betclic and Winamax, "Master
// d'Augusta", "US Masters" or "The Masters"; the Open d'Espagne is "Open de
// Espana" at Winamax, 5 days after Vbet's date.
const SET: Record<string, RawEvent[]> = JSON.parse(
  gunzipSync(readFileSync(join(__dirname, "fixtures/golf-winners-2026-10-06.json.gz"))).toString()
);

describe("matchEvents over the five bookmakers' real golf tournaments", () => {
  const events = matchEvents(SET);
  const books = (title: RegExp) =>
    events
      .filter((e) => title.test(e.participants[0]))
      .map((e) => Object.keys(e.byBookmaker).sort().join(","));

  it("lists each tournament once, with every bookmaker that offers it", () => {
    expect(events).toHaveLength(8);
    expect(books(/Baycurrent/)).toEqual(["betclic,netbet,unibet,winamax"]);
    expect(books(/Espagne/)).toEqual(["betclic,netbet,unibet,vbet,winamax"]);
    expect(books(/Masters|Augusta/)).toEqual(["betclic,netbet,unibet,vbet,winamax"]);
    expect(books(/PGA/)).toEqual(["betclic,netbet,unibet,vbet,winamax"]);
    expect(books(/US Open/)).toEqual(["betclic,unibet,vbet,winamax"]);
    expect(books(/Open Championship/)).toEqual(["betclic,unibet,vbet,winamax"]);
    expect(books(/Ryder/)).toEqual(["betclic,netbet,unibet,vbet,winamax"]);
    expect(books(/Solheim/)).toEqual(["unibet,winamax"]);
  });

  it("keeps the ids and titles Betclic and Winamax gave the tournaments already listed", () => {
    // Betclic, then Winamax, seed an event: the other bookmakers join it.
    expect(events.map((e) => e.participants[0]).sort()).toEqual([
      "Baycurrent Classic 2026",
      "Master d'Augusta 2027",
      "Open Championship 2027",
      "Open d'Espagne 2026",
      "Ryder Cup 2027",
      "Solheim Cup 2028",
      "US Open 2027",
      "USPGA Championship 2027",
    ]);
  });
});

// The same field of players, so that only the title and the date tell two tournaments apart.
const PLAYERS = Array.from({ length: 60 }, (_, i) => `Golfer ${String.fromCharCode(65 + (i % 26))}${i}`);
const tournament = (title: string, startTime: string): RawEvent => ({
  sport: "golf",
  competition: "",
  startTime,
  participants: [title],
  odds: PLAYERS.map((selection, i) => ({ market: "Vainqueur", selection, price: 10 + i })),
});
const pairs = (a: RawEvent, b: RawEvent) => eventSimilarity(a, b) >= NAME_SIMILARITY_THRESHOLD;

describe("a golf tournament's dates and titles", () => {
  it("pairs a tournament a bookmaker dates a week apart, under any of its titles", () => {
    const augusta = tournament("Master d'Augusta 2027", "2027-04-15T10:00:00.000Z");
    expect(pairs(augusta, tournament("US Masters 2027", "2027-04-08T11:00:00.000Z"))).toBe(true);
    expect(pairs(augusta, tournament("The Masters 2027", "2027-04-14T00:00:00.000Z"))).toBe(true);
    const pga = tournament("USPGA Championship 2027", "2027-05-24T01:00:00.000Z");
    expect(pairs(pga, tournament("PGA Championship - 2027", "2027-05-20T11:00:00.000Z"))).toBe(true);
    const open = tournament("Open Championship 2027", "2027-07-18T15:00:00.000Z");
    expect(pairs(open, tournament("The Open 2027", "2027-07-19T00:00:00.000Z"))).toBe(true);
    expect(pairs(open, tournament("The Open Championship 2027", "2027-07-15T06:00:00.000Z"))).toBe(true);
    const spain = tournament("Open d'Espagne 2026", "2026-10-11T23:00:00.000Z");
    expect(pairs(spain, tournament("DP World Tour 2026 - Open de Espana", "2026-10-13T00:00:00.000Z"))).toBe(true);
  });

  it("keeps two tournaments of the same field apart, whatever their dates", () => {
    const masters = tournament("US Masters 2027", "2027-04-15T10:00:00.000Z");
    expect(pairs(masters, tournament("PGA Championship 2027", "2027-04-17T10:00:00.000Z"))).toBe(false);
    expect(pairs(tournament("US Open 2027", "2027-06-20T20:00:00.000Z"), tournament("The Open 2027", "2027-06-22T00:00:00.000Z"))).toBe(false);
    // The women's tournament of the same name is another one.
    expect(
      pairs(tournament("PGA Championship 2027", "2027-05-24T01:00:00.000Z"), tournament("Women's PGA Championship 2027", "2027-05-20T11:00:00.000Z"))
    ).toBe(false);
  });

  it("does not pair a tournament with the next year's, nor one more than 14 days away", () => {
    const masters = tournament("US Masters 2027", "2027-04-15T10:00:00.000Z");
    expect(pairs(masters, tournament("US Masters 2028", "2028-04-13T10:00:00.000Z"))).toBe(false);
    expect(pairs(masters, tournament("US Masters 2027", "2027-04-02T10:00:00.000Z"))).toBe(true); // 13 days
    expect(pairs(masters, tournament("US Masters 2027", "2027-03-30T10:00:00.000Z"))).toBe(false); // 16 days
  });
});

describe("aligning a golf tournament's competitors across bookmakers", () => {
  it("puts every bookmaker's draw on one row", () => {
    const seed = ["Europe", "USA", "Match Nul"];
    for (const draw of ["Égalité", "Egalité", "N", "Match nul"]) {
      expect(alignCompetitors(["Europe", "États-Unis", draw], seed).get(draw)).toBe("Match Nul");
    }
    // A player is no draw.
    expect(alignCompetitors(["Nick Taylor"], seed).size).toBe(0);
  });

  it("reads one spelling of a surname, whichever way the bookmaker writes its umlaut or double a", () => {
    expect(alignCompetitors(["Aaberg, Ludvig"], ["Ludvig Aberg"]).get("Aaberg, Ludvig")).toBe("Ludvig Aberg");
    expect(alignCompetitors(["Jäger, Stephan"], ["Stephan Jaeger"]).get("Jäger, Stephan")).toBe("Stephan Jaeger");
    expect(alignCompetitors(["Moeller, Niklas"], ["Niklas Møller"]).get("Moeller, Niklas")).toBe("Niklas Møller");
    // Two players of one surname stay two.
    expect(alignCompetitors(["Aaberg, Ludvig"], ["Nicolai Aberg"]).size).toBe(0);
  });
});
