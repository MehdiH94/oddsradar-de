import { describe, it, expect, beforeEach } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { openDb } from "../../src/db/client";
import { getLatestEvents, getValueBets, saveMarketOdds, upsertCanonicalEvents } from "../../src/db/repository";
import { getEventDetail } from "../../src/db/eventDetail";
import { ReferenceOdds, saveReferenceOdds } from "../../src/db/reference";
import { savePlayerOdds } from "../../src/db/playerReference";
import { bestValue, valueBetsOf, valueEdges, VALUE_MIN_EDGE } from "../../src/db/value";
import { CanonicalEvent, RawOdds } from "../../src/types";

const hoursFromNow = (h: number) => new Date(Date.now() + h * 60 * 60 * 1000).toISOString();
const minutesAgo = (m: number) => new Date(Date.now() - m * 60 * 1000).toISOString();
const oneXTwo = ([one, draw, two]: number[]): RawOdds[] => [
  { market: "1X2", selection: "1", price: one },
  { market: "1X2", selection: "X", price: draw },
  { market: "1X2", selection: "2", price: two },
];
const FAIR = { "1": 2, X: 3.4, "2": 4 } as const;
const MAIN = { market: "1X2", fair: FAIR };
const reference = (fair: Record<"1" | "X" | "2", number> = FAIR): ReferenceOdds => ({
  fair,
  back: fair,
  lay: fair,
  matched: 1500,
});

describe("value", () => {
  const event = {
    id: "e",
    sport: "football",
    competition: "",
    startTime: hoursFromNow(2),
    participants: ["A", "B"],
    byBookmaker: {
      winamax: { scrapedAt: "", odds: oneXTwo([2.2, 3.3, 3.8]) },
      betclic: { scrapedAt: "", odds: [...oneXTwo([2, 3.5, 3.9]), { market: "Vainqueur", selection: "1", price: 9 }] },
    },
  };

  it("is a match's best price against the fair odds of its 1X2, among the given bookmakers", () => {
    expect(bestValue(event, MAIN)).toEqual({ edge: expect.closeTo(0.1, 10), selection: "1", bookmaker: "winamax" });
    expect(bestValue(event, MAIN, ["betclic"])).toEqual({
      edge: expect.closeTo(3.5 / 3.4 - 1, 10),
      selection: "X",
      bookmaker: "betclic",
    });
    expect(bestValue(event, MAIN, [])).toBeNull();
  });

  it("lists a match's value bets on its 1X2, biggest edge first, among the given bookmakers", () => {
    expect(valueBetsOf(event, MAIN)).toEqual([
      { edge: expect.closeTo(0.1, 10), selection: "1", bookmaker: "winamax", price: 2.2 },
      { edge: expect.closeTo(3.5 / 3.4 - 1, 10), selection: "X", bookmaker: "betclic", price: 3.5 },
    ]);
    expect(valueBetsOf(event, MAIN, ["betclic"]).map((b) => b.bookmaker)).toEqual(["betclic"]);
    expect(valueBetsOf(event, MAIN, [])).toEqual([]);
  });

  it("makes a value bet from 1% above the fair odds", () => {
    expect(VALUE_MIN_EDGE).toBe(0.01);
    const priced = (price: number) => ({ ...event, byBookmaker: { winamax: { scrapedAt: "", odds: oneXTwo([price, 1, 1]) } } });
    expect(valueBetsOf(priced(2.02), MAIN)).toHaveLength(1);
    expect(valueBetsOf(priced(2.0199), MAIN)).toEqual([]);
  });

  it("weighs only the prices of the market the reference prices", () => {
    // A winner's prices, overtime included, against a 1X2's fair odds on
    // regular time (or a handicap read as a winner): never compared.
    const winner = (one: number, two: number): RawOdds[] => [
      { market: "Vainqueur du match", selection: "1", price: one },
      { market: "Vainqueur du match", selection: "2", price: two },
    ];
    const mixed = { ...event, byBookmaker: { winamax: { scrapedAt: "", odds: winner(2.5, 5) } } };
    expect(bestValue(mixed, MAIN)).toBeNull();
    expect(valueBetsOf(mixed, MAIN)).toEqual([]);
    // And a 1X2's prices against a winner's fair odds.
    const basket = { market: "Vainqueur du match", fair: { "1": 1.4, "2": 3.5 } };
    expect(valueBetsOf(event, basket)).toEqual([]);
    expect(valueBetsOf(mixed, basket).map((b) => [b.selection, b.price])).toEqual([
      ["1", 2.5],
      ["2", 5],
    ]);
  });

  it("lists an outcome's value bets by bookmaker", () => {
    expect(valueEdges({ winamax: 2.2, betclic: 2.01 }, 2)).toEqual({ winamax: expect.closeTo(0.1, 10) });
  });
});

describe("the listing and the reference", () => {
  let db: DatabaseSync;
  const match = (id: string, hours: number, winamax: number[], betclic: number[]): CanonicalEvent => ({
    id,
    sport: "football",
    competition: "Ligue 1",
    startTime: hoursFromNow(hours),
    participants: [id, "Rival"],
    byBookmaker: { winamax: oneXTwo(winamax), betclic: oneXTwo(betclic) },
  });
  const ids = (page: { events: { id: string }[] }) => page.events.map((e) => e.id);

  beforeEach(() => {
    db = openDb(":memory:");
    upsertCanonicalEvents(db, [
      // Winamax's 2.2 on "1" is 10% above the fair 2.
      match("value", 1, [2.2, 3.2, 3.6], [2, 3.3, 3.7]),
      // Only 0.5% above.
      match("small", 2, [2.01, 3.2, 3.6], [1.95, 3.3, 3.7]),
      // Betclic's 2.1 is 5% above; Winamax's prices aren't.
      match("betclic", 3, [1.9, 3.2, 3.6], [2.1, 3.3, 3.7]),
      // Without a reference: "stale" kicks off first, "nofair" has the better TRJ.
      match("stale", 3.5, [1.5, 3, 5], [1.5, 3, 5]),
      match("nofair", 4, [2.1, 3.5, 4], [2, 3.4, 3.9]),
    ]);
    const now = new Date().toISOString();
    for (const id of ["value", "small", "betclic"]) saveReferenceOdds(db, id, reference(), now);
    saveReferenceOdds(db, "stale", reference(), minutesAgo(60));
  });

  it("gives each match its current reference and its best edge", () => {
    const events = Object.fromEntries(getLatestEvents(db, { sort: "start" }).events.map((e) => [e.id, e]));
    expect(events.value.reference).toEqual({ market: "1X2", fair: FAIR, matched: 1500, scrapedAt: expect.any(String), source: "exchange" });
    expect(events.value.value).toEqual({ edge: expect.closeTo(0.1, 10), selection: "1", bookmaker: "winamax" });
    expect(events.nofair.reference).toBeNull();
    expect(events.nofair.value).toBeNull();
    // Too old for the listing: gone.
    expect(events.stale.reference).toBeNull();
  });

  it("leaves the TRJ as it is", () => {
    const withReference = getLatestEvents(db, { sort: "start" }).events.map((e) => e.payoutRate);
    db.exec("DELETE FROM reference_odds");
    expect(getLatestEvents(db, { sort: "start" }).events.map((e) => e.payoutRate)).toEqual(withReference);
  });

  it("sorts by best edge, then the matches without a reference by TRJ", () => {
    expect(ids(getLatestEvents(db, { sort: "value" }))).toEqual(["value", "betclic", "small", "nofair", "stale"]);
    // Winamax's prices only: "betclic" has no edge left above "small"'s.
    expect(ids(getLatestEvents(db, { sort: "value", bookmakers: ["winamax"] })).slice(0, 3)).toEqual([
      "value",
      "small",
      "betclic",
    ]);
  });

  describe("every value bet", () => {
    const rows = (result: { bets: { eventId: string; bookmaker: string; selection: string }[] }) =>
      result.bets.map((b) => `${b.eventId} ${b.bookmaker} ${b.selection}`);

    it("lists each one with its match, price, fair odds and edge, biggest edge first", () => {
      const result = getValueBets(db);
      expect(rows(result)).toEqual(["value winamax 1", "betclic betclic 1"]);
      expect(result.total).toBe(2);
      expect(result.bets[0]).toEqual({
        eventId: "value",
        sport: "football",
        competition: "Ligue 1",
        startTime: expect.any(String),
        participants: ["value", "Rival"],
        marketCount: 1,
        market: "1X2",
        marketLabel: "Spielergebnis (1X2)",
        selection: "1",
        label: "value",
        bookmaker: "winamax",
        price: 2.2,
        basis: "fair",
        fair: 2,
        edge: expect.closeTo(0.1, 10),
        matched: 1500,
      });
    });

    it("keeps the ticked bookmakers' only", () => {
      expect(rows(getValueBets(db, { bookmakers: ["betclic"] }))).toEqual(["betclic betclic 1"]);
      expect(getValueBets(db, { bookmakers: [] })).toEqual({ bets: [], total: 0 });
    });

    it("gives a match one per price, sorted by edge or by kick-off", () => {
      // Winamax's 3.6 on the draw is 5.9% above 3.4, its 2.1 on "1" 5% like
      // Betclic's on "betclic", which kicks off sooner; Betclic's 3.5 and 2.05 2.9% and 2.5%.
      upsertCanonicalEvents(db, [match("double", 5, [2.1, 3.6, 3.9], [2.05, 3.5, 3.9])]);
      saveReferenceOdds(db, "double", reference(), new Date().toISOString());
      expect(rows(getValueBets(db))).toEqual([
        "value winamax 1",
        "double winamax X",
        "betclic betclic 1",
        "double winamax 1",
        "double betclic X",
        "double betclic 1",
      ]);
      expect(getValueBets(db).bets[1]).toMatchObject({ selection: "X", label: "Unentschieden", price: 3.6, fair: 3.4 });
      expect(rows(getValueBets(db, { sort: "start" }))).toEqual([
        "value winamax 1",
        "betclic betclic 1",
        "double winamax X",
        "double winamax 1",
        "double betclic X",
        "double betclic 1",
      ]);
      // An away win reads as the away team.
      upsertCanonicalEvents(db, [match("away", 6, [1.9, 3.2, 4.4], [1.9, 3.2, 3.8])]);
      saveReferenceOdds(db, "away", reference(), new Date().toISOString());
      expect(getValueBets(db).bets.find((b) => b.eventId === "away")).toMatchObject({ selection: "2", label: "Rival" });
    });

    it("leaves out a stale reference or price, and the matches started", () => {
      // "stale"'s 5 on "2" would be 25% above its hour-old fair 4.
      expect(rows(getValueBets(db)).some((row) => row.startsWith("stale"))).toBe(false);
      db.prepare("UPDATE event_bookmaker_odds SET scraped_at = ? WHERE event_id = 'value' AND bookmaker_id = 'winamax'").run(
        minutesAgo(60)
      );
      expect(rows(getValueBets(db))).toEqual(["betclic betclic 1"]);
      db.prepare("UPDATE events SET start_time = ? WHERE id = 'betclic'").run(minutesAgo(1));
      expect(getValueBets(db).bets).toEqual([]);
    });

    it("goes with the search", () => {
      expect(rows(getValueBets(db, { q: "BETCLIC" }))).toEqual(["betclic betclic 1"]);
      expect(getValueBets(db, { q: "rival" }).total).toBe(2);
    });
  });

  describe("the players' fair odds", () => {
    // The exchange's scorers on "value": Mbappé reliably at 2.00 (back and
    // lay around it), Dembélé without fair odds (too few bettors) but with a
    // lay of 2.02.
    const players = (eventId: string, rows: [string, number | null][], market = "anytime_scorer", at = new Date().toISOString()) =>
      savePlayerOdds(
        db,
        eventId,
        market,
        rows.map(([player, fair]) => ({ runner: player, player, back: 1.98, lay: 2.02, backSize: 50, laySize: 50, fair })),
        5000,
        at
      );
    beforeEach(() => {
      players("value", [["Mbappé", 2], ["Dembélé", null]]);
      players("value", [["Mbappé", 6]], "scorer_goals|2");
      saveMarketOdds(
        db,
        [
          {
            eventId: "value",
            bookmakerId: "winamax",
            odds: [
              { market: "anytime_scorer", selection: "Mbappé", price: 2.3 },
              { market: "anytime_scorer", selection: "Dembélé", price: 3 },
              { market: "scorer_goals|2", selection: "Mbappé", price: 6.05 },
            ],
          },
          { eventId: "value", bookmakerId: "betclic", odds: [{ market: "anytime_scorer", selection: "Mbappé", price: 2.01 }] },
        ],
        new Date().toISOString()
      );
    });
    const outcome = (market: string, player: string, bookmakers?: string[]) =>
      getEventDetail(db, "value", { bookmakers })!
        .sections.flatMap((s) => s.markets)
        .find((m) => m.key === market)!
        .lines[0].outcomes.find((o) => o.key === player)!;

    it("shows them on the match page, value bets from 5%", () => {
      expect(outcome("anytime_scorer", "Mbappé")).toMatchObject({ fair: 2, edges: { winamax: expect.closeTo(0.15, 10) } });
      expect(outcome("anytime_scorer", "Mbappé").fairIsCeiling).toBeUndefined();
      // 6.05 is under 5% above 6, Betclic's 2.01 under 2.00's.
      expect(outcome("scorer_goals|2", "Mbappé")).toMatchObject({ fair: 6, edges: {} });
      expect(outcome("anytime_scorer", "Mbappé", ["betclic"]).edges).toEqual({});
    });

    it("takes a price for a value bet from exactly 5% above", () => {
      const winamax = (price: number) =>
        saveMarketOdds(
          db,
          [{ eventId: "value", bookmakerId: "winamax", odds: [{ market: "anytime_scorer", selection: "Mbappé", price }] }],
          new Date().toISOString()
        );
      winamax(2.09);
      expect(outcome("anytime_scorer", "Mbappé").edges).toEqual({});
      winamax(2.1);
      expect(Object.keys(outcome("anytime_scorer", "Mbappé").edges!)).toEqual(["winamax"]);
    });

    it("weighs a player without fair odds against the lay, and shows it as their ceiling", () => {
      // Winamax's 3.00 is 48.5% above Dembélé's lay of 2.02.
      expect(outcome("anytime_scorer", "Dembélé")).toMatchObject({
        fair: 2.02,
        fairIsCeiling: true,
        edges: { winamax: expect.closeTo(3 / 2.02 - 1, 10) },
      });
      // Under it: no ceiling shown.
      saveMarketOdds(
        db,
        [{ eventId: "value", bookmakerId: "winamax", odds: [{ market: "anytime_scorer", selection: "Dembélé", price: 2.1 }] }],
        new Date().toISOString()
      );
      expect(outcome("anytime_scorer", "Dembélé").fair).toBeUndefined();
    });

    it("shows no suspect price, the exchange having nothing for the player", () => {
      saveMarketOdds(
        db,
        [
          { eventId: "value", bookmakerId: "winamax", odds: [{ market: "anytime_scorer", selection: "Rien", price: 4 }] },
          { eventId: "value", bookmakerId: "betclic", odds: [{ market: "anytime_scorer", selection: "Rien", price: 3 }] },
        ],
        new Date().toISOString()
      );
      // Winamax's 4 is 33% above Betclic's 3: counted (tests/reference/
      // players.test.ts), not shown.
      const rien = outcome("anytime_scorer", "Rien");
      expect([rien.fair, rien.edges, rien.suspects]).toEqual([undefined, undefined, undefined]);
      expect(outcome("anytime_scorer", "Rien", ["winamax"]).suspects).toBeUndefined();
      expect(getValueBets(db).bets.filter((b) => b.basis === "bookmaker")).toEqual([]);
    });

    it("leaves out stale ones", () => {
      db.exec("UPDATE reference_player_odds SET scraped_at = '2000-01-01T00:00:00.000Z' WHERE market = 'anytime_scorer'");
      expect(outcome("anytime_scorer", "Mbappé").fair).toBeUndefined();
      expect(getValueBets(db).bets.some((b) => b.market === "anytime_scorer")).toBe(false);
    });

    it("lists their value bets among the 1X2's, a match's by edge", () => {
      expect(getValueBets(db).bets.map((b) => `${b.eventId} ${b.market} ${b.bookmaker} ${b.label} ${b.basis}`)).toEqual([
        "value anytime_scorer winamax Dembélé lay",
        "value anytime_scorer winamax Mbappé fair",
        "value 1X2 winamax value fair",
        "betclic 1X2 betclic betclic fair",
      ]);
      expect(getValueBets(db).bets[1]).toMatchObject({
        marketLabel: "Torschütze (jederzeit)",
        selection: "Mbappé",
        price: 2.3,
        fair: 2,
        edge: expect.closeTo(0.15, 10),
        matched: 5000,
      });
      expect(getValueBets(db).bets[0]).toMatchObject({ fair: 2.02, edge: expect.closeTo(3 / 2.02 - 1, 10) });
      expect(getValueBets(db, { bookmakers: ["betclic"] }).bets.map((b) => b.market)).toEqual(["1X2"]);
      expect(getValueBets(db, { sort: "start" }).bets.map((b) => `${b.eventId} ${b.market}`)).toEqual([
        "value anytime_scorer",
        "value anytime_scorer",
        "value 1X2",
        "betclic 1X2",
      ]);
    });

    it("lists a match whose players alone are weighed", () => {
      players("nofair", [["Kane", 2.5]]);
      saveMarketOdds(
        db,
        [{ eventId: "nofair", bookmakerId: "winamax", odds: [{ market: "anytime_scorer", selection: "Kane", price: 2.7 }] }],
        new Date().toISOString()
      );
      expect(getValueBets(db).bets.find((b) => b.eventId === "nofair")).toMatchObject({ label: "Kane", marketLabel: "Torschütze (jederzeit)" });
    });
  });

  it("shows the fair odds and value bets on the match page's 1X2, and only there", () => {
    saveMarketOdds(
      db,
      // The half-time result has outcomes "1", "X" and "2" too.
      [{ eventId: "value", bookmakerId: "winamax", odds: oneXTwo([3, 2.1, 4.5]).map((o) => ({ ...o, market: "ht_1X2" })) }],
      new Date().toISOString()
    );
    const markets = getEventDetail(db, "value")!.sections.flatMap((s) => s.markets);
    const oneXTwoCard = markets.find((m) => m.key === "1X2")!;
    const [one, draw, two] = oneXTwoCard.lines[0].outcomes;
    expect(one).toMatchObject({ key: "1", fair: 2, edges: { winamax: expect.closeTo(0.1, 10) }, best: ["winamax"] });
    expect(draw).toMatchObject({ key: "X", fair: 3.4, edges: {} });
    expect(two).toMatchObject({ key: "2", fair: 4, edges: {} });
    const halfTime = markets.find((m) => m.key === "ht_1X2")!.lines[0].outcomes[0];
    expect(halfTime.fair).toBeUndefined();
    expect(getEventDetail(db, "nofair")!.sections[0].markets[0].lines[0].outcomes[0].fair).toBeUndefined();
  });

  it("counts only the requested bookmakers' value bets on the match page", () => {
    const [one] = getEventDetail(db, "value", { bookmakers: ["betclic"] })!.sections[0].markets[0].lines[0].outcomes;
    expect(one.edges).toEqual({});
  });
});
