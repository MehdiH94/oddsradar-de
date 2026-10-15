import { describe, it, expect } from "vitest";
import {
  compareMarketKeys,
  compareOutcomes,
  coversEveryCase,
  FAMILIES,
  familiesOf,
  hasCases,
  mainSectionOf,
  MARKET_SPORTS,
  PLAYER_FAMILIES,
  sectionsOf,
  marketLabel,
  familyOf,
  golfBestOf,
  outcomeLabel,
  parseMarketKey,
  playerMarketKey,
  swapMarketKey,
  swapOutcome,
  unrecognizedMarketKey,
  winnersOf,
} from "../../src/markets/catalog";
import { isMainTour } from "../../src/markets/tennis";

const teams = ["Borussia Dortmund", "Werder Brême"];

describe("market keys", () => {
  it("reads a family and its line back", () => {
    expect(parseMarketKey("total_goals|2.5")).toEqual({ kind: "family", family: familyOf("total_goals"), line: 2.5 });
    expect(parseMarketKey("btts")).toEqual({ kind: "family", family: familyOf("btts") });
  });

  it("keeps a bookmaker's own market apart, whatever its name", () => {
    expect(parseMarketKey(unrecognizedMarketKey("winamax", "Écart de buts|Dortmund (-1,5)"))).toEqual({
      kind: "unrecognized",
      bookmaker: "winamax",
      name: "Écart de buts|Dortmund (-1,5)",
    });
    expect(parseMarketKey("bc:Minute du premier but")).toMatchObject({ kind: "unrecognized", bookmaker: "betclic" });
  });

  it("does not read a family without its line, or with one it has no use for, as that family", () => {
    expect(parseMarketKey("total_goals")).toEqual({ kind: "other", name: "total_goals" });
    expect(parseMarketKey("btts|2.5")).toEqual({ kind: "other", name: "btts|2.5" });
    expect(parseMarketKey("Vainqueur du match")).toEqual({ kind: "other", name: "Vainqueur du match" });
  });

  it("has one family per key", () => {
    expect(new Set(FAMILIES.map((f) => f.key)).size).toBe(FAMILIES.length);
  });
});

describe("whether a market's outcomes cover every case", () => {
  it("knows the cases of every complete family", () => {
    expect(FAMILIES.filter((f) => f.complete && !hasCases(f.key)).map((f) => f.key)).toEqual([]);
  });

  it("wants every one of a fixed set", () => {
    expect(coversEveryCase("1X2", ["1", "X", "2"])).toBe(true);
    expect(coversEveryCase("ht_1X2", ["1", "2"])).toBe(false);
    expect(coversEveryCase("clean_sheet@2", ["yes", "no"])).toBe(true);
    expect(coversEveryCase("handicap", ["1"])).toBe(false);
  });

  it("wants numbers of goals from none to the last one's \"or more\"", () => {
    expect(coversEveryCase("2h_exact_goals", ["0", "1", "2+"])).toBe(true);
    // "2+" closed: 0 and 1 alone would add up to a false surebet.
    expect(coversEveryCase("2h_exact_goals", ["0", "1"])).toBe(false);
    expect(coversEveryCase("exact_goals", ["0", "2", "3+"])).toBe(false);
  });

  it("wants bands side by side, goals from 0 and minutes from the 1st to the 90th", () => {
    expect(coversEveryCase("goal_bands", ["0-1", "2-3", "4-6", "7+"])).toBe(true);
    expect(coversEveryCase("goal_bands", ["0-1", "4-6", "7+"])).toBe(false);
    const quarters = ["1-15", "16-30", "31-45", "46-60", "61-75", "76-90"];
    expect(coversEveryCase("first_goal_minute_15", [...quarters, "none"])).toBe(true);
    expect(coversEveryCase("first_goal_minute_15", quarters)).toBe(false);
    expect(coversEveryCase("first_goal_minute_15", ["1-15", "16-30", "none"])).toBe(false);
  });

  it("never for a family whose outcomes overlap", () => {
    expect(coversEveryCase("double_chance", ["1X", "12", "X2"])).toBe(false);
    expect(coversEveryCase("penalty_goal", ["1", "2", "any", "both", "none"])).toBe(false);
  });
});

describe("turning a bookmaker's outcomes round", () => {
  it("swaps the teams of results, double chances and combinations", () => {
    expect(swapOutcome("1X2", "1")).toBe("2");
    expect(swapOutcome("1X2", "X")).toBe("X");
    expect(swapOutcome("double_chance", "1X")).toBe("X2");
    expect(swapOutcome("double_chance", "12")).toBe("12");
    expect(swapOutcome("ht_ft", "1/X")).toBe("2/X");
    expect(swapOutcome("dc_total", "X2&over")).toBe("1X&over");
    expect(swapOutcome("result_btts", "2&no")).toBe("1&no");
    expect(swapOutcome("first_goal_result", "1>2")).toBe("2>1");
    expect(swapOutcome("first_team_to_score", "none")).toBe("none");
  });

  it("swaps only the team of a winning margin, not its goals", () => {
    expect(swapOutcome("winning_margin", "1:2")).toBe("2:2");
    expect(swapOutcome("winning_margin", "2:3+")).toBe("1:3+");
    expect(swapOutcome("winning_margin", "X")).toBe("X");
  });

  it("reverses scores, keeping multichance ones sorted", () => {
    expect(swapOutcome("correct_score", "2-1")).toBe("1-2");
    expect(swapOutcome("correct_score", "other")).toBe("other");
    expect(swapOutcome("multi_score", "1-0,2-0,3-0")).toBe("0-1,0-2,0-3");
    expect(swapOutcome("multi_score", "other@1")).toBe("other@2");
  });

  it("leaves goals, lines and players alone", () => {
    expect(swapOutcome("exact_goals", "2")).toBe("2");
    expect(swapOutcome("total_goals", "over")).toBe("over");
    expect(swapOutcome("anytime_scorer", "Serhou Guirassy")).toBe("Serhou Guirassy");
  });

  it("gives a team's own market to the other team", () => {
    expect(swapMarketKey("team_goals@1|2.5")).toBe("team_goals@2|2.5");
    expect(swapMarketKey("clean_sheet@2")).toBe("clean_sheet@1");
    expect(swapMarketKey("total_goals|2.5")).toBe("total_goals|2.5");
    expect(swapMarketKey("wx:Buts de Dortmund@1")).toBe("wx:Buts de Dortmund@1");
  });

  it("turns a handicap into the other team's: the line changes sign, the side team", () => {
    // The first team -1.5 is the second team +1.5.
    expect(swapMarketKey("handicap|-1.5")).toBe("handicap|1.5");
    expect(swapMarketKey("ht_handicap|0.5")).toBe("ht_handicap|-0.5");
    expect(swapOutcome("handicap", "1")).toBe("2");
    expect(swapOutcome("handicap", "2")).toBe("1");
  });

  it("swaps who scores a penalty, not whether both or none do", () => {
    expect(swapOutcome("penalty_goal", "1")).toBe("2");
    expect(swapOutcome("header_goal", "no@2")).toBe("no@1");
    expect(swapOutcome("penalty_goal", "any")).toBe("any");
    expect(swapOutcome("penalty_goal", "none")).toBe("none");
  });
});

describe("basketball's markets", () => {
  it("lists a match's markets after its result, then those one bookmaker only has", () => {
    expect(MARKET_SPORTS).toContain("basketball");
    expect(sectionsOf("basketball").map((s) => s.key)).toEqual(
      expect.arrayContaining(["result", "points", "half", "second_half", "quarters", "winamax", "betclic"])
    );
    expect(sectionsOf("basketball").at(-1)?.key).toBe("betclic");
    expect(mainSectionOf("basketball")).toBe("result");
  });

  it("has a family for the handicap, the totals, the overtime and each period's result, handicap and totals", () => {
    const keys = familiesOf("basketball").map((f) => f.key);
    expect(keys).toEqual(
      expect.arrayContaining([
        "1X2",
        "draw_no_bet",
        "spread",
        "overtime",
        "total_points",
        "team_points@1",
        "team_points@2",
        "winner_total",
        "ht_1X2",
        "ht_spread",
        "2h_total_points",
        "ht_team_points@2",
        "q1_1X2",
        "q4_draw_no_bet",
        "q2_spread",
        "q3_total_points",
        "q1_team_points@1",
      ])
    );
    // A family of football's goals is not basketball's: its points are its own.
    expect(keys).not.toContain("total_goals");
    expect(familiesOf("football").map((f) => f.key)).not.toContain("spread");
    expect(familyOf("total_points")).toMatchObject({ sport: "basketball", hasLine: true, complete: true, swap: "none" });
    expect(familyOf("spread")).toMatchObject({ section: "result", swap: "handicap", hasLine: true });
    expect(familyOf("q2_spread")).toMatchObject({ section: "quarters" });
    expect(familyOf("2h_total_points")).toMatchObject({ section: "second_half" });
    expect(familyOf("total_points")).toMatchObject({ section: "points" });
  });

  it("covers every case of a handicap, an over/under and a winner and total", () => {
    expect(coversEveryCase("spread", ["1", "2"])).toBe(true);
    expect(coversEveryCase("q3_spread", ["1"])).toBe(false);
    expect(coversEveryCase("ht_total_points", ["over", "under"])).toBe(true);
    expect(coversEveryCase("q1_team_points@2", ["over"])).toBe(false);
    expect(coversEveryCase("winner_total", ["1&over", "1&under", "2&over", "2&under"])).toBe(true);
    expect(coversEveryCase("winner_total", ["1&over", "2&under"])).toBe(false);
    expect(coversEveryCase("overtime", ["yes", "no"])).toBe(true);
    expect(coversEveryCase("q2_1X2", ["1", "X", "2"])).toBe(true);
  });

  it("names the markets in French, with points, and the handicaps by the margin", () => {
    const teams = ["Barcelone", "Zalgiris"];
    expect(marketLabel(familyOf("spread")!, teams, -6.5)).toBe("Handicap : Barcelone -6,5");
    expect(marketLabel(familyOf("total_points")!, teams, 174.5)).toBe("Nombre de points (174,5 points)");
    expect(marketLabel(familyOf("team_points@2")!, teams, 85.5)).toBe("Points de Zalgiris (85,5 points)");
    expect(marketLabel(familyOf("q1_total_points")!, teams, 42.5)).toBe("Nombre de points du 1er quart-temps (42,5 points)");
    expect(marketLabel(familyOf("q3_spread")!, teams, 0.5)).toBe("Handicap du 3e quart-temps : Barcelone +0,5");
    expect(marketLabel(familyOf("2h_team_points@1")!, teams, 44.5)).toBe("Points de Barcelone en 2e mi-temps (44,5 points)");
    expect(outcomeLabel("spread", "1", teams, -6.5)).toBe("Barcelone gagne par 7 points ou plus");
    expect(outcomeLabel("spread", "2", teams, -6.5)).toBe("Zalgiris ne perd pas, ou perd par 6 points au plus");
    expect(outcomeLabel("spread", "2", teams, 0.5)).toBe("Zalgiris gagne");
    expect(outcomeLabel("total_points", "over", teams, 174.5)).toBe("Plus de 174,5");
    expect(outcomeLabel("winner_total", "2&under", teams, 174.5)).toBe("Zalgiris & Moins de 174,5");
    expect(outcomeLabel("overtime", "yes", teams)).toBe("Oui");
  });

  it("gives a team's points to the other team, and turns a handicap and its line round", () => {
    expect(swapMarketKey("team_points@1|87.5")).toBe("team_points@2|87.5");
    expect(swapMarketKey("q2_team_points@2|21.5")).toBe("q2_team_points@1|21.5");
    expect(swapMarketKey("q1_spread|-0.5")).toBe("q1_spread|0.5");
    expect(swapMarketKey("2h_spread|2.5")).toBe("2h_spread|-2.5");
    expect(swapMarketKey("total_points|174.5")).toBe("total_points|174.5");
    expect(swapOutcome("spread", "1")).toBe("2");
    expect(swapOutcome("winner_total", "1&over")).toBe("2&over");
    expect(swapOutcome("q1_1X2", "1")).toBe("2");
    expect(swapOutcome("q1_1X2", "X")).toBe("X");
    expect(swapOutcome("overtime", "yes")).toBe("yes");
  });

  it("has the quarter and the half with the most points, a tie being the last outcome", () => {
    const teams = ["Barcelone", "Zalgiris"];
    expect(coversEveryCase("highest_quarter", ["q1", "q2", "q3", "q4", "tie"])).toBe(true);
    expect(coversEveryCase("highest_quarter", ["q1", "q2", "q3", "q4"])).toBe(false);
    expect(coversEveryCase("highest_half", ["1st", "2nd", "tie"])).toBe(true);
    expect(outcomeLabel("highest_quarter", "q3", teams)).toBe("3e quart-temps");
    expect(outcomeLabel("highest_quarter", "tie", teams)).toBe("Égalité");
    expect(outcomeLabel("highest_half", "1st", teams)).toBe("1re mi-temps");
    const outcomes = ["tie", "q4", "q1", "q3", "q2"];
    expect(outcomes.sort((a, b) => compareOutcomes("highest_quarter", a, b))).toEqual(["q1", "q2", "q3", "q4", "tie"]);
  });

  it("reads a period's key and line back", () => {
    expect(parseMarketKey("q4_spread|-1.5")).toEqual({ kind: "family", family: familyOf("q4_spread"), line: -1.5 });
    expect(parseMarketKey("ht_total_points|87.5")).toEqual({ kind: "family", family: familyOf("ht_total_points"), line: 87.5 });
    expect(parseMarketKey("overtime")).toEqual({ kind: "family", family: familyOf("overtime") });
  });

  it("reads the result in regular time (a draw is possible) as the 1X2 of any match", () => {
    expect(parseMarketKey("1X2")).toEqual({ kind: "family", family: familyOf("1X2") });
    expect(coversEveryCase("1X2", ["1", "X", "2"])).toBe(true);
  });

  it("turns the winner of the match round, though it is no family: only its teams swap", () => {
    expect(swapOutcome("Vainqueur du match", "1")).toBe("2");
    expect(swapOutcome("Vainqueur du match", "2")).toBe("1");
    expect(swapMarketKey("Vainqueur du match")).toBe("Vainqueur du match");
  });
});

describe("basketball's players' markets", () => {
  const teams = ["Barcelone", "Zalgiris"];

  it("has a section for each statistic, after the quarters", () => {
    expect(sectionsOf("basketball").map((s) => s.key)).toEqual([
      "result",
      "points",
      "half",
      "second_half",
      "quarters",
      "p_points",
      "p_rebounds",
      "p_assists",
      "p_threes",
      "p_combos",
      "p_best",
      "winamax",
      "betclic",
    ]);
  });

  it("makes a market of each player and line, whose key carries the player", () => {
    expect(playerMarketKey("player_points", "LeBron James", 27.5)).toBe("player_points#LeBron James|27.5");
    expect(playerMarketKey("player_points", "  Luka   Dončić ")).toBe("player_points#Luka Dončić");
    // The key's own separators can't be a player's.
    expect(playerMarketKey("player_points", "A|B#C", 1.5)).toBe("player_points#A B C|1.5");
    expect(parseMarketKey("player_points#LeBron James|27.5")).toEqual({
      kind: "family",
      family: familyOf("player_points"),
      line: 27.5,
      player: "LeBron James",
    });
  });

  it("is no family without its player, nor a player's market of another family", () => {
    expect(parseMarketKey("player_points|27.5")).toEqual({ kind: "other", name: "player_points|27.5" });
    expect(parseMarketKey("player_points#|27.5")).toEqual({ kind: "other", name: "player_points#|27.5" });
    expect(parseMarketKey("total_points#LeBron James|174.5")).toEqual({ kind: "other", name: "total_points#LeBron James|174.5" });
    expect(parseMarketKey("player_points#LeBron James")).toEqual({ kind: "other", name: "player_points#LeBron James" });
  });

  it("covers every case of a player's over/under, and none of a ladder's over alone", () => {
    for (const stat of ["points", "rebounds", "assists", "threes", "pra", "pr", "pa", "ra"]) {
      expect(familyOf(`player_${stat}`), stat).toMatchObject({ sport: "basketball", hasLine: true, complete: true, perPlayer: true });
      expect(coversEveryCase(`player_${stat}`, ["over", "under"]), stat).toBe(true);
      expect(coversEveryCase(`player_${stat}`, ["over"]), stat).toBe(false);
    }
  });

  it("names a card after its player, in French", () => {
    expect(marketLabel(familyOf("player_points")!, teams, undefined, "LeBron James")).toBe("Points de LeBron James");
    expect(marketLabel(familyOf("player_rebounds")!, teams, undefined, "Joel Parra")).toBe("Rebonds de Joel Parra");
    expect(marketLabel(familyOf("player_assists")!, teams, undefined, "Maodo Lo")).toBe("Passes décisives de Maodo Lo");
    expect(marketLabel(familyOf("player_threes")!, teams, undefined, "Kevin Punter")).toBe("Paniers à 3 points de Kevin Punter");
    expect(marketLabel(familyOf("player_pra")!, teams, undefined, "Kevin Punter")).toBe("Points + rebonds + passes de Kevin Punter");
    expect(marketLabel(familyOf("player_points")!, teams, 27.5, "Kevin Punter")).toBe("Points de Kevin Punter (27,5 points)");
    expect(outcomeLabel("player_points", "over", teams, 27.5)).toBe("Plus de 27,5");
  });

  it("lists the best scorer and the double-double by player, with no TRJ", () => {
    for (const key of ["top_scorer", "double_double"]) {
      expect(familyOf(key), key).toMatchObject({ sport: "basketball", section: "p_best", byPrice: true, complete: false });
    }
    expect(PLAYER_FAMILIES).toEqual(expect.arrayContaining(["top_scorer", "double_double"]));
  });

  it("puts the players of a statistic in order, then their lines", () => {
    const keys = [
      "player_points#Maodo Lo|10.5",
      "player_points#Kevin Punter|24.5",
      "player_points#Kevin Punter|19.5",
      "player_rebounds#Joel Parra|4.5",
      "player_assists#Maodo Lo|3.5",
    ];
    const sorted = keys.map(parseMarketKey).sort(compareMarketKeys);
    expect(sorted.map((p) => (p.kind === "family" ? `${p.family.key} ${p.player} ${p.line}` : ""))).toEqual([
      "player_points Kevin Punter 19.5",
      "player_points Kevin Punter 24.5",
      "player_points Maodo Lo 10.5",
      "player_rebounds Joel Parra 4.5",
      "player_assists Maodo Lo 3.5",
    ]);
  });

  it("leaves a player's market alone when the teams swap", () => {
    expect(swapMarketKey("player_points#Kevin Punter|24.5")).toBe("player_points#Kevin Punter|24.5");
    expect(swapOutcome("player_points", "over")).toBe("over");
  });
});

describe("golf's markets", () => {
  it("lists a tournament's markets in sections of its own, its winner first", () => {
    expect(sectionsOf("golf").map((s) => s.key)).toEqual(["g_winner", "g_top", "g_round", "g_nation", "winamax", "betclic"]);
    expect(mainSectionOf("golf")).toBe("g_winner");
    expect(familiesOf("golf").map((f) => f.key).slice(0, 2)).toEqual(["golf_top", "golf_round_leader"]);
  });

  it("reads a Top N and a round's leader back, the line being N or the round", () => {
    expect(parseMarketKey("golf_top|10")).toEqual({ kind: "family", family: familyOf("golf_top"), line: 10 });
    expect(parseMarketKey("golf_round_leader|1")).toEqual({ kind: "family", family: familyOf("golf_round_leader"), line: 1 });
    expect(familyOf("golf_top")).toMatchObject({ sport: "golf", section: "g_top", byPrice: true, winners: "line" });
    expect(familyOf("golf_round_leader")).toMatchObject({ sport: "golf", section: "g_round", byPrice: true, winners: 1 });
    // Without its line, a Top N is not one.
    expect(parseMarketKey("golf_top").kind).toBe("other");
  });

  it("names them in French, the players as they are", () => {
    expect(marketLabel(familyOf("golf_top")!, ["Open d'Espagne 2026"], 5)).toBe("Dans le Top 5");
    expect(marketLabel(familyOf("golf_top")!, ["Open d'Espagne 2026"], 20)).toBe("Dans le Top 20");
    expect(marketLabel(familyOf("golf_round_leader")!, ["Open d'Espagne 2026"], 1)).toBe("Leader après le tour 1");
    expect(outcomeLabel("golf_top", "Xander Schauffele", ["Open d'Espagne 2026"], 5)).toBe("Xander Schauffele");
  });

  it("has a family per nationality for the best of it, one winner each, in a section of its own", () => {
    expect(sectionsOf("golf").map((s) => s.key)).toContain("g_nation");
    expect(familyOf("golf_best_americain")).toMatchObject({ sport: "golf", section: "g_nation", byPrice: true, winners: 1, hasLine: false });
    expect(marketLabel(familyOf("golf_best_americain")!, ["Open"], undefined)).toBe("Meilleur Américain");
    expect(marketLabel(familyOf("golf_best_sud_coreen")!, ["Open"], undefined)).toBe("Meilleur Sud-Coréen");
    expect(marketLabel(familyOf("golf_best_grande_bretagne_irlande")!, ["Open"], undefined)).toBe("Meilleur Grande-Bretagne + Irlande");
  });

  it("recognizes the best of a nationality under each bookmaker's title", () => {
    for (const title of ["Meilleur americain", "Meilleur athlète Américain", "Meilleur Américain", "Meilleur  américain "]) {
      expect(golfBestOf(title)).toBe("golf_best_americain");
    }
    expect(golfBestOf("Meilleur sud-coréen")).toBe("golf_best_sud_coreen");
    expect(golfBestOf("Meilleur athlète Sud-Coréen")).toBe("golf_best_sud_coreen");
    expect(golfBestOf("Meilleur Sud Africain")).toBe("golf_best_sud_africain");
    expect(golfBestOf("Meilleur Grande-Bretagne + Irlande")).toBe("golf_best_grande_bretagne_irlande");
    expect(golfBestOf("Meilleur européen continental")).toBe("golf_best_europeen_continental");
    expect(golfBestOf("Meilleur Ecossais")).toBe("golf_best_ecossais");
    // PMU's: "joueur" before the nationality, and a "Meillleur" typo for the South African.
    expect(golfBestOf("Meilleur joueur espagnol")).toBe("golf_best_espagnol");
    expect(golfBestOf("Meilleur Joueur Français")).toBe("golf_best_francais");
    expect(golfBestOf("Meillleur joueur sud-africain")).toBe("golf_best_sud_africain");
    // Not a nationality the catalog knows, nor a best of one.
    expect(golfBestOf("Meilleur Martien")).toBeUndefined();
    expect(golfBestOf("Top 5")).toBeUndefined();
    expect(golfBestOf("Vainqueur")).toBeUndefined();
  });

  it("counts the winners of a Top N from its line and of a leader as one", () => {
    expect(winnersOf({ kind: "family", family: familyOf("golf_top")!, line: 10 })).toBe(10);
    expect(winnersOf({ kind: "family", family: familyOf("golf_round_leader")!, line: 1 })).toBe(1);
    expect(winnersOf({ kind: "family", family: familyOf("btts")! })).toBeUndefined();
    expect(winnersOf({ kind: "other", name: "Vainqueur du match" })).toBeUndefined();
  });
});

describe("outcomes on the dashboard", () => {
  it("orders goals by number and teams by position", () => {
    const sorted = (family: string, outcomes: string[]) => [...outcomes].sort((a, b) => compareOutcomes(family, a, b));
    expect(sorted("exact_goals", ["2", "6+", "0", "1"])).toEqual(["0", "1", "2", "6+"]);
    expect(sorted("ht_goal_bands", ["4+", "1-3", "0", "1-2"])).toEqual(["0", "1-2", "1-3", "4+"]);
    expect(sorted("1X2", ["2", "X", "1"])).toEqual(["1", "X", "2"]);
    expect(sorted("double_chance", ["X2", "12", "1X"])).toEqual(["1X", "12", "X2"]);
    expect(sorted("correct_score", ["0-1", "1-1", "2-0", "1-0", "other"])).toEqual(["1-0", "2-0", "1-1", "0-1", "other"]);
    expect(sorted("first_goal_minute_15", ["none", "46-60", "1-15", "16-30"])).toEqual(["1-15", "16-30", "46-60", "none"]);
    expect(sorted("first_team_to_score", ["none", "2", "1"])).toEqual(["1", "2", "none"]);
    expect(sorted("header_goal", ["no@1", "none", "both", "2", "any", "1"])).toEqual(["1", "2", "any", "both", "none", "no@1"]);
  });

  it("names teams, lines and scores in French", () => {
    expect(outcomeLabel("double_chance", "X2", teams)).toBe("Nul ou Werder Brême");
    expect(outcomeLabel("total_goals", "over", teams, 2.5)).toBe("Plus de 2,5");
    expect(outcomeLabel("result_total", "1&under", teams, 3.5)).toBe("Borussia Dortmund & Moins de 3,5");
    expect(outcomeLabel("winning_margin", "2:1", teams)).toBe("Werder Brême par 1 but");
    expect(outcomeLabel("winning_margin", "1:3+", teams)).toBe("Borussia Dortmund par 3 buts ou plus");
    expect(outcomeLabel("multi_score", "1-0,2-0,3-0", teams)).toBe("1 - 0, 2 - 0 ou 3 - 0");
    expect(outcomeLabel("multi_score", "other@2", teams)).toBe("Werder Brême gagne (autre score)");
    expect(outcomeLabel("first_goal_result", "2>X", teams)).toBe("Werder Brême marque en premier, nul");
    expect(outcomeLabel("exact_goals", "6+", teams)).toBe("6 ou plus");
    expect(outcomeLabel("btts", "no", teams)).toBe("Non");
    expect(outcomeLabel("first_goal_minute_10", "1-10", teams)).toBe("1re à 10e minute");
    expect(outcomeLabel("first_goal_minute_15", "76-90", teams)).toBe("76e à 90e minute");
    expect(outcomeLabel("first_goal_minute_15", "none", teams)).toBe("Aucun but");
    expect(outcomeLabel("goal_bands", "7+", teams)).toBe("7 ou plus");
    expect(outcomeLabel("penalty_goal", "any", teams)).toBe("Au moins une équipe");
    expect(outcomeLabel("penalty_goal", "none", teams)).toBe("Aucune équipe");
    expect(outcomeLabel("header_goal", "no@1", teams)).toBe("Borussia Dortmund ne marque pas");
  });

  it("says in words what each side of a handicap needs", () => {
    // The line is the first team's handicap.
    expect(outcomeLabel("handicap", "1", teams, -1.5)).toBe("Borussia Dortmund gagne par 2 buts ou plus");
    expect(outcomeLabel("handicap", "2", teams, -1.5)).toBe("Werder Brême ne perd pas, ou perd par 1 but");
    expect(outcomeLabel("handicap", "2", teams, -2.5)).toBe("Werder Brême ne perd pas, ou perd par 2 buts au plus");
    expect(outcomeLabel("handicap", "1", teams, 1.5)).toBe("Borussia Dortmund ne perd pas, ou perd par 1 but");
    expect(outcomeLabel("handicap", "1", teams, -0.5)).toBe("Borussia Dortmund gagne");
    expect(outcomeLabel("handicap", "2", teams, -0.5)).toBe("Werder Brême ne perd pas");
  });

  it("names the players of a pair with what they must do", () => {
    expect(outcomeLabel("scorer_double_chance", "Gonçalo Ramos / João Félix", teams)).toBe("Gonçalo Ramos ou João Félix");
    expect(outcomeLabel("scorers_both", "Gonçalo Ramos / João Félix", teams)).toBe("Gonçalo Ramos et João Félix");
  });

  it("names a team's market after the team", () => {
    expect(marketLabel(familyOf("clean_sheet@2")!, teams)).toBe("Werder Brême n'encaisse pas de but");
    expect(marketLabel(familyOf("scorer_goals")!, teams, 2)).toBe("Marque au moins 2 buts");
    expect(marketLabel(familyOf("result_total")!, teams, 2.5)).toBe("Résultat et nombre de buts (2,5 buts)");
    expect(marketLabel(familyOf("handicap")!, teams, -1.5)).toBe("Handicap : Borussia Dortmund -1,5");
    expect(marketLabel(familyOf("2h_handicap")!, teams, 0.5)).toBe("Handicap en 2e mi-temps : Borussia Dortmund +0,5");
    expect(marketLabel(familyOf("duo_goals")!, teams, 2.5)).toBe("Le duo marque plus de 2,5 buts");
    expect(marketLabel(familyOf("decisive_player_times")!, teams, 2)).toBe("Joueur décisif au moins 2 fois");
  });
});

describe("tennis", () => {
  const players = ["Alex De Minaur", "Hubert Hurkacz"];

  it("has its own sections, its main market in the first", () => {
    expect(sectionsOf("tennis").map((s) => s.label)).toEqual([
      "Match",
      "Sets",
      "Jeux",
      "Par set",
      "Aces et breaks",
      "Seulement chez Winamax",
      "Seulement chez Betclic",
    ]);
    expect(mainSectionOf("tennis")).toBe("t_match");
    expect(mainSectionOf("football")).toBe("result");
    expect(familiesOf("tennis").every((f) => f.section.startsWith("t_"))).toBe(true);
    expect(familiesOf("football").some((f) => f.section.startsWith("t_"))).toBe(false);
  });

  it("names the markets and outcomes in games, sets and aces", () => {
    expect(marketLabel(familyOf("games_handicap")!, players, -3.5)).toBe("Handicap jeux : Alex De Minaur -3,5");
    expect(outcomeLabel("games_handicap", "1", players, -3.5)).toBe("Alex De Minaur gagne par 4 jeux ou plus");
    expect(outcomeLabel("games_handicap", "2", players, -3.5)).toBe("Hubert Hurkacz ne perd pas, ou perd par 3 jeux au plus");
    expect(outcomeLabel("set_handicap", "2", players, -1.5)).toBe("Hubert Hurkacz ne perd pas, ou perd par 1 set");
    expect(outcomeLabel("set_handicap", "1", players, -1.5)).toBe("Alex De Minaur gagne par 2 sets ou plus");
    expect(marketLabel(familyOf("winner_total_games")!, players, 22.5)).toBe("Vainqueur et nombre de jeux (22,5 jeux)");
    expect(outcomeLabel("winner_total_games", "2&under", players, 22.5)).toBe("Hubert Hurkacz & Moins de 22,5");
    expect(marketLabel(familyOf("player_aces@2")!, players)).toBe("Aces réussis par Hubert Hurkacz");
    expect(marketLabel(familyOf("player_games@1")!, players)).toBe("Jeux gagnés par Alex De Minaur");
    expect(outcomeLabel("exact_sets", "3", players)).toBe("3 sets");
    expect(outcomeLabel("most_aces", "X", players)).toBe("Égalité");
    expect(outcomeLabel("set1_match", "2/1", players)).toBe("Hubert Hurkacz / Alex De Minaur");
    expect(outcomeLabel("set_betting", "2-1", players)).toBe("2 - 1");
    // Football's stay in goals.
    expect(outcomeLabel("handicap", "1", teams, -1.5)).toBe("Borussia Dortmund gagne par 2 buts ou plus");
  });

  it("turns a player's markets round like a team's", () => {
    expect(swapMarketKey("games_handicap|-3.5")).toBe("games_handicap|3.5");
    expect(swapMarketKey("player_aces@1|6.5")).toBe("player_aces@2|6.5");
    expect(swapOutcome("set_betting", "2-1")).toBe("1-2");
    expect(swapOutcome("set1_correct_score", "7-5")).toBe("5-7");
    expect(swapOutcome("set1_match", "1/2")).toBe("2/1");
    expect(swapOutcome("most_aces", "X")).toBe("X");
  });

  it("knows when its outcomes cover every case", () => {
    expect(coversEveryCase("set_betting", ["2-0", "2-1", "1-2", "0-2"])).toBe(true);
    expect(coversEveryCase("set_betting", ["3-0", "3-1", "3-2", "2-3", "1-3", "0-3"])).toBe(true);
    expect(coversEveryCase("set_betting", ["2-0", "2-1", "1-2"])).toBe(false);
    expect(coversEveryCase("exact_sets", ["2", "3"])).toBe(true);
    expect(coversEveryCase("exact_sets", ["3", "4", "5"])).toBe(true);
    expect(coversEveryCase("exact_sets", ["3", "4"])).toBe(false);
    expect(coversEveryCase("set1_correct_score", ["6-0", "6-1", "6-2", "6-3", "6-4", "7-5", "7-6"])).toBe(false);
    // Betclic's aces: over a line only.
    expect(coversEveryCase("player_aces@1", ["over"])).toBe(false);
    expect(coversEveryCase("most_aces", ["1", "X", "2"])).toBe(true);
  });
});

describe("the main tennis tours", () => {
  it("are the ATP's, the WTA's and the Grand Slams, without their minor events", () => {
    expect(["Pékin WTA", "Tokyo ATP", "Roland-Garros", "Open d'Australie", "Wimbledon"].every(isMainTour)).toBe(true);
    expect(["Challenger Rennes", "ITF Monastir", "UTR Pro Series", "Pékin ATP Double", "Tokyo ATP Qualif.", "Ligue 1"].some(isMainTour)).toBe(
      false
    );
  });
});

describe("ice hockey, American football, rugby union and handball", () => {
  const keysOf = (sport: string) => familiesOf(sport).map((f) => f.key);

  it("has every sport's markets in a section of its match page", () => {
    // Else the match page drops them without a word (src/db/eventDetail.ts).
    for (const sport of MARKET_SPORTS) {
      const sections = new Set(sectionsOf(sport).map((s) => s.key));
      for (const f of familiesOf(sport)) expect(sections.has(f.section), `${sport}: ${f.key} is in ${f.section}`).toBe(true);
    }
    expect(MARKET_SPORTS).toEqual(expect.arrayContaining(["football américain", "rugby à xv", "hockey sur glace", "handball"]));
  });

  it("gives ice hockey the football's goals in regular time, the overtime's own, and the periods'", () => {
    expect(keysOf("hockey sur glace")).toEqual(
      expect.arrayContaining([
        "1X2",
        "double_chance",
        "draw_no_bet",
        "handicap",
        "total_goals",
        "team_goals@1",
        "btts",
        "ot_handicap",
        "ot_total_goals",
        "ot_team_goals@2",
        "p1_1X2",
        "p3_draw_no_bet",
        "p2_double_chance",
        "p1_handicap",
        "p2_total_goals",
        "p3_team_goals@1",
      ])
    );
    expect(keysOf("hockey sur glace")).not.toContain("spread");
    expect(sectionsOf("hockey sur glace").map((s) => s.key).slice(0, 3)).toEqual(["result", "goals", "periods"]);
    expect(familyOf("ot_total_goals")).toMatchObject({ sport: "hockey sur glace", hasLine: true, complete: true });
    expect(familyOf("p2_total_goals")).toMatchObject({ section: "periods", hasLine: true });
  });

  it("gives American football the basketball's points, overtime included, and quarters; rugby union its halves", () => {
    expect(keysOf("football américain")).toEqual(
      expect.arrayContaining(["spread", "total_points", "team_points@1", "overtime", "ht_1X2", "ht_spread", "2h_draw_no_bet", "q1_1X2", "q4_total_points", "highest_quarter"])
    );
    expect(keysOf("rugby à xv")).toEqual(
      expect.arrayContaining(["1X2", "draw_no_bet", "double_chance", "spread", "total_points", "ht_1X2", "ht_spread", "2h_total_points", "ht_team_points@2"])
    );
    // Rugby union has no quarter, nor an overtime.
    expect(keysOf("rugby à xv").some((k) => k.startsWith("q1_") || k === "overtime")).toBe(false);
    expect(sectionsOf("rugby à xv").map((s) => s.key)).not.toContain("quarters");
    expect(sectionsOf("football américain").map((s) => s.key)).toEqual(expect.arrayContaining(["points", "half", "quarters"]));
  });

  it("gives handball the football's goals and halves", () => {
    expect(keysOf("handball")).toEqual(
      expect.arrayContaining(["1X2", "double_chance", "handicap", "total_goals", "team_goals@2", "ht_ft", "ht_1X2", "ht_handicap", "2h_total_goals", "highest_scoring_half"])
    );
    expect(keysOf("handball")).not.toContain("spread");
    expect(keysOf("handball").some((k) => k.startsWith("p1_") || k.startsWith("q1_"))).toBe(false);
  });

  it("keeps a sport's families to its own: a football scorer is nobody else's", () => {
    for (const sport of ["hockey sur glace", "football américain", "rugby à xv", "handball"]) {
      expect(keysOf(sport), sport).not.toContain("anytime_scorer");
      expect(keysOf(sport), sport).not.toContain("player_points");
    }
  });

  it("names them in French, with the unit of the sport", () => {
    const teams = ["Washington Capitals", "Montréal Canadiens"];
    expect(marketLabel(familyOf("ot_total_goals")!, teams, 5.5)).toBe("Nombre de buts, prolongations incluses (5,5 buts)");
    expect(marketLabel(familyOf("ot_handicap")!, teams, -1.5)).toBe("Handicap, prolongations incluses : Washington Capitals -1,5");
    expect(marketLabel(familyOf("p1_total_goals")!, teams, 1.5)).toBe("Nombre de buts de la 1re période (1,5 buts)");
    expect(marketLabel(familyOf("p3_team_goals@2")!, teams, 0.5)).toBe("Buts de Montréal Canadiens à la 3e période (0,5 buts)");
    expect(marketLabel(familyOf("q2_total_points")!, ["Denver", "Seattle"], 7.5)).toBe("Nombre de points du 2e quart-temps (7,5 points)");
  });

  it("covers every case of a period's result and of the overtime's totals", () => {
    expect(coversEveryCase("p2_1X2", ["1", "X", "2"])).toBe(true);
    expect(coversEveryCase("p1_draw_no_bet", ["1", "2"])).toBe(true);
    expect(coversEveryCase("p3_double_chance", ["1X", "X2"])).toBe(false);
    expect(coversEveryCase("ot_total_goals", ["over", "under"])).toBe(true);
    expect(coversEveryCase("ot_team_goals@1", ["over"])).toBe(false);
    expect(coversEveryCase("ot_handicap", ["1", "2"])).toBe(true);
    expect(hasCases("p1_handicap")).toBe(true);
  });
});
