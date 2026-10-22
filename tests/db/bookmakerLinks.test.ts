import { describe, it, expect, beforeEach } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { openDb } from "../../src/db/client";
import { getValueBets, upsertCanonicalEvents } from "../../src/db/repository";
import { bookmakerEventUrl, loadBookmakerLinks } from "../../src/db/bookmakerLinks";
import { getSurebets } from "../../src/db/surebets";
import { getEventDetail } from "../../src/db/eventDetail";
import { saveReferenceOdds } from "../../src/db/reference";
import { MARKET_MATCH_WINNER } from "../../src/scraper/canonical";
import { CanonicalEvent } from "../../src/types";

// Real ids, each opened on the bookmaker's site and seen to show its match
// (21/10/2026).
describe("bookmakerEventUrl", () => {
  it("opens a LeoVegas.de event by its Kambi id", () => {
    expect(bookmakerEventUrl("leovegas", { sourceId: "1028036087", participants: ["FC Tokyo", "Kashiwa Reysol"] })).toBe(
      "https://www.leovegas.de/de-de/sportwetten#event/1028036087"
    );
  });

  it("opens a Merkur Bets game on its sportsbook's host by the odds service's id", () => {
    expect(bookmakerEventUrl("merkurbets", { sourceId: "3197841592", participants: ["Lion City Sailors FC", "Tampines Rovers."] })).toBe(
      "https://v3-msw-mb-de.cashpoint.solutions/de/sports/game-details/3197841592"
    );
  });

  it("opens a bet-at-home.de match by its id, whatever words come before it", () => {
    expect(bookmakerEventUrl("betathome", { sourceId: "317130545365590016", participants: ["Bayern München", "Arsenal"] })).toBe(
      "https://www.bet-at-home.de/de/sports/i/event/0/x/x/x/x/317130545365590016"
    );
  });

  it("opens an ODDSET match by a slug of its teams and its id, prefixed or not", () => {
    expect(bookmakerEventUrl("oddset", { sourceId: "2:7867098", participants: ["FC Bayern München", "Arsenal"] })).toBe(
      "https://www.oddset.de/de/sports/events/fc-bayern-munchen-arsenal-2:7867098"
    );
    expect(bookmakerEventUrl("oddset", { sourceId: "20014863", participants: ["Hapoel Tel-Aviv (ISR)", "Virtus Bologna (ITA)"] })).toBe(
      "https://www.oddset.de/de/sports/events/hapoel-tel-aviv-isr-virtus-bologna-ita-20014863"
    );
    expect(bookmakerEventUrl("oddset", { sourceId: "20014863", participants: ["—"] })).toBe(
      "https://www.oddset.de/de/sports/events/event-20014863"
    );
  });

  it("opens a Betway.de event by its API's id", () => {
    expect(bookmakerEventUrl("betway", { sourceId: "17260272", participants: ["Stuttgart", "Borussia M'gladbach"] })).toBe(
      "https://betway.de/de/de/sports/event/17260272"
    );
  });

  it("builds nothing for the bookmakers whose address could not be checked or built", () => {
    for (const [bookmaker, sourceId] of [
      ["twentybet", "11336345"],
      ["admiralbet", "asw:event:16886659"],
      ["tipico", "c3e8b1a2f4d5e6a7b8c9d0e1f2a3b4c5"],
      ["winamaxde", "c3e8b1a2f4d5e6a7b8c9d0e1f2a3b4c5"],
      ["exchange", "1"],
    ]) {
      expect(bookmakerEventUrl(bookmaker, { sourceId, participants: ["A", "B"] })).toBeUndefined();
    }
  });

  it("builds nothing from an id not of the bookmaker's form", () => {
    expect(bookmakerEventUrl("leovegas", { sourceId: "1028036087/../x", participants: [] })).toBeUndefined();
    expect(bookmakerEventUrl("merkurbets", { sourceId: "", participants: [] })).toBeUndefined();
    expect(bookmakerEventUrl("betathome", { sourceId: "abc", participants: [] })).toBeUndefined();
    expect(bookmakerEventUrl("oddset", { sourceId: "2:7867098?x=1", participants: ["A"] })).toBeUndefined();
    expect(bookmakerEventUrl("betway", { sourceId: "17260272#x", participants: [] })).toBeUndefined();
  });
});

const hoursFromNow = (h: number) => new Date(Date.now() + h * 3600e3).toISOString();
const winner = (one: number, two: number) => [
  { market: MARKET_MATCH_WINNER, selection: "1", price: one },
  { market: MARKET_MATCH_WINNER, selection: "2", price: two },
];

// A match whose winner pays 105% between LeoVegas.de and 20bet, and that
// Betway.de lists too.
const match = (): CanonicalEvent => ({
  id: "lal-bos",
  sport: "basketball",
  competition: "NBA",
  startTime: hoursFromNow(5),
  participants: ["Lakers", "Celtics"],
  byBookmaker: { leovegas: winner(2.2, 1.6), twentybet: winner(1.7, 2.1), betway: winner(1.8, 1.9) },
  sources: {
    leovegas: { sourceId: "1028036087", participants: ["Los Angeles Lakers", "Boston Celtics"] },
    twentybet: { sourceId: "11336345", participants: ["Lakers", "Celtics"] },
    betway: { sourceId: "17260272", participants: ["Lakers", "Celtics"] },
  },
});

describe("the bookmakers' links of the stored matches", () => {
  let db: DatabaseSync;
  beforeEach(() => {
    db = openDb(":memory:");
    upsertCanonicalEvents(db, [match()]);
  });

  it("loads, by match and bookmaker, those that can be built", () => {
    expect(loadBookmakerLinks(db, ["lal-bos", "none"])).toEqual(
      new Map([
        [
          "lal-bos",
          {
            leovegas: "https://www.leovegas.de/de-de/sportwetten#event/1028036087",
            betway: "https://betway.de/de/de/sports/event/17260272",
          },
        ],
      ])
    );
    expect(loadBookmakerLinks(db, [])).toEqual(new Map());
  });

  it("gives a surebet's bookmaker leg its link, and none to a leg without one", () => {
    const [surebet] = getSurebets(db);
    expect(surebet.legs.map((l) => [l.source, l.url])).toEqual([
      ["leovegas", "https://www.leovegas.de/de-de/sportwetten#event/1028036087"],
      ["twentybet", undefined],
    ]);
    expect(surebet.legs[1]).not.toHaveProperty("url");
  });

  it("gives a value bet its bookmaker's link, and none to a bookmaker without one", () => {
    const oneXTwo = (one: number) => [
      { market: "1X2", selection: "1", price: one },
      { market: "1X2", selection: "X", price: 3 },
      { market: "1X2", selection: "2", price: 4 },
    ];
    upsertCanonicalEvents(db, [
      {
        id: "fcb-ars",
        sport: "football",
        competition: "Champions League",
        startTime: hoursFromNow(5),
        participants: ["Bayern München", "Arsenal"],
        byBookmaker: { leovegas: oneXTwo(2.2), twentybet: oneXTwo(2.1) },
        sources: {
          leovegas: { sourceId: "1028036087", participants: ["Bayern München", "Arsenal"] },
          twentybet: { sourceId: "11336345", participants: ["Bayern München", "Arsenal"] },
        },
      },
    ]);
    const fair = { "1": 2, X: 3.4, "2": 4.2 };
    saveReferenceOdds(db, "fcb-ars", { fair, back: fair, lay: fair, matched: 1500 }, new Date().toISOString());
    const bets = getValueBets(db).bets;
    expect(bets.map((b) => [b.bookmaker, b.url])).toEqual([
      ["leovegas", "https://www.leovegas.de/de-de/sportwetten#event/1028036087"],
      ["twentybet", undefined],
    ]);
    expect(bets[1]).not.toHaveProperty("url");
  });

  it("gives a match's page the links of the requested bookmakers that price it", () => {
    expect(getEventDetail(db, "lal-bos")?.links).toEqual({
      leovegas: "https://www.leovegas.de/de-de/sportwetten#event/1028036087",
      betway: "https://betway.de/de/de/sports/event/17260272",
    });
    expect(getEventDetail(db, "lal-bos", { bookmakers: ["leovegas", "twentybet"] })?.links).toEqual({
      leovegas: "https://www.leovegas.de/de-de/sportwetten#event/1028036087",
    });
  });
});
