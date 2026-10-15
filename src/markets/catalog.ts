import { MARKET_1X2, MARKET_MATCH_WINNER } from "../scraper/canonical";

// Every market of a football, tennis or basketball match that two bookmakers
// offer, under one shared key, so their prices can be compared outcome by
// outcome.
//
// Stored in event_bookmaker_odds as is: `market` is the family's key, with its
// line when it has one ("total_goals|2.5"), and `selection` one of the
// family's canonical outcomes ("over", "1X", "2-1", a player's name). The
// bookmakers' own names never reach the database for these: each scraper
// maps its markets here (src/scraper/winamaxMarkets.ts, betclicMarkets.ts).
//
// Outcomes name the teams (a tennis match's players) "1" (the first) and "2"
// (the second), draws "X". Each bookmaker's are first read in its own team order, then turned
// round when it lists the match the other way round from the event
// (swapOutcome, swapMarketKey).
//
// A market no family covers keeps the bookmaker's own name, prefixed so it
// can never be compared with the other bookmaker's (unrecognizedMarketKey).

export type Sport =
  | "football"
  | "tennis"
  | "golf"
  | "basketball"
  | "football américain"
  | "rugby à xv"
  | "hockey sur glace"
  | "handball";

export type SectionKey =
  | "result"
  | "goals"
  | "half"
  | "second_half"
  | "points"
  | "quarters"
  | "periods"
  | "p_points"
  | "p_rebounds"
  | "p_assists"
  | "p_threes"
  | "p_combos"
  | "p_best"
  | "score"
  | "scorers"
  | "combos"
  | "t_match"
  | "t_sets"
  | "t_games"
  | "t_set1"
  | "t_serve"
  | "g_winner"
  | "g_top"
  | "g_round"
  | "g_nation"
  | "winamax"
  | "betclic";

type Section = { key: SectionKey; label: string };

const ONE_BOOKMAKER: Section[] = [
  { key: "winamax", label: "Seulement chez Winamax" },
  { key: "betclic", label: "Seulement chez Betclic" },
];

// A match page's sections, by sport, in display order.
const SPORT_SECTIONS: Record<Sport, readonly Section[]> = {
  football: [
    { key: "result", label: "Résultat" },
    { key: "goals", label: "Buts" },
    { key: "half", label: "1re mi-temps" },
    { key: "second_half", label: "2e mi-temps" },
    { key: "score", label: "Score exact" },
    { key: "scorers", label: "Buteurs et passeurs" },
    { key: "combos", label: "Combinés" },
    ...ONE_BOOKMAKER,
  ],
  tennis: [
    { key: "t_match", label: "Match" },
    { key: "t_sets", label: "Sets" },
    { key: "t_games", label: "Jeux" },
    { key: "t_set1", label: "Par set" },
    { key: "t_serve", label: "Aces et breaks" },
    ...ONE_BOOKMAKER,
  ],
  // A golf tournament: its winner (the listing's own market), then the
  // markets of several winners, which the bookmakers (and the exchange) price
  // by player.
  golf: [
    { key: "g_winner", label: "Vainqueur" },
    { key: "g_top", label: "Classement final : Top 3, 5, 10, 20…" },
    { key: "g_round", label: "Leader après un tour" },
    { key: "g_nation", label: "Meilleur par nationalité" },
    ...ONE_BOOKMAKER,
  ],
  // A basketball match: the winner (the listing's own, overtime included) and
  // the result in regular time, a draw possible, come first.
  basketball: [
    { key: "result", label: "Résultat" },
    { key: "points", label: "Points" },
    { key: "half", label: "1re mi-temps" },
    { key: "second_half", label: "2e mi-temps" },
    { key: "quarters", label: "Quart-temps" },
    // The players, by statistic: a card each, with its lines.
    { key: "p_points", label: "Points des joueurs" },
    { key: "p_rebounds", label: "Rebonds des joueurs" },
    { key: "p_assists", label: "Passes décisives des joueurs" },
    { key: "p_threes", label: "Paniers à 3 points des joueurs" },
    { key: "p_combos", label: "Points, rebonds et passes des joueurs" },
    { key: "p_best", label: "Meilleurs joueurs" },
    ...ONE_BOOKMAKER,
  ],
  // The sports below are read by the bookmakers that give a match's page for them
  // (src/scraper/marketsRun.ts, MARKETS_BY_BOOKMAKER). They reuse the families of
  // the football and the basketball: a result in regular time, a draw possible, the
  // handicap and the totals in goals (hockey, handball) or in points (the others),
  // and the halves, quarters and periods built on them.
  //
  // American football: the winner is the listing's (overtime included), like the
  // basketball's, and its own markets include the overtime too.
  "football américain": [
    { key: "result", label: "Résultat" },
    { key: "points", label: "Points" },
    { key: "half", label: "1re mi-temps" },
    { key: "second_half", label: "2e mi-temps" },
    { key: "quarters", label: "Quart-temps" },
    ...ONE_BOOKMAKER,
  ],
  // Rugby union: the listing's result has a draw, there is no overtime.
  "rugby à xv": [
    { key: "result", label: "Résultat" },
    { key: "points", label: "Points" },
    { key: "half", label: "1re mi-temps" },
    { key: "second_half", label: "2e mi-temps" },
    ...ONE_BOOKMAKER,
  ],
  // Ice hockey: the listing's result is the regular time's, the plain families
  // are too; the overtime-included ones are "ot_".
  "hockey sur glace": [
    { key: "result", label: "Résultat" },
    { key: "goals", label: "Buts" },
    { key: "periods", label: "Périodes" },
    ...ONE_BOOKMAKER,
  ],
  handball: [
    { key: "result", label: "Résultat" },
    { key: "goals", label: "Buts" },
    { key: "half", label: "1re mi-temps" },
    { key: "second_half", label: "2e mi-temps" },
    ...ONE_BOOKMAKER,
  ],
};

// The sports whose matches have every market read (src/scraper/marketsRun.ts).
export const MARKET_SPORTS = Object.keys(SPORT_SECTIONS) as Sport[];

export function sectionsOf(sport: string): readonly Section[] {
  return SPORT_SECTIONS[sport as Sport] ?? SPORT_SECTIONS.football;
}

// The section of a match's main market, the listing's own ("1X2",
// "Vainqueur du match"), which no family covers.
export const mainSectionOf = (sport: string): SectionKey =>
  sport === "tennis" ? "t_match" : sport === "golf" ? "g_winner" : "result";

// How a family's outcomes name the teams:
// - "teams": every "1" or "2" in them is a team ("1", "1X", "1&over", "1/X");
// - "margin": only the first character is ("1:2" is team 1 by 2 goals);
// - "scores": they are scores, home first ("2-1", "1-0,2-0", "other@1");
// - "handicap": they are "1" or "2", and the line is the first team's
//   handicap, so it changes sign too ("handicap|-1.5" 1 is "handicap|1.5" 2);
// - "none": they don't ("over", "yes", "3+", a player).
export type TeamSwap = "teams" | "margin" | "scores" | "handicap" | "none";

// What a line or a margin counts: "2,5 buts", "22,5 jeux".
export interface Unit {
  one: string;
  many: string;
}

const GOALS: Unit = { one: "but", many: "buts" };
const POINTS: Unit = { one: "point", many: "points" };
const REBOUNDS: Unit = { one: "rebond", many: "rebonds" };
const ASSISTS: Unit = { one: "passe décisive", many: "passes décisives" };
const THREES: Unit = { one: "panier à 3 points", many: "paniers à 3 points" };
const GAMES: Unit = { one: "jeu", many: "jeux" };
const SETS: Unit = { one: "set", many: "sets" };
const ACES: Unit = { one: "ace", many: "aces" };
const BREAKS: Unit = { one: "break", many: "breaks" };

export interface MarketFamily {
  key: string;
  sport: Sport;
  unit: Unit;
  // "{1}" and "{2}" stand for the teams' names.
  label: string;
  section: SectionKey;
  // Its outcomes cover every case exactly once, so its best prices have a
  // TRJ. Double chances overlap and scorers leave out "no scorer": no TRJ.
  complete: boolean;
  // Its key carries a line: "total_goals|2.5".
  hasLine: boolean;
  swap: TeamSwap;
  // Outcomes listed by best price rather than by name: players.
  byPrice?: boolean;
  // Outcomes naming several players, "A / B": any one of them ("or", a
  // double chance) or all of them ("and") must score.
  combo?: "or" | "and";
  // How many of its outcomes win, when it is not one of them: a golf
  // tournament's Top N has N ("line": its line), the leader after a round one.
  // Their best prices add up to that many cases, not one (winnersOf).
  winners?: number | "line";
  // Other sports' matches it is as good a market of: a result in regular time
  // is a football match's and a basketball match's alike.
  alsoFor?: readonly Sport[];
  // One market per player (and line): its key carries the player,
  // "player_points#LeBron James|27.5", its outcomes over and under.
  perPlayer?: boolean;
}

type FamilyOptions = {
  complete?: boolean;
  hasLine?: boolean;
  swap?: TeamSwap;
  byPrice?: boolean;
  combo?: "or" | "and";
  sport?: Sport;
  unit?: Unit;
  winners?: number | "line";
  alsoFor?: readonly Sport[];
  perPlayer?: boolean;
};

function family(key: string, label: string, section: SectionKey, opts: FamilyOptions = {}): MarketFamily {
  return {
    key,
    sport: opts.sport ?? "football",
    unit: opts.unit ?? GOALS,
    label,
    section,
    complete: opts.complete ?? true,
    hasLine: opts.hasLine ?? false,
    swap: opts.swap ?? "none",
    ...(opts.byPrice || opts.combo ? { byPrice: true } : {}),
    ...(opts.combo ? { combo: opts.combo } : {}),
    ...(opts.winners !== undefined ? { winners: opts.winners } : {}),
    ...(opts.alsoFor ? { alsoFor: opts.alsoFor } : {}),
    ...(opts.perPlayer ? { perPlayer: true } : {}),
  };
}

// Players: listed by price, and never all the cases.
const players = (opts: { hasLine?: boolean; combo?: "or" | "and" } = {}) => ({ complete: false, byPrice: true, ...opts });

// A market about one of the teams, once per team: "clean_sheet@1" and
// "clean_sheet@2". `label` names the team "{t}".
function perTeam(key: string, label: string, section: SectionKey, opts: FamilyOptions = {}): MarketFamily[] {
  return ([1, 2] as const).map((team) => family(`${key}@${team}`, label.replace("{t}", `{${team}}`), section, opts));
}

function tennis(key: string, label: string, section: SectionKey, opts: FamilyOptions = {}): MarketFamily {
  return family(key, label, section, { ...opts, sport: "tennis" });
}

const perPlayer = (key: string, label: string, section: SectionKey, opts: FamilyOptions = {}) =>
  perTeam(key, label, section, { ...opts, sport: "tennis" });

// A basketball match's market: its lines are in points.
const basketball = (key: string, label: string, section: SectionKey, opts: FamilyOptions = {}) =>
  family(key, label, section, { ...opts, sport: "basketball", unit: POINTS });

// A basketball statistic of a player: a card each, with its lines.
const perPlayerBasketball = (key: string, label: string, section: SectionKey, unit: Unit) =>
  basketball(key, label, section, { hasLine: true, perPlayer: true, unit });

const perTeamBasketball = (key: string, label: string, section: SectionKey, opts: FamilyOptions = {}) =>
  perTeam(key, label, section, { ...opts, sport: "basketball", unit: POINTS });

// What a football match and the other sports' have in common: a result in
// regular time, a draw possible, and the markets of a half built on it.
const AND_BASKETBALL = ["basketball"] as const;
const WITH_HALVES = ["basketball", "football américain", "rugby à xv", "handball"] as const;
const WITH_RESULT = [...WITH_HALVES, "hockey sur glace"] as const;
// Where a draw is a result of its own and the double chance is a market.
const WITH_DOUBLE_CHANCE = ["rugby à xv", "hockey sur glace", "handball"] as const;
// Football's families in goals: the handicap and the totals of hockey and handball.
const IN_GOALS = ["hockey sur glace", "handball"] as const;
// Basketball's families in points: rugby union and American football score in points
// too, and play halves; only American football plays quarters (and an overtime).
const IN_POINTS = ["football américain", "rugby à xv"] as const;
const AMERICAN_FOOTBALL = ["football américain"] as const;

// A basketball quarter's families: "q1_" is the first one's.
const QUARTERS = [
  { n: 1, at: "au 1er quart-temps", of: "du 1er quart-temps" },
  { n: 2, at: "au 2e quart-temps", of: "du 2e quart-temps" },
  { n: 3, at: "au 3e quart-temps", of: "du 3e quart-temps" },
  { n: 4, at: "au 4e quart-temps", of: "du 4e quart-temps" },
] as const;

function quarterFamilies({ n, at, of }: (typeof QUARTERS)[number]): MarketFamily[] {
  return [
    basketball(`q${n}_1X2`, `Résultat ${of}`, "quarters", { swap: "teams", alsoFor: AMERICAN_FOOTBALL }),
    basketball(`q${n}_draw_no_bet`, `Remboursé si nul ${at}`, "quarters", { swap: "teams", alsoFor: AMERICAN_FOOTBALL }),
    basketball(`q${n}_spread`, `Handicap ${of} : {1} {h}`, "quarters", { hasLine: true, swap: "handicap", alsoFor: AMERICAN_FOOTBALL }),
    basketball(`q${n}_total_points`, `Nombre de points ${of}`, "quarters", { hasLine: true, alsoFor: AMERICAN_FOOTBALL }),
    ...perTeamBasketball(`q${n}_team_points`, `Points de {t} ${at}`, "quarters", { hasLine: true, alsoFor: AMERICAN_FOOTBALL }),
  ];
}

// An ice hockey match's market: its lines are in goals, in regular time unless it
// says "ot_" (overtime and shootout included).
const hockey = (key: string, label: string, section: SectionKey, opts: FamilyOptions = {}) =>
  family(key, label, section, { ...opts, sport: "hockey sur glace" });

const perTeamHockey = (key: string, label: string, section: SectionKey, opts: FamilyOptions = {}) =>
  perTeam(key, label, section, { ...opts, sport: "hockey sur glace" });

// An ice hockey period's families: "p1_" is the first one's.
const PERIODS = [
  { n: 1, at: "à la 1re période", of: "de la 1re période" },
  { n: 2, at: "à la 2e période", of: "de la 2e période" },
  { n: 3, at: "à la 3e période", of: "de la 3e période" },
] as const;

function periodFamilies({ n, at, of }: (typeof PERIODS)[number]): MarketFamily[] {
  return [
    hockey(`p${n}_1X2`, `Résultat ${of}`, "periods", { swap: "teams" }),
    hockey(`p${n}_draw_no_bet`, `Remboursé si nul ${at}`, "periods", { swap: "teams" }),
    hockey(`p${n}_double_chance`, `Double chance ${at}`, "periods", { complete: false, swap: "teams" }),
    hockey(`p${n}_handicap`, `Handicap ${of} : {1} {h}`, "periods", { hasLine: true, swap: "handicap" }),
    hockey(`p${n}_total_goals`, `Nombre de buts ${of}`, "periods", { hasLine: true }),
    ...perTeamHockey(`p${n}_team_goals`, `Buts de {t} ${at}`, "periods", { hasLine: true }),
  ];
}

// A golf tournament's market of several winners, its players listed by price.
const golf = (key: string, label: string, section: SectionKey, opts: FamilyOptions = {}) =>
  family(key, label, section, { complete: false, byPrice: true, ...opts, sport: "golf" });

// The nationalities (and regions) the bookmakers have a "best of" market for
// (6/10/2026: Winamax's 12 and Betclic's 7 at Baycurrent Classic, Unibet's 12
// at the Open d'Espagne): one family each, its key made of the slug. A market
// of another nationality keeps its bookmaker's own name (golfBestOf).
const NATIONALITIES: ReadonlyArray<readonly [slug: string, label: string]> = [
  ["americain", "Américain"],
  ["anglais", "Anglais"],
  ["australien", "Australien"],
  ["canadien", "Canadien"],
  ["japonais", "Japonais"],
  ["sud_africain", "Sud-Africain"],
  ["sud_coreen", "Sud-Coréen"],
  ["espagnol", "Espagnol"],
  ["italien", "Italien"],
  ["francais", "Français"],
  ["allemand", "Allemand"],
  ["ecossais", "Écossais"],
  ["suedois", "Suédois"],
  ["chinois", "Chinois"],
  ["irlandais", "Irlandais"],
  ["gallois", "Gallois"],
  ["nord_irlandais", "Nord-Irlandais"],
  ["danois", "Danois"],
  ["norvegien", "Norvégien"],
  ["finlandais", "Finlandais"],
  ["belge", "Belge"],
  ["autrichien", "Autrichien"],
  ["suisse", "Suisse"],
  ["portugais", "Portugais"],
  ["argentin", "Argentin"],
  ["mexicain", "Mexicain"],
  ["chilien", "Chilien"],
  ["colombien", "Colombien"],
  ["thailandais", "Thaïlandais"],
  ["indien", "Indien"],
  ["neo_zelandais", "Néo-Zélandais"],
  ["sud_americain", "Sud-Américain"],
  ["asiatique", "Asiatique"],
  ["europeen", "Européen"],
  ["europeen_continental", "Européen continental"],
  ["scandinave", "Scandinave"],
  ["grande_bretagne_irlande", "Grande-Bretagne + Irlande"],
];

// In display order within each section. A label's "{1}" and "{2}" are the
// teams, "{n}" its line, "{h}" its line as the first team's handicap; a label
// without either gets its line appended ("(2,5 buts)").
export const FAMILIES: readonly MarketFamily[] = [
  // Résultat
  family(MARKET_1X2, "Résultat du match", "result", { swap: "teams", alsoFor: WITH_RESULT }),
  family("double_chance", "Double chance", "result", { complete: false, swap: "teams", alsoFor: WITH_DOUBLE_CHANCE }),
  family("draw_no_bet", "Remboursé si match nul", "result", { swap: "teams", alsoFor: WITH_RESULT }),
  family("handicap", "Handicap : {1} {h}", "result", { hasLine: true, swap: "handicap", alsoFor: IN_GOALS }),
  family("ht_ft", "Mi-temps / fin de match", "result", { swap: "teams", alsoFor: WITH_HALVES }),
  family("winning_margin", "Écart de victoire", "result", { swap: "margin" }),
  ...perTeam("win_to_nil", "{t} gagne sans encaisser de but", "result"),
  ...perTeam("win_both_halves", "{t} gagne les deux mi-temps", "result", { alsoFor: AND_BASKETBALL }),
  ...perTeam("win_either_half", "{t} gagne au moins une mi-temps", "result"),

  // Buts
  family("total_goals", "Nombre de buts", "goals", { hasLine: true, alsoFor: IN_GOALS }),
  ...perTeam("team_goals", "Buts de {t}", "goals", { hasLine: true, alsoFor: IN_GOALS }),
  family("btts", "Les deux équipes marquent", "goals", { alsoFor: IN_GOALS }),
  family("exact_goals", "Nombre exact de buts", "goals"),
  ...perTeam("team_exact_goals", "Nombre exact de buts de {t}", "goals"),
  family("first_team_to_score", "Première équipe à marquer", "goals", { swap: "teams" }),
  family("last_team_to_score", "Dernière équipe à marquer", "goals", { swap: "teams" }),
  ...perTeam("clean_sheet", "{t} n'encaisse pas de but", "goals"),
  ...perTeam("score_both_halves", "{t} marque dans les deux mi-temps", "goals"),
  family("highest_scoring_half", "Mi-temps la plus prolifique", "goals", { alsoFor: ["handball"] }),
  // Bands that differ between bookmakers (Winamax 4-6 and 7+, Betclic 4-5 and
  // 6+): the common ones are compared, the market has no TRJ.
  family("goal_bands", "Nombre de buts (tranches)", "goals"),
  family("first_goal_minute_10", "Minute du premier but (par 10 minutes)", "goals"),
  family("first_goal_minute_15", "Minute du premier but (par 15 minutes)", "goals"),
  // Which team scores that way: "1", "2", "any", "both", "none", and "no@1"
  // for "the first team doesn't". They overlap: no TRJ.
  family("penalty_goal", "But sur penalty", "goals", { complete: false, swap: "teams" }),
  family("header_goal", "But de la tête", "goals", { complete: false, swap: "teams" }),
  family("free_kick_goal", "But sur coup franc direct", "goals", { complete: false, swap: "teams" }),
  family("sub_scores", "Un remplaçant marque", "goals"),

  // 1re mi-temps
  family("ht_1X2", "Résultat à la mi-temps", "half", { swap: "teams", alsoFor: WITH_HALVES }),
  family("ht_double_chance", "Double chance à la mi-temps", "half", { complete: false, swap: "teams", alsoFor: ["rugby à xv", "handball"] }),
  family("ht_draw_no_bet", "Remboursé si nul à la mi-temps", "half", { swap: "teams", alsoFor: WITH_HALVES }),
  family("ht_handicap", "Handicap à la mi-temps : {1} {h}", "half", { hasLine: true, swap: "handicap", alsoFor: ["handball"] }),
  family("ht_total_goals", "Nombre de buts en 1re mi-temps", "half", { hasLine: true, alsoFor: ["handball"] }),
  ...perTeam("ht_team_goals", "Buts de {t} en 1re mi-temps", "half", { hasLine: true, alsoFor: ["handball"] }),
  family("ht_btts", "Les deux équipes marquent en 1re mi-temps", "half", { alsoFor: ["handball"] }),
  family("ht_exact_goals", "Nombre exact de buts en 1re mi-temps", "half"),
  family("ht_goal_bands", "Buts en 1re mi-temps (tranches)", "half", { complete: false }),
  ...perTeam("ht_clean_sheet", "{t} n'encaisse pas de but en 1re mi-temps", "half"),
  family("ht_result_total", "Résultat et nombre de buts à la mi-temps", "half", { hasLine: true, swap: "teams" }),
  family("ht_dc_btts", "Double chance et les deux équipes marquent à la mi-temps", "half", {
    complete: false,
    swap: "teams",
  }),
  family("ht_result_btts", "Résultat et les deux équipes marquent à la mi-temps", "half", { swap: "teams" }),
  family("ht_first_team_to_score", "Première équipe à marquer en 1re mi-temps", "half", { swap: "teams" }),
  family("ht_scorer", "Buteur en 1re mi-temps", "half", players()),
  family("ht_scorer_goals", "Marque au moins {n} buts en 1re mi-temps", "half", players({ hasLine: true })),
  family("ht_scorer_double_chance", "Double chance buteur en 1re mi-temps", "half", players({ combo: "or" })),
  family("ht_scorer_triple_chance", "Triple chance buteur en 1re mi-temps", "half", players({ combo: "or" })),
  family("ht_scorers_both", "Les deux joueurs marquent en 1re mi-temps", "half", players({ combo: "and" })),
  family("ht_header_goal", "But de la tête en 1re mi-temps", "half"),

  // 2e mi-temps (the second half alone): Betclic's, and Winamax's scorers.
  family("2h_1X2", "Résultat de la 2e mi-temps", "second_half", { swap: "teams", alsoFor: WITH_HALVES }),
  family("2h_double_chance", "Double chance en 2e mi-temps", "second_half", { complete: false, swap: "teams", alsoFor: ["rugby à xv", "handball"] }),
  family("2h_draw_no_bet", "Remboursé si nul en 2e mi-temps", "second_half", { swap: "teams", alsoFor: WITH_HALVES }),
  family("2h_handicap", "Handicap en 2e mi-temps : {1} {h}", "second_half", { hasLine: true, swap: "handicap", alsoFor: ["handball"] }),
  family("2h_total_goals", "Nombre de buts en 2e mi-temps", "second_half", { hasLine: true, alsoFor: ["handball"] }),
  ...perTeam("2h_team_goals", "Buts de {t} en 2e mi-temps", "second_half", { hasLine: true, alsoFor: ["handball"] }),
  family("2h_btts", "Les deux équipes marquent en 2e mi-temps", "second_half", { alsoFor: ["handball"] }),
  family("2h_exact_goals", "Nombre exact de buts en 2e mi-temps", "second_half"),
  family("2h_goal_bands", "Buts en 2e mi-temps (tranches)", "second_half", { complete: false }),
  ...perTeam("2h_clean_sheet", "{t} n'encaisse pas de but en 2e mi-temps", "second_half"),
  family("2h_first_team_to_score", "Première équipe à marquer en 2e mi-temps", "second_half", { swap: "teams" }),
  family("2h_result_total", "Résultat et nombre de buts en 2e mi-temps", "second_half", { hasLine: true, swap: "teams" }),
  family("2h_result_btts", "Résultat et les deux équipes marquent en 2e mi-temps", "second_half", { swap: "teams" }),
  family("2h_correct_score", "Score exact de la 2e mi-temps", "second_half", { swap: "scores" }),
  family("2h_scorer", "Buteur en 2e mi-temps", "second_half", players()),
  family("2h_scorer_goals", "Marque au moins {n} buts en 2e mi-temps", "second_half", players({ hasLine: true })),
  family("2h_scorer_double_chance", "Double chance buteur en 2e mi-temps", "second_half", players({ combo: "or" })),
  family("2h_scorer_triple_chance", "Triple chance buteur en 2e mi-temps", "second_half", players({ combo: "or" })),
  family("2h_scorers_both", "Les deux joueurs marquent en 2e mi-temps", "second_half", players({ combo: "and" })),
  family("2h_header_goal", "But de la tête en 2e mi-temps", "second_half"),

  // Score exact
  family("correct_score", "Score exact", "score", { swap: "scores" }),
  family("multi_score", "Score exact multichance", "score", { swap: "scores" }),
  family("ht_correct_score", "Score exact à la mi-temps", "score", { swap: "scores" }),

  // Buteurs et passeurs
  family("anytime_scorer", "Buteur", "scorers", players()),
  family("first_scorer", "Premier buteur", "scorers", players()),
  family("last_scorer", "Dernier buteur", "scorers", players()),
  family("scorer_goals", "Marque au moins {n} buts", "scorers", players({ hasLine: true })),
  family("scorer_team_wins", "Buteur et son équipe gagne", "scorers", players()),
  family("scorer_both_halves", "Marque dans les deux mi-temps", "scorers", players()),
  family("scorer_double_chance", "Double chance buteur", "scorers", players({ combo: "or" })),
  family("scorer_triple_chance", "Triple chance buteur", "scorers", players({ combo: "or" })),
  family("scorers_both", "Les deux joueurs marquent", "scorers", players({ combo: "and" })),
  family("duo_goals", "Le duo marque plus de {n} buts", "scorers", players({ hasLine: true, combo: "and" })),
  family("trio_goals", "Le trio marque plus de {n} buts", "scorers", players({ hasLine: true, combo: "and" })),
  // Winnings multiplied by the player's goals (Winamax's "Serial Player",
  // Betclic's "Extra gains à chaque but"): priced the same way at both, about
  // 0.87 times the plain scorer's price (Danemark - Portugal, 29/09/2026).
  family("scorer_each_goal", "Buteur, gains multipliés par ses buts", "scorers", players()),
  family("decisive_player", "Joueur décisif (buteur ou passeur)", "scorers", players()),
  family("decisive_each_action", "Joueur décisif, gains multipliés par ses buts et passes", "scorers", players()),
  family("decisive_player_times", "Joueur décisif au moins {n} fois", "scorers", players({ hasLine: true })),
  family("decisive_double_chance", "Double chance joueur décisif", "scorers", players({ combo: "or" })),
  family("assist_each", "Passeur, gains multipliés par ses passes décisives", "scorers", players()),
  family("assist_double_chance", "Double chance passeur", "scorers", players({ combo: "or" })),
  family("assist_triple_chance", "Triple chance passeur", "scorers", players({ combo: "or" })),

  // Combinés
  family("result_btts", "Résultat et les deux équipes marquent", "combos", { swap: "teams" }),
  family("result_total", "Résultat et nombre de buts", "combos", { hasLine: true, swap: "teams" }),
  family("dc_btts", "Double chance et les deux équipes marquent", "combos", { complete: false, swap: "teams" }),
  family("dc_total", "Double chance et nombre de buts", "combos", { complete: false, hasLine: true, swap: "teams" }),
  family("first_goal_result", "Première équipe à marquer et résultat", "combos", { swap: "teams" }),

  // --- tennis: "1" and "2" are the players, "{1}" and "{2}" their names ---
  // Match (the winner is the listing's, "Vainqueur du match")
  tennis("games_handicap", "Handicap jeux : {1} {h}", "t_match", { hasLine: true, swap: "handicap", unit: GAMES }),
  tennis("set_handicap", "Handicap sets : {1} {h}", "t_match", { hasLine: true, swap: "handicap", unit: SETS }),
  tennis("set1_match", "Vainqueur du 1er set / du match", "t_match", { swap: "teams" }),
  tennis("winner_total_games", "Vainqueur et nombre de jeux", "t_match", { hasLine: true, swap: "teams", unit: GAMES }),

  // Sets
  tennis("set_betting", "Score en sets", "t_sets", { swap: "scores", unit: SETS }),
  tennis("total_sets", "Nombre de sets", "t_sets", { hasLine: true, unit: SETS }),
  tennis("exact_sets", "Nombre exact de sets", "t_sets", { unit: SETS }),
  ...perPlayer("win_a_set", "{t} gagne au moins un set", "t_sets"),
  tennis("tiebreak", "Tie-break dans le match", "t_sets"),
  tennis("bagel", "Un set gagné 6-0", "t_sets"),

  // Jeux
  tennis("total_games", "Nombre de jeux", "t_games", { hasLine: true, unit: GAMES }),
  ...perPlayer("player_games", "Jeux gagnés par {t}", "t_games", { hasLine: true, unit: GAMES }),

  // Par set
  tennis("set1_winner", "Vainqueur du 1er set", "t_set1", { swap: "teams" }),
  tennis("set2_winner", "Vainqueur du 2e set", "t_set1", { swap: "teams" }),
  tennis("set1_games_handicap", "Handicap jeux du 1er set : {1} {h}", "t_set1", { hasLine: true, swap: "handicap", unit: GAMES }),
  tennis("set1_total_games", "Nombre de jeux du 1er set", "t_set1", { hasLine: true, unit: GAMES }),
  tennis("set1_correct_score", "Score du 1er set", "t_set1", { swap: "scores", unit: GAMES }),

  // Aces et breaks: Betclic's aces are "over" only, so they have no TRJ.
  tennis("total_aces", "Nombre d'aces", "t_serve", { hasLine: true, unit: ACES }),
  ...perPlayer("player_aces", "Aces réussis par {t}", "t_serve", { hasLine: true, unit: ACES }),
  tennis("most_aces", "Plus d'aces", "t_serve", { swap: "teams" }),
  tennis("first_break", "Premier joueur à réussir un break", "t_serve", { swap: "teams" }),
  tennis("total_breaks", "Nombre de breaks", "t_serve", { hasLine: true, unit: BREAKS }),
  ...perPlayer("player_breaks", "Breaks réussis par {t}", "t_serve", { hasLine: true, unit: BREAKS }),

  // --- basketball: "1" and "2" are the teams, lines are in points, overtime
  // included in the match's own markets (the winner is the listing's,
  // "Vainqueur du match") and left out of a half's and a quarter's. The result
  // in regular time, the refund on a draw, half-time / full-time and winning
  // both halves are football's families above. ---
  // Résultat
  basketball("spread", "Handicap : {1} {h}", "result", { hasLine: true, swap: "handicap", alsoFor: IN_POINTS }),
  basketball("overtime", "Prolongation", "result", { alsoFor: AMERICAN_FOOTBALL }),
  ...perTeamBasketball("win_all_quarters", "{t} gagne tous les quarts-temps", "result"),

  // Points
  basketball("total_points", "Nombre de points", "points", { hasLine: true, alsoFor: IN_POINTS }),
  ...perTeamBasketball("team_points", "Points de {t}", "points", { hasLine: true, alsoFor: IN_POINTS }),
  basketball("winner_total", "Vainqueur et nombre de points", "points", { hasLine: true, swap: "teams" }),
  basketball("highest_quarter", "Quart-temps le plus prolifique", "points", { alsoFor: AMERICAN_FOOTBALL }),
  basketball("highest_half", "Mi-temps la plus prolifique", "points"),

  // 1re mi-temps
  basketball("ht_spread", "Handicap à la mi-temps : {1} {h}", "half", { hasLine: true, swap: "handicap", alsoFor: IN_POINTS }),
  basketball("ht_total_points", "Nombre de points en 1re mi-temps", "half", { hasLine: true, alsoFor: IN_POINTS }),
  ...perTeamBasketball("ht_team_points", "Points de {t} en 1re mi-temps", "half", { hasLine: true, alsoFor: IN_POINTS }),

  // 2e mi-temps
  basketball("2h_spread", "Handicap en 2e mi-temps : {1} {h}", "second_half", { hasLine: true, swap: "handicap", alsoFor: IN_POINTS }),
  basketball("2h_total_points", "Nombre de points en 2e mi-temps", "second_half", { hasLine: true, alsoFor: IN_POINTS }),
  ...perTeamBasketball("2h_team_points", "Points de {t} en 2e mi-temps", "second_half", { hasLine: true, alsoFor: IN_POINTS }),

  // Quart-temps
  ...QUARTERS.flatMap(quarterFamilies),

  // Joueurs: a market per player and line, over and under. A bookmaker's
  // "N or more" ladder is the over of N - 0.5.
  perPlayerBasketball("player_points", "Points de {p}", "p_points", POINTS),
  perPlayerBasketball("player_rebounds", "Rebonds de {p}", "p_rebounds", REBOUNDS),
  perPlayerBasketball("player_assists", "Passes décisives de {p}", "p_assists", ASSISTS),
  perPlayerBasketball("player_threes", "Paniers à 3 points de {p}", "p_threes", THREES),
  perPlayerBasketball("player_pra", "Points + rebonds + passes de {p}", "p_combos", POINTS),
  perPlayerBasketball("player_pr", "Points + rebonds de {p}", "p_combos", POINTS),
  perPlayerBasketball("player_pa", "Points + passes de {p}", "p_combos", POINTS),
  perPlayerBasketball("player_ra", "Rebonds + passes de {p}", "p_combos", REBOUNDS),
  basketball("top_scorer", "Meilleur marqueur", "p_best", players()),
  basketball("double_double", "Double-double", "p_best", players()),

  // --- ice hockey: "1" and "2" are the teams, lines are in goals; the plain
  // families above (the result, the handicap, the totals, the double chance...)
  // are regular time's, as the listing's 1X2 is. A bookmaker's overtime-included
  // version is its own family. ---
  hockey("ot_handicap", "Handicap, prolongations incluses : {1} {h}", "result", { hasLine: true, swap: "handicap" }),
  hockey("ot_total_goals", "Nombre de buts, prolongations incluses", "goals", { hasLine: true }),
  ...perTeamHockey("ot_team_goals", "Buts de {t}, prolongations incluses", "goals", { hasLine: true }),
  ...PERIODS.flatMap(periodFamilies),

  // Golf: a tournament's winners by player. A Top N has N winners; its line
  // is N. A round's leader has one, its line is the round (6/10/2026, Winamax,
  // Betclic and Unibet: Top 5, 10 and 20, the leader after the 1st round).
  golf("golf_top", "Dans le Top {n}", "g_top", { hasLine: true, winners: "line" }),
  golf("golf_round_leader", "Leader après le tour {n}", "g_round", { hasLine: true, winners: 1 }),
  ...NATIONALITIES.map(([slug, label]) => golf(`golf_best_${slug}`, `Meilleur ${label}`, "g_nation", { winners: 1 })),
];

// How many of a market's outcomes win: a golf Top N's N, the leader's one.
// Undefined for a market with exactly one outcome winning (every other).
export function winnersOf(parsed: ParsedMarketKey): number | undefined {
  if (parsed.kind !== "family" || parsed.family.winners === undefined) return undefined;
  return parsed.family.winners === "line" ? parsed.line : parsed.family.winners;
}

// The family of a bookmaker's "best of a nationality" title: Winamax's "Meilleur
// americain", Betclic's "Meilleur athlète Américain", Unibet's "Meilleur
// Américain", PMU's "Meilleur joueur espagnol" (and its "Meillleur joueur
// sud-africain", typo included) are "golf_best_americain". Undefined for another
// title, or a nationality the catalog has no family for.
export function golfBestOf(title: string): string | undefined {
  const plain = title.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const nationality = /^meill+eure? (?:athlete |joueu(?:r|se) )?(.+)$/.exec(plain.replace(/\s+/g, " ").trim())?.[1];
  if (!nationality) return undefined;
  const key = `golf_best_${nationality.replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "")}`;
  return FAMILY_BY_KEY.has(key) ? key : undefined;
}

// The families of a sport's matches.
export function familiesOf(sport: string): readonly MarketFamily[] {
  return FAMILIES.filter((f) => f.sport === sport || f.alsoFor?.includes(sport as Sport));
}

const FAMILY_BY_KEY = new Map(FAMILIES.map((f) => [f.key, f]));

// The players' markets (scorers, assisters, decisive players...): their
// outcomes are players. The listing can keep only the matches that have some.
export const PLAYER_FAMILIES: readonly string[] = FAMILIES.filter((f) => f.byPrice).map((f) => f.key);

const FAMILY_RANK = new Map(FAMILIES.map((f, i) => [f.key, i]));

export function familyOf(key: string): MarketFamily | undefined {
  return FAMILY_BY_KEY.get(key);
}

// --- market keys -------------------------------------------------------------

export function marketKey(familyKey: string, line?: number): string {
  return line === undefined ? familyKey : `${familyKey}|${line}`;
}

export type UnrecognizedSource = "winamax" | "betclic";

const UNRECOGNIZED_PREFIX: Record<UnrecognizedSource, string> = { winamax: "wx:", betclic: "bc:" };

// A market no family covers, under the bookmaker's own name.
export function unrecognizedMarketKey(bookmaker: UnrecognizedSource, name: string): string {
  return UNRECOGNIZED_PREFIX[bookmaker] + name.replace(/\s+/g, " ").trim();
}

// A player's market: its key carries the player after a "#".
export function playerMarketKey(familyKey: string, player: string, line?: number): string {
  const name = player.replace(/[|#]/g, " ").replace(/\s+/g, " ").trim();
  return `${familyKey}#${name}${line === undefined ? "" : `|${line}`}`;
}

export type ParsedMarketKey =
  | { kind: "family"; family: MarketFamily; line?: number; player?: string }
  | { kind: "unrecognized"; bookmaker: UnrecognizedSource; name: string }
  // A key written by the listing's own scrapers ("Vainqueur du match") or
  // one this version no longer knows.
  | { kind: "other"; name: string };

export function parseMarketKey(key: string): ParsedMarketKey {
  for (const [bookmaker, prefix] of Object.entries(UNRECOGNIZED_PREFIX) as [UnrecognizedSource, string][]) {
    if (key.startsWith(prefix)) return { kind: "unrecognized", bookmaker, name: key.slice(prefix.length) };
  }
  const [head, rawLine] = key.split("|");
  const hash = head.indexOf("#");
  const familyKey = hash === -1 ? head : head.slice(0, hash);
  const player = hash === -1 ? undefined : head.slice(hash + 1);
  const found = FAMILY_BY_KEY.get(familyKey);
  if (!found) return { kind: "other", name: key };
  // A family of a player's has one, and the others none.
  if (Boolean(found.perPlayer) !== (player !== undefined && player !== "")) return { kind: "other", name: key };
  const line = rawLine === undefined ? undefined : Number(rawLine);
  if (found.hasLine !== (line !== undefined) || (line !== undefined && !Number.isFinite(line))) {
    return { kind: "other", name: key };
  }
  return {
    kind: "family",
    family: found,
    ...(line === undefined ? {} : { line }),
    ...(player === undefined ? {} : { player }),
  };
}

// Display order of two parsed keys: sections, then families, then lines. A
// match's main market that no family covers (tennis's "Vainqueur du match")
// comes first.
export function compareMarketKeys(a: ParsedMarketKey, b: ParsedMarketKey): number {
  const rank = (k: ParsedMarketKey) =>
    k.kind === "family" ? (FAMILY_RANK.get(k.family.key) ?? 0) : k.kind === "other" ? -1 : Number.MAX_SAFE_INTEGER;
  const byFamily = rank(a) - rank(b);
  if (byFamily !== 0) return byFamily;
  if (a.kind === "family" && b.kind === "family") {
    // A statistic's players, in order, each with its lines.
    return (a.player ?? "").localeCompare(b.player ?? "", "fr") || (a.line ?? 0) - (b.line ?? 0);
  }
  const name = (k: ParsedMarketKey) => (k.kind === "family" ? "" : k.name);
  return name(a).localeCompare(name(b), "fr");
}

// --- turning a bookmaker's outcomes round -----------------------------------

const swapTeamChar = (c: string) => (c === "1" ? "2" : c === "2" ? "1" : c);
const DOUBLE_CHANCE_SWAP: Record<string, string> = { "1X": "X2", X2: "1X", "12": "12" };

export function swapOutcome(familyKey: string, outcome: string): string {
  // The listing's winner of the match is no family, but its outcomes are teams.
  if (familyKey === MARKET_MATCH_WINNER) return swapTeamChar(outcome);
  const f = FAMILY_BY_KEY.get(familyKey);
  switch (f?.swap) {
    case "teams":
    case "handicap":
      // Double chances keep their spelling: "1X" (1 or X) turned round is
      // "X2", and "12" stays "12".
      return outcome
        .split(/([&/>])/)
        .map((part) => DOUBLE_CHANCE_SWAP[part] ?? [...part].map(swapTeamChar).join(""))
        .join("");
    case "margin":
      return swapTeamChar(outcome[0]) + outcome.slice(1);
    case "scores":
      return outcome
        .split(",")
        .map((score) => {
          if (score === "other@1") return "other@2";
          if (score === "other@2") return "other@1";
          const m = /^(\d+)-(\d+)$/.exec(score);
          return m ? `${m[2]}-${m[1]}` : score;
        })
        .sort(compareScores)
        .join(",");
    default:
      return outcome;
  }
}

// "clean_sheet@1|…" <-> "clean_sheet@2|…": a team's own market becomes the
// other team's. A handicap's line is the first team's: "handicap|-1.5" <->
// "handicap|1.5".
export function swapMarketKey(key: string): string {
  const [familyKey, ...rest] = key.split("|");
  if (FAMILY_BY_KEY.get(familyKey)?.swap === "handicap" && rest.length === 1) {
    return `${familyKey}|${-Number(rest[0])}`;
  }
  const m = /^(.*)@([12])$/.exec(familyKey);
  if (!m || !FAMILY_BY_KEY.has(familyKey)) return key;
  return [`${m[1]}@${m[2] === "1" ? "2" : "1"}`, ...rest].join("|");
}

// --- whether a market's outcomes cover every case ---------------------------

// A family's outcomes cover every case only when none is missing: a
// bookmaker closes one now and then ("2+" of a half's exact goals), and the
// best prices of the others then add up to a false surebet. Checked against
// what each complete family's outcomes must be.
const fixed =
  (...outcomes: string[]) =>
  (seen: ReadonlySet<string>) =>
    seen.size === outcomes.length && outcomes.every((o) => seen.has(o));
const YES_NO_CASES = fixed("yes", "no");
const TEAMS_OR_NONE = fixed("1", "none", "2");
const OVER_UNDER_CASES = fixed("over", "under");
const PLAYERS_CASES = fixed("1", "2");

// A match's scores in sets: every way of winning it, for either player, in
// best of 3 (2-0, 2-1, 1-2, 0-2) or of 5 sets.
function everySetScore(seen: ReadonlySet<string>): boolean {
  const scores = [...seen].map((o) => /^(\d+)-(\d+)$/.exec(o)).map((m) => (m ? [Number(m[1]), Number(m[2])] : [NaN, NaN]));
  const n = Math.max(...scores.flat());
  if (!(n >= 2)) return false;
  const all = Array.from({ length: n }, (_, k) => [`${n}-${k}`, `${k}-${n}`]).flat();
  return seen.size === all.length && all.every((o) => seen.has(o));
}

// A match's number of sets: 2 or 3, 3 to 5.
function everySetCount(seen: ReadonlySet<string>): boolean {
  const counts = [...seen].map(Number).sort((a, b) => a - b);
  const [low] = counts;
  return counts.length === low && counts.every((c, i) => c === low + i);
}

// "0" to "k-1" goals, then "k+".
function everyGoalCount(seen: ReadonlySet<string>): boolean {
  const top = [...seen].find((o) => /^\d+\+$/.test(o));
  const k = top === undefined ? NaN : Number(top.slice(0, -1));
  return seen.size === k + 1 && Array.from({ length: k }, (_, i) => String(i)).every((o) => seen.has(o));
}

// Bands side by side from `from`, the last one open ("7+"), and whatever
// `extra` outcomes: goals from 0 ("0-1", "2-3", "4-6", "7+"), minutes from
// 1 to 90 and "none" ("1-15" ... "76-90").
function contiguousBands(seen: ReadonlySet<string>, from: number, to: number | "open", extra: string[] = []): boolean {
  if (!extra.every((o) => seen.has(o))) return false;
  const bands = [...seen]
    .filter((o) => !extra.includes(o))
    .map((o) => {
      const m = /^(\d+)(?:-(\d+)|(\+))?$/.exec(o);
      return m ? [Number(m[1]), m[3] ? Infinity : Number(m[2] ?? m[1])] : [NaN, NaN];
    })
    .sort((a, b) => a[0] - b[0]);
  let next = from;
  for (const [lo, hi] of bands) {
    if (lo !== next) return false;
    next = hi + 1;
  }
  return to === "open" ? next === Infinity : next === to + 1;
}

// By family, without its half ("ht_", "2h_") or team ("@1").
const CASES: Record<string, (seen: ReadonlySet<string>) => boolean> = {
  [MARKET_1X2]: fixed("1", "X", "2"),
  draw_no_bet: fixed("1", "2"),
  handicap: fixed("1", "2"),
  ht_ft: fixed("1/1", "1/X", "1/2", "X/1", "X/X", "X/2", "2/1", "2/X", "2/2"),
  winning_margin: fixed("1:1", "1:2", "1:3+", "X", "2:1", "2:2", "2:3+"),
  win_to_nil: YES_NO_CASES,
  win_both_halves: YES_NO_CASES,
  win_either_half: YES_NO_CASES,
  btts: YES_NO_CASES,
  clean_sheet: YES_NO_CASES,
  score_both_halves: YES_NO_CASES,
  sub_scores: YES_NO_CASES,
  total_goals: fixed("over", "under"),
  team_goals: fixed("over", "under"),
  exact_goals: everyGoalCount,
  team_exact_goals: everyGoalCount,
  goal_bands: (seen) => contiguousBands(seen, 0, "open"),
  first_goal_minute_10: (seen) => contiguousBands(seen, 1, 90, ["none"]),
  first_goal_minute_15: (seen) => contiguousBands(seen, 1, 90, ["none"]),
  first_team_to_score: TEAMS_OR_NONE,
  last_team_to_score: TEAMS_OR_NONE,
  highest_scoring_half: fixed("1st", "equal", "2nd"),
  header_goal: fixed("any", "none"),
  result_btts: fixed("1&yes", "1&no", "X&yes", "X&no", "2&yes", "2&no"),
  result_total: fixed("1&over", "1&under", "X&over", "X&under", "2&over", "2&under"),
  first_goal_result: fixed("1>1", "1>X", "1>2", "2>1", "2>X", "2>2", "none"),
  // Every score but those listed: which can't be told apart from a closed
  // one, but a market without its "other" is surely short.
  correct_score: (seen) => seen.has("other"),
  multi_score: (seen) => seen.has("other@1") && seen.has("other@2"),

  // Tennis
  games_handicap: PLAYERS_CASES,
  set_handicap: PLAYERS_CASES,
  set1_match: fixed("1/1", "1/2", "2/1", "2/2"),
  winner_total_games: fixed("1&over", "1&under", "2&over", "2&under"),
  set_betting: everySetScore,
  total_sets: OVER_UNDER_CASES,
  exact_sets: everySetCount,
  win_a_set: YES_NO_CASES,
  tiebreak: YES_NO_CASES,
  bagel: YES_NO_CASES,
  total_games: OVER_UNDER_CASES,
  player_games: OVER_UNDER_CASES,
  set1_winner: PLAYERS_CASES,
  set2_winner: PLAYERS_CASES,
  set1_games_handicap: PLAYERS_CASES,
  set1_total_games: OVER_UNDER_CASES,
  // A set's every score: 6-0 to 7-6, each way.
  set1_correct_score: fixed(...["6-0", "6-1", "6-2", "6-3", "6-4", "7-5", "7-6"].flatMap((s) => [s, s.split("-").reverse().join("-")])),
  total_aces: OVER_UNDER_CASES,
  player_aces: OVER_UNDER_CASES,
  most_aces: fixed("1", "X", "2"),
  first_break: PLAYERS_CASES,
  total_breaks: OVER_UNDER_CASES,
  player_breaks: OVER_UNDER_CASES,

  // Ice hockey (a period's and the overtime's, by their base family: "p1_1X2" is
  // "1X2", "ot_handicap" is "handicap")
  // Basketball (a half's and a quarter's, like a football half's, by their
  // base family: "q1_spread" is "spread")
  spread: PLAYERS_CASES,
  overtime: YES_NO_CASES,
  win_all_quarters: YES_NO_CASES,
  total_points: OVER_UNDER_CASES,
  team_points: OVER_UNDER_CASES,
  winner_total: fixed("1&over", "1&under", "2&over", "2&under"),
  highest_quarter: fixed("q1", "q2", "q3", "q4", "tie"),
  highest_half: fixed("1st", "2nd", "tie"),
  player_points: OVER_UNDER_CASES,
  player_rebounds: OVER_UNDER_CASES,
  player_assists: OVER_UNDER_CASES,
  player_threes: OVER_UNDER_CASES,
  player_pra: OVER_UNDER_CASES,
  player_pr: OVER_UNDER_CASES,
  player_pa: OVER_UNDER_CASES,
  player_ra: OVER_UNDER_CASES,
};

const casesOf = (familyKey: string) =>
  CASES[familyKey] ?? CASES[familyKey.replace(/^(ht|2h|q[1-4]|p[1-3]|ot)_/, "").replace(/@[12]$/, "")];

// Whether these outcomes of a complete family are all of its cases.
export function coversEveryCase(familyKey: string, outcomes: Iterable<string>): boolean {
  const cases = casesOf(familyKey);
  return cases !== undefined && familyOf(familyKey)?.complete === true && cases(new Set(outcomes));
}

// For the tests: every complete family has its cases.
export const hasCases = (familyKey: string) => casesOf(familyKey) !== undefined;

// --- outcome order and labels ------------------------------------------------

function compareScores(a: string, b: string): number {
  const parse = (s: string) => {
    const m = /^(\d+)-(\d+)$/.exec(s);
    return m ? [Number(m[1]), Number(m[2])] : [99, 99];
  };
  const [ah, aa] = parse(a);
  const [bh, ba] = parse(b);
  return ah - bh || aa - ba;
}

const TOKEN_RANK: Record<string, number> = {
  "1": 0,
  "1X": 1,
  X: 2,
  "12": 3,
  X2: 4,
  "2": 5,
  any: 6,
  both: 7,
  none: 8,
  "no@1": 9,
  "no@2": 10,
  yes: 0,
  no: 1,
  over: 0,
  under: 1,
  "1st": 0,
  equal: 1,
  "2nd": 2,
  q1: 0,
  q2: 1,
  q3: 2,
  q4: 3,
  tie: 4,
};

// A number of goals ("3", "3+", the band "1-2") by its value; any other token
// by its place in TOKEN_RANK. In a family whose outcomes name no team, "1"
// and "2" are goals, not teams.
function tokenRank(token: string, goals: boolean): number {
  // "No goal" after every number of goals or minute.
  if (goals && token === "none") return 1000;
  const n = /^(\d+)(?:(\+)|-(\d+))?$/.exec(token);
  if (n && (goals || !(token in TOKEN_RANK))) {
    return 10 + Number(n[1]) + (n[2] ? 0.5 : n[3] ? Number(n[3]) / 100 : 0);
  }
  if (token in TOKEN_RANK) return TOKEN_RANK[token];
  return 100;
}

// Scores: the first team's wins, then draws, then the second team's, each
// from the fewest goals; anything else ("other") last.
function scoreGroup(outcome: string): number {
  const m = /^(\d+)-(\d+)/.exec(outcome);
  if (!m) return outcome.includes("@1") ? 0.5 : outcome.includes("@2") ? 2.5 : outcome === "X" ? 1.5 : 3;
  const [h, a] = [Number(m[1]), Number(m[2])];
  return h > a ? 0 : h === a ? 1 : 2;
}

export function compareOutcomes(familyKey: string, a: string, b: string): number {
  const f = FAMILY_BY_KEY.get(familyKey);
  if (f?.swap === "scores") {
    return scoreGroup(a) - scoreGroup(b) || compareScores(a, b) || a.localeCompare(b);
  }
  const goals = f?.swap === "none";
  const ta = a.split(/[&/>:]/);
  const tb = b.split(/[&/>:]/);
  for (let i = 0; i < Math.max(ta.length, tb.length); i++) {
    const d = tokenRank(ta[i] ?? "", goals) - tokenRank(tb[i] ?? "", goals);
    if (d !== 0) return d;
  }
  return a.localeCompare(b, "fr");
}

// "2,5": French decimal comma.
export function formatLine(line: number): string {
  return String(line).replace(".", ",");
}

// "+1,5", "-0,5".
const signedLine = (line: number) => (line > 0 ? "+" : "") + formatLine(line);

export function marketLabel(f: MarketFamily, participants: readonly string[], line?: number, player?: string): string {
  const label = f.label
    .replace("{1}", participants[0] ?? "Équipe 1")
    .replace("{2}", participants[1] ?? "Équipe 2")
    .replace("{p}", player ?? "ce joueur");
  if (line === undefined) return label.replace(/ \{[hn]\}/, "");
  if (label.includes("{h}")) return label.replace("{h}", signedLine(line));
  if (label.includes("{n}")) return label.replace("{n}", formatLine(line));
  return `${label} (${formatLine(line)} ${f.unit.many})`;
}

function teamName(token: string, participants: readonly string[]): string {
  if (token === "1") return participants[0] ?? "Équipe 1";
  if (token === "2") return participants[1] ?? "Équipe 2";
  if (token === "X") return "Nul";
  if (token === "1X") return `${teamName("1", participants)} ou nul`;
  if (token === "X2") return `Nul ou ${teamName("2", participants)}`;
  if (token === "12") return `${teamName("1", participants)} ou ${teamName("2", participants)}`;
  return token;
}

const WORDS: Record<string, string> = {
  yes: "Oui",
  no: "Non",
  none: "Aucun but",
  any: "Au moins une équipe",
  both: "Les deux équipes",
  "1st": "1re mi-temps",
  equal: "Autant de buts",
  "2nd": "2e mi-temps",
  q1: "1er quart-temps",
  q2: "2e quart-temps",
  q3: "3e quart-temps",
  q4: "4e quart-temps",
  tie: "Égalité",
  other: "Autre score",
};

function overUnder(token: string, line: number | undefined): string {
  const side = token === "over" ? "Plus de" : "Moins de";
  return line === undefined ? side : `${side} ${formatLine(line)}`;
}

const count = (n: number, unit: Unit) => `${n} ${n > 1 ? unit.many : unit.one}`;

// A team (a player) with a half-goal (game, set) handicap, in words: -1.5
// "gagne par 2 buts ou plus", +1.5 "ne perd pas, ou perd par 1 but".
function handicapLabel(team: string, handicap: number, unit: Unit): string {
  if (handicap < 0) {
    const margin = -handicap + 0.5;
    return margin === 1 ? `${team} gagne` : `${team} gagne par ${count(margin, unit)} ou plus`;
  }
  const margin = handicap - 0.5;
  if (margin === 0) return `${team} ne perd pas`;
  return `${team} ne perd pas, ou perd par ${count(margin, unit)}${margin > 1 ? " au plus" : ""}`;
}

// "1" -> "1re", "10" -> "10e".
const ordinal = (n: string) => (n === "1" ? "1re" : `${n}e`);

// Which team scores a goal of that kind: "none" is no team, not no goal.
const GOAL_KINDS = new Set(["penalty_goal", "header_goal", "free_kick_goal"]);

// How an outcome reads on the dashboard.
export function outcomeLabel(
  familyKey: string,
  outcome: string,
  participants: readonly string[],
  line?: number
): string {
  const f = FAMILY_BY_KEY.get(familyKey);
  if (!f) return outcome;
  if (outcome === "none" && GOAL_KINDS.has(familyKey)) return "Aucune équipe";
  if (outcome in WORDS && outcome !== "other") return WORDS[outcome];
  if (outcome === "over" || outcome === "under") return overUnder(outcome, line);
  if (f.combo) return outcome.split(" / ").join(f.combo === "and" ? " et " : " ou ");

  switch (f.swap) {
    case "handicap": {
      if (line === undefined) return teamName(outcome, participants);
      return handicapLabel(teamName(outcome, participants), outcome === "1" ? line : -line, f.unit);
    }
    case "scores": {
      if (outcome === "X") return "Nul (autre score)";
      const parts = outcome.split(",").map((s) => {
        if (s === "other") return WORDS.other;
        const other = /^other@([12])$/.exec(s);
        if (other) return `${teamName(other[1], participants)} gagne (autre score)`;
        return s.replace("-", " - ");
      });
      return parts.length > 1 ? `${parts.slice(0, -1).join(", ")} ou ${parts[parts.length - 1]}` : parts[0];
    }
    case "margin": {
      if (outcome === "X") return "Nul";
      const [team, goals] = outcome.split(":");
      const n = goals.replace("+", "");
      const unit = n === "1" && !goals.endsWith("+") ? "but" : "buts";
      return `${teamName(team, participants)} par ${n} ${unit}${goals.endsWith("+") ? " ou plus" : ""}`;
    }
    case "teams": {
      if (familyKey === "first_goal_result") {
        const [scorer, result] = outcome.split(">");
        return `${teamName(scorer, participants)} marque en premier, ${result === "X" ? "nul" : `${teamName(result, participants)} gagne`}`;
      }
      if (familyKey === "most_aces" && outcome === "X") return "Égalité";
      if (familyKey === "ht_ft" || familyKey === "set1_match") {
        return outcome
          .split("/")
          .map((t) => teamName(t, participants))
          .join(" / ");
      }
      const not = /^no@([12])$/.exec(outcome);
      if (not) return `${teamName(not[1], participants)} ne marque pas`;
      return outcome
        .split("&")
        .map((t) => (t === "over" || t === "under" ? overUnder(t, line) : (WORDS[t] ?? teamName(t, participants))))
        .join(" & ");
    }
    default: {
      const plus = /^(\d+)\+$/.exec(outcome);
      if (plus) return `${plus[1]} ou plus`;
      const band = /^(\d+)-(\d+)$/.exec(outcome);
      if (band && familyKey.startsWith("first_goal_minute")) return `${ordinal(band[1])} à ${band[2]}e minute`;
      if (band) return `${band[1]} à ${band[2]}`;
      if (familyKey === "exact_sets") return count(Number(outcome), f.unit);
      return outcome;
    }
  }
}
