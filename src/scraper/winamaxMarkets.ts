import { io, Socket } from "socket.io-client";
import { randomUUID } from "node:crypto";
import { RawOdds } from "../types";
import { familyOf, golfBestOf, marketKey, playerMarketKey, unrecognizedMarketKey } from "../markets/catalog";
import { MARKET_1X2 } from "./canonical";

// Every market of a football, tennis or basketball match at Winamax, mapped onto the shared catalog
// (src/markets/catalog.ts). The same Socket.IO server as the listing
// (./winamax.ts) answers the route "match:<id>" with the match's every bet:
// about 100 of them for a big match, 190 KB, in 100 to 200 ms (2026-09-29,
// tests/scraper/fixtures/markets/winamax-dortmund-werder.json.gz).
//
// Winamax identifies its bets with standard market ids (1 is the match
// result, 18 the total goals...), their line in `specialBetValue`
// ("total=2.5") and each outcome with a code ("1", "x", "2", "over", "74" for
// yes...). The codes name the teams by position, competitor 1 then 2, so the
// outcomes read here are in Winamax's own team order; the markets cycle turns
// them round when the event lists the teams the other way.

export interface WinamaxBet {
  betId: number;
  matchId: number;
  marketId: number;
  betTitle: string;
  outcomes: number[];
  specialBetValue?: string;
  available?: boolean;
}

export interface WinamaxOutcome {
  label: string;
  code?: string;
  available?: boolean;
}

export interface WinamaxMatchReply {
  // The match itself: its sport (1 football, 2 basketball, 5 tennis).
  matches?: Record<string, { sportId?: number }>;
  bets?: Record<string, WinamaxBet>;
  outcomes?: Record<string, WinamaxOutcome>;
  odds?: Record<string, number>;
}

type Reader = (outcome: WinamaxOutcome, bet: WinamaxBet) => string | undefined;

// Outcome code -> canonical outcome.
const byCode =
  (codes: Record<string, string>): Reader =>
  (o) =>
    o.code === undefined ? undefined : codes[o.code];

const RESULT = byCode({ "1": "1", x: "X", "2": "2" });
const DOUBLE_CHANCE = byCode({ "9": "1X", "10": "12", "11": "X2" });
const TEAM = byCode({ "1": "1", "2": "2" });
const YES_NO = byCode({ "74": "yes", "76": "no" });
const OVER_UNDER = byCode({ over: "over", under: "under" });
const FIRST_TEAM = byCode({ "6": "1", "7": "none", "8": "2" });
const HALVES = byCode({ "1": "1st", "2": "equal", "3": "2nd" });
const HT_FT = byCode({
  "418": "1/1",
  "420": "1/X",
  "422": "1/2",
  "424": "X/1",
  "426": "X/X",
  "428": "X/2",
  "430": "2/1",
  "432": "2/X",
  "434": "2/2",
});
const RESULT_BTTS = byCode({ "78": "1&yes", "80": "1&no", "82": "X&yes", "84": "X&no", "86": "2&yes", "88": "2&no" });
const RESULT_TOTAL = byCode({
  "794": "1&under",
  "796": "1&over",
  "798": "X&under",
  "800": "X&over",
  "802": "2&under",
  "804": "2&over",
});
const DC_BTTS = byCode({
  "1718": "1X&yes",
  "1719": "1X&no",
  "1720": "12&yes",
  "1721": "12&no",
  "1722": "X2&yes",
  "1723": "X2&no",
});
const DC_TOTAL = byCode({
  "1724": "1X&under",
  "1725": "12&under",
  "1726": "X2&under",
  "1727": "1X&over",
  "1728": "12&over",
  "1729": "X2&over",
});
const FIRST_GOAL_RESULT = byCode({
  "814": "1>1",
  "816": "1>X",
  "818": "1>2",
  "820": "2>1",
  "822": "2>X",
  "824": "2>2",
  "826": "none",
});
// "sr:winning_margin:3+:115": the bucket is the last number.
const WINNING_MARGIN: Reader = (o) =>
  ({ "113": "1:1", "114": "1:2", "115": "1:3+", "119": "X", "116": "2:1", "117": "2:2", "118": "2:3+" })[
    o.code?.split(":").pop() ?? ""
  ];
// "3" or "3 ou plus".
const GOAL_COUNT: Reader = (o) => {
  const m = /^(\d+)( ou plus)?$/.exec(o.label.trim());
  return m ? `${m[1]}${m[2] ? "+" : ""}` : undefined;
};
// "0", "1-2", "4 et plus".
const GOAL_BAND: Reader = (o) => {
  const label = o.label.trim();
  const plus = /^(\d+) et plus$/.exec(label);
  if (plus) return `${plus[1]}+`;
  return /^\d+(-\d+)?$/.test(label) ? label : undefined;
};
// Code "2:1" or "other".
const SCORE: Reader = (o) => {
  if (o.code === "other") return "other";
  const m = /^(\d+):(\d+)$/.exec(o.code ?? "");
  return m ? `${m[1]}-${m[2]}` : undefined;
};
// "1-0 ou 2-0 ou 3-0", "Autre victoire à domicile", "Match nul".
const MULTI_SCORE: Reader = (o) => {
  const label = o.label.trim();
  if (/^match nul$/i.test(label)) return "X";
  if (/domicile/i.test(label)) return "other@1";
  if (/extérieur/i.test(label)) return "other@2";
  const scores = [...label.matchAll(/(\d+)-(\d+)/g)].map((m) => `${m[1]}-${m[2]}`);
  return scores.length > 1 ? scores.sort(compareScoreStrings).join(",") : undefined;
};
const PLAYER: Reader = (o) => o.label.replace(/\s+/g, " ").trim() || undefined;
// "N. Bustos ou F. Fagundez", "N. Bustos et F. Fagundez" -> "N. Bustos / F. Fagundez".
const PLAYERS: Reader = (o) => {
  const names = o.label.split(/ ou | et /).map((n) => n.replace(/\s+/g, " ").trim());
  return names.length > 1 && names.every(Boolean) ? names.join(" / ") : undefined;
};
// "Duo Buteurs - G. Ramos + R. Hojlund", one bet per pair and line: its
// players, for its one outcome, "Plus de 1,5".
const PLAYERS_IN_TITLE: Reader = (o, bet) => {
  const names = /^(?:Duo|Trio) Buteurs - (.+)$/.exec(bet.betTitle.trim())?.[1].split(" + ").map((n) => n.trim());
  return o.code === "over" && names && names.length > 1 ? names.join(" / ") : undefined;
};
// A half-goal handicap: "yes" is the favourite's side, whose handicap is
// negative. The line is the first team's ("hcp=1.5": "Pereira +1.5" is "no",
// "Santa Fe -1.5" is "yes").
const HANDICAP: Reader = (o, bet) => {
  const hcp = lineOf(bet, "hcp");
  if (hcp === undefined || (o.code !== "yes" && o.code !== "no")) return undefined;
  const favourite = hcp < 0 ? "1" : "2";
  return o.code === "yes" ? favourite : favourite === "1" ? "2" : "1";
};
// Which team scores a penalty, a header...: codes 1 to 5.
const GOAL_TYPE = byCode({ "1": "1", "2": "2", "3": "any", "4": "both", "5": "none" });
// "1-15", "Aucun".
const MINUTES: Reader = (o) => {
  const label = o.label.trim();
  if (/^aucun$/i.test(label)) return "none";
  return /^\d+-\d+$/.test(label) ? label : undefined;
};

function compareScoreStrings(a: string, b: string): number {
  const [ah, aa] = a.split("-").map(Number);
  const [bh, ba] = b.split("-").map(Number);
  return ah - bh || aa - ba;
}

// Tennis: "1er set / match" in codes, "De Minaur et Hurkacz" is "1/2".
const SET_MATCH = byCode({ "861": "1/1", "862": "2/1", "863": "1/2", "864": "2/2" });
const WINNER_GAMES = byCode({ "973": "1&over", "974": "2&over", "975": "1&under", "976": "2&under" });
const ACES_OVER_UNDER = byCode({ "12": "over", "13": "under" });
// "Aces - Résultat": a player, or as many each.
const MOST = byCode({ "1": "1", "2": "X", "3": "2" });
// "2", "3".
const SET_COUNT: Reader = (o) => (/^\d$/.test(o.label.trim()) ? o.label.trim() : undefined);

// "total=2.5" -> 2.5, "goals=2" -> 2, "hcp=-1.5" -> -1.5.
function lineOf(bet: WinamaxBet, name: LineName): number | undefined {
  const m = new RegExp(`(?:^|\\|)${name}=(-?\\d+(?:\\.\\d+)?)`).exec(bet.specialBetValue ?? "");
  return m ? Number(m[1]) : undefined;
}

type LineName = "total" | "goals" | "hcp" | "setnr" | "quarternr";

interface Mapping {
  // "{setnr}" stands for the bet's set: "set{setnr}_winner" is "set1_winner"
  // for the first set's. "{quarternr}" for its quarter: "q{quarternr}_spread".
  family: string;
  read: Reader;
  // Where its line is, for a family that has one.
  line?: LineName;
  // Only this variant of the market, when Winamax has several shapes of it.
  variant?: string;
  // Half-goal lines only: a whole-goal handicap ("hcp=-1") refunds a draw,
  // which the other bookmaker's never does.
  halfLinesOnly?: boolean;
  // A player's market: one bet per player and line, his name after the last
  // " - " of its title, in the family's key.
  player?: boolean;
}

// Winamax market id -> catalog family. Verified on the Dortmund - Werder
// Brême capture (tests/scraper/fixtures/markets): each maps to the market of
// the same meaning at Betclic.
const FOOTBALL_MARKETS: Record<number, Mapping> = {
  10: { family: "double_chance", read: DOUBLE_CHANCE },
  11: { family: "draw_no_bet", read: TEAM },
  7016: { family: "handicap", read: HANDICAP, line: "hcp", halfLinesOnly: true },
  // The same bets as 7016, one per line, in yes or no: "Dortmund gagne par au
  // moins 2 buts d'écart".
  8016: { family: "handicap", read: HANDICAP, line: "hcp", halfLinesOnly: true },
  47: { family: "ht_ft", read: HT_FT },
  15: { family: "winning_margin", read: WINNING_MARGIN, variant: "sr:winning_margin:3+" },
  33: { family: "win_to_nil@1", read: YES_NO },
  34: { family: "win_to_nil@2", read: YES_NO },
  48: { family: "win_both_halves@1", read: YES_NO },
  49: { family: "win_both_halves@2", read: YES_NO },
  50: { family: "win_either_half@1", read: YES_NO },
  51: { family: "win_either_half@2", read: YES_NO },

  18: { family: "total_goals", read: OVER_UNDER, line: "total" },
  19: { family: "team_goals@1", read: OVER_UNDER, line: "total" },
  20: { family: "team_goals@2", read: OVER_UNDER, line: "total" },
  29: { family: "btts", read: YES_NO },
  21: { family: "exact_goals", read: GOAL_COUNT },
  23: { family: "team_exact_goals@1", read: GOAL_COUNT },
  24: { family: "team_exact_goals@2", read: GOAL_COUNT },
  8: { family: "first_team_to_score", read: FIRST_TEAM },
  9: { family: "last_team_to_score", read: FIRST_TEAM },
  31: { family: "clean_sheet@1", read: YES_NO },
  32: { family: "clean_sheet@2", read: YES_NO },
  56: { family: "score_both_halves@1", read: YES_NO },
  57: { family: "score_both_halves@2", read: YES_NO },
  52: { family: "highest_scoring_half", read: HALVES },
  25: { family: "goal_bands", read: GOAL_BAND },
  101: { family: "first_goal_minute_10", read: MINUTES },
  100: { family: "first_goal_minute_15", read: MINUTES },
  9091: { family: "penalty_goal", read: GOAL_TYPE },
  9090: { family: "header_goal", read: GOAL_TYPE },
  9089: { family: "free_kick_goal", read: GOAL_TYPE },
  9088: { family: "sub_scores", read: YES_NO },

  60: { family: "ht_1X2", read: RESULT },
  63: { family: "ht_double_chance", read: DOUBLE_CHANCE },
  64: { family: "ht_draw_no_bet", read: TEAM },
  66: { family: "ht_handicap", read: HANDICAP, line: "hcp", halfLinesOnly: true },
  68: { family: "ht_total_goals", read: OVER_UNDER, line: "total" },
  69: { family: "ht_team_goals@1", read: OVER_UNDER, line: "total" },
  70: { family: "ht_team_goals@2", read: OVER_UNDER, line: "total" },
  75: { family: "ht_btts", read: YES_NO },
  71: { family: "ht_exact_goals", read: GOAL_COUNT },
  552: { family: "ht_goal_bands", read: GOAL_BAND },
  76: { family: "ht_clean_sheet@1", read: YES_NO },
  77: { family: "ht_clean_sheet@2", read: YES_NO },
  79: { family: "ht_result_total", read: RESULT_TOTAL, line: "total" },
  542: { family: "ht_dc_btts", read: DC_BTTS },
  9072: { family: "ht_scorer", read: PLAYER },
  9169: { family: "ht_scorer_double_chance", read: PLAYERS },
  9170: { family: "ht_scorer_triple_chance", read: PLAYERS },
  9074: { family: "ht_scorer_goals", read: PLAYER, line: "goals" },

  9073: { family: "2h_scorer", read: PLAYER },
  9075: { family: "2h_scorer_goals", read: PLAYER, line: "goals" },

  199: { family: "correct_score", read: SCORE },
  551: { family: "multi_score", read: MULTI_SCORE },
  81: { family: "ht_correct_score", read: SCORE },

  40: { family: "anytime_scorer", read: PLAYER },
  9003: { family: "first_scorer", read: PLAYER },
  9004: { family: "last_scorer", read: PLAYER },
  9001: { family: "scorer_goals", read: PLAYER, line: "goals" },
  9005: { family: "scorer_team_wins", read: PLAYER },
  9099: { family: "scorer_both_halves", read: PLAYER },
  9006: { family: "scorer_double_chance", read: PLAYERS },
  9007: { family: "scorer_triple_chance", read: PLAYERS },
  9008: { family: "scorers_both", read: PLAYERS },
  9102: { family: "duo_goals", read: PLAYERS_IN_TITLE, line: "total" },
  9103: { family: "trio_goals", read: PLAYERS_IN_TITLE, line: "total" },
  9467: { family: "scorer_each_goal", read: PLAYER },
  9469: { family: "decisive_each_action", read: PLAYER },
  9468: { family: "assist_each", read: PLAYER },
  9173: { family: "decisive_player", read: PLAYER },
  9018: { family: "decisive_player_times", read: PLAYER, line: "total" },
  9238: { family: "decisive_double_chance", read: PLAYERS },
  9237: { family: "assist_double_chance", read: PLAYERS },
  9239: { family: "assist_triple_chance", read: PLAYERS },

  35: { family: "result_btts", read: RESULT_BTTS },
  37: { family: "result_total", read: RESULT_TOTAL, line: "total" },
  546: { family: "dc_btts", read: DC_BTTS },
  547: { family: "dc_total", read: DC_TOTAL, line: "total" },
  184: { family: "first_goal_result", read: FIRST_GOAL_RESULT },
};

// Winamax market id -> catalog family, for tennis: Sportradar's ids, some of
// which football uses for other markets (199 is a football match's exact
// score, a tennis match's score in sets). Verified on the De Minaur -
// Hurkacz, Alcaraz - Munar and Lehecka - Vacherot captures (4/10/2026,
// tests/scraper/fixtures/markets/winamax-tennis-*). Winamax alone: the
// results after 2, 4 or 6 games, the first service games, the aces' tiers.
const TENNIS_MARKETS: Record<number, Mapping> = {
  187: { family: "games_handicap", read: HANDICAP, line: "hcp", halfLinesOnly: true },
  188: { family: "set_handicap", read: HANDICAP, line: "hcp", halfLinesOnly: true },
  201: { family: "set1_match", read: SET_MATCH },
  1055: { family: "winner_total_games", read: WINNER_GAMES, line: "total" },

  199: { family: "set_betting", read: SCORE },
  314: { family: "total_sets", read: OVER_UNDER, line: "total" },
  196: { family: "exact_sets", read: SET_COUNT },
  192: { family: "win_a_set@1", read: YES_NO },
  193: { family: "win_a_set@2", read: YES_NO },
  195: { family: "tiebreak", read: YES_NO },
  194: { family: "bagel", read: YES_NO },

  189: { family: "total_games", read: OVER_UNDER, line: "total" },
  190: { family: "player_games@1", read: OVER_UNDER, line: "total" },
  191: { family: "player_games@2", read: OVER_UNDER, line: "total" },

  202: { family: "set{setnr}_winner", read: TEAM },
  203: { family: "set1_games_handicap", read: HANDICAP, line: "hcp", variant: "setnr=1", halfLinesOnly: true },
  204: { family: "set1_total_games", read: OVER_UNDER, line: "total", variant: "setnr=1" },
  207: { family: "set1_correct_score", read: SCORE, variant: "setnr=1" },

  9082: { family: "total_aces", read: ACES_OVER_UNDER, line: "total" },
  9083: { family: "player_aces@1", read: ACES_OVER_UNDER, line: "total" },
  9084: { family: "player_aces@2", read: ACES_OVER_UNDER, line: "total" },
  9086: { family: "most_aces", read: MOST },
  9077: { family: "first_break", read: TEAM },
  9123: { family: "total_breaks", read: OVER_UNDER, line: "total" },
  9124: { family: "player_breaks@1", read: OVER_UNDER, line: "total" },
  9125: { family: "player_breaks@2", read: OVER_UNDER, line: "total" },
};

// Winamax market id -> catalog family, for basketball. Verified on the Barcelone
// - Zalgiris Kaunas capture (9/10/2026, tests/scraper/fixtures/markets/
// winamax-barcelone-zalgiris.json.gz). The listing's own is 219, the winner
// overtime included; the result (1) is in regular time, a draw possible.
const BASKETBALL_MARKETS: Record<number, Mapping> = {
  // The match, overtime included (the handicap, the totals, the winner and the
  // total), but for the result and the refund on a draw, in regular time.
  1: { family: MARKET_1X2, read: RESULT },
  11: { family: "draw_no_bet", read: TEAM },
  223: { family: "spread", read: HANDICAP, line: "hcp", halfLinesOnly: true },
  225: { family: "total_points", read: OVER_UNDER, line: "total", halfLinesOnly: true },
  227: { family: "team_points@1", read: OVER_UNDER, line: "total", halfLinesOnly: true },
  228: { family: "team_points@2", read: OVER_UNDER, line: "total", halfLinesOnly: true },
  292: { family: "winner_total", read: WINNER_GAMES, line: "total", halfLinesOnly: true },
  220: { family: "overtime", read: YES_NO },
  47: { family: "ht_ft", read: HT_FT },
  48: { family: "win_both_halves@1", read: YES_NO },
  49: { family: "win_both_halves@2", read: YES_NO },
  1313: { family: "win_all_quarters@1", read: YES_NO },
  1314: { family: "win_all_quarters@2", read: YES_NO },

  // The first half, "Mi-temps".
  60: { family: "ht_1X2", read: RESULT },
  64: { family: "ht_draw_no_bet", read: TEAM },
  66: { family: "ht_spread", read: HANDICAP, line: "hcp", halfLinesOnly: true },
  68: { family: "ht_total_points", read: OVER_UNDER, line: "total", halfLinesOnly: true },
  69: { family: "ht_team_points@1", read: OVER_UNDER, line: "total", halfLinesOnly: true },
  70: { family: "ht_team_points@2", read: OVER_UNDER, line: "total", halfLinesOnly: true },

  // The players': a bet each, "Nombre de points du joueur - Kevin Punter", over
  // and under a line; a ladder's ("paliers") has the over alone, at each of
  // its lines.
  921: { family: "player_points", read: OVER_UNDER, line: "total", halfLinesOnly: true, player: true },
  9060: { family: "player_points", read: OVER_UNDER, line: "total", halfLinesOnly: true, player: true },
  923: { family: "player_rebounds", read: OVER_UNDER, line: "total", halfLinesOnly: true, player: true },
  9068: { family: "player_rebounds", read: OVER_UNDER, line: "total", halfLinesOnly: true, player: true },
  922: { family: "player_assists", read: OVER_UNDER, line: "total", halfLinesOnly: true, player: true },
  9067: { family: "player_assists", read: OVER_UNDER, line: "total", halfLinesOnly: true, player: true },
  924: { family: "player_threes", read: OVER_UNDER, line: "total", halfLinesOnly: true, player: true },
  9070: { family: "player_threes", read: OVER_UNDER, line: "total", halfLinesOnly: true, player: true },
  9053: { family: "player_pra", read: OVER_UNDER, line: "total", halfLinesOnly: true, player: true },
  9178: { family: "player_pra", read: OVER_UNDER, line: "total", halfLinesOnly: true, player: true },
  9054: { family: "player_pa", read: OVER_UNDER, line: "total", halfLinesOnly: true, player: true },
  9179: { family: "player_pa", read: OVER_UNDER, line: "total", halfLinesOnly: true, player: true },
  9055: { family: "player_ra", read: OVER_UNDER, line: "total", halfLinesOnly: true, player: true },
  9180: { family: "player_ra", read: OVER_UNDER, line: "total", halfLinesOnly: true, player: true },
  9056: { family: "player_pr", read: OVER_UNDER, line: "total", halfLinesOnly: true, player: true },
  9181: { family: "player_pr", read: OVER_UNDER, line: "total", halfLinesOnly: true, player: true },
  9096: { family: "top_scorer", read: PLAYER },
  9171: { family: "double_double", read: PLAYER },

  // A quarter, its number in the bet's "quarternr".
  235: { family: "q{quarternr}_1X2", read: RESULT },
  302: { family: "q{quarternr}_draw_no_bet", read: TEAM },
  303: { family: "q{quarternr}_spread", read: HANDICAP, line: "hcp", halfLinesOnly: true },
  236: { family: "q{quarternr}_total_points", read: OVER_UNDER, line: "total", halfLinesOnly: true },
  756: { family: "q{quarternr}_team_points@1", read: OVER_UNDER, line: "total", halfLinesOnly: true },
  757: { family: "q{quarternr}_team_points@2", read: OVER_UNDER, line: "total", halfLinesOnly: true },
};

const FOOTBALL = 1;
const BASKETBALL = 2;
const TENNIS = 5;
const GOLF = 9;

// By sport id: the markets, and the main one, which the listing's own cycle
// keeps fresh (./winamax.ts). A sport without a table is not read: the ids are
// Sportradar's, which mean other things from a sport to another (199 is a
// football match's exact score, a tennis match's score in sets).
const BY_SPORT: Record<number, { markets: Record<number, Mapping>; listing: ReadonlySet<number> }> = {
  [FOOTBALL]: { markets: FOOTBALL_MARKETS, listing: new Set([1]) },
  [BASKETBALL]: { markets: BASKETBALL_MARKETS, listing: new Set([219]) },
  [TENNIS]: { markets: TENNIS_MARKETS, listing: new Set([186]) },
};

// A mapping's family for this bet: its set's or its quarter's, when it depends
// on it (a quarter that is not one of the four is no family).
function familyFor(mapping: Mapping, bet: WinamaxBet): string | undefined {
  const placeholder = /\{(setnr|quarternr)\}/.exec(mapping.family);
  if (!placeholder) return mapping.family;
  const n = lineOf(bet, placeholder[1] as LineName);
  const key = n === undefined ? undefined : mapping.family.replace(placeholder[0], String(n));
  return key && familyOf(key) ? key : undefined;
}

// "hcp=-1.5" -> " (-1,5)": the line of a market kept under its own name.
function lineSuffix(bet: WinamaxBet): string {
  const m = /(?:total|hcp|goals)=(-?\d+(?:\.\d+)?)/.exec(bet.specialBetValue ?? "");
  return m ? ` (${m[1].replace(".", ",")})` : "";
}

// A golf bet's family and line, by what it is: Winamax numbers its markets
// differently from a tournament to another (the winner is 5072 here and 4984
// at the Masters), and titles one "Open de España 2026 - Top 5" or "Top 5". A
// Top N carries its number of winners; a leader's title says its round
// (6/10/2026, tests/scraper/fixtures/markets/winamax-golf-*).
const ROUNDS: Record<string, number> = { premier: 1, "1er": 1, deuxième: 2, "2e": 2, troisième: 3, "3e": 3, quatrième: 4, "4e": 4 };
function golfMarketOf(bet: WinamaxBet): string | undefined {
  const winners = /(?:^|\|)winners=(\d+)/.exec(bet.specialBetValue ?? "");
  if (winners) return marketKey("golf_top", Number(winners[1]));
  const round = /^leader .*\b(premier|1er|deuxième|2e|troisième|3e|quatrième|4e) (?:round|tour)\b/i.exec(bet.betTitle.trim());
  return round ? marketKey("golf_round_leader", ROUNDS[round[1].toLowerCase()]) : golfBestOf(bet.betTitle);
}

// A golf tournament's markets: its winner is the listing's own, a Top N, a
// round's leader and the best of a nationality are the catalog's, and any
// other keeps Winamax's name for it.
function readWinamaxGolf(reply: WinamaxMatchReply, matchId: string): RawOdds[] {
  const odds: RawOdds[] = [];
  for (const bet of Object.values(reply.bets ?? {})) {
    if (String(bet.matchId) !== matchId || bet.available === false || /^vainqueur$/i.test(bet.betTitle.trim())) continue;
    const family = golfMarketOf(bet);
    const market = family ?? unrecognizedMarketKey("winamax", bet.betTitle.replace("|", " – "));
    for (const outcomeId of bet.outcomes) {
      const outcome = reply.outcomes?.[outcomeId];
      const price = reply.odds?.[outcomeId];
      if (!outcome || outcome.available === false || typeof price !== "number" || !(price > 1)) continue;
      const selection = outcome.label.replace(/\s+/g, " ").trim();
      if (selection) odds.push({ market, selection, price });
    }
  }
  return odds;
}

// Every open price of the match's markets, in Winamax's team order. A market
// no family covers keeps Winamax's name for it and for its outcomes.
export function readWinamaxMarkets(reply: WinamaxMatchReply, matchId: string): RawOdds[] {
  const sportId = reply.matches?.[matchId]?.sportId;
  if (sportId === GOLF) return readWinamaxGolf(reply, matchId);
  const sport = sportId === undefined ? undefined : BY_SPORT[sportId];
  if (!sport) return [];
  const odds: RawOdds[] = [];
  for (const bet of Object.values(reply.bets ?? {})) {
    // The reply also carries live updates of other matches.
    if (String(bet.matchId) !== matchId || bet.available === false) continue;
    if (sport.listing.has(bet.marketId)) continue;

    const mapping = sport.markets[bet.marketId];
    const known = mapping && (!mapping.variant || (bet.specialBetValue ?? "").includes(mapping.variant));
    const family = known ? familyFor(mapping, bet) : undefined;
    const line = family && mapping.line ? lineOf(bet, mapping.line) : undefined;
    const lineFits = !mapping?.line || (line !== undefined && (!mapping.halfLinesOnly || !Number.isInteger(line)));
    // A player's market is in the family's key with his name: "Nombre de
    // points du joueur - Kevin Punter".
    const player = family && mapping.player ? /^.* - (.+)$/.exec(bet.betTitle.trim())?.[1] : undefined;
    const market =
      family && lineFits && (!mapping.player || player)
        ? mapping.player
          ? playerMarketKey(family, player!, line)
          : marketKey(family, line)
        : unrecognizedMarketKey("winamax", bet.betTitle.replace("|", " – ") + lineSuffix(bet));

    for (const outcomeId of bet.outcomes) {
      const outcome = reply.outcomes?.[outcomeId];
      const price = reply.odds?.[outcomeId];
      if (!outcome || outcome.available === false || typeof price !== "number" || !(price > 1)) continue;
      const selection = market.startsWith("wx:") ? outcome.label.replace(/\s+/g, " ").trim() : mapping.read(outcome, bet);
      if (selection) odds.push({ market, selection, price });
    }
  }
  return odds;
}

const WINAMAX_WS_URL = "https://sports-eu-west-3.winamax.fr";
const SOCKET_PATH = "/uof-sports-server/socket.io";
const ROUTE_TIMEOUT_MS = 15000;

function requestMatch(socket: Socket, matchId: string): Promise<WinamaxMatchReply> {
  const requestId = randomUUID();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off("m", onMessage);
      reject(new Error(`Winamax match ${matchId} timed out`));
    }, ROUTE_TIMEOUT_MS);
    function onMessage(data: Record<string, unknown>) {
      if (data.requestId !== requestId) return;
      clearTimeout(timeout);
      socket.off("m", onMessage);
      resolve(data as WinamaxMatchReply);
    }
    socket.on("m", onMessage);
    socket.emit("m", { route: `match:${matchId}`, requestId });
  });
}

// The markets of the given Winamax matches, one after another over one
// connection. A match that doesn't answer costs only that match.
export async function fetchWinamaxMarkets(matchIds: readonly string[]): Promise<Map<string, RawOdds[]>> {
  const byMatch = new Map<string, RawOdds[]>();
  if (matchIds.length === 0) return byMatch;
  const socket = io(WINAMAX_WS_URL, {
    path: SOCKET_PATH,
    query: { language: "FR", version: "3.65.0", embed: "false" },
    transports: ["websocket"],
    timeout: ROUTE_TIMEOUT_MS,
  });
  try {
    await new Promise<void>((resolve, reject) => {
      socket.once("connect", () => resolve());
      socket.once("connect_error", (err: Error) => reject(err));
    });
    for (const matchId of matchIds) {
      try {
        byMatch.set(matchId, readWinamaxMarkets(await requestMatch(socket, matchId), matchId));
      } catch (err) {
        console.warn(`[markets:winamax] no markets for match ${matchId}:`, err);
      }
    }
  } finally {
    socket.close();
  }
  return byMatch;
}
