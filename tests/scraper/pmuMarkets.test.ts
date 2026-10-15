import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { RawOdds } from "../../src/types";
import { parseMarketKey } from "../../src/markets/catalog";
import { fetchPmuMarkets, PmuEventsReply, readPmuMarkets } from "../../src/scraper/pmuMarkets";

// Real captures of the offering API PMU's site reads (Kambi, 11/10/2026): the
// answer of betoffer/event/<id> for a football match (Coventry City - Newcastle
// United, 280 offers), a tennis match (Medvedev - Svrcina, 34) and a women's
// basketball match (Golden State Valkyries - Atlanta Dream, 168).
const capture = (sport: string): PmuEventsReply =>
  JSON.parse(gunzipSync(readFileSync(join(__dirname, `fixtures/pmu-event-${sport}.json.gz`))).toString());
const FOOTBALL = capture("football");
const TENNIS = capture("tennis");
const BASKETBALL = capture("basketball");
const FOOTBALL_ID = String(FOOTBALL.events[0].id);
const TENNIS_ID = String(TENNIS.events[0].id);
const BASKETBALL_ID = String(BASKETBALL.events[0].id);

const read = (reply: PmuEventsReply, id: string): RawOdds[] => readPmuMarkets(reply).get(id) ?? [];
const price = (odds: RawOdds[], market: string, selection: string) =>
  odds.find((o) => o.market === market && o.selection === selection)?.price;
const selections = (odds: RawOdds[], market: string) => odds.filter((o) => o.market === market).map((o) => o.selection);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("readPmuMarkets, a football match", () => {
  const odds = read(FOOTBALL, FOOTBALL_ID);

  it("reads only markets the catalog knows, and none of the listing's main one", () => {
    expect(odds.length).toBeGreaterThan(250);
    for (const o of odds) expect(parseMarketKey(o.market).kind, o.market).toBe("family");
    expect(odds.some((o) => o.market === "1X2")).toBe(false);
  });

  it("reads the total of goals on its half lines, with the match's, a team's and a half's", () => {
    expect(price(odds, "total_goals|2.5", "over")).toBe(1.61);
    expect(price(odds, "total_goals|2.5", "under")).toBe(1.98);
    expect(price(odds, "team_goals@1|0.5", "over")).toBe(1.24);
    expect(price(odds, "team_goals@2|0.5", "over")).toBe(1.1);
    expect(price(odds, "ht_total_goals|1.5", "under")).toBe(1.34);
    expect(price(odds, "2h_total_goals|0.5", "over")).toBe(1.17);
    expect(price(odds, "ht_team_goals@1|0.5", "under")).toBe(1.5);
    expect(price(odds, "2h_team_goals@1|1.5", "under")).toBe(1.14);
  });

  it("leaves out a price that is suspended, and keeps its other side", () => {
    expect(price(odds, "total_goals|0.5", "over")).toBeUndefined();
    expect(price(odds, "total_goals|0.5", "under")).toBe(11);
  });

  it("reads a handicap on the first team's line, with both sides", () => {
    expect(price(odds, "handicap|0.5", "1")).toBe(1.58);
    expect(price(odds, "handicap|0.5", "2")).toBe(1.84);
    expect(price(odds, "handicap|-1.5", "1")).toBe(6.4);
  });

  it("reads the double chance, the refund on a draw and half-time / full-time", () => {
    expect(price(odds, "double_chance", "1X")).toBe(1.65);
    expect(price(odds, "double_chance", "12")).toBe(1.23);
    expect(price(odds, "double_chance", "X2")).toBe(1.26);
    expect(price(odds, "draw_no_bet", "1")).toBe(2.23);
    expect(price(odds, "draw_no_bet", "2")).toBe(1.4);
    expect(price(odds, "ht_ft", "1/X")).toBe(11);
    expect(price(odds, "ht_ft", "X/2")).toBe(5.2);
  });

  it("reads both teams scoring, the correct score and the first team to score", () => {
    expect(price(odds, "btts", "yes")).toBe(1.5);
    expect(price(odds, "btts", "no")).toBe(2.17);
    expect(price(odds, "correct_score", "0-1")).toBe(9);
    expect(price(odds, "correct_score", "3-4")).toBe(56);
    expect(price(odds, "first_team_to_score", "1")).toBe(2.25);
    expect(price(odds, "first_team_to_score", "none")).toBe(12.5);
    expect(price(odds, "first_team_to_score", "2")).toBe(1.78);
  });

  it("reads each half's result, refund, double chance, both teams scoring and score", () => {
    expect(price(odds, "ht_1X2", "X")).toBe(2.14);
    expect(price(odds, "2h_1X2", "1")).toBe(3.35);
    expect(price(odds, "ht_draw_no_bet", "2")).toBe(1.46);
    expect(price(odds, "2h_draw_no_bet", "1")).toBe(2.23);
    expect(price(odds, "ht_double_chance", "X2")).toBe(1.19);
    expect(price(odds, "2h_double_chance", "1X")).toBe(1.5);
    expect(price(odds, "ht_btts", "yes")).toBe(3.8);
    expect(price(odds, "2h_btts", "no")).toBe(1.3);
    expect(price(odds, "ht_correct_score", "0-0")).toBe(3.15);
  });

  it("puts a team's own markets under that team, home first", () => {
    expect(selections(odds, "win_to_nil@1")).toEqual(["yes"]);
    expect(price(odds, "win_to_nil@1", "yes")).toBe(5.5);
    expect(price(odds, "win_to_nil@2", "yes")).toBe(3.65);
    expect(price(odds, "win_either_half@1", "yes")).toBe(2);
    expect(price(odds, "win_either_half@1", "no")).toBe(1.7);
  });

  it("reads the combinations of a result or a double chance with both teams scoring or a total", () => {
    expect(price(odds, "result_btts", "1&yes")).toBe(5.2);
    expect(price(odds, "dc_btts", "1X&yes")).toBe(2.23);
    expect(price(odds, "dc_btts", "12&yes")).toBe(2.04);
    expect(price(odds, "dc_total|2.5", "1X&over")).toBe(3);
    expect(price(odds, "dc_total|2.5", "12&over")).toBe(1.7);
  });

  it("reads the players' markets under their name", () => {
    expect(price(odds, "anytime_scorer", "Ethan Pinnock")).toBe(12);
    expect(price(odds, "anytime_scorer", "Yoane Wissa")).toBe(2.7);
    expect(price(odds, "scorer_goals|2", "Gustavo Hamer")).toBe(41);
    expect(price(odds, "scorer_goals|3", "Harvey Barnes")).toBe(81);
    expect(price(odds, "decisive_player", "Gustavo Hamer")).toBe(2.9);
    expect(price(odds, "ht_scorer", "William Osula")).toBe(4.9);
  });

  it("reads the first scorer, and leaves out the case of no goal", () => {
    expect(price(odds, "first_scorer", "Lewis Miley")).toBe(23);
    expect(selections(odds, "first_scorer")).not.toContain("Aucun but");
  });
});

describe("readPmuMarkets, a tennis match", () => {
  const odds = read(TENNIS, TENNIS_ID);

  it("reads only markets the catalog knows", () => {
    expect(odds.length).toBeGreaterThan(40);
    for (const o of odds) expect(parseMarketKey(o.market).kind, o.market).toBe("family");
  });

  it("reads the games, the sets and each player's games on half lines", () => {
    expect(price(odds, "total_games|22.5", "over")).toBe(2.48);
    expect(price(odds, "total_games|22.5", "under")).toBe(1.37);
    expect(price(odds, "set1_total_games|8.5", "over")).toBe(1.36);
    expect(price(odds, "total_sets|2.5", "under")).toBe(1.26);
    expect(price(odds, "player_games@1|12.5", "over")).toBe(1.83);
    expect(price(odds, "player_games@2|8.5", "under")).toBe(1.54);
  });

  it("leaves out a price that is suspended", () => {
    expect(price(odds, "set1_total_games|6.5", "over")).toBeUndefined();
    expect(price(odds, "set1_total_games|6.5", "under")).toBe(11);
  });

  it("reads the set handicap on the first player's line", () => {
    expect(price(odds, "set_handicap|-1.5", "1")).toBe(1.37);
    expect(price(odds, "set_handicap|-1.5", "2")).toBe(2.48);
    expect(price(odds, "set_handicap|1.5", "1")).toBeUndefined();
    expect(price(odds, "set_handicap|1.5", "2")).toBe(8);
  });

  it("reads the score in sets and the first set's score, home first", () => {
    expect(price(odds, "set_betting", "2-0")).toBe(1.44);
    expect(price(odds, "set_betting", "1-2")).toBe(9);
    expect(price(odds, "set1_correct_score", "6-1")).toBe(6.25);
    // The second set's score has no family.
    expect(odds.some((o) => o.market.includes("set2_correct_score"))).toBe(false);
  });

  it("reads who wins each set, by the player and not by the order the answer lists them", () => {
    expect(price(odds, "set1_winner", "1")).toBe(1.15);
    expect(price(odds, "set1_winner", "2")).toBe(3.8);
    expect(price(odds, "set2_winner", "1")).toBe(1.15);
  });

  it("reads whether each player wins a set, and the tie-break as a yes or a no", () => {
    expect(price(odds, "win_a_set@1", "no")).toBe(7.5);
    expect(price(odds, "win_a_set@1", "yes")).toBeUndefined();
    expect(price(odds, "win_a_set@2", "yes")).toBe(2.43);
    expect(price(odds, "tiebreak", "yes")).toBe(2.88);
    expect(price(odds, "tiebreak", "no")).toBe(1.14);
  });
});

describe("readPmuMarkets, a basketball match", () => {
  const odds = read(BASKETBALL, BASKETBALL_ID);

  it("reads only markets the catalog knows", () => {
    expect(odds.length).toBeGreaterThan(100);
    for (const o of odds) expect(parseMarketKey(o.market).kind, o.market).toBe("family");
  });

  it("reads the points, the spread and each team's points, overtime included", () => {
    expect(price(odds, "total_points|154.5", "over")).toBe(1.8);
    expect(price(odds, "total_points|154.5", "under")).toBe(1.61);
    expect(price(odds, "spread|-6.5", "1")).toBe(2.45);
    expect(price(odds, "spread|-6.5", "2")).toBe(1.37);
    expect(price(odds, "team_points@1|78.5", "over")).toBe(1.82);
    expect(price(odds, "team_points@2|78.5", "over")).toBe(2.18);
  });

  it("reads the first half's and the first quarter's markets", () => {
    expect(price(odds, "ht_total_points|72.5", "over")).toBe(1.52);
    expect(price(odds, "ht_spread|-0.5", "1")).toBe(1.68);
    expect(price(odds, "ht_draw_no_bet", "2")).toBe(1.84);
    expect(price(odds, "ht_1X2", "X")).toBe(13);
    expect(price(odds, "ht_team_points@1|37.5", "over")).toBe(1.71);
    expect(price(odds, "ht_team_points@2|36.5", "under")).toBe(1.78);
    expect(price(odds, "q1_draw_no_bet", "1")).toBe(1.66);
    expect(price(odds, "q1_spread|-0.5", "1")).toBe(1.76);
    expect(price(odds, "q1_total_points|37.5", "under")).toBe(1.74);
    expect(price(odds, "q1_1X2", "2")).toBe(2.07);
    expect(price(odds, "q1_team_points@1|18.5", "over")).toBe(1.63);
    expect(price(odds, "q1_team_points@2|18.5", "under")).toBe(1.74);
  });

  it("reads half-time / full-time, which the answer splits in two offers", () => {
    expect(price(odds, "ht_ft", "1/1")).toBe(2.3);
    expect(price(odds, "ht_ft", "2/1")).toBe(4.9);
    expect(selections(odds, "ht_ft").length).toBeGreaterThanOrEqual(9);
  });

  it("reads a player's ladder as the over of the line below it", () => {
    expect(price(odds, "player_pr#Kiah Stokes|14.5", "over")).toBe(3.3);
    expect(price(odds, "player_pr#Kiah Stokes|9.5", "over")).toBe(1.54);
    expect(price(odds, "player_pr#Allisha Gray|19.5", "over")).toBe(2.18);
    expect(odds.some((o) => o.market.startsWith("player_pa#"))).toBe(true);
    expect(odds.some((o) => o.market.startsWith("player_ra#"))).toBe(true);
  });
});

// Two golf tournaments, the DP World India Championship and the Buick LPGA
// Shanghai (14/10/2026), each offer cut to its first 12 players.
describe("readPmuMarkets, golf tournaments", () => {
  const GOLF = capture("golf");
  const INDIA_ID = "1029463358";
  const SHANGHAI_ID = "1029463474";
  const india = read(GOLF, INDIA_ID);
  const keys = (odds: RawOdds[]) => [...new Set(odds.map((o) => o.market))].sort();

  it("reads the Top 5, 10 and 20 from the finishing position's offers, by their description", () => {
    expect(selections(india, "golf_top|5")).toHaveLength(12);
    expect(price(india, "golf_top|5", "Aaron Rai")).toBe(4.5);
    expect(price(india, "golf_top|10", "Aaron Rai")).toBe(2.63);
    expect(price(india, "golf_top|20", "Aaron Rai")).toBe(1.73);
    expect(price(india, "golf_top|5", "Adrian Meronk")).toBe(17);
  });

  it("reads the leader after each round, and not the Top N after the 1st round that shares its criterion", () => {
    expect(selections(india, "golf_round_leader|1")).toHaveLength(12);
    expect(price(india, "golf_round_leader|1", "Aaron Rai")).toBe(29);
    expect(price(india, "golf_round_leader|2", "Shane Lowry")).toBe(19);
    expect(price(india, "golf_round_leader|3", "Shane Lowry")).toBe(15);
  });

  it("reads the best of a nationality as the catalog's, whatever PMU's spelling of it", () => {
    expect(price(india, "golf_best_francais", "Antoine Rozner")).toBe(5);
    expect(price(india, "golf_best_anglais", "Aaron Rai")).toBe(4.35);
    expect(price(india, "golf_best_sud_africain", "Casey Jarvis")).toBe(3);
    expect(keys(india).filter((m) => m.startsWith("golf_best_"))).toEqual([
      "golf_best_anglais",
      "golf_best_ecossais",
      "golf_best_espagnol",
      "golf_best_francais",
      "golf_best_sud_africain",
      "golf_best_suedois",
    ]);
  });

  it("reads only the catalog's markets, and leaves the winner to the listing", () => {
    expect(keys(india)).toEqual(
      [
        "golf_round_leader|1",
        "golf_round_leader|2",
        "golf_round_leader|3",
        "golf_top|10",
        "golf_top|20",
        "golf_top|5",
        ...keys(india).filter((m) => m.startsWith("golf_best_")),
      ].sort()
    );
    for (const o of india) expect(parseMarketKey(o.market).kind, o.market).toBe("family");
    expect(india.some((o) => o.market === "Vainqueur")).toBe(false);
  });

  it("reads each tournament of the answer with its own markets", () => {
    const shanghai = read(GOLF, SHANGHAI_ID);
    expect(keys(shanghai)).toEqual(["golf_round_leader|1", "golf_top|10", "golf_top|5"]);
    expect(price(shanghai, "golf_top|5", "A Lim Kim")).toBe(4.5);
    expect(price(shanghai, "golf_top|5", "Aaron Rai")).toBeUndefined();
  });

  it("leaves out an outcome that is suspended", () => {
    const suspended = structuredClone(GOLF);
    const top5 = suspended.betOffers.find((o) => o?.eventId === Number(INDIA_ID) && o.description === "Top 5")!;
    top5.outcomes[0].status = "SUSPENDED";
    expect(price(read(suspended, INDIA_ID), "golf_top|5", "Aaron Rai")).toBeUndefined();
    expect(selections(read(suspended, INDIA_ID), "golf_top|5")).toHaveLength(11);
  });
});

// The offers of a match of each of four more sports, as PMU's `betoffer/event/<id>`
// answers them (14/10/2026), the offers of a same title cut to eight and the players'
// left out: an NHL match (249 offers), a New Zealand rugby union one (25), an NFL one
// (523) and a Champions League handball one (12).
describe("readPmuMarkets, the sports read by their titles", () => {
  const sportOf = (name: string): PmuEventsReply => capture(name);
  const readAll = (name: string) => {
    const reply = sportOf(name);
    return readPmuMarkets(reply).get(String(reply.events[0].id)) ?? [];
  };
  const markets = (odds: RawOdds[]) => [...new Set(odds.map((o) => o.market))];
  const known = (odds: RawOdds[]) => odds.every((o) => parseMarketKey(o.market).kind === "family");

  describe("an ice hockey match", () => {
    const odds = readAll("ice-hockey");

    it("reads only the catalog's markets, and neither the listing's result and winner nor a bet of another kind", () => {
      expect(known(odds)).toBe(true);
      expect(odds.some((o) => o.market === "1X2" || o.market === "Vainqueur du match")).toBe(false);
      // "Total Goals - 0:00-4:59" is the goals of the first minutes, not the match's total.
      expect(price(odds, "total_goals|0.5", "over")).toBeUndefined();
    });

    it("reads the regular time's totals, handicap, refund and double chance, the plain families", () => {
      expect(price(odds, "total_goals|5.5", "over")).toBe(1.4);
      expect(price(odds, "total_goals|5.5", "under")).toBe(2.25);
      expect(price(odds, "handicap|-1.5", "1")).toBe(2.6);
      expect(price(odds, "handicap|-1.5", "2")).toBe(1.24);
      expect(price(odds, "draw_no_bet", "1")).toBe(1.62);
      expect(price(odds, "double_chance", "1X")).toBe(1.34);
      expect(price(odds, "double_chance", "X2")).toBe(1.48);
      expect(price(odds, "btts", "yes")).toBeDefined();
    });

    it("reads each team's goals under that team, the home side first", () => {
      expect(price(odds, "team_goals@1|1.5", "over")).toBe(1.07);
      expect(price(odds, "team_goals@2|1.5", "over")).toBe(1.09);
    });

    it("keeps the overtime and shootout's apart from the regular time's, on the lines they differ", () => {
      expect(price(odds, "total_goals|6.5", "over")).toBe(1.91);
      expect(price(odds, "ot_total_goals|6.5", "over")).toBe(1.67);
      expect(price(odds, "ot_handicap|-2.5", "1")).toBe(3.8);
      expect(price(odds, "ot_team_goals@1|2.5", "over")).toBe(1.32);
    });

    it("reads each period's result, refund, double chance, totals and teams' goals", () => {
      expect(price(odds, "p1_1X2", "X")).toBe(3);
      expect(price(odds, "p2_1X2", "1")).toBe(2.55);
      expect(price(odds, "p3_draw_no_bet", "2")).toBe(1.93);
      expect(price(odds, "p2_double_chance", "1X")).toBe(1.45);
      expect(price(odds, "p1_total_goals|1.5", "under")).toBe(2.08);
      expect(price(odds, "p3_team_goals@2|1.5", "over")).toBe(2.85);
    });

    it("leaves out the winner of the match, overtime and shootout included, which is the listing's", () => {
      expect(markets(odds).some((m) => /winner|moneyline/i.test(m))).toBe(false);
    });
  });

  describe("a rugby union match", () => {
    const odds = readAll("rugby-union");

    it("reads the handicap and the total in points, and the halves' result and handicap", () => {
      expect(known(odds)).toBe(true);
      expect(price(odds, "spread|4.5", "1")).toBe(1.72);
      expect(price(odds, "total_points|56.5", "over")).toBe(1.72);
      expect(price(odds, "ht_1X2", "X")).toBe(12);
      expect(price(odds, "2h_1X2", "2")).toBe(1.68);
      expect(price(odds, "ht_spread|2.5", "2")).toBe(1.77);
      expect(price(odds, "2h_spread|1.5", "1")).toBe(1.92);
    });

    it("leaves out the 3-way handicaps, the margins, the first try and the other bets", () => {
      expect(markets(odds).sort()).toEqual(["2h_1X2", "2h_spread|1.5", "ht_1X2", "ht_spread|2.5", "spread|4.5", "total_points|56.5"]);
    });
  });

  describe("an American football match", () => {
    const odds = readAll("american-football");

    it("reads the spread and the totals, overtime included, as the plain families", () => {
      expect(known(odds)).toBe(true);
      expect(price(odds, "spread|5.5", "1")).toBe(1.43);
      expect(price(odds, "spread|5.5", "2")).toBe(2.17);
      expect(price(odds, "total_points|43.5", "over")).toBe(2.1);
      expect(price(odds, "team_points@1|19.5", "over")).toBe(1.88);
      expect(price(odds, "team_points@2|20.5", "under")).toBe(1.94);
      expect(price(odds, "overtime", "yes")).toBe(12);
    });

    it("reads each half's and each quarter's result, refund, spread and totals", () => {
      expect(price(odds, "ht_1X2", "X")).toBe(9.5);
      expect(price(odds, "ht_draw_no_bet", "2")).toBe(1.76);
      expect(price(odds, "ht_spread|1.5", "1")).toBe(1.6);
      expect(price(odds, "ht_total_points|20.5", "over")).toBe(1.83);
      expect(price(odds, "q1_1X2", "X")).toBe(4.1);
      expect(price(odds, "q1_spread|1.5", "2")).toBe(2.38);
      expect(price(odds, "q1_total_points|7.5", "over")).toBe(2.08);
      expect(price(odds, "q1_team_points@2|3.5", "over")).toBe(2.18);
    });

    it("reads the second half's overtime-included bets only", () => {
      expect(price(odds, "2h_total_points|19.5", "over")).toBe(1.82);
      expect(price(odds, "2h_spread|1.5", "2")).toBe(2.04);
      expect(price(odds, "2h_1X2", "X")).toBe(10.5);
    });

    it("leaves out the touchdowns, the field goals, the margins and the players' yards", () => {
      expect(markets(odds).every((m) => /points|spread|1X2|draw_no_bet|overtime/.test(m))).toBe(true);
    });
  });

  describe("a handball match", () => {
    const odds = readAll("handball");

    it("reads the handicap, the totals, the refund, the double chance and the first half's", () => {
      expect(known(odds)).toBe(true);
      expect(price(odds, "handicap|5.5", "1")).toBe(1.78);
      expect(price(odds, "total_goals|63.5", "over")).toBe(1.74);
      expect(price(odds, "team_goals@1|28.5", "over")).toBe(1.74);
      expect(price(odds, "team_goals@2|34.5", "under")).toBe(1.86);
      expect(price(odds, "draw_no_bet", "2")).toBe(1.06);
      expect(price(odds, "double_chance", "X2")).toBe(1.01);
      expect(price(odds, "ht_1X2", "2")).toBe(1.29);
      expect(price(odds, "ht_handicap|2.5", "1")).toBe(1.98);
      expect(price(odds, "ht_total_goals|31.5", "under")).toBe(1.76);
    });

    it("leaves out the three-way handicap, which is another bet", () => {
      expect(markets(odds).some((m) => m.startsWith("handicap|6"))).toBe(false);
    });
  });
});

describe("readPmuMarkets, an answer of several matches", () => {
  it("reads each match's offers with its own teams", () => {
    const both: PmuEventsReply = {
      events: [...FOOTBALL.events, ...TENNIS.events],
      betOffers: [...FOOTBALL.betOffers, ...TENNIS.betOffers],
    };
    const markets = readPmuMarkets(both);
    expect([...markets.keys()].sort()).toEqual([FOOTBALL_ID, TENNIS_ID].sort());
    expect(price(markets.get(FOOTBALL_ID)!, "total_goals|2.5", "over")).toBe(1.61);
    expect(price(markets.get(TENNIS_ID)!, "total_games|22.5", "over")).toBe(2.48);
  });

  it("reads nothing of a sport it has no markets for", () => {
    const rugby: PmuEventsReply = {
      events: [{ ...FOOTBALL.events[0], sport: "SNOOKER" }],
      betOffers: FOOTBALL.betOffers,
    };
    expect(readPmuMarkets(rugby).get(FOOTBALL_ID) ?? []).toEqual([]);
  });

  it("reads nothing of an answer without matches", () => {
    expect([...readPmuMarkets({ events: [], betOffers: [] })]).toEqual([]);
    expect([...readPmuMarkets({} as PmuEventsReply)]).toEqual([]);
  });

  it("leaves out an offer that cannot be read without losing the others", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const broken = { ...FOOTBALL, betOffers: [{ eventId: FOOTBALL.events[0].id }, null, ...FOOTBALL.betOffers] } as unknown as PmuEventsReply;
    expect(price(read(broken, FOOTBALL_ID), "total_goals|2.5", "over")).toBe(1.61);
    warn.mockRestore();
  });
});

describe("fetchPmuMarkets", () => {
  const BASE = "https://eu.offering-api.kambicdn.com/offering/v2018/pmusportsfr/betoffer/event/";
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const idsOf = (url: string) => url.slice(BASE.length).split(".json")[0].split(",");

  // The API as it answers: the offers of the matches it was asked for.
  function api(overrides: (ids: string[]) => Response | undefined = () => undefined) {
    return vi.fn(async (url: string) => {
      const ids = idsOf(url);
      const overridden = overrides(ids);
      if (overridden) return overridden;
      const known = [FOOTBALL, TENNIS].filter((r) => ids.includes(String(r.events[0].id)));
      return json({ events: known.flatMap((r) => r.events), betOffers: known.flatMap((r) => r.betOffers) });
    });
  }

  async function run(fetchMock: ReturnType<typeof api>, ids: string[]) {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", fetchMock);
    const promise = fetchPmuMarkets(ids);
    promise.catch(() => {});
    await vi.runAllTimersAsync();
    return promise;
  }

  it("asks for the matches a few at a time, and gives each one's markets by its id", async () => {
    const fetchMock = api();
    const ids = [FOOTBALL_ID, TENNIS_ID, ...Array.from({ length: 12 }, (_, i) => String(9000 + i))];
    const markets = await run(fetchMock, ids);

    const calls = fetchMock.mock.calls.map(([url]) => url);
    expect(calls.length).toBeGreaterThan(1);
    expect(calls.flatMap(idsOf).sort()).toEqual([...ids].sort());
    for (const url of calls) {
      expect(url).toContain("lang=fr_FR");
      expect(url).toContain("market=FR");
      expect(url).toContain("client_id=200");
      expect(idsOf(url).length).toBeLessThanOrEqual(10);
    }
    expect(price(markets.get(FOOTBALL_ID)!, "total_goals|2.5", "over")).toBe(1.61);
    expect(price(markets.get(TENNIS_ID)!, "total_games|22.5", "over")).toBe(2.48);
  });

  it("asks for nothing when there is no match", async () => {
    const fetchMock = api();
    expect((await run(fetchMock, [])).size).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps the other matches when one request fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // The first request holds ten of them, the second the last one.
    const ids = [FOOTBALL_ID, ...Array.from({ length: 9 }, (_, i) => String(9000 + i)), "9010"];
    const markets = await run(api((asked) => (asked.includes("9010") ? json({}, 500) : undefined)), ids);
    expect(price(markets.get(FOOTBALL_ID)!, "total_goals|2.5", "over")).toBe(1.61);
    expect(markets.has("9010")).toBe(false);
    warn.mockRestore();
  });

  it("throws when every request fails, so the cycle says the bookmaker failed", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(run(api(() => json({}, 403)), [FOOTBALL_ID, TENNIS_ID])).rejects.toThrow(/every pmu request failed/);
    warn.mockRestore();
  });
});
