import { describe, it, expect, beforeEach } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { openDb } from "../../src/db/client";
import { getLatestEvents, saveMarketOdds, upsertCanonicalEvents } from "../../src/db/repository";
import { getEventDetail } from "../../src/db/eventDetail";
import { playerMarketKey } from "../../src/markets/catalog";
import { CanonicalEvent, RawOdds } from "../../src/types";

const hoursFromNow = (h: number) => new Date(Date.now() + h * 60 * 60 * 1000).toISOString();
const minutesAgo = (m: number) => new Date(Date.now() - m * 60 * 1000).toISOString();

const match: CanonicalEvent = {
  id: "bvb",
  sport: "football",
  competition: "Bundesliga",
  startTime: hoursFromNow(5),
  participants: ["Borussia Dortmund", "Werder Brême"],
  byBookmaker: {
    betclic: [
      { market: "1X2", selection: "1", price: 1.33 },
      { market: "1X2", selection: "X", price: 5.25 },
      { market: "1X2", selection: "2", price: 6.5 },
    ],
    winamax: [
      { market: "1X2", selection: "1", price: 1.29 },
      { market: "1X2", selection: "X", price: 4.9 },
      { market: "1X2", selection: "2", price: 5.6 },
    ],
  },
};

function save(db: DatabaseSync, bookmakerId: string, odds: RawOdds[], at = new Date().toISOString()) {
  saveMarketOdds(db, [{ eventId: "bvb", bookmakerId, odds }], at);
}

describe("getEventDetail", () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = openDb(":memory:");
    upsertCanonicalEvents(db, [match]);
  });

  describe("competitionFilter", () => {
    it("names a match's competition as the matches' filter does", () => {
      expect(getEventDetail(db, "bvb")).toMatchObject({ competition: "Bundesliga", competitionFilter: "Bundesliga" });
    });

    it("leaves a season out of it", () => {
      upsertCanonicalEvents(db, [{ ...match, id: "cup", competition: "Coupe de France 2026/2027", participants: ["Lens", "Lille"] }]);
      expect(getEventDetail(db, "cup")).toMatchObject({
        competition: "Coupe de France 2026/2027",
        competitionFilter: "Coupe de France",
      });
    });

    it("is a competition winner's title without its season, whatever its bookmaker calls the competition", () => {
      upsertCanonicalEvents(db, [
        {
          id: "l1",
          sport: "football",
          competition: "Ligue 1 McDonald's®",
          startTime: hoursFromNow(24 * 200),
          participants: ["Ligue 1 2026/2027"],
          byBookmaker: { unibet: [{ market: "Vainqueur", selection: "Paris Saint-Germain", price: 1.5 }] },
        },
      ]);
      expect(getEventDetail(db, "l1")).toMatchObject({ competition: "Ligue 1 McDonald's®", competitionFilter: "Ligue 1" });
    });
  });

  it("sorts markets into sections, in the catalog's order, the main one first", () => {
    save(db, "winamax", [
      { market: "anytime_scorer", selection: "Serhou Guirassy", price: 1.66 },
      { market: "btts", selection: "yes", price: 1.5 },
      { market: "btts", selection: "no", price: 2.05 },
      { market: "double_chance", selection: "1X", price: 1.07 },
      { market: "wx:Remplaçant buteur", selection: "Oui", price: 2.15 },
    ]);

    const detail = getEventDetail(db, "bvb")!;

    expect(detail.participants).toEqual(["Borussia Dortmund", "Werder Brême"]);
    expect(detail.sections.map((s) => [s.label, s.markets.map((m) => m.label)])).toEqual([
      ["Result", ["Match result", "Double chance"]],
      ["Goals", ["Both teams to score"]],
      ["Scorers and assists", ["Anytime scorer"]],
      ["Only at Winamax", ["Remplaçant buteur"]],
    ]);
  });

  it("gives each outcome every bookmaker's price and the best, ties included", () => {
    save(db, "winamax", [{ market: "double_chance", selection: "1X", price: 1.08 }]);
    save(db, "betclic", [
      { market: "double_chance", selection: "1X", price: 1.08 },
      { market: "double_chance", selection: "X2", price: 2.85 },
    ]);

    const market = getEventDetail(db, "bvb")!.sections[0].markets[1];

    expect(market.compared).toBe(true);
    expect(market.lines[0].outcomes).toEqual([
      { key: "1X", label: "Borussia Dortmund or draw", prices: { betclic: 1.08, winamax: 1.08 }, best: ["betclic", "winamax"] },
      // Priced by one bookmaker only: nothing to compare, so no best.
      { key: "X2", label: "Draw or Werder Brême", prices: { betclic: 2.85 }, best: [] },
    ]);
  });

  it("gives a boosted outcome its boosted price beside its price, never as it", () => {
    // 20bet's boost on Werder Brême, as its listing stores it (RawOdds.boosted).
    upsertCanonicalEvents(db, [
      {
        ...match,
        byBookmaker: {
          ...match.byBookmaker,
          twentybet: [
            { market: "1X2", selection: "1", price: 1.3 },
            { market: "1X2", selection: "X", price: 5 },
            { market: "1X2", selection: "2", price: 6.2, boosted: 6.9 },
          ],
        },
      },
    ]);

    const [home, , away] = getEventDetail(db, "bvb")!.sections[0].markets[0].lines[0].outcomes;

    expect(away.prices).toEqual({ betclic: 6.5, twentybet: 6.2, winamax: 5.6 });
    expect(away.boosted).toEqual({ twentybet: 6.9 });
    expect(away.best).toEqual(["betclic"]);
    expect(home.boosted).toBeUndefined();
    // Not ticked, its boost goes with its price.
    const unticked = getEventDetail(db, "bvb", { bookmakers: ["betclic", "winamax"] })!;
    expect(unticked.sections[0].markets[0].lines[0].outcomes[2].boosted).toBeUndefined();
  });

  it("puts over/under lines of one market in one table, and a TRJ on each line", () => {
    save(db, "winamax", [
      { market: "total_goals|2.5", selection: "over", price: 1.3 },
      { market: "total_goals|2.5", selection: "under", price: 2.7 },
      { market: "total_goals|3.5", selection: "over", price: 1.8 },
    ]);
    save(db, "betclic", [
      { market: "total_goals|2.5", selection: "over", price: 1.31 },
      { market: "total_goals|2.5", selection: "under", price: 2.67 },
      { market: "total_goals|3.5", selection: "over", price: 1.8 },
      { market: "total_goals|3.5", selection: "under", price: 1.71 },
    ]);

    const goals = getEventDetail(db, "bvb")!.sections.find((s) => s.key === "goals")!.markets;

    expect(goals).toHaveLength(1);
    expect(goals[0]).toMatchObject({ label: "Total goals", kind: "lines" });
    expect(goals[0].lines.map((l) => l.line)).toEqual([2.5, 3.5]);
    expect(goals[0].lines[0].payoutRate).toBeCloseTo(1 / (1 / 1.31 + 1 / 2.7));
    // Winamax prices only one side of 3.5: its over is still the same bet as
    // Betclic's, Betclic's under covers the rest.
    expect(goals[0].lines[1].payoutRate).toBeCloseTo(1 / (1 / 1.8 + 1 / 1.71));
    // But not without any under.
    save(db, "betclic", [{ market: "total_goals|3.5", selection: "over", price: 1.8 }]);
    expect(getEventDetail(db, "bvb")!.sections.find((s) => s.key === "goals")!.markets[0].lines[1].payoutRate).toBeNull();
  });

  it("counts a surebet when the best prices add up to over 100 %", () => {
    save(db, "winamax", [
      { market: "btts", selection: "yes", price: 2.1 },
      { market: "btts", selection: "no", price: 1.6 },
    ]);
    save(db, "betclic", [
      { market: "btts", selection: "yes", price: 1.7 },
      { market: "btts", selection: "no", price: 2.2 },
    ]);

    const detail = getEventDetail(db, "bvb")!;

    expect(detail.surebetCount).toBe(1);
    expect(detail.comparedCount).toBe(2);
  });

  it("has no TRJ for overlapping outcomes or players", () => {
    save(db, "winamax", [
      { market: "double_chance", selection: "1X", price: 1.07 },
      { market: "double_chance", selection: "12", price: 1.11 },
      { market: "double_chance", selection: "X2", price: 2.8 },
      { market: "anytime_scorer", selection: "Serhou Guirassy", price: 1.66 },
      { market: "anytime_scorer", selection: "Mathis Albert", price: 2.15 },
    ]);

    const detail = getEventDetail(db, "bvb")!;
    const all = detail.sections.flatMap((s) => s.markets).filter((m) => m.label !== "Match result");

    expect(all.map((m) => m.lines[0].payoutRate)).toEqual([null, null]);
  });

  it("gives each handicap line its card, named after the first team's handicap, with its TRJ", () => {
    save(db, "winamax", [
      { market: "handicap|-1.5", selection: "1", price: 1.76 },
      { market: "handicap|-1.5", selection: "2", price: 1.7 },
    ]);
    save(db, "betclic", [
      { market: "handicap|-1.5", selection: "1", price: 1.81 },
      { market: "handicap|-1.5", selection: "2", price: 1.75 },
      { market: "handicap|-2.5", selection: "1", price: 2.92 },
    ]);

    const result = getEventDetail(db, "bvb")!.sections.find((s) => s.key === "result")!.markets;
    // In the order of their lines.
    const [minus25, minus15] = result.filter((m) => m.key.startsWith("handicap"));

    expect(minus15).toMatchObject({ label: "Handicap: Borussia Dortmund -1.5", kind: "list", compared: true });
    expect(minus15.lines[0].outcomes.map((o) => [o.label, o.best])).toEqual([
      ["Borussia Dortmund wins by 2 goals or more", ["betclic"]],
      ["Werder Brême does not lose, or loses by 1 goal", ["betclic"]],
    ]);
    expect(minus15.lines[0].payoutRate).toBeCloseTo(1 / (1 / 1.81 + 1 / 1.75));
    expect(minus25.label).toBe("Handicap: Borussia Dortmund -2.5");
  });

  it("files the second half in its own section", () => {
    save(db, "betclic", [
      { market: "2h_1X2", selection: "1", price: 1.56 },
      { market: "2h_total_goals|0.5", selection: "over", price: 1.07 },
      { market: "2h_total_goals|0.5", selection: "under", price: 5.4 },
    ]);

    const section = getEventDetail(db, "bvb")!.sections.find((s) => s.key === "second_half")!;

    expect(section.label).toBe("2nd half");
    expect(section.markets.map((m) => [m.label, m.kind])).toEqual([
      ["2nd half result", "list"],
      ["2nd half total goals", "lines"],
    ]);
  });

  it("compares no \"other score\" of two bookmakers that list different scores", () => {
    save(db, "winamax", [
      { market: "correct_score", selection: "1-0", price: 7 },
      { market: "correct_score", selection: "4-4", price: 110 },
      { market: "correct_score", selection: "other", price: 13.5 },
    ]);
    save(db, "betclic", [
      { market: "correct_score", selection: "1-0", price: 7.5 },
      { market: "correct_score", selection: "other", price: 5.4 },
    ]);

    const outcomes = getEventDetail(db, "bvb")!.sections.find((s) => s.key === "score")!.markets[0].lines[0].outcomes;

    expect(outcomes.map((o) => [o.key, o.best])).toEqual([
      ["1-0", ["betclic"]],
      ["4-4", []],
      // Betclic's "Autre" holds 4-4, Winamax's doesn't: not the same bet.
      ["other", []],
    ]);
  });

  it("has no TRJ when an outcome is missing, lest a closed one make a false surebet", () => {
    // Betclic's "2+" closed: 1 / 3.15 + 1 / 2.42 would be a TRJ of 137 %.
    save(db, "betclic", [
      { market: "2h_exact_goals", selection: "0", price: 3.15 },
      { market: "2h_exact_goals", selection: "1", price: 2.42 },
    ]);

    const detail = getEventDetail(db, "bvb")!;
    const market = detail.sections.find((s) => s.key === "second_half")!.markets[0];

    expect(market.lines[0].payoutRate).toBeNull();
    expect(detail.surebetCount).toBe(0);
  });

  it("keeps to the requested bookmakers", () => {
    save(db, "winamax", [{ market: "btts", selection: "yes", price: 1.5 }]);
    save(db, "betclic", [{ market: "clean_sheet@2", selection: "yes", price: 9.75 }]);

    const detail = getEventDetail(db, "bvb", { bookmakers: ["betclic"] })!;
    const markets = detail.sections.flatMap((s) => s.markets);

    expect(markets.map((m) => m.label)).toEqual(["Match result", "Werder Brême clean sheet"]);
    expect(markets[0].lines[0].outcomes.map((o) => Object.keys(o.prices))).toEqual([["betclic"], ["betclic"], ["betclic"]]);
  });

  it("drops markets the markets cycle hasn't refreshed for three of its cycles", () => {
    save(db, "winamax", [{ market: "btts", selection: "yes", price: 1.5 }], minutesAgo(40));
    save(db, "betclic", [{ market: "btts", selection: "no", price: 2 }], minutesAgo(50));

    const btts = getEventDetail(db, "bvb")!.sections.find((s) => s.key === "goals")!.markets[0];

    expect(btts.lines[0].outcomes.map((o) => o.key)).toEqual(["yes"]);
  });

  it("has nothing for an unknown or started match", () => {
    upsertCanonicalEvents(db, [{ ...match, id: "started", startTime: hoursFromNow(-1) }]);
    expect(getEventDetail(db, "nope")).toBeNull();
    expect(getEventDetail(db, "started")).toBeNull();
  });
});

describe("the listing beside every market of a match", () => {
  it("keeps to the main market, and counts the match's others", () => {
    const db = openDb(":memory:");
    upsertCanonicalEvents(db, [match]);
    save(db, "winamax", [
      { market: "btts", selection: "yes", price: 1.5 },
      { market: "total_goals|2.5", selection: "over", price: 1.3 },
      { market: "wx:Remplaçant buteur", selection: "Oui", price: 2.15 },
    ]);

    const [listed] = getLatestEvents(db).events;

    expect(new Set(listed.byBookmaker.winamax.odds.map((o) => o.market))).toEqual(new Set(["1X2"]));
    expect(listed.marketCount).toBe(4);
  });

  it("doesn't list a match whose only current prices are the markets cycle's", () => {
    const db = openDb(":memory:");
    upsertCanonicalEvents(db, [match]);
    db.prepare("UPDATE event_bookmaker_odds SET scraped_at = ?").run(minutesAgo(20));
    save(db, "winamax", [{ market: "btts", selection: "yes", price: 1.5 }]);

    expect(getLatestEvents(db).total).toBe(0);
  });
});

describe("a tennis match's page", () => {
  const db = openDb(":memory:");

  it("gives a tennis match its own sections, its winner first, in games and sets", () => {
    upsertCanonicalEvents(db, [
      {
        id: "dm-hh",
        sport: "tennis",
        competition: "Pékin ATP",
        startTime: hoursFromNow(5),
        participants: ["Alex De Minaur", "Hubert Hurkacz"],
        byBookmaker: {
          winamax: [
            { market: "Vainqueur du match", selection: "1", price: 1.64 },
            { market: "Vainqueur du match", selection: "2", price: 2 },
          ],
        },
      },
    ]);
    saveMarketOdds(
      db,
      [
        {
          eventId: "dm-hh",
          bookmakerId: "winamax",
          odds: [
            { market: "total_games|22.5", selection: "over", price: 1.7 },
            { market: "total_games|22.5", selection: "under", price: 1.86 },
            { market: "games_handicap|-1.5", selection: "1", price: 1.76 },
            { market: "games_handicap|-1.5", selection: "2", price: 1.7 },
            { market: "player_aces@2|9.5", selection: "over", price: 1.8 },
            { market: "wx:Résultat après 4 jeux", selection: "Match nul", price: 1.52 },
          ],
        },
        {
          eventId: "dm-hh",
          bookmakerId: "betclic",
          odds: [
            { market: "total_games|22.5", selection: "over", price: 1.65 },
            { market: "total_games|22.5", selection: "under", price: 1.8 },
            { market: "games_handicap|-1.5", selection: "1", price: 1.75 },
            { market: "games_handicap|-1.5", selection: "2", price: 1.7 },
            { market: "player_aces@2|9.5", selection: "over", price: 1.8 },
          ],
        },
      ],
      new Date().toISOString()
    );
    const detail = getEventDetail(db, "dm-hh")!;
    expect(detail.sections.map((s) => [s.label, s.markets.map((m) => m.label)])).toEqual([
      ["Match", ["Match winner", "Games handicap: Alex De Minaur -1.5"]],
      ["Games", ["Total games"]],
      ["Aces and breaks", ["Aces by Hubert Hurkacz"]],
      ["Only at Winamax", ["Résultat après 4 jeux"]],
    ]);
    const [winner, handicap] = detail.sections[0].markets;
    expect(winner.lines[0].outcomes.map((o) => o.label)).toEqual(["Alex De Minaur", "Hubert Hurkacz"]);
    expect(handicap.lines[0].outcomes.map((o) => [o.label, o.best])).toEqual([
      ["Alex De Minaur wins by 2 games or more", ["winamax"]],
      ["Hubert Hurkacz does not lose, or loses by 1 game", ["betclic", "winamax"]],
    ]);
    // Both sides of every line: a TRJ; Betclic's aces over only: none.
    const games = detail.sections[1].markets[0];
    expect(games.lines[0].payoutRate).toBeCloseTo(1 / (1 / 1.7 + 1 / 1.86), 10);
    expect(detail.sections[2].markets[0].lines[0].payoutRate).toBeNull();
  });
});

describe("getEventDetail, a basketball match", () => {
  // Unibet's list gives the result in regular time (a 1X2), the others the
  // winner, overtime included; the markets give each bookmaker's other one.
  let db: DatabaseSync;
  const winner = (a: number, b: number): RawOdds[] => [
    { market: "Vainqueur du match", selection: "1", price: a },
    { market: "Vainqueur du match", selection: "2", price: b },
  ];
  const result = (a: number, x: number, b: number): RawOdds[] => [
    { market: "1X2", selection: "1", price: a },
    { market: "1X2", selection: "X", price: x },
    { market: "1X2", selection: "2", price: b },
  ];
  const barca: CanonicalEvent = {
    id: "barca",
    sport: "basketball",
    competition: "Euroligue",
    startTime: hoursFromNow(3),
    participants: ["Barcelone", "Zalgiris"],
    byBookmaker: { unibet: result(1.77, 12, 2.05), winamax: winner(1.72, 1.98) },
  };
  const saveBarca = (bookmakerId: string, odds: RawOdds[], at = new Date().toISOString()) =>
    saveMarketOdds(db, [{ eventId: "barca", bookmakerId, odds }], at);
  const card = (label: string) => getEventDetail(db, "barca")!.sections[0].markets.find((m) => m.label === label)!;

  beforeEach(() => {
    db = openDb(":memory:");
    upsertCanonicalEvents(db, [barca]);
  });

  it("shows the winner and the result in regular time, each with the prices of the bookmakers that give it", () => {
    saveBarca("unibet", [...winner(1.69, 1.94), ...result(1.8, 12.5, 2)]);
    saveBarca("betclic", result(1.82, 12.75, 2.12));

    const detail = getEventDetail(db, "barca")!;

    expect(detail.sections.map((s) => [s.label, s.markets.map((m) => m.label)])).toEqual([
      ["Result", ["Match winner", "Match result"]],
    ]);
    expect(card("Match winner").lines[0].outcomes.map((o) => [o.label, o.prices])).toEqual([
      ["Barcelone", { unibet: 1.69, winamax: 1.72 }],
      ["Zalgiris", { unibet: 1.94, winamax: 1.98 }],
    ]);
    expect(card("Match result").lines[0].outcomes.map((o) => [o.label, Object.keys(o.prices)])).toEqual([
      ["Barcelone", ["betclic", "unibet"]],
      ["Draw", ["betclic", "unibet"]],
      ["Zalgiris", ["betclic", "unibet"]],
    ]);
  });

  it("makes a card of each player's statistic, its lines in a table, the players in order", () => {
    const over = (stat: string, player: string, line: number, over: number, under?: number): RawOdds[] => [
      { market: playerMarketKey(stat, player, line), selection: "over", price: over },
      ...(under === undefined ? [] : [{ market: playerMarketKey(stat, player, line), selection: "under", price: under }]),
    ];
    saveBarca("winamax", [
      ...over("player_points", "Maodo Lo", 9.5, 1.75, 1.75),
      ...over("player_points", "Kevin Punter", 24.5, 1.9, 1.7),
      ...over("player_points", "Kevin Punter", 22.5, 1.55, 2.2),
      ...over("player_rebounds", "Joel Parra", 3.5, 1.5, 2.1),
    ]);
    // A ladder: the over alone, and lines of another bookmaker's.
    saveBarca("unibet", [
      ...over("player_points", "Kevin Punter", 24.5, 1.95),
      ...over("player_points", "Kevin Punter", 22.5, 1.6, 2.1),
      ...over("player_points", "Maodo Lo", 9.5, 1.8, 1.7),
    ]);

    const detail = getEventDetail(db, "barca")!;
    const points = detail.sections.find((s) => s.key === "p_points")!;
    const rebounds = detail.sections.find((s) => s.key === "p_rebounds")!;

    expect(detail.sections.map((s) => s.label)).toEqual(
      expect.arrayContaining(["Result", "Player points", "Player rebounds"])
    );
    expect(points.markets.map((m) => [m.label, m.kind, m.lines.map((l) => l.line)])).toEqual([
      ["Kevin Punter points", "lines", [22.5, 24.5]],
      ["Maodo Lo points", "lines", [9.5]],
    ]);
    expect(rebounds.markets.map((m) => m.label)).toEqual(["Joel Parra rebounds"]);
    const punter = points.markets[0];
    expect(punter.compared).toBe(true);
    // 22.5: Unibet's over 1.6 against Winamax's under 2.2 and Unibet's own 2.1: a TRJ of both sides.
    expect(punter.lines[0].outcomes.map((o) => [o.key, o.prices, o.best])).toEqual([
      ["over", { winamax: 1.55, unibet: 1.6 }, ["unibet"]],
      ["under", { winamax: 2.2, unibet: 2.1 }, ["winamax"]],
    ]);
    expect(punter.lines[0].payoutRate).toBeCloseTo(1 / (1 / 1.6 + 1 / 2.2), 10);
    // 24.5: Unibet's ladder prices the over only, Winamax's both: the best of each.
    expect(punter.lines[1].outcomes.map((o) => [o.key, o.prices])).toEqual([
      ["over", { winamax: 1.9, unibet: 1.95 }],
      ["under", { winamax: 1.7 }],
    ]);
    expect(punter.lines[1].payoutRate).toBeCloseTo(1 / (1 / 1.95 + 1 / 1.7), 10);
  });

  it("lists the best scorer by player, favourites first, with no TRJ", () => {
    saveBarca("winamax", [
      { market: "top_scorer", selection: "Kevin Punter", price: 3.2 },
      { market: "top_scorer", selection: "Carsen Edwards", price: 2.95 },
    ]);
    saveBarca("betclic", [
      { market: "top_scorer", selection: "Kevin Punter", price: 2.68 },
      { market: "top_scorer", selection: "Carsen Edwards", price: 2.98 },
    ]);

    const best = getEventDetail(db, "barca")!.sections.find((s) => s.key === "p_best")!;

    expect(best.markets.map((m) => m.label)).toEqual(["Top scorer"]);
    // By their best price, the lowest first.
    expect(best.markets[0].lines[0].outcomes.map((o) => [o.label, o.best])).toEqual([
      ["Carsen Edwards", ["betclic"]],
      ["Kevin Punter", ["winamax"]],
    ]);
    expect(best.markets[0].lines[0].payoutRate).toBeNull();
  });

  it("takes a bookmaker's price from its listing when its markets give the same outcome", () => {
    // The listing's 1.77, refreshed every 5 minutes, over the markets' 1.8.
    saveBarca("unibet", result(1.8, 12.5, 2), minutesAgo(10));

    expect(card("Match result").lines[0].outcomes.map((o) => o.prices.unibet)).toEqual([1.77, 12, 2.05]);
  });
});

describe("getEventDetail, an ice hockey match", () => {
  // The listing's result is the regular time's; the markets keep the regular time's
  // totals apart from those that include the overtime and the shootout ("ot_"), and
  // add each period's.
  let db: DatabaseSync;
  const caps: CanonicalEvent = {
    id: "caps",
    sport: "hockey sur glace",
    competition: "NHL",
    startTime: hoursFromNow(4),
    participants: ["Washington Capitals", "Montréal Canadiens"],
    byBookmaker: {
      vbet: [
        { market: "1X2", selection: "1", price: 2.01 },
        { market: "1X2", selection: "X", price: 3.56 },
        { market: "1X2", selection: "2", price: 2.22 },
      ],
    },
  };
  const save = (bookmakerId: string, odds: RawOdds[]) =>
    saveMarketOdds(db, [{ eventId: "caps", bookmakerId, odds }], new Date().toISOString());
  const overUnder = (market: string, over: number, under: number): RawOdds[] => [
    { market, selection: "over", price: over },
    { market, selection: "under", price: under },
  ];

  beforeEach(() => {
    db = openDb(":memory:");
    upsertCanonicalEvents(db, [caps]);
  });

  it("puts the goals in regular time, the overtime's and each period's in the sections of the sport", () => {
    save("vbet", [
      ...overUnder("total_goals|5.5", 1.36, 1.95),
      ...overUnder("p1_total_goals|1.5", 1.44, 1.78),
      { market: "p1_1X2", selection: "1", price: 2.3 },
      { market: "p1_1X2", selection: "X", price: 2.5 },
      { market: "p1_1X2", selection: "2", price: 2.42 },
    ]);
    save("pmu", [...overUnder("total_goals|5.5", 1.4, 2.25), ...overUnder("ot_total_goals|5.5", 1.55, 1.8)]);

    const detail = getEventDetail(db, "caps")!;

    expect(detail.sections.map((s) => [s.label, s.markets.map((m) => m.label)])).toEqual([
      ["Result", ["Match result"]],
      ["Goals", ["Total goals", "Total goals, overtime included"]],
      ["Periods", ["Result of the 1st period", "Total goals of the 1st period"]],
    ]);
    const goals = detail.sections[1].markets[0].lines[0];
    expect(goals.line).toBe(5.5);
    expect(goals.outcomes.map((o) => [o.key, o.prices, o.best])).toEqual([
      ["over", { vbet: 1.36, pmu: 1.4 }, ["pmu"]],
      ["under", { vbet: 1.95, pmu: 2.25 }, ["pmu"]],
    ]);
    // The overtime's alone at PMU: not compared with the regular time's.
    expect(detail.sections[1].markets[1].lines[0].outcomes.map((o) => Object.keys(o.prices))).toEqual([["pmu"], ["pmu"]]);
  });
});
