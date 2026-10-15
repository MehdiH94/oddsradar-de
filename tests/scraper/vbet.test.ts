import { describe, it, expect, vi, afterEach } from "vitest";
import { gunzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { familiesOf, parseMarketKey, sectionsOf } from "../../src/markets/catalog";
import {
  CIRCUSBET,
  circusbetScraper,
  DAZNBET,
  daznbetScraper,
  fetchCircusbetMarkets,
  fetchDaznbetMarkets,
  fetchSwarm,
  fetchVbet,
  fetchVbetMarkets,
  gamesRequest,
  readVbetMarkets,
  readVbetSport,
  sportRequest,
  VbetReply,
  vbetScraper,
} from "../../src/scraper/vbet";
import { MARKET_KINDS } from "../../src/scraper/vbetMarkets";

// Real answers of Vbet's Swarm websocket to sportRequest, one per sport
// (5/10/2026).
const reply = (alias: string): VbetReply =>
  JSON.parse(gunzipSync(readFileSync(join(__dirname, `fixtures/vbet-${alias}.json.gz`))).toString());

describe("readVbetSport", () => {
  it("reads a football match's result, labelled with the teams' names and the draw", () => {
    const events = readVbetSport(reply("Soccer"), "Soccer");
    // Every game with both teams and a result; the competitions' winners
    // (no second team, no result) and the matchdays' statistics ("1res
    // équipes (Buts) - 2es équipes (Buts)") are left out.
    expect(events).toHaveLength(684);
    expect(events.some((e) => /Statisti/i.test(e.competition) || e.participants[0].includes("(Buts)"))).toBe(false);
    expect(events.find((e) => e.participants[0] === "États-Unis" && e.participants[1] === "Canada")).toEqual({
      sport: "football",
      competition: "Matchs amicaux internationaux",
      startTime: "2026-10-07T00:00:00.000Z",
      participants: ["États-Unis", "Canada"],
      odds: [
        { market: "1X2", selection: "États-Unis", price: 1.73 },
        { market: "1X2", selection: "Nul", price: 3.17 },
        { market: "1X2", selection: "Canada", price: 3.26 },
      ],
      sourceId: "31091089",
    });
  });

  it("reads a basketball match's winner, not the handicapped one beside it", () => {
    const events = readVbetSport(reply("Basketball"), "Basketball");
    // 58 winners; 51 of their matches also list "Vainqueur du match (20 pts
    // d'avance)", of the same 2-way type.
    expect(events).toHaveLength(58);
    expect(events.find((e) => e.participants[0] === "KK Bosna")?.odds).toEqual([
      { market: "Vainqueur du match", selection: "KK Bosna", price: 6 },
      { market: "Vainqueur du match", selection: "CB PAOK Salonique", price: 1.05 },
    ]);
  });

  it("prefers ice hockey's result in regular time, else its winner overtime included", () => {
    const events = readVbetSport(reply("IceHockey"), "IceHockey");
    const markets = events.map((e) => e.odds[0].market);
    expect(markets.filter((m) => m === "1X2")).toHaveLength(40);
    expect(markets.filter((m) => m === "Vainqueur du match")).toHaveLength(40);
    // Never "Résultat du match (3 buts d'avance)", a 3-way handicap.
    expect(events.find((e) => e.participants[0] === "HC Skoda Plzen")?.odds.map((o) => o.price)).toEqual([
      2.3, 3.78, 1.89,
    ]);
  });

  it("trims names and competitions, and maps every sport it is read for", () => {
    const nfl = readVbetSport(reply("AmericanFootball"), "AmericanFootball");
    expect(nfl.find((e) => e.participants[0] === "Jacksonville Jaguars")).toMatchObject({
      sport: "football américain",
      competition: "NFL",
      participants: ["Jacksonville Jaguars", "Philadelphia Eagles"],
    });
    expect(readVbetSport(reply("Tennis"), "Tennis")[0].sport).toBe("tennis");
    expect(readVbetSport(reply("Handball"), "Handball")[0].sport).toBe("handball");
    expect(readVbetSport(reply("Boxing"), "Boxing")[0].sport).toBe("boxe");
  });

  it("leaves out a match under way, suspended, or whose result lacks an outcome", () => {
    const game = (id: number, extra: object, events: object) => ({
      id,
      team1_name: "A",
      team2_name: "B",
      start_ts: 1791312300,
      ...extra,
      market: { 1: { id: 1, name: "Résultat du match", type: "P1XP2", market_type: "MatchResult", event: events } },
    });
    const full = {
      1: { id: 1, name: "A", price: 2, type_1: "W1" },
      2: { id: 2, name: "Nul", price: 3, type_1: "X" },
      3: { id: 3, name: "B", price: 4, type_1: "W2" },
    };
    const built: VbetReply = {
      code: 0,
      data: {
        data: {
          sport: {
            1: {
              alias: "Soccer",
              region: {
                1: {
                  competition: {
                    1: {
                      name: "Ligue",
                      game: {
                        1: game(1, {}, full),
                        2: game(2, { is_started: 1 }, full),
                        3: game(3, { is_blocked: 1 }, full),
                        4: game(4, {}, { 1: full[1], 3: full[3] }),
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    };
    expect(readVbetSport(built, "Soccer").map((e) => e.sourceId)).toEqual(["1"]);
  });
});

describe("readVbetSport, golf tournaments", () => {
  // Real answer to sportRequest("Golf") (6/10/2026): 6 tournaments, each a
  // game with its title only (no second team) and a "Winner" market.
  const events = readVbetSport(reply("Golf"), "Golf");
  const byTitle = (title: string) => events.find((e) => e.participants[0] === title)!;

  it("reads each tournament as a winner market titled by the tournament", () => {
    expect(events.map((e) => e.participants[0]).sort()).toEqual([
      "Open d'Espagne",
      "Ryder Cup 2027",
      "The Masters 2027",
      "The Open Championship 2027",
      "US Open 2027",
      "USPGA Championship 2027",
    ]);
    const open = byTitle("Open d'Espagne");
    expect(open).toMatchObject({
      sport: "golf",
      competition: "Open d'Espagne",
      startTime: "2026-10-08T05:00:00.000Z",
      sourceId: "31126724",
    });
    expect(open.odds).toHaveLength(131);
    expect(new Set(open.odds.map((o) => o.market))).toEqual(new Set(["Vainqueur"]));
    expect(open.odds).toContainEqual({ market: "Vainqueur", selection: "Ludvig Aberg", price: 7.8 });
  });

  it("trims the competitions' and the players' names, which come with stray spaces", () => {
    expect(byTitle("US Open 2027").competition).toBe("US Open");
    expect(byTitle("Open d'Espagne").odds.map((o) => o.selection)).toContain("Jorge Campillo");
    for (const event of events) expect(event.odds.filter((o) => o.selection !== o.selection.trim())).toEqual([]);
    expect(byTitle("Ryder Cup 2027").odds.map((o) => o.selection).sort()).toEqual(["Europe", "Égalité", "États-Unis"]);
  });

  it("leaves a tournament under way or suspended out, like a match", () => {
    const started = structuredClone(reply("Golf"));
    const sport = Object.values(started.data!.data!.sport!)[0];
    const games = Object.values(sport.region!).flatMap((r) => Object.values(r.competition!)).flatMap((c) => Object.values(c.game!));
    games.find((g) => g.team1_name === "Open d'Espagne")!.is_started = 1;
    games.find((g) => g.team1_name === "US Open 2027")!.is_blocked = 1;
    expect(readVbetSport(started, "Golf")).toHaveLength(4);
  });
});

// Real answers to sportRequest for the sports added on 8/10/2026: badminton and
// table tennis (head-to-heads, doubles among the singles), then the winners of
// cycling, biathlon, Nascar and the Formula 2.
describe("readVbetSport, badminton and table tennis", () => {
  it("reads their matches, the doubles' pairs written with a slash, as winners", () => {
    const badminton = readVbetSport(reply("Badminton"), "Badminton");
    expect(badminton).toHaveLength(12);
    expect(badminton.every((e) => e.sport === "badminton")).toBe(true);
    expect(badminton.find((e) => e.participants[0] === "Lee Zii Jia")).toEqual({
      sport: "badminton",
      competition: "Arctic Open",
      startTime: "2026-10-09T10:45:00.000Z",
      participants: ["Lee Zii Jia", "Christo Popov"],
      odds: [
        { market: "Vainqueur du match", selection: "Lee Zii Jia", price: 2.85 },
        { market: "Vainqueur du match", selection: "Christo Popov", price: 1.22 },
      ],
      sourceId: expect.any(String),
    });
    expect(badminton.some((e) => e.participants[0].includes("/"))).toBe(true);

    const tableTennis = readVbetSport(reply("TableTennis"), "TableTennis");
    expect(tableTennis).toHaveLength(12);
    expect(new Set(tableTennis.map((e) => e.sport))).toEqual(new Set(["tennis de table"]));
    // A match's handicap in points (MatchPointHandicap) is not its winner.
    expect(tableTennis.every((e) => e.odds.length === 2 && e.odds[0].market === "Vainqueur du match")).toBe(true);
  });
});

describe("readVbetSport, the winners of cycling, biathlon, Nascar and the Formula 2", () => {
  const winners = (alias: string) => readVbetSport(reply(alias), alias);

  it("reads a race or a season as a winner market titled by the game", () => {
    const cycling = winners("Cycling");
    expect(cycling.map((e) => [e.sport, e.participants[0], e.odds.length])).toEqual([
      ["cyclisme", "Tour de France 2027", 106],
      ["cyclisme", "Paris-Roubaix 2027", 122],
    ]);
    expect(new Set(cycling[0].odds.map((o) => o.market))).toEqual(new Set(["Vainqueur"]));
    expect(cycling[0].competition).toBe("Tour de France");
  });

  it("puts Nascar's races and the Formula 2's winners under automobile", () => {
    const nascar = winners("Nascar");
    expect(nascar.map((e) => e.participants[0])).toEqual(["Bank of America 400", "Blue Cross NC 300"]);
    expect(new Set(nascar.map((e) => e.sport))).toEqual(new Set(["automobile"]));
    expect(winners("AutoRacing").map((e) => [e.sport, e.participants[0]])).toEqual([
      ["automobile", "Formula 2 Drivers Championship 2026"],
    ]);
  });

  // Real case (13/10/2026): Cote Radar showed the Cup's championship prices
  // (Larson 1.83, Hamlin 2.92) as Vbet's for the Freeway Insurance 500, where
  // the race's were 7.70 and 6.50. Vbet lists the championship of each series in
  // a competition of its own ("Monster Energy NASCAR Cup - Compétition", 16
  // contenders, all in the race's field) and dates it at the weekend's start,
  // like the race, so the matcher paired it with a race another bookmaker lists.
  it("leaves out Nascar's championships, which are not a race's winner", () => {
    const games = Object.values(reply("Nascar").data!.data!.sport!).flatMap((sport) =>
      Object.values(sport.region!).flatMap((region) =>
        Object.values(region.competition!).map((competition) => competition.name.trim())
      )
    );
    expect(games).toEqual(
      expect.arrayContaining(["Monster Energy NASCAR Cup - Compétition", "O'Reilly Auto Parts Series. Compétition"])
    );
    const nascar = winners("Nascar");
    expect(nascar.map((e) => e.competition)).toEqual(["Monster Energy NASCAR Cup Series", "O'Reilly Auto Parts Series"]);
    expect(nascar.some((e) => /Nascar Cup Series 2026|O'Reilly Auto Parts Series 2026/.test(e.participants[0]))).toBe(false);
    // The races' own markets are still read: 39 and 37 drivers.
    expect(nascar.map((e) => e.odds.length)).toEqual([39, 37]);
  });

  it("reads biathlon's World Cup winners, men's and women's, under biathlon", () => {
    const biathlon = winners("Biathlon");
    expect(biathlon).toHaveLength(4);
    expect(new Set(biathlon.map((e) => e.sport))).toEqual(new Set(["biathlon"]));
    expect(biathlon.some((e) => /\(F\)/.test(e.participants[0]))).toBe(true);
  });

  it("asks for each of them the winner market, not the head-to-heads'", () => {
    for (const alias of ["Cycling", "Biathlon", "Nascar", "AutoRacing"]) {
      expect(sportRequest(alias)).toMatchObject({ where: { market: { type: { "@in": ["Winner"] } } } });
    }
    expect(sportRequest("Badminton")).toMatchObject({ where: { market: { type: { "@in": ["P1XP2", "P1P2", "Winner"] } } } });
  });
});

describe("sportRequest", () => {
  it("asks for every level of Swarm's tree, the region included", () => {
    // Without the region, Swarm answered no game at all in production.
    expect(Object.keys(sportRequest("Soccer").what as object)).toEqual([
      "sport",
      "region",
      "competition",
      "game",
      "market",
      "event",
    ]);
  });
});

// Real answer to gamesRequest for the Open d'Espagne and the Masters 2027
// (6/10/2026): the markets of the two tournaments, those delivered.
const marketsReply = (): VbetReply =>
  JSON.parse(gunzipSync(readFileSync(join(__dirname, "fixtures/vbet-GolfMarkets.json.gz"))).toString());

describe("readVbetMarkets, golf tournaments", () => {
  const markets = readVbetMarkets(marketsReply());
  const byMarket = (gameId: string) => {
    const grouped = new Map<string, number>();
    for (const o of markets.get(gameId) ?? []) grouped.set(o.market, (grouped.get(o.market) ?? 0) + 1);
    return grouped;
  };

  it("reads a tournament's Top N and its round leader, by Swarm's market kind, per game", () => {
    expect([...markets.keys()].sort()).toEqual(["29511098", "31126724"]);
    expect(byMarket("31126724")).toEqual(
      new Map([
        ["golf_top|10", 131],
        ["golf_top|20", 131],
        ["golf_round_leader|1", 131],
      ])
    );
    expect(markets.get("31126724")).toContainEqual({ market: "golf_top|10", selection: "Ludvig Aberg", price: expect.any(Number) });
  });

  it("leaves out the winner (the listing's), the forecasts and a tournament with the winner only", () => {
    expect([...(markets.get("31126724") ?? [])].some((o) => o.market === "Vainqueur" || /forecast/i.test(o.market))).toBe(false);
    expect(markets.get("29511098")).toEqual([]);
  });

  it("reads the best of a nationality by its title, which no capture of Vbet has yet", () => {
    // Synthetic: Vbet's Open d'Espagne (6/10/2026) listed no such market, so one is added to its reply,
    // named as the other bookmakers name theirs.
    const reply = marketsReply();
    const game = Object.values(reply.data!.data!.sport!)
      .flatMap((sport) => Object.values(sport.region ?? {}))
      .flatMap((region) => Object.values(region.competition ?? {}))
      .flatMap((competition) => Object.values(competition.game ?? {}))
      .find((g) => String(g.id) === "31126724")!;
    game.market!["900000001"] = {
      id: 900000001,
      name: "Meilleur Européen",
      type: "P1P2",
      market_type: "BestEuropean",
      event: {
        "1": { id: 1, name: " Ludvig Aberg ", price: 3.5, type_1: "W1" },
        "2": { id: 2, name: "Tommy Fleetwood", price: 1, type_1: "W2" },
      },
    };
    expect(readVbetMarkets(reply).get("31126724")).toContainEqual({
      market: "golf_best_europeen",
      selection: "Ludvig Aberg",
      price: 3.5,
    });
    // A price of 1 is a market left open without one.
    expect(readVbetMarkets(reply).get("31126724")!.filter((o) => o.market === "golf_best_europeen")).toHaveLength(1);
  });

  it("trims the players' names, and reads nothing from a reply without games", () => {
    expect((markets.get("31126724") ?? []).every((o) => o.selection === o.selection.trim())).toBe(true);
    expect(readVbetMarkets({ code: 0 }).size).toBe(0);
  });
});

// Real answers to gamesRequest for one match each (8/10/2026): JS Kabylie -
// ASO Chlef (Ligue 1, 242 markets of 156 kinds) and Kecmanovic - Mensik (ATP
// Shanghai, 49 markets of 31 kinds), the markets of the kinds this project
// reads or not.
const matchReply = (name: "Soccer" | "Tennis"): VbetReply =>
  JSON.parse(gunzipSync(readFileSync(join(__dirname, `fixtures/vbet-${name}Markets.json.gz`))).toString());

// A game's prices by market key, then outcome.
const priceTable = (odds: { market: string; selection: string; price: number }[] | undefined) => {
  const table = new Map<string, Map<string, number>>();
  for (const o of odds ?? []) {
    if (!table.has(o.market)) table.set(o.market, new Map());
    table.get(o.market)!.set(o.selection, o.price);
  }
  return table;
};
const outcomes = (table: Map<string, Map<string, number>>, key: string) => Object.fromEntries(table.get(key) ?? []);

describe("readVbetMarkets, a football match", () => {
  const read = readVbetMarkets(matchReply("Soccer"));
  const table = priceTable(read.get("31142978"));

  it("reads the goals' totals by line, half-goal lines only, the way the other bookmakers' are", () => {
    expect(outcomes(table, "total_goals|2.5")).toEqual({ over: 1.86, under: 1.5 });
    expect(outcomes(table, "total_goals|0.5")).toEqual({ over: 1.04, under: 6.8 });
    // 1, 2, 3 and 4 goals refund a push: not a market the others offer.
    expect([...table.keys()].filter((k) => /^total_goals\|\d+$/.test(k))).toEqual([]);
    expect(outcomes(table, "team_goals@1|2.5")).toEqual({ over: 2.55, under: 1.2 });
    expect(table.has("team_goals@1|2")).toBe(false);
  });

  it("reads the goals' handicap with the first team's line, half goals only", () => {
    // "Home -1.5" at 2.1 and "Away +1.5" at 1.35; "Home +0.5" is the line 0.5.
    expect(outcomes(table, "handicap|-1.5")).toEqual({ "1": 2.1, "2": 1.35 });
    expect(outcomes(table, "handicap|0.5")).toEqual({ "1": 1.045, "2": 6.5 });
    expect(outcomes(table, "handicap|-0.5")).toEqual({ "1": 1.35, "2": 2.1 });
    // A whole line (2, 1, 0, 3) refunds a draw; the 3-way handicap is another bet.
    expect([...table.keys()].filter((k) => /^handicap\|-?\d+$/.test(k))).toEqual([]);
  });

  it("reads the results, the chances and the cases of a match", () => {
    expect(outcomes(table, "double_chance")).toEqual({ "1X": 1.07, "12": 1.16, X2: 2.32 });
    expect(outcomes(table, "draw_no_bet")).toEqual({ "1": 1.08, "2": 4.5 });
    expect(outcomes(table, "btts")).toEqual({ yes: 2, no: 1.43 });
    expect(outcomes(table, "ht_1X2")).toEqual({ "1": 1.7, X: 1.93, "2": 6.6 });
    expect(outcomes(table, "first_team_to_score")).toEqual({ "1": 1.29, "2": 2.99, none: 7.2 });
    expect(outcomes(table, "highest_scoring_half")).toEqual({ "1st": 2.65, equal: 2.88, "2nd": 1.91 });
    expect(table.get("ht_ft")?.get("1/1")).toBe(1.84);
    expect(table.get("ht_ft")?.get("1/X")).toBe(12);
    expect(outcomes(table, "win_to_nil@1")).toEqual({ yes: 1.74, no: 1.46 });
    expect(outcomes(table, "exact_goals")["6+"]).toBe(11);
  });

  it("reads a result and its total, the six outcomes of the family, not the double chances beside them", () => {
    expect(outcomes(table, "result_total|2.5")).toEqual({
      "1&over": 2.15,
      "1&under": 2.44,
      "X&over": 12,
      "X&under": 3.21,
      "2&over": 10,
      "2&under": 7.7,
    });
  });

  it("reads the double chances with a total or both teams scoring, and the first goal with the result", () => {
    expect(outcomes(table, "dc_total|2.5")).toEqual({
      "1X&over": 2,
      "1X&under": 1.64,
      "12&over": 1.97,
      "12&under": 2.11,
      "X2&over": 6.4,
      "X2&under": 2.62,
    });
    expect(outcomes(table, "dc_btts")).toEqual({
      "1X&yes": 2.09,
      "1X&no": 1.6,
      "12&yes": 2.76,
      "12&no": 1.66,
      "X2&yes": 3.35,
      "X2&no": 3.92,
    });
    expect(outcomes(table, "first_goal_result")).toEqual({
      "1>1": 1.45,
      "1>X": 6.7,
      "1>2": 25,
      "2>1": 7.9,
      "2>X": 6.7,
      "2>2": 5.7,
      none: 7.2,
    });
  });

  it("reads who scores first in each half, and the half's goals by band", () => {
    expect(outcomes(table, "ht_first_team_to_score")).toEqual({ "1": 1.66, "2": 4.8, none: 2.15 });
    expect(outcomes(table, "2h_first_team_to_score")).toEqual({ "1": 1.56, "2": 3.81, none: 2.45 });
    expect(outcomes(table, "ht_goal_bands")).toEqual({ "0-1": 1.25, "2-3": 2.66, "4-6": 17, "7+": 21 });
    expect(outcomes(table, "2h_goal_bands")).toEqual({ "0-1": 1.42, "2-3": 2.2, "4-6": 9.7, "7+": 21 });
  });

  it("reads the score as the others do, home first", () => {
    const scores = table.get("correct_score")!;
    expect(scores.has("0-0") && scores.has("1-2")).toBe(true);
    expect(table.get("ht_correct_score")?.has("1-0")).toBe(true);
  });

  it("leaves out the main market (the listing's) and every market no family covers", () => {
    expect(table.has("1X2")).toBe(false);
    // Every key is a family's, none a bookmaker's own name.
    expect([...table.keys()].every((k) => parseMarketKey(k).kind === "family")).toBe(true);
    expect(table.size).toBeGreaterThan(60);
  });
});

describe("readVbetMarkets, a tennis match", () => {
  const read = readVbetMarkets(matchReply("Tennis"));
  const table = priceTable(read.get("31155573"));

  it("reads the totals and the handicap of games, half lines only", () => {
    expect(outcomes(table, "total_games|23.5")).toEqual({ over: 1.84, under: 1.53 });
    expect(table.has("total_games|23")).toBe(false);
    // "Home +3.5" is the first player's line 3.5.
    expect(outcomes(table, "games_handicap|3.5")).toEqual({ "1": 1.62, "2": 1.73 });
    expect(table.has("games_handicap|3")).toBe(false);
    expect(outcomes(table, "set_handicap|-1.5")).toEqual({ "1": 5.3, "2": 1.07 });
    expect(outcomes(table, "player_games@1|12.5")).toEqual({ over: 1.85, under: 1.4 });
  });

  it("reads the sets: their score, their number, the first set's winner and its total", () => {
    expect(outcomes(table, "set_betting")).toEqual({ "2-0": 5.2, "2-1": 4.85, "0-2": 1.7, "1-2": 3.06 });
    expect(outcomes(table, "total_sets|2.5")).toEqual({ over: 2.05, under: 1.36 });
    expect(outcomes(table, "set1_winner")).toEqual({ "1": 2.35, "2": 1.3 });
    expect(outcomes(table, "set1_total_games|12.5")).toEqual({ over: 2.65, under: 1.18 });
    expect(outcomes(table, "set1_games_handicap|-1.5")).toEqual({ "1": 3.05, "2": 1.14 });
    expect(table.get("set1_correct_score")?.get("6-0")).toBe(81);
    expect(table.get("set1_correct_score")?.get("0-6")).toBeGreaterThan(1);
    expect(table.get("set1_match")?.get("1/1")).toBe(3.84);
    expect(outcomes(table, "bagel")).toEqual({ yes: 7.5, no: 1.015 });
  });

  it("reads the winner and its total games per player, and the breaks", () => {
    expect(outcomes(table, "winner_total_games|25.5")).toEqual({ "1&over": 6, "1&under": 6.5 });
    expect(outcomes(table, "winner_total_games|21.5")).toEqual({ "2&over": 2.4, "2&under": 2.6 });
    expect(outcomes(table, "total_breaks|3.5")).toEqual({ over: 1.4, under: 1.85 });
    expect(outcomes(table, "player_breaks@1|1.5")).toEqual({ over: 1.7, under: 1.5 });
  });

  it("leaves out the winner (the listing's) and what no family covers", () => {
    expect(table.has("Vainqueur du match")).toBe(false);
    expect([...table.keys()].every((k) => parseMarketKey(k).kind === "family")).toBe(true);
  });
});

// Real answers for one game each of ice hockey (Washington Capitals - Montreal
// Canadiens, NHL, 153 markets), American football (Denver Broncos - Seattle
// Seahawks, NFL, 176), handball (GOG - IFK Kristianstad, Champions League, 35)
// and rugby union (Northland - Otago, Mitre 10 Cup, 45), 14/10/2026.
const sportReply = (name: "IceHockey" | "AmericanFootball" | "Handball" | "RugbyUnion"): VbetReply =>
  JSON.parse(gunzipSync(readFileSync(join(__dirname, `fixtures/vbet-${name}Markets.json.gz`))).toString());

// A market is a family of the sport, in a section of its match page.
const placed = (table: Map<string, Map<string, number>>, sport: string) => {
  const sections = new Set(sectionsOf(sport).map((s) => s.key));
  const families = new Set(familiesOf(sport).map((f) => f.key));
  return [...table.keys()].every((key) => {
    const parsed = parseMarketKey(key);
    return parsed.kind === "family" && sections.has(parsed.family.section) && families.has(parsed.family.key);
  });
};

describe("readVbetMarkets, an ice hockey match", () => {
  const table = priceTable(readVbetMarkets(sportReply("IceHockey")).get("31196486"));

  it("reads only markets the catalog has for ice hockey, in its sections", () => {
    expect(table.size).toBeGreaterThan(50);
    expect(placed(table, "hockey sur glace")).toBe(true);
  });

  it("reads the regular time's totals, handicap, double chance and both teams scoring, half lines only", () => {
    expect(outcomes(table, "total_goals|5.5")).toEqual({ over: 1.36, under: 1.95 });
    // "Home -0.5" is the first team's line: Washington, who is "Home" in the outcomes.
    expect(outcomes(table, "handicap|-0.5")).toEqual({ "1": 1.8, "2": 1.42 });
    expect(outcomes(table, "handicap|0.5")).toEqual({ "1": 1.34, "2": 1.98 });
    expect(table.has("handicap|1")).toBe(false);
    expect(outcomes(table, "double_chance")).toEqual({ "1X": 1.39, "12": 1.18, X2: 1.47 });
    expect(outcomes(table, "btts")).toEqual({ yes: 1.03, no: 6.8 });
    // Nothing is read as the overtime's: Vbet's totals and handicaps are regular time's.
    expect([...table.keys()].some((k) => k.startsWith("ot_"))).toBe(false);
  });

  it("gives a team's goals to the team the market names, not the kind's home or away", () => {
    // "AwayTeamTotal" is "Team 1 - Total de buts": the first team's, as the American game
    // lists its away team first.
    expect(outcomes(table, "team_goals@1|2.5")).toEqual({ over: 1.32, under: 2.02 });
    expect(outcomes(table, "team_goals@2|2.5")).toEqual({ over: 1.38, under: 1.9 });
  });

  it("reads each period's result, double chance, handicap, totals and teams' goals", () => {
    expect(outcomes(table, "p1_1X2")).toEqual({ "1": 2.3, X: 2.5, "2": 2.42 });
    expect(outcomes(table, "p3_1X2")).toEqual({ "1": 2.21, X: 2.74, "2": 2.32 });
    expect(outcomes(table, "p2_double_chance")).toEqual({ "1X": 1.32, X2: 1.36, "12": 1.22 });
    expect(outcomes(table, "p1_handicap|-0.5")).toEqual({ "1": 2.05, "2": 1.3 });
    expect(outcomes(table, "p3_total_goals|1.5")).toEqual({ over: 1.28, under: 2.1 });
    expect(outcomes(table, "p3_team_goals@1|1.5")).toEqual({ over: 2.05, under: 1.3 });
    expect(outcomes(table, "p3_team_goals@2|1.5")).toEqual({ over: 2.3, under: 1.24 });
  });

  it("leaves out the listing's result, the scorers and the overtime's winner", () => {
    expect(table.has("1X2")).toBe(false);
    expect([...table.keys()].some((k) => /scorer|player/.test(k))).toBe(false);
  });
});

describe("readVbetMarkets, an American football match", () => {
  const table = priceTable(readVbetMarkets(sportReply("AmericanFootball")).get("31140274"));

  it("reads only markets the catalog has for American football, in its sections", () => {
    expect(table.size).toBeGreaterThan(30);
    expect(placed(table, "football américain")).toBe(true);
  });

  it("reads the handicap and the totals, overtime included, half lines only", () => {
    expect(outcomes(table, "spread|2.5")).toEqual({ "1": 1.69, "2": 1.65 });
    expect(outcomes(table, "spread|-3.5")).toEqual({ "1": 2.36, "2": 1.29 });
    expect(table.has("spread|3")).toBe(false);
    expect(outcomes(table, "total_points|42.5")).toEqual({ over: 1.83, under: 1.54 });
    expect(table.has("total_points|42")).toBe(false);
  });

  it("gives a team's points to the team the market names: Team 1, listed first, is the 'away' kind", () => {
    // The same match at NetBet (Denver at home there): Denver's 19.5 points over at 1.63 and
    // Seattle's 21.5 at 1.7, so Team 1 (Denver) is the 19.5.
    expect(outcomes(table, "team_points@1|19.5")).toEqual({ over: 1.6, under: 1.7 });
    expect(outcomes(table, "team_points@2|21.5")).toEqual({ over: 1.75, under: 1.57 });
  });

  it("reads the quarter's result, refund, handicap and totals, and the first half's", () => {
    expect(outcomes(table, "q1_1X2")).toEqual({ "1": 2.32, X: 3.55, "2": 2.06 });
    expect(outcomes(table, "q1_draw_no_bet")).toEqual({ "1": 1.66, "2": 1.54 });
    expect(outcomes(table, "q1_spread|0.5")).toEqual({ "1": 1.38, "2": 1.9 });
    expect(outcomes(table, "q1_total_points|7.5")).toEqual({ over: 1.72, under: 1.48 });
    expect(outcomes(table, "ht_1X2")).toEqual({ "1": 1.95, X: 7.1, "2": 1.69 });
    expect(outcomes(table, "ht_draw_no_bet")).toEqual({ "1": 1.7, "2": 1.5 });
    expect(outcomes(table, "ht_spread|0.5")).toEqual({ "1": 1.58, "2": 1.62 });
    expect(outcomes(table, "ht_total_points|20.5")).toEqual({ over: 1.62, under: 1.58 });
  });

  it("leaves out the second half, whose bets do not say whether the overtime is in", () => {
    expect([...table.keys()].some((k) => k.startsWith("2h_"))).toBe(false);
  });
});

describe("readVbetMarkets, a handball match", () => {
  const table = priceTable(readVbetMarkets(sportReply("Handball")).get("31079669"));

  it("reads only markets the catalog has for handball, in its sections", () => {
    expect(table.size).toBeGreaterThan(10);
    expect(placed(table, "handball")).toBe(true);
  });

  it("reads the totals and a team's goals, half lines only", () => {
    expect(outcomes(table, "total_goals|68.5")).toEqual({ over: 1.75, under: 1.57 });
    // "Home" is Team 1, the first team, in a European game.
    expect(outcomes(table, "team_goals@1|36.5")).toEqual({ over: 1.55, under: 1.8 });
    expect(outcomes(table, "team_goals@2|30.5")).toEqual({ over: 1.6, under: 1.7 });
    // The match's handicap is a whole line (6): not read.
    expect([...table.keys()].some((k) => k.startsWith("handicap|"))).toBe(false);
  });

  it("reads the first half's result, refund, handicap, totals and teams' goals", () => {
    expect(outcomes(table, "ht_1X2")).toEqual({ "1": 1.18, X: 6.9, "2": 3.99 });
    expect(outcomes(table, "ht_draw_no_bet")).toEqual({ "1": 1.08, "2": 4.8 });
    expect(outcomes(table, "ht_handicap|-3.5")).toEqual({ "1": 1.62, "2": 1.58 });
    expect(outcomes(table, "ht_total_goals|31.5")).toEqual({ over: 1.28, under: 2.1 });
    expect(outcomes(table, "ht_team_goals@1|18.5")).toEqual({ over: 1.62, under: 1.58 });
    expect(outcomes(table, "ht_team_goals@2|14.5")).toEqual({ over: 1.5, under: 1.7 });
  });

  it("reads half-time / full-time, the half with most goals", () => {
    expect(outcomes(table, "ht_ft")).toEqual({
      "1/1": 1.19, "X/1": 9.4, "2/1": 10, "1/X": 41, "X/X": 86, "2/X": 67, "1/2": 21, "X/2": 29, "2/2": 11,
    });
    expect(outcomes(table, "highest_scoring_half")).toEqual({ "1st": 1.93, "2nd": 1.58, equal: 10 });
  });
});

describe("readVbetMarkets, a rugby union match", () => {
  const table = priceTable(readVbetMarkets(sportReply("RugbyUnion")).get("31190649"));

  it("reads only markets the catalog has for rugby union, in its sections", () => {
    expect(table.size).toBeGreaterThan(8);
    expect(placed(table, "rugby à xv")).toBe(true);
  });

  it("reads the refund on a draw, the handicap and the total in points", () => {
    expect(outcomes(table, "draw_no_bet")).toEqual({ "1": 1.95, "2": 1.36 });
    // "Home +4.5" is the first team's line 4.5.
    expect(outcomes(table, "spread|4.5")).toEqual({ "1": 1.6, "2": 1.6 });
    expect(outcomes(table, "total_points|55.5")).toEqual({ over: 1.6, under: 1.6 });
  });

  it("reads the first half's result, refund, handicap, total and teams' points", () => {
    expect(outcomes(table, "ht_1X2")).toEqual({ "1": 2.12, X: 11, "2": 1.61 });
    expect(outcomes(table, "ht_draw_no_bet")).toEqual({ "1": 1.91, "2": 1.48 });
    expect(outcomes(table, "ht_spread|2.5")).toEqual({ "1": 1.63, "2": 1.66 });
    expect(outcomes(table, "ht_total_points|29.5")).toEqual({ over: 1.7, under: 1.6 });
    expect(outcomes(table, "ht_team_points@1|12.5")).toEqual({ over: 1.65, under: 1.65 });
    expect(outcomes(table, "ht_team_points@2|14.5")).toEqual({ over: 1.7, under: 1.6 });
  });

  it("leaves out the listing's result and the tries", () => {
    expect(table.has("1X2")).toBe(false);
    expect([...table.keys()].some((k) => /try|essai/i.test(k))).toBe(false);
  });
});

describe("gamesRequest", () => {
  it("asks for every market of the given games, the whole tree of the sport's request", () => {
    const request = gamesRequest([31126724, 29511098]);
    expect(request.where).toEqual({ game: { id: { "@in": [31126724, 29511098] } } });
    expect(Object.keys(request.what as object)).toEqual(Object.keys(sportRequest("Golf").what as object));
  });

  it("asks for the lines of the markets and their outcomes, which the totals and handicaps are read by", () => {
    const what = gamesRequest([1]).what as { market: string[]; event: string[] };
    expect(what.market).toContain("base");
    expect(what.event).toContain("base");
  });

  it("asks only for the market kinds it reads, when given them", () => {
    const request = gamesRequest([31142978], MARKET_KINDS);
    expect(request.where).toEqual({ game: { id: { "@in": [31142978] } }, market: { market_type: { "@in": MARKET_KINDS } } });
    expect(MARKET_KINDS).toEqual(expect.arrayContaining(["OverUnder", "AsianHandicap", "TotalGamesOver/Under", "ThreeBet"]));
    // The listing owns the main market.
    expect(MARKET_KINDS).not.toContain("MatchResult");
  });
});

describe("sportRequest, golf", () => {
  it("asks for a tournament's winner market, where a match's main market is a result", () => {
    const where = (alias: string) => sportRequest(alias).where as { market: { type: { "@in": string[] } } };
    expect(where("Golf").market.type["@in"]).toEqual(["Winner"]);
    // A head-to-head sport asks for the winners of its competitions beside its matches.
    expect(where("Soccer").market.type["@in"]).toEqual(["P1XP2", "P1P2", "Winner"]);
    expect(sportRequest("Golf").where).toMatchObject({ sport: { alias: "Golf" }, game: { type: { "@in": [0, 2] } } });
  });
});

describe("fetchVbet", () => {
  afterEach(() => vi.unstubAllGlobals());

  // A stand-in for Swarm: answers request_session, then each sport's "get"
  // with the given reply (or a failure code).
  type Params = { what: Record<string, unknown>; where: { sport: { alias: string }; market?: unknown } };
  function fakeSwarm(answer: (params: Params) => VbetReply) {
    const sent: { command: string; params: unknown }[] = [];
    let closed = false;
    class FakeWebSocket {
      onopen: (() => void) | null = null;
      onerror: (() => void) | null = null;
      onmessage: ((m: { data: string }) => void) | null = null;
      onclose: (() => void) | null = null;
      constructor(readonly url: string) {
        setTimeout(() => this.onopen?.());
      }
      send(data: string) {
        const { command, params, rid } = JSON.parse(data);
        sent.push({ command, params });
        const body = command === "request_session" ? { code: 0, data: { sid: "s" } } : answer(params);
        setTimeout(() => this.onmessage?.({ data: JSON.stringify({ ...body, rid }) }));
      }
      close() {
        closed = true;
      }
    }
    vi.stubGlobal("WebSocket", FakeWebSocket);
    return { sent, isClosed: () => closed };
  }

  it("opens a session, asks each sport's main market, and reads them all", async () => {
    const swarm = fakeSwarm(({ where }) =>
      where.sport.alias === "Soccer" ? reply("Soccer") : { code: 0, data: { data: {} } }
    );
    const events = await fetchVbet();
    expect(events).toHaveLength(684);
    expect(swarm.sent[0]).toEqual({
      command: "request_session",
      params: { language: "fra", site_id: "277", source: 42 },
    });
    const asked = swarm.sent
      .slice(1)
      .map((s) => (s.params as { where: { sport: { alias: string } } }).where.sport.alias);
    expect(asked).toContain("Soccer");
    expect(asked).toContain("IceHockey");
    expect(swarm.sent[1].params).toEqual(sportRequest(asked[0]));
    expect(swarm.isClosed()).toBe(true);
  });

  it("reads the sports added on 8/10/2026, but leaves out Formula 1, MotoGP and the skiing", async () => {
    const swarm = fakeSwarm(() => ({ code: 0, data: { data: {} } }));
    await fetchVbet();
    const aliases = swarm.sent
      .slice(1)
      .map((s) => (s.params as { where: { sport: { alias: string } } }).where.sport.alias);
    expect(aliases).toEqual(
      expect.arrayContaining(["Badminton", "TableTennis", "Cycling", "Biathlon", "Nascar", "AutoRacing"])
    );
    // Vbet dates a Grand Prix, its sprint and a season all at the weekend's
    // start (9/10 8:30), a season of skiing at its first race: they would pair
    // with another event's winners.
    for (const left of ["Formula1", "Motorsport", "AlpineSkiing", "CrossCountrySkiing"]) {
      expect(aliases).not.toContain(left);
    }
  });

  // The answer to the request for the games' sports: each one, without its markets.
  const sportsOf = (sports: Record<string, string>): VbetReply => ({
    code: 0,
    data: {
      data: {
        sport: Object.fromEntries(
          [...new Set(Object.values(sports))].map((alias, i) => [
            String(i),
            {
              alias,
              region: {
                "1": {
                  competition: {
                    "1": {
                      name: "x",
                      game: Object.fromEntries(
                        Object.entries(sports)
                          .filter(([, a]) => a === alias)
                          .map(([id]) => [id, { id: Number(id), start_ts: 0 }])
                      ),
                    },
                  },
                },
              },
            },
          ])
        ),
      },
    },
  });

  it("asks for the markets of the given games over one session, and closes it", async () => {
    // Golf's games are asked for as they are, after a request for their sports.
    const swarm = fakeSwarm((params) =>
      params.what.market ? marketsReply() : sportsOf({ "31126724": "Golf", "29511098": "Golf" })
    );
    const markets = await fetchVbetMarkets(["31126724", "29511098"]);

    expect([...markets.keys()].sort()).toEqual(["29511098", "31126724"]);
    expect(markets.get("31126724")!.length).toBe(131 * 3);
    expect(swarm.sent.map((s) => s.command)).toEqual(["request_session", "get", "get"]);
    expect(swarm.sent[2].params).toEqual(gamesRequest([31126724, 29511098]));
    expect(swarm.isClosed()).toBe(true);
    // Nothing asked, nothing connected.
    const none = fakeSwarm(() => ({ code: 12 }));
    expect((await fetchVbetMarkets([])).size).toBe(0);
    expect(none.sent).toEqual([]);
  });

  it("asks a football or a tennis match only for the kinds it reads, and tells the sports apart by the games'", async () => {
    const swarm = fakeSwarm((params) => {
      if (!params.what.market) return sportsOf({ "31142978": "Soccer", "31155573": "Tennis", "31126724": "Golf" });
      const game = (params.where as unknown as { game: { id: { "@in": number[] } } }).game.id["@in"];
      // The football and the tennis match come in one answer, as Swarm gives them.
      if (game.includes(31142978)) {
        const [soccer, tennis] = [matchReply("Soccer"), matchReply("Tennis")];
        return { code: 0, data: { data: { sport: { a: Object.values(soccer.data!.data!.sport!)[0], b: Object.values(tennis.data!.data!.sport!)[0] } } } };
      }
      return marketsReply();
    });
    const markets = await fetchVbetMarkets(["31142978", "31155573", "31126724"]);

    const asked = swarm.sent.slice(2).map((s) => s.params as { where: { game: { id: { "@in": number[] } }; market?: unknown } });
    // One request for the football and the tennis (their kinds), one for golf (all).
    expect(asked.map((r) => r.where.game.id["@in"])).toEqual([[31142978, 31155573], [31126724]]);
    expect(asked[0].where.market).toEqual({ market_type: { "@in": MARKET_KINDS } });
    expect(asked[1].where.market).toBeUndefined();
    expect(markets.get("31142978")!.some((o) => o.market === "total_goals|2.5")).toBe(true);
    expect(markets.get("31155573")!.some((o) => o.market === "total_games|23.5")).toBe(true);
    expect(markets.get("31126724")!.some((o) => o.market.startsWith("golf_top"))).toBe(true);
  });

  it("asks an ice hockey, American football, handball or rugby union match only for the kinds it reads", async () => {
    const swarm = fakeSwarm((params) => {
      if (!params.what.market) return sportsOf({ "31196486": "IceHockey", "31140274": "AmericanFootball", "31079669": "Handball", "31190649": "RugbyUnion" });
      const sports = ["IceHockey", "AmericanFootball", "Handball", "RugbyUnion"] as const;
      const first = (name: (typeof sports)[number]) => Object.values(sportReply(name).data!.data!.sport!)[0];
      return { code: 0, data: { data: { sport: Object.fromEntries(sports.map((name, i) => [String(i), first(name)])) } } };
    });
    const markets = await fetchVbetMarkets(["31196486", "31140274", "31079669", "31190649"]);

    const asked = swarm.sent.slice(2).map((s) => s.params as { where: { game: { id: { "@in": number[] } }; market?: unknown } });
    // One request, with the kinds read.
    expect(asked.map((r) => r.where.game.id["@in"])).toEqual([[31196486, 31140274, 31079669, 31190649]]);
    expect(asked[0].where.market).toEqual({ market_type: { "@in": MARKET_KINDS } });
    for (const kind of ["MatchTotal2", "PeriodWinner3", "QuarterWinner(3Way)", "HalfHandicap2", "HalfResult3way", "Handicap(NoDraw)"]) {
      expect(MARKET_KINDS).toContain(kind);
    }
    expect(markets.get("31196486")!.some((o) => o.market === "total_goals|5.5")).toBe(true);
    expect(markets.get("31140274")!.some((o) => o.market === "spread|2.5")).toBe(true);
    expect(markets.get("31079669")!.some((o) => o.market === "total_goals|68.5")).toBe(true);
    expect(markets.get("31190649")!.some((o) => o.market === "total_points|55.5")).toBe(true);
  });

  it("fails on a request Swarm refuses, for the cycle to log", async () => {
    const swarm = fakeSwarm(() => ({ code: 12 }));
    await expect(fetchVbetMarkets(["31126724"])).rejects.toThrow("code 12");
    expect(swarm.isClosed()).toBe(true);
  });

  it("skips a sport that fails, but fails when every sport does", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    fakeSwarm(({ where }) => (where.sport.alias === "Soccer" ? reply("Soccer") : { code: 12 }));
    expect(await fetchVbet()).toHaveLength(684);
    const swarm = fakeSwarm(() => ({ code: 12 }));
    await expect(fetchVbet()).rejects.toThrow("every Vbet sport failed");
    expect(swarm.isClosed()).toBe(true);
  });

  it("reads CircusBet and DAZN Bet from Vbet's server, each with its own site id", async () => {
    for (const [site, scraper, siteId] of [
      [CIRCUSBET, circusbetScraper, "1869622"],
      [DAZNBET, daznbetScraper, "18766873"],
    ] as const) {
      const swarm = fakeSwarm(({ where }) =>
        where.sport.alias === "Soccer" ? reply("Soccer") : { code: 0, data: { data: {} } }
      );
      const events = await fetchSwarm(site);
      expect(events).toHaveLength(684);
      expect(scraper.id).toBe(site.id);
      expect(swarm.sent[0]).toEqual({
        command: "request_session",
        params: { language: "fra", site_id: siteId, source: 42 },
      });
      expect(swarm.isClosed()).toBe(true);
    }
    expect(vbetScraper.id).toBe("vbet");
  });

  it("names the site in its errors: CircusBet's refused session, DAZN Bet's failed sports", async () => {
    fakeSwarm(() => ({ code: 12 }));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(fetchSwarm(DAZNBET)).rejects.toThrow("every DAZN Bet sport failed");

    class RefusingWebSocket {
      onopen: (() => void) | null = null;
      onmessage: ((m: { data: string }) => void) | null = null;
      onerror = null;
      onclose = null;
      constructor() {
        setTimeout(() => this.onopen?.());
      }
      send(data: string) {
        const { rid } = JSON.parse(data);
        setTimeout(() => this.onmessage?.({ data: JSON.stringify({ code: 5, rid }) }));
      }
      close() {}
    }
    vi.stubGlobal("WebSocket", RefusingWebSocket);
    await expect(fetchSwarm(CIRCUSBET)).rejects.toThrow("CircusBet refused the session (code 5)");
  });

  it("asks for the markets of CircusBet's and DAZN Bet's games with their site ids", async () => {
    for (const [fetcher, siteId] of [
      [fetchCircusbetMarkets, "1869622"],
      [fetchDaznbetMarkets, "18766873"],
    ] as const) {
      const swarm = fakeSwarm((params) =>
        params.what.market ? marketsReply() : sportsOf({ "31126724": "Golf", "29511098": "Golf" })
      );
      const markets = await fetcher(["31126724", "29511098"]);
      expect([...markets.keys()].sort()).toEqual(["29511098", "31126724"]);
      expect(swarm.sent[0]).toEqual({
        command: "request_session",
        params: { language: "fra", site_id: siteId, source: 42 },
      });
      expect(swarm.isClosed()).toBe(true);
    }
  });
});

// Real answers of Vbet's Swarm websocket (14/10/2026), the games with a "Winner"
// market only, each cut to its first twelve contenders: the winners of the competitions
// of football (52), tennis (9), basketball (9), ice hockey (10) and rugby union (5).
describe("readVbetSport, the winners of competitions", () => {
  const winners = (alias: string): VbetReply => {
    const all = JSON.parse(gunzipSync(readFileSync(join(__dirname, "fixtures/vbet-competition-winners.json.gz"))).toString());
    return all[alias];
  };
  const read = (alias: string) => readVbetSport(winners(alias), alias);

  it("reads a league's winner as an outright of its sport, titled with the league and its season", () => {
    const ligue1 = read("Soccer").find((e) => e.participants[0] === "Ligue 1 2026/2027")!;
    expect(ligue1).toMatchObject({ sport: "football", competition: "Ligue 1 McDonald's® - Compétition" });
    expect(ligue1.odds).toHaveLength(12);
    expect(new Set(ligue1.odds.map((o) => o.market))).toEqual(new Set(["Vainqueur"]));
    expect(ligue1.sourceId).toMatch(/^\d+$/);
  });

  it("reads the winners of every sport it lists them for", () => {
    expect(read("Tennis").map((e) => e.participants[0])).toEqual(
      expect.arrayContaining(["Roland-Garros (H) 2027", "Roland-Garros (F) 2027", "Wimbledon - Men 2027"])
    );
    expect(read("Basketball").map((e) => e.participants[0])).toContain("NBA 2026/2027");
    expect(read("IceHockey").map((e) => e.participants[0])).toContain("NHL 2026/2027");
    expect(read("RugbyUnion").map((e) => e.sport)).toEqual(Array(read("RugbyUnion").length).fill("rugby à xv"));
  });

  it("leaves out the NBA's division, conference and extra markets, titled apart from its winner", () => {
    const basketball = read("Basketball").map((e) => e.participants[0]);
    expect(basketball.filter((title) => title.startsWith("NBA"))).toEqual(["NBA 2026/2027"]);
  });

  it("reads competitions of the same name apart, each with its own contenders", () => {
    const premier = read("Soccer").filter((e) => e.participants[0] === "Premier League 2026/2027");
    // England's, Armenia's, Russia's: three games of one title (the Welsh one is "Cymru Premier").
    expect(premier.length).toBeGreaterThan(1);
    expect(new Set(premier.map((e) => e.sourceId)).size).toBe(premier.length);
  });

  it("leaves out a winner whose bets are closed or that is under way", () => {
    const reply = winners("Soccer");
    for (const sport of Object.values(reply.data!.data!.sport!)) {
      for (const region of Object.values(sport.region ?? {})) {
        for (const competition of Object.values(region.competition ?? {})) {
          for (const game of Object.values(competition.game ?? {})) game.is_blocked = 1;
        }
      }
    }
    expect(readVbetSport(reply, "Soccer")).toEqual([]);
  });
});
