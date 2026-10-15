import { RawOdds } from "../types";
import { marketKey, playerMarketKey } from "../markets/catalog";
import { MARKET_1X2 } from "./canonical";
import type { VbetEvent, VbetMarket } from "./vbet";

// Every market of a football, a tennis, a basketball, an ice hockey, an American
// football, a handball or a rugby union match at Vbet, mapped onto the shared
// catalog (src/markets/catalog.ts). Vbet gives each market a Swarm kind
// ("OverUnder", "AsianHandicap"), a line (`base`, on the market and on each of
// its outcomes) and its outcomes a type ("Over", "Home", "W1"), so a kind and
// a line say which family and which line it is, whatever its French title
// (real captures of 8/10/2026, tests/scraper/fixtures/vbet-*Markets.json.gz:
// a Ligue 1 match with 242 markets of 156 kinds, an ATP match with 49 of 31).
//
// A line is read only when it has half a goal or a game ("2.5"): a whole line
// ("2", "-1") refunds a push, a market the other bookmakers do not offer, as
// Winamax's is read (halfLinesOnly). A kind of no family, and the main market
// (the listing's own), are left out.

type Reader = (market: VbetMarket) => RawOdds[];

const isHalfLine = (line: number) => Math.abs(line % 1) === 0.5;

// A market's outcomes under a family's key, one token each; an outcome of no
// token, or without a real price, is left out.
function pick(key: string, market: VbetMarket, token: (outcome: VbetEvent) => string | undefined): RawOdds[] {
  return Object.values(market.event ?? {}).flatMap((o): RawOdds[] => {
    const selection = token(o);
    return selection !== undefined && o.price > 1 ? [{ market: key, selection, price: o.price }] : [];
  });
}

const byType = (tokens: Record<string, string>) => (o: VbetEvent) => tokens[o.type_1];

const OVER_UNDER = byType({ Over: "over", Under: "under" });
const YES_NO = byType({ Yes: "yes", No: "no" });
const HOME_AWAY = byType({ Home: "1", Away: "2" });

// An over/under market: its line is the market's.
const total =
  (family: string): Reader =>
  (market) =>
    typeof market.base === "number" && isHalfLine(market.base)
      ? pick(marketKey(family, market.base), market, OVER_UNDER)
      : [];

// A handicap with two outcomes: the line is the first team's, "Home -1.5" being
// the line -1.5 (its outcome's base, not the market's, which has no sign).
const handicap =
  (family: string): Reader =>
  (market) => {
    const home = Object.values(market.event ?? {}).find((o) => o.type_1 === "Home");
    return typeof home?.base === "number" && isHalfLine(home.base)
      ? pick(marketKey(family, home.base), market, HOME_AWAY)
      : [];
  };

const outcomes =
  (family: string, tokens: Record<string, string>): Reader =>
  (market) =>
    pick(family, market, byType(tokens));

const yesNo =
  (family: string): Reader =>
  (market) =>
    pick(family, market, YES_NO);

// Scores, named by their goals ("2-1", the home side's first).
const scores =
  (family: string): Reader =>
  (market) =>
    pick(family, market, (o) => (/^\d+-\d+$/.test(o.name.trim()) ? o.name.trim() : undefined));

const HALF_FULL_TIME: Record<string, string> = {
  "W1/W1": "1/1",
  "W1/Draw": "1/X",
  "W1/W2": "1/2",
  "Draw/W1": "X/1",
  "Draw/Draw": "X/X",
  "Draw/W2": "X/2",
  "W2/W1": "2/1",
  "W2/Draw": "2/X",
  "W2/W2": "2/2",
};

const DOUBLE_CHANCE = { "1X": "1X", "12": "12", X2: "X2" };
const GOAL_BANDS = { "0or1": "0-1", "2or3": "2-3", "4to6": "4-6", "7ormore": "7+" };
const TEAMS_OR_NONE = { Home: "1", Away: "2", NoGoal: "none" };
// A number of goals, then "and more" ("4ormore", "4+"): the family's "0" to "k-1", "k+".
const GOAL_COUNTS = {
  "0": "0",
  "1": "1",
  "2": "2",
  "3": "3",
  "4": "4",
  "5": "5",
  "4ormore": "4+",
  "4+": "4+",
  "6ormore": "6+",
};

const RESULT_TOKEN: Record<string, string> = { w1: "1", x: "X", draw: "X", w2: "2" };

// A result or a double chance and a total: "W1andOver2.5" is "1&over" of the
// result and the line 2.5, "1XandOver2.5" "1X&over" of the double chance.
const resultAndTotal: Reader = (market) =>
  Object.values(market.event ?? {}).flatMap((o): RawOdds[] => {
    const m = /^(W1|W2|X|1X|12|X2)and(over|under)(\d+(?:\.\d+)?)$/i.exec(o.type_1);
    const line = m ? Number(m[3]) : NaN;
    if (!m || !isHalfLine(line) || !(o.price > 1)) return [];
    const chance = m[1].toUpperCase();
    const double = ["1X", "12", "X2"].includes(chance);
    return [
      {
        market: marketKey(double ? "dc_total" : "result_total", line),
        selection: `${double ? chance : RESULT_TOKEN[m[1].toLowerCase()]}&${m[2].toLowerCase()}`,
        price: o.price,
      },
    ];
  });

// A double chance and both teams scoring: "1XAnd(BothToScore-Yes)" is "1X&yes".
const doubleChanceAndBtts: Reader = (market) =>
  pick("dc_btts", market, (o) => {
    const m = /^(1X|12|X2)and\(?(?:BothToScore-)?(yes|no)\)?$/i.exec(o.type_1);
    return m ? `${m[1].toUpperCase()}&${m[2].toLowerCase()}` : undefined;
  });

// Which team scores first and how the match ends: "Team1andX" is "1>X".
const firstGoalResult: Reader = (market) =>
  pick("first_goal_result", market, (o) => {
    if (o.type_1 === "NoGoal") return "none";
    const m = /^Team([12])and(W1|X|W2)$/.exec(o.type_1);
    return m ? `${m[1]}>${RESULT_TOKEN[m[2].toLowerCase()]}` : undefined;
  });

// A result and both teams scoring: "W1And(BothToScore-Yes)" is "1&yes".
const resultAndBtts =
  (family: string): Reader =>
  (market) =>
    pick(family, market, (o) => {
      const m = /^(W1|W2|X|Draw)and\(?(?:BothToScore-)?(yes|no)\)?$/i.exec(o.type_1);
      return m ? `${RESULT_TOKEN[m[1].toLowerCase()]}&${m[2].toLowerCase()}` : undefined;
    });

const FOOTBALL: Record<string, Reader> = {
  // Totals, by period and by team.
  OverUnder: total("total_goals"),
  HalfTimeOverUnder: total("ht_total_goals"),
  "2ndHalfTotalOver/Under": total("2h_total_goals"),
  Team1OverUnder: total("team_goals@1"),
  Team2OverUnder: total("team_goals@2"),
  HalfTimeTeam1OverUnder: total("ht_team_goals@1"),
  HalfTimeTeam2OverUnder: total("ht_team_goals@2"),
  SecondHalfHomeTeamTotalGoalsOverUnder: total("2h_team_goals@1"),
  SecondHalfAwayTeamTotalGoalsOverUnder: total("2h_team_goals@2"),
  // Handicaps.
  AsianHandicap: handicap("handicap"),
  HalfTimeAsianHandicap: handicap("ht_handicap"),
  "2ndHalfAsianHandicap": handicap("2h_handicap"),
  // Results by period, chances.
  HalfTimeResult: outcomes("ht_1X2", { W1: "1", X: "X", W2: "2" }),
  SecondHalfResult: outcomes("2h_1X2", { W1: "1", X: "X", W2: "2" }),
  DoubleChance: outcomes("double_chance", DOUBLE_CHANCE),
  HalfTimeDoubleChance: outcomes("ht_double_chance", DOUBLE_CHANCE),
  SecondHalfDoubleChance: outcomes("2h_double_chance", DOUBLE_CHANCE),
  DrawNoBet: outcomes("draw_no_bet", { Team1: "1", Team2: "2" }),
  HalfTimeFullTime: outcomes("ht_ft", HALF_FULL_TIME),
  // Both teams scoring.
  BothTeamsToScore: yesNo("btts"),
  "1stHalfBothTeamsToScore": yesNo("ht_btts"),
  "2ndHalfBothTeamsToScore": yesNo("2h_btts"),
  // Who scores first or last, the half with the most goals.
  FirstTeamToScore: outcomes("first_team_to_score", TEAMS_OR_NONE),
  FirstHalfFirstTeamToScore: outcomes("ht_first_team_to_score", TEAMS_OR_NONE),
  SecondHalfFirstTeamToScore: outcomes("2h_first_team_to_score", TEAMS_OR_NONE),
  LastTeamToScore: outcomes("last_team_to_score", TEAMS_OR_NONE),
  HalfWithMostGoals: outcomes("highest_scoring_half", { "1>2": "1st", "1=2": "equal", "1<2": "2nd" }),
  // Scores.
  CorrectScore: scores("correct_score"),
  HalfTimeCorrectScore: scores("ht_correct_score"),
  "2ndHalfCorrectScore": scores("2h_correct_score"),
  // Goals' counts and bands.
  TotalGoalsExact: outcomes("exact_goals", GOAL_COUNTS),
  Team1TotalGoalsExact: outcomes("team_exact_goals@1", GOAL_COUNTS),
  Team2TotalGoalsExact: outcomes("team_exact_goals@2", GOAL_COUNTS),
  HalfTimeTotalGoalsExact: outcomes("ht_exact_goals", GOAL_COUNTS),
  SecondHalfTotalGoalsExact: outcomes("2h_exact_goals", GOAL_COUNTS),
  TotalGoals: outcomes("goal_bands", GOAL_BANDS),
  HalfTimeTotalGoals: outcomes("ht_goal_bands", GOAL_BANDS),
  SecondHalfTotalGoals: outcomes("2h_goal_bands", GOAL_BANDS),
  // Combinations.
  OutcomeAndTotal15: resultAndTotal,
  OutcomeAndTotal25: resultAndTotal,
  OutcomeAndTotal35: resultAndTotal,
  OutcomeAndTotal45: resultAndTotal,
  OutcomeandBothTeamToScore: resultAndBtts("result_btts"),
  DoubleChanceAndBothTeamToScore: doubleChanceAndBtts,
  FirstTeamToScoreAndResult: firstGoalResult,
  FirstHalfOutcomeAndBothTeamToScore: resultAndBtts("ht_result_btts"),
  SecondHalfOutcomeAndBothTeamToScore: resultAndBtts("2h_result_btts"),
  // A team winning to nil, both halves, one of them; scoring in both.
  Team1ToWinToNil: yesNo("win_to_nil@1"),
  Team2ToWinToNil: yesNo("win_to_nil@2"),
  Team1WinBothHalves: yesNo("win_both_halves@1"),
  Team2WinBothHalves: yesNo("win_both_halves@2"),
  Team1ToWinatLeastOneofthehalves: yesNo("win_either_half@1"),
  Team2ToWinatLeastOneofTheHalves: yesNo("win_either_half@2"),
  "Team1ScoreBothInHalvesYes/no": yesNo("score_both_halves@1"),
  "Team2ScoreBothInHalvesYes/no": yesNo("score_both_halves@2"),
};

// A tennis set's number, from the title of its markets ("Set No.1 : Total de jeux").
const setNumber = (market: VbetMarket): number | undefined => {
  const m = /Set No\.(\d)/i.exec(market.name);
  return m ? Number(m[1]) : undefined;
};

// A market of the first set only: the catalog has the first set's markets.
const ofFirstSet =
  (reader: Reader): Reader =>
  (market) =>
    setNumber(market) === 1 ? reader(market) : [];

// "Joueur 1 - Victoire et Total de jeux": the player's win and the match's games over a line.
const winnerAndTotalGames =
  (player: "1" | "2"): Reader =>
  (market) =>
    typeof market.base === "number" && isHalfLine(market.base)
      ? pick(marketKey("winner_total_games", market.base), market, (o) =>
          o.type_1 === "Over" ? `${player}&over` : o.type_1 === "Under" ? `${player}&under` : undefined
        )
      : [];

const TENNIS: Record<string, Reader> = {
  "TotalGamesOver/Under": total("total_games"),
  Handicap: handicap("games_handicap"),
  SetsHandicap: handicap("set_handicap"),
  TotalofSets: total("total_sets"),
  "Player1:Player'sTotalofWonGames": total("player_games@1"),
  "Player2:Player'sTotalofWonGames": total("player_games@2"),
  TotalofBreaksintheMatch: total("total_breaks"),
  "Player1:TotalofBreaks": total("player_breaks@1"),
  "Player2:TotalofBreaks": total("player_breaks@2"),
  "Player1:TowinthematchandTotalofGames": winnerAndTotalGames("1"),
  "Player2:TowinthematchandTotalofGames": winnerAndTotalGames("2"),
  ThreeBet: scores("set_betting"),
  "1stSet-Match": outcomes("set1_match", { "W1/W1": "1/1", "W1/W2": "1/2", "W2/W1": "2/1", "W2/W2": "2/2" }),
  "InSet6:0or0:6": yesNo("bagel"),
  SetWinner: (market) =>
    setNumber(market) === 1 || setNumber(market) === 2
      ? outcomes(`set${setNumber(market)}_winner`, { W1: "1", W2: "2" })(market)
      : [],
  SetOverUnder: ofFirstSet(total("set1_total_games")),
  SetHandicap: ofFirstSet(handicap("set1_games_handicap")),
  SetScore: ofFirstSet(scores("set1_correct_score")),
};

// Basketball (a Euroleague match: 108 markets, 9/10/2026,
// tests/scraper/fixtures/vbet-BasketballMarkets.json.gz). "MatchWinner2", the
// winner overtime included, is the listing's; the result in regular time
// ("MatchWinner3") has a draw. The match's own markets are overtime included.
// A half or a quarter has its kind and its number in its name ("Mi-temps
// No.1", "Quart-temps No.3"); Vbet's first half also is "1re Mi-temps".
const halfPrefix = (market: VbetMarket) =>
  /No\.1\b|^1re Mi-temps/i.test(market.name) ? "ht_" : /No\.2\b|^2e Mi-temps/i.test(market.name) ? "2h_" : undefined;
const quarterPrefix = (market: VbetMarket) => {
  const n = Number(/No\.(\d)\b/.exec(market.name)?.[1]);
  return n >= 1 && n <= 4 ? `q${n}_` : undefined;
};
const inPeriod =
  (prefixOf: (market: VbetMarket) => string | undefined, build: (prefix: string) => Reader): Reader =>
  (market) => {
    const prefix = prefixOf(market);
    return prefix === undefined ? [] : build(prefix)(market);
  };
const inHalf = (build: (prefix: string) => Reader) => inPeriod(halfPrefix, build);
const inQuarter = (build: (prefix: string) => Reader) => inPeriod(quarterPrefix, build);

const RESULT_3WAY = { W1: "1", X: "X", W2: "2" };
const RESULT_2WAY = { W1: "1", W2: "2" };

// The team a market is about: the "Team 1" or "Team 2" of its name, which follow the
// order of the game's teams. The kind's "Home" and "Away" are the real home and away
// teams, and an American game lists its away team first: its "AwayTeamTotalPoints"
// is Team 1's (NFL, Denver Broncos - Seattle Seahawks, 14/10/2026: the 19.5 points of
// "Team 1" are Denver's at NetBet). A handicap's outcomes, "Home" and "Away", follow
// the order of the teams in every sport seen.
const teamOf = (market: VbetMarket): "1" | "2" | undefined => {
  const team = /\bTeam ([12])\b/.exec(market.name)?.[1];
  return team === "1" || team === "2" ? team : undefined;
};

// A team's total (over and under one line), the family's side the market's own.
// `fallback` is the side to take when the name does not say.
const teamTotal =
  (family: string, fallback?: "1" | "2"): Reader =>
  (market) => {
    const team = teamOf(market) ?? fallback;
    return team ? total(`${family}@${team}`)(market) : [];
  };

// "W1 et plus de": the winner and the match's points over the market's line.
const winnerAndTotalPoints: Reader = (market) =>
  typeof market.base === "number" && isHalfLine(market.base)
    ? pick(
        marketKey("winner_total", market.base),
        market,
        byType({ W1andOver: "1&over", W1andUnder: "1&under", W2andOver: "2&over", W2andUnder: "2&under" })
      )
    : [];

// A player's ladder, a market a threshold with every player as an outcome
// ("PlayerToScore20orMorePoints"): "20 or more" is the over of 19.5.
const PLAYER_LADDERS: ReadonlyArray<readonly [RegExp, string]> = [
  [/^PlayerToScore(\d+)orMorePoints$/, "player_points"],
  [/^PlayerToRecord(\d+)orMoreRebounds$/, "player_rebounds"],
  [/^PlayerToRecord(\d+)orMoreAssists$/, "player_assists"],
  [/^PlayerMade(\d+)orMoreThree-Points$/, "player_threes"],
];

function readPlayerLadder(market: VbetMarket): RawOdds[] {
  for (const [kind, family] of PLAYER_LADDERS) {
    const threshold = Number(kind.exec(market.market_type)?.[1]);
    if (!(threshold > 0)) continue;
    return Object.values(market.event ?? {}).flatMap((o): RawOdds[] =>
      o.name.trim() && o.price > 1
        ? [{ market: playerMarketKey(family, o.name, threshold - 0.5), selection: "over", price: o.price }]
        : []
    );
  }
  return [];
}

const BASKETBALL: Record<string, Reader> = {
  TopPointsScorer: (market) => pick("top_scorer", market, (o) => o.name.trim() || undefined),
  MatchWinner3: outcomes(MARKET_1X2, RESULT_3WAY),
  MatchHandicap: handicap("spread"),
  MatchTotal: total("total_points"),
  MatchHomeTeamTotal2: teamTotal("team_points", "1"),
  MatchAwayTeamTotal2: teamTotal("team_points", "2"),
  MatchWinnerAndTotalPoints: winnerAndTotalPoints,
  "1stHalf/FullTime": outcomes("ht_ft", HALF_FULL_TIME),
  HighestScoringQuarter: outcomes("highest_quarter", {
    "1stQuarter": "q1",
    "2ndQuarter": "q2",
    "3rdQuarter": "q3",
    "4thQuarter": "q4",
    Tie: "tie",
  }),
  HighestScoringHalf: outcomes("highest_half", { "1stHalf": "1st", "2ndHalf": "2nd", Tie: "tie" }),
  ToWinBothHalvesTeam1: yesNo("win_both_halves@1"),
  ToWinBothHalvesTeam2: yesNo("win_both_halves@2"),
  // A half's "Vainqueur (2 choix)" is the refund on a draw.
  HalfWinner3: inHalf((prefix) => outcomes(`${prefix}1X2`, RESULT_3WAY)),
  HalfWinner2: inHalf((prefix) => outcomes(`${prefix}draw_no_bet`, { W1: "1", W2: "2" })),
  HalfHandicap: inHalf((prefix) => handicap(`${prefix}spread`)),
  HalfTotal: inHalf((prefix) => total(`${prefix}total_points`)),
  HalfHomeTeamTotal2: inHalf((prefix) => teamTotal(`${prefix}team_points`, "1")),
  HalfAwayTeamTotal2: inHalf((prefix) => teamTotal(`${prefix}team_points`, "2")),
  QuarterHandicap: inQuarter((prefix) => handicap(`${prefix}spread`)),
  QuarterTotal: inQuarter((prefix) => total(`${prefix}total_points`)),
  QuarterHomeTeamTotal2: inQuarter((prefix) => teamTotal(`${prefix}team_points`, "1")),
  QuarterAwayTeamTotal2: inQuarter((prefix) => teamTotal(`${prefix}team_points`, "2")),
};

// --- ice hockey, American football, handball, rugby union (real captures of
// 14/10/2026, tests/scraper/fixtures/vbet-{IceHockey,AmericanFootball,Handball,
// RugbyUnion}Markets.json.gz: an NHL match with 153 markets, an NFL one with 176, a
// Champions League handball one with 35, a Mitre 10 Cup rugby one with 45). The same
// kind can mean another market from one sport to the next ("HalfWinner" is the
// handball's result and the rugby's refund on a draw): each sport has its table. ---

// A market that says in its name which time it is about, read only for that one: a
// hockey match's "(Temps réglementaire)" is the plain families', an American football
// match's "(Y compris la Prolongation)" the points' (the unmarked bet, whose time is
// not known, is left out).
const named =
  (time: RegExp) =>
  (reader: Reader): Reader =>
  (market) =>
    time.test(market.name) ? reader(market) : [];
const inRegularTime = named(/Temps réglementaire/i);
const withOvertime = named(/Prolongation/i);

// An ice hockey period: "Période No.1" to "Période No.3", the overtime having none.
const periodPrefix = (market: VbetMarket) => {
  const n = /Période No\.([1-3])\b/.exec(market.name)?.[1];
  return n ? `p${n}_` : undefined;
};
const inPeriodOfHockey = (build: (prefix: string) => Reader) => inPeriod(periodPrefix, build);

// American football's first half: the second half's bets do not say whether the
// overtime is in, and its "Mi-temps No.2" is left out.
const firstHalfPrefix = (market: VbetMarket) => (/No\.1\b|^1re Mi-temps/i.test(market.name) ? "ht_" : undefined);
const inFirstHalf = (build: (prefix: string) => Reader) => inPeriod(firstHalfPrefix, build);

const ICE_HOCKEY: Record<string, Reader> = {
  MatchHandicap2: inRegularTime(handicap("handicap")),
  MatchTotal2: inRegularTime(total("total_goals")),
  HomeTeamTotal: inRegularTime(teamTotal("team_goals")),
  AwayTeamTotal: inRegularTime(teamTotal("team_goals")),
  DoubleChance: inRegularTime(outcomes("double_chance", DOUBLE_CHANCE)),
  BothTeamsToScore: inRegularTime(yesNo("btts")),
  PeriodWinner3: inPeriodOfHockey((prefix) => outcomes(`${prefix}1X2`, RESULT_3WAY)),
  PeriodDoubleChance: inPeriodOfHockey((prefix) => outcomes(`${prefix}double_chance`, DOUBLE_CHANCE)),
  PeriodHandicap2: inPeriodOfHockey((prefix) => handicap(`${prefix}handicap`)),
  PeriodTotal2: inPeriodOfHockey((prefix) => total(`${prefix}total_goals`)),
  PeriodHomeTeamTotal: inPeriodOfHockey((prefix) => teamTotal(`${prefix}team_goals`)),
  PeriodAwayTeamTotal: inPeriodOfHockey((prefix) => teamTotal(`${prefix}team_goals`)),
};

const AMERICAN_FOOTBALL: Record<string, Reader> = {
  MatchHandicap: withOvertime(handicap("spread")),
  MatchTotal: withOvertime(total("total_points")),
  HomeTeamTotalPoints: withOvertime(teamTotal("team_points")),
  AwayTeamTotalPoints: withOvertime(teamTotal("team_points")),
  // A quarter's and the first half's "Vainqueur" refunds a draw, its "(3 Choix)" has one.
  QuarterWinner: inQuarter((prefix) => outcomes(`${prefix}draw_no_bet`, RESULT_2WAY)),
  "QuarterWinner(3Way)": inQuarter((prefix) => outcomes(`${prefix}1X2`, RESULT_3WAY)),
  QuarterHandicap: inQuarter((prefix) => handicap(`${prefix}spread`)),
  QuarterTotal: inQuarter((prefix) => total(`${prefix}total_points`)),
  HalfWinner: inFirstHalf((prefix) => outcomes(`${prefix}draw_no_bet`, RESULT_2WAY)),
  "HalfWinner(3Way)": inFirstHalf((prefix) => outcomes(`${prefix}1X2`, RESULT_3WAY)),
  HalfHandicap: inFirstHalf((prefix) => handicap(`${prefix}spread`)),
  HalfTotal: inFirstHalf((prefix) => total(`${prefix}total_points`)),
};

// "W1H" is a home lead at half-time and a draw at full time ("1/X"), "HW2" the reverse.
const HANDBALL_HALF_FULL_TIME = Object.fromEntries(
  (["W1", "H", "W2"] as const).flatMap((half) =>
    (["W1", "H", "W2"] as const).map((full) => {
      const token = (code: string) => (code === "W1" ? "1" : code === "W2" ? "2" : "X");
      return [`${half}${full}`, `${token(half)}/${token(full)}`];
    })
  )
);

const HANDBALL: Record<string, Reader> = {
  MatchHandicap2: handicap("handicap"),
  MatchTotal2: total("total_goals"),
  HomeTeamTotal2: teamTotal("team_goals"),
  AwayTeamTotal2: teamTotal("team_goals"),
  "Half-time/Full-time": outcomes("ht_ft", HANDBALL_HALF_FULL_TIME),
  HalfWinner: inHalf((prefix) => outcomes(`${prefix}1X2`, RESULT_3WAY)),
  HalfWinner2: inHalf((prefix) => outcomes(`${prefix}draw_no_bet`, RESULT_2WAY)),
  HalfHandicap2: inHalf((prefix) => handicap(`${prefix}handicap`)),
  HalfTotal2: inHalf((prefix) => total(`${prefix}total_goals`)),
  HalfHomeTeamTotal2: inHalf((prefix) => teamTotal(`${prefix}team_goals`)),
  HalfAwayTeamTotal2: inHalf((prefix) => teamTotal(`${prefix}team_goals`)),
  HigherScoringHalf: outcomes("highest_scoring_half", { FirstOverSecond: "1st", FirstEqualSecond: "equal", FirstUnderSecond: "2nd" }),
};

const RUGBY_UNION: Record<string, Reader> = {
  "MatchResult(DrawNoBet)": outcomes("draw_no_bet", RESULT_2WAY),
  "Handicap(NoDraw)": handicap("spread"),
  "TotalPointsOver/Under": total("total_points"),
  HalfResult3way: inHalf((prefix) => outcomes(`${prefix}1X2`, RESULT_3WAY)),
  HalfWinner: inHalf((prefix) => outcomes(`${prefix}draw_no_bet`, RESULT_2WAY)),
  HalfHandicap: inHalf((prefix) => handicap(`${prefix}spread`)),
  "HalfTotalPointsOver/Under": inHalf((prefix) => total(`${prefix}total_points`)),
  HalfTeam1TotalPoints: inHalf((prefix) => teamTotal(`${prefix}team_points`, "1")),
  HalfTeam2TotalPoints: inHalf((prefix) => teamTotal(`${prefix}team_points`, "2")),
};

// The kinds asked for: only those a family covers (a football match has about
// 240 markets, its main market, listed beside, is the listing's).
export const MARKET_KINDS: string[] = [
  ...new Set([
    ...Object.keys(FOOTBALL),
    ...Object.keys(TENNIS),
    ...Object.keys(ICE_HOCKEY),
    ...Object.keys(AMERICAN_FOOTBALL),
    ...Object.keys(HANDBALL),
    ...Object.keys(RUGBY_UNION),
  ]),
];

const readWith = (table: Record<string, Reader>, markets: readonly VbetMarket[]): RawOdds[] =>
  markets.flatMap((market) => table[market.market_type]?.(market) ?? []);

export const readSoccerMarkets = (markets: readonly VbetMarket[]): RawOdds[] => readWith(FOOTBALL, markets);
export const readTennisMarkets = (markets: readonly VbetMarket[]): RawOdds[] => readWith(TENNIS, markets);
export const readBasketballMarkets = (markets: readonly VbetMarket[]): RawOdds[] =>
  markets.flatMap((market) => BASKETBALL[market.market_type]?.(market) ?? readPlayerLadder(market));
export const readIceHockeyMarkets = (markets: readonly VbetMarket[]): RawOdds[] => readWith(ICE_HOCKEY, markets);
export const readAmericanFootballMarkets = (markets: readonly VbetMarket[]): RawOdds[] => readWith(AMERICAN_FOOTBALL, markets);
export const readHandballMarkets = (markets: readonly VbetMarket[]): RawOdds[] => readWith(HANDBALL, markets);
export const readRugbyUnionMarkets = (markets: readonly VbetMarket[]): RawOdds[] => readWith(RUGBY_UNION, markets);
