import { RawOdds } from "../types";
import { golfBestOf, marketKey, playerMarketKey } from "../markets/catalog";
import { MARKET_1X2, MARKET_MATCH_WINNER } from "./canonical";
import {
  BASE_URL,
  fetchToken,
  HEADERS,
  kind,
  parsePrice,
  REQUEST_TIMEOUT_MS,
  spaceInitials,
  UnibetItem,
  UnibetPage,
} from "./unibet";

// The markets of an event at Unibet beside its main one (./unibet.ts), from the
// route its site asks for the markets of given events:
// /lvs-api/ff/<id>,<id>...?ext=1, with the same anonymous token as the
// listing's. A golf tournament answers in about 350 KB (6/10/2026,
// tests/scraper/fixtures/unibet-golf-markets.json.gz); a football match gives
// 150 to 425 markets in about 1 MB and a tennis match 60 in 70 KB (8/10/2026,
// tests/scraper/fixtures/unibet-{football,tennis}-markets.json.gz).
//
// A golf market's kind is not its type id (the winner, the leader and the best
// of a nationality share 3093): its title is. A football or a tennis market
// has its type and its period (`markettypeId`, `periodId`), a line in its
// outcomes' `spread` or titles, and French decimal prices. Only half-goal and
// half-game lines are read ("2.5"): a whole line refunds a push, a market the
// other bookmakers do not offer. A market of no family, the three-way
// handicaps and the main market (the listing's own) are left out.

// "Top 5", "Top 10": a market of several winners. "Leader à l'issue du 1er
// Round": the leader after a round. "Meilleur Américain": the best of a
// nationality.
const ROUNDS: Record<string, number> = { "1er": 1, premier: 1, "2e": 2, "2eme": 2, deuxieme: 2, "3e": 3, "3eme": 3, troisieme: 3 };
function golfMarketOf(title: string): string | undefined {
  const top = /^top (\d+)$/i.exec(title.trim());
  if (top) return marketKey("golf_top", Number(top[1]));
  const normalized = title.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const round = /^leader .*\b(1er|premier|2e|2eme|deuxieme|3e|3eme|troisieme) (?:round|tour)\b/.exec(normalized);
  return round ? marketKey("golf_round_leader", ROUNDS[round[1]]) : golfBestOf(title);
}

interface Market {
  item: UnibetItem;
  // Its outcomes Unibet shows and prices, in its own order.
  outcomes: UnibetItem[];
}
interface Context {
  // The two sides, as Unibet names them ("Santos", "R.Sakamoto").
  home: string;
  away: string;
}
type Reader = (market: Market, ctx: Context) => RawOdds[];

const isHalfLine = (line: number) => Math.abs(line % 1) === 0.5;
// "2,5" and "2.5".
const numberOf = (text: string) => Number(text.replace(",", "."));

// An outcome as a price under a family's key, one token each.
function pick(key: string, market: Market, token: (o: UnibetItem) => string | undefined): RawOdds[] {
  return market.outcomes.flatMap((o): RawOdds[] => {
    const selection = token(o);
    const price = parsePrice(o.price);
    return selection !== undefined && price > 1 ? [{ market: key, selection, price }] : [];
  });
}

// "Santos" is the first side, "Flamengo" the second, "N" or "Nul" the draw.
function sideToken(text: string, ctx: Context): "1" | "2" | "X" | undefined {
  const t = text.trim();
  if (/^(n|nul|match nul|égalité|egalité)$/i.test(t)) return "X";
  return t === ctx.home ? "1" : t === ctx.away ? "2" : undefined;
}

// The side a market's title is about: "Flamengo gagnera les 2 mi temps", "... - R.Sakamoto 10,5".
function sideOfTitle(title: string, ctx: Context): "1" | "2" | undefined {
  const [inHome, inAway] = [title.includes(ctx.home), title.includes(ctx.away)];
  return inHome === inAway ? undefined : inHome ? "1" : "2";
}

const YES_NO = (o: UnibetItem) => ({ oui: "yes", non: "no" })[(o.desc ?? "").trim().toLowerCase() as "oui" | "non"];

const yesNo =
  (family: string): Reader =>
  (m) =>
    pick(family, m, YES_NO);

// A yes/no market about the side the title names: "@1" or "@2" of the family.
const sideYesNo =
  (family: string): Reader =>
  (m, ctx) => {
    const side = sideOfTitle(m.item.desc ?? "", ctx);
    return side ? pick(`${family}@${side}`, m, YES_NO) : [];
  };

const results =
  (family: string): Reader =>
  (m, ctx) =>
    pick(family, m, (o) => sideToken(o.desc ?? "", ctx));

// "Plus 2.5" / "Moins 2,5": an over/under market, its line the outcome's own.
function overUnder(o: UnibetItem): { line: number; token: "over" | "under" } | undefined {
  const m = /^(plus|moins) (\d+(?:[.,]\d+)?)$/i.exec((o.desc ?? "").trim());
  return m ? { line: numberOf(m[2]), token: m[1].toLowerCase() === "plus" ? "over" : "under" } : undefined;
}

function totalOf(family: string, m: Market): RawOdds[] {
  return m.outcomes.flatMap((o): RawOdds[] => {
    const parsed = overUnder(o);
    const price = parsePrice(o.price);
    return parsed && isHalfLine(parsed.line) && price > 1
      ? [{ market: marketKey(family, parsed.line), selection: parsed.token, price }]
      : [];
  });
}

const total =
  (family: string): Reader =>
  (m) =>
    totalOf(family, m);

// A side's total: "Plus / Moins But(s) - Flamengo 0,5", "... Jeu(x) - R.Sakamoto 10,5".
const sideTotal =
  (family: string): Reader =>
  (m, ctx) => {
    const side = sideOfTitle(m.item.desc ?? "", ctx);
    return side ? totalOf(`${family}@${side}`, m) : [];
  };

// "Santos [-0,5]" / "Flamengo [+0,5]": a handicap with two outcomes, the line the first side's.
const handicap =
  (family: string): Reader =>
  (m, ctx) => {
    const parsed = m.outcomes.map((o) => {
      const match = /^(.*) \[([+-]?\d+(?:,\d+)?)\]$/.exec((o.desc ?? "").trim());
      return { o, side: match ? sideToken(match[1], ctx) : undefined, line: match ? numberOf(match[2]) : NaN };
    });
    const home = parsed.find((p) => p.side === "1");
    if (!home || !isHalfLine(home.line)) return [];
    return parsed.flatMap(({ o, side }): RawOdds[] => {
      const price = parsePrice(o.price);
      return (side === "1" || side === "2") && price > 1
        ? [{ market: marketKey(family, home.line), selection: side, price }]
        : [];
    });
  };

// "Santos / N": a double chance of two of the three results.
function doubleChanceOf(a: string, b: string, ctx: Context): string | undefined {
  const [x, y] = [sideToken(a, ctx), sideToken(b, ctx)];
  if (!x || !y || x === y) return undefined;
  return ({ "1X": "1X", "12": "12", "2X": "X2" } as Record<string, string>)[[x, y].sort().join("")];
}

const doubleChance =
  (family: string): Reader =>
  (m, ctx) =>
    pick(family, m, (o) => {
      const [a, b] = (o.desc ?? "").split(" / ");
      return b === undefined ? undefined : doubleChanceOf(a, b, ctx);
    });

// "Santos - N": the half-time result, then the match's.
const halfFullTime: Reader = (m, ctx) =>
  pick("ht_ft", m, (o) => {
    const [a, b] = (o.desc ?? "").split(" - ").map((t) => sideToken(t, ctx));
    return a && b ? `${a}/${b}` : undefined;
  });

const scores =
  (family: string): Reader =>
  (m) =>
    pick(family, m, (o) => {
      const text = (o.desc ?? "").trim();
      return /^\d+ - \d+$/.test(text) ? text.replace(" - ", "-") : /^autres?$/i.test(text) ? "other" : undefined;
    });

// Who scores first or last: a side, or "Pas de But".
const firstOrLast =
  (family: string): Reader =>
  (m, ctx) =>
    pick(family, m, (o) => (/^pas de but$/i.test((o.desc ?? "").trim()) ? "none" : sideToken(o.desc ?? "", ctx)));

// "Santos et plus 1,5" / "Match nul et moins de 1,5": a result and the line.
const resultAndTotal =
  (family: string): Reader =>
  (m, ctx) =>
    m.outcomes.flatMap((o): RawOdds[] => {
      const match = /^(.*?) et (plus|moins)\b/i.exec((o.desc ?? "").trim());
      const side = match ? sideToken(match[1], ctx) : undefined;
      const price = parsePrice(o.price);
      return side && typeof o.spread === "number" && isHalfLine(o.spread) && price > 1
        ? [{ market: marketKey(family, o.spread), selection: `${side}&${match![2].toLowerCase() === "plus" ? "over" : "under"}`, price }]
        : [];
    });

// "Santos / Oui", "N / Non": a result and both teams scoring.
const resultAndBtts =
  (family: string): Reader =>
  (m, ctx) =>
    pick(family, m, (o) => {
      const [a, b] = (o.desc ?? "").split(" / ");
      const side = sideToken(a ?? "", ctx);
      const yn = b === undefined ? undefined : YES_NO({ desc: b });
      return side && yn ? `${side}&${yn}` : undefined;
    });

// "1 / Nul et Oui", "Nul / 2 et Non": a double chance (the sides as 1, Nul, 2) and both teams scoring.
const NUMBERED: Record<string, string> = { "1": "1", nul: "X", "2": "2" };
const doubleChanceAndBtts =
  (family: string): Reader =>
  (m) =>
    pick(family, m, (o) => {
      const match = /^(1|Nul|2) \/ (1|Nul|2) et (Oui|Non)$/i.exec((o.desc ?? "").trim());
      if (!match) return undefined;
      const chance = ({ "1X": "1X", "12": "12", "2X": "X2" } as Record<string, string>)[
        [NUMBERED[match[1].toLowerCase()], NUMBERED[match[2].toLowerCase()]].sort().join("")
      ];
      return chance ? `${chance}&${match[3].toLowerCase() === "oui" ? "yes" : "no"}` : undefined;
    });

// "Santos / Nul et Plus de 1.5 Buts": a double chance and a total.
const doubleChanceAndTotal: Reader = (m, ctx) =>
  m.outcomes.flatMap((o): RawOdds[] => {
    const match = /^(.*?) \/ (.*?) et (plus|moins) de\s+(\d+(?:\.\d+)?)/i.exec((o.desc ?? "").trim());
    const chance = match ? doubleChanceOf(match[1], match[2], ctx) : undefined;
    const line = match ? Number(match[4]) : NaN;
    const price = parsePrice(o.price);
    return chance && isHalfLine(line) && price > 1
      ? [{ market: marketKey("dc_total", line), selection: `${chance}&${match![3].toLowerCase() === "plus" ? "over" : "under"}`, price }]
      : [];
  });

// "Santos marque le 1er but et gagne": which side scores first, then how the match ends.
const firstGoalResult: Reader = (m, ctx) =>
  pick("first_goal_result", m, (o) => {
    const text = (o.desc ?? "").trim();
    if (/^pas de but$/i.test(text)) return "none";
    const match = /^(.*) marque le 1er but et (gagne|match nul|perd)$/i.exec(text);
    const first = match ? sideToken(match[1], ctx) : undefined;
    if (!match || (first !== "1" && first !== "2")) return undefined;
    const how = match[2].toLowerCase();
    return `${first}>${how === "match nul" ? "X" : how === "gagne" ? first : first === "1" ? "2" : "1"}`;
  });

// "Santos par exactement 2 Buts", "Flamengo par 3 Buts ou plus", "Nul".
const winningMargin: Reader = (m, ctx) =>
  pick("winning_margin", m, (o) => {
    const text = (o.desc ?? "").trim();
    if (/^nul$/i.test(text)) return "X";
    const match = /^(.*) par (?:exactement )?(\d)(?: buts? ou plus)?/i.exec(text);
    const side = match ? sideToken(match[1], ctx) : undefined;
    return match && (side === "1" || side === "2") ? `${side}:${match[2]}${/ou plus/i.test(text) ? "+" : ""}` : undefined;
  });

// "Exactement 0", "3 et Plus", "Pas de but": a side's number of goals.
const countToken = (o: UnibetItem): string | undefined => {
  const text = (o.desc ?? "").trim();
  if (/^pas de but$/i.test(text)) return "0";
  const exactly = /^exactement (\d+)$/i.exec(text);
  if (exactly) return exactly[1];
  const more = /^(\d+) (?:et plus|ou plus|\+)$/i.exec(text) ?? /^(\d+)\+$/.exec(text);
  return more ? `${more[1]}+` : /^\d+$/.test(text) ? text : undefined;
};

const sideExactGoals: Reader = (m, ctx) => {
  const side = sideOfTitle(m.item.desc ?? "", ctx);
  return side ? pick(`team_exact_goals@${side}`, m, countToken) : [];
};

const bandToken = (o: UnibetItem): string | undefined => {
  const text = (o.desc ?? "").trim();
  return /^\d+-\d+$/.test(text) ? text : /^(\d+) et plus$/i.test(text) ? `${/^(\d+)/.exec(text)![1]}+` : undefined;
};

// A band of minutes, by its end ("[10:00 - 19:59]" ends at 20): "11-20".
const minutes =
  (family: string, width: number): Reader =>
  (m) =>
    pick(family, m, (o) => {
      if (/^aucun$/i.test((o.desc ?? "").trim())) return "none";
      return typeof o.spread === "number" && o.spread > 0 ? `${o.spread - width + 1}-${o.spread}` : undefined;
    });

const highestHalf: Reader = (m) =>
  pick("highest_scoring_half", m, (o) =>
    /^1[èe]re mi-temps$/i.test((o.desc ?? "").trim())
      ? "1st"
      : /^2nde mi-temps$/i.test((o.desc ?? "").trim())
        ? "2nd"
        : /^[ée]galit[ée]$/i.test((o.desc ?? "").trim())
          ? "equal"
          : undefined
  );

// A football market, by Unibet's type and then its period: 100 is the match,
// 102 its first half, 103 its second.
const FOOTBALL: Record<string, Reader> = {};
function football(type: number, periods: Record<number, Reader>) {
  for (const [period, reader] of Object.entries(periods)) FOOTBALL[`${type}:${period}`] = reader;
}
football(994001025, { 100: total("total_goals"), 102: total("ht_total_goals"), 103: total("2h_total_goals") });
football(3007, { 100: sideTotal("team_goals"), 102: sideTotal("ht_team_goals"), 103: sideTotal("2h_team_goals") });
football(3021, { 100: handicap("handicap"), 102: handicap("ht_handicap"), 103: handicap("2h_handicap") });
// The match's result is the listing's.
football(1, { 102: results("ht_1X2"), 103: results("2h_1X2") });
football(605, { 100: doubleChance("double_chance"), 102: doubleChance("ht_double_chance"), 103: doubleChance("2h_double_chance") });
football(571, { 100: results("draw_no_bet"), 102: results("ht_draw_no_bet"), 103: results("2h_draw_no_bet") });
football(350, { 100: yesNo("btts"), 102: yesNo("ht_btts"), 103: yesNo("2h_btts") });
football(29, { 100: firstOrLast("first_team_to_score"), 102: firstOrLast("ht_first_team_to_score"), 103: firstOrLast("2h_first_team_to_score") });
football(481, { 100: firstOrLast("last_team_to_score") });
football(27, { 100: halfFullTime });
football(28, { 100: scores("correct_score"), 102: scores("ht_correct_score"), 103: scores("2h_correct_score") });
football(110125, { 100: resultAndTotal("result_total"), 102: resultAndTotal("ht_result_total"), 103: resultAndTotal("2h_result_total") });
football(120769, { 100: resultAndBtts("result_btts"), 102: resultAndBtts("ht_result_btts"), 103: resultAndBtts("2h_result_btts") });
football(994001268, { 100: doubleChanceAndBtts("dc_btts"), 102: doubleChanceAndBtts("ht_dc_btts") });
football(994001270, { 100: doubleChanceAndTotal });
football(994001254, { 100: firstGoalResult });
football(994001022, { 100: winningMargin });
football(611, { 100: sideExactGoals });
football(994001103, { 102: (m) => pick("ht_exact_goals", m, countToken), 103: (m) => pick("2h_exact_goals", m, countToken) });
football(994001032, { 100: (m) => pick("exact_goals", m, countToken) });
football(994001039, { 100: (m) => pick("goal_bands", m, bandToken) });
football(1000, { 100: highestHalf });
football(120942, { 100: minutes("first_goal_minute_10", 10) });
football(120943, { 100: minutes("first_goal_minute_15", 15) });
football(110114, { 100: yesNo("clean_sheet@1"), 102: yesNo("ht_clean_sheet@1"), 103: yesNo("2h_clean_sheet@1") });
football(110115, { 100: yesNo("clean_sheet@2"), 102: yesNo("ht_clean_sheet@2"), 103: yesNo("2h_clean_sheet@2") });
// A side's win to nil, both halves, one of them, scoring in both: the side is in the title.
football(994001052, { 100: sideYesNo("win_to_nil") });
football(994001053, { 100: sideYesNo("win_to_nil") });
football(120765, { 100: sideYesNo("win_both_halves") });
football(120940, { 100: sideYesNo("win_either_half") });
football(994001080, { 100: sideYesNo("score_both_halves") });
football(994001081, { 100: sideYesNo("score_both_halves") });

// "Santos - Santos"-like set and match: "R.Sakamoto / A.Rublev", the first set's winner then the match's.
const setAndMatch: Reader = (m, ctx) =>
  pick("set1_match", m, (o) => {
    const [a, b] = (o.desc ?? "").split(" / ").map((t) => sideToken(t, ctx));
    return (a === "1" || a === "2") && (b === "1" || b === "2") ? `${a}/${b}` : undefined;
  });

// "2 - 0": a set score, "6 - 4" a set's.
const setScores =
  (family: string): Reader =>
  (m) =>
    pick(family, m, (o) => (/^\d+ - \d+$/.test((o.desc ?? "").trim()) ? (o.desc ?? "").trim().replace(" - ", "-") : undefined));

// "R.Sakamoto gagne et plus de 22.5 jeux": the winner and the games over a line.
const winnerAndTotalGames: Reader = (m, ctx) =>
  m.outcomes.flatMap((o): RawOdds[] => {
    const match = /^(.*) gagne et (plus|moins) de (\d+(?:\.\d+)?) jeux$/i.exec((o.desc ?? "").trim());
    const side = match ? sideToken(match[1], ctx) : undefined;
    const line = match ? Number(match[3]) : NaN;
    const price = parsePrice(o.price);
    return (side === "1" || side === "2") && isHalfLine(line) && price > 1
      ? [{ market: marketKey("winner_total_games", line), selection: `${side}&${match![2].toLowerCase() === "plus" ? "over" : "under"}`, price }]
      : [];
  });

// "Plus / Moins (Aces) 18,5" is the match's, "... - A.Rublev 8,5" a player's.
const aces: Reader = (m, ctx) => {
  const title = m.item.desc ?? "";
  if (!/ - /.test(title)) return totalOf("total_aces", m);
  const side = sideOfTitle(title, ctx);
  return side ? totalOf(`player_aces@${side}`, m) : [];
};

const TENNIS: Record<string, Reader> = {};
function tennis(type: number, periods: Record<number, Reader>) {
  for (const [period, reader] of Object.entries(periods)) TENNIS[`${type}:${period}`] = reader;
}
tennis(840, { 113: setScores("set_betting") });
tennis(120997, { 113: sideYesNo("win_a_set") });
tennis(994002007, { 113: handicap("set_handicap") });
tennis(100001897, { 113: handicap("games_handicap"), 114: handicap("set1_games_handicap") });
tennis(10098, { 113: (m) => pick("exact_sets", m, (o) => /^(\d+) sets?$/i.exec((o.desc ?? "").trim())?.[1]) });
tennis(120999, { 113: setAndMatch });
tennis(1028, { 113: total("total_games"), 114: total("set1_total_games") });
tennis(121066, { 113: sideTotal("player_games") });
tennis(10047, { 114: setScores("set1_correct_score") });
tennis(68, { 114: results("set1_winner"), 115: results("set2_winner") });
tennis(994002137, { 113: winnerAndTotalGames });
tennis(120797, { 113: yesNo("bagel") });
tennis(110102, { 113: aces });

// A basketball market, by Unibet's type and then its period: 209 is the whole
// match, overtime included ("Match"), 1195 its regular time ("Temps
// réglementaire"), 210 and 211 its halves, 213 to 216 its quarters. The same
// type can be for one or the other from a competition to another (a Euroleague
// match's handicaps are in regular time, a WNBA match's in "Match"), so each
// reader checks the period's name too, not only its id.
const BASKETBALL: Record<string, Reader> = {};
function basketball(type: number, periods: readonly number[], reader: Reader) {
  for (const period of periods) BASKETBALL[`${type}:${period}`] = reader;
}

// The prefix of a period's families: the match's (overtime included) and its
// regular time have none, a half has "ht_" or "2h_", a quarter "q1_"...
const PERIOD_PREFIXES: Record<string, string> = {
  "1ère Mi-temps": "ht_",
  "2ème Mi-temps": "2h_",
  "1er Quart-temps": "q1_",
  "2ème Quart-temps": "q2_",
  "3ème Quart-temps": "q3_",
  "4ème Quart-temps": "q4_",
};
const MATCH = "Match";
const REGULAR_TIME = "Temps réglementaire";

// A reader of the match or of a half or a quarter, whose families' keys are
// made of the period's prefix. `of` lists the whole-match periods it is read
// in ("Match" and/or regular time): the periods of a half or a quarter always.
const inPeriods =
  (of: readonly string[], build: (prefix: string) => Reader): Reader =>
  (m, ctx) => {
    const period = m.item.period ?? "";
    const prefix = of.includes(period) ? "" : PERIOD_PREFIXES[period];
    return prefix === undefined ? [] : build(prefix)(m, ctx);
  };

const ALL_PERIODS = [209, 1195, 210, 211, 213, 214, 215, 216];
// The result in regular time, a draw possible ("1 N 2"), the same in a half or
// a quarter. The refund on a draw ("Face à Face" in regular time, a half, a
// quarter) beside it.
basketball(3056, ALL_PERIODS, inPeriods([REGULAR_TIME], (prefix) => results(`${prefix}1X2`)));
basketball(3059, ALL_PERIODS, (m, ctx) =>
  // The winner, overtime included, is the "Face à Face" of the whole match;
  // Unibet's listing gives its result in regular time instead.
  m.item.period === MATCH
    ? results(MARKET_MATCH_WINNER)(m, ctx)
    : inPeriods([REGULAR_TIME], (prefix) => results(`${prefix}draw_no_bet`))(m, ctx)
);
// The handicap, the totals, a team's (the team in the title): overtime
// included for the whole match, so not its regular time.
basketball(3061, ALL_PERIODS, inPeriods([MATCH], (prefix) => handicap(`${prefix}spread`)));
basketball(994003008, ALL_PERIODS, inPeriods([MATCH], (prefix) => total(`${prefix}total_points`)));
basketball(994003053, ALL_PERIODS, inPeriods([], (prefix) => total(`${prefix}total_points`)));
basketball(3060, ALL_PERIODS, inPeriods([MATCH], (prefix) => sideTotal(`${prefix}team_points`)));
// "Barcelone et Plus de 174.5": the winner and the total, overtime included.
basketball(994003060, [209], inPeriods([MATCH], () => resultAndTotal("winner_total")));
// The players': his name is in the market's title ("Plus / Moins Points -
// Edgaras Ulanovas", one market a player) or in each outcome's ("Marius
// Grigonis 18+", "Aleksander Balcerowski + de 12,5", one market for all of
// them). Unibet writes some in initials ("S.Umude"), spaced for the matcher.
// "18+" is the over of 17.5.
const nameOfPlayer = (name: string) => spaceInitials(name.trim());
const playerOfTitle = (m: Market) => {
  const name = /^.* - (.+)$/.exec((m.item.desc ?? "").trim())?.[1];
  return name ? nameOfPlayer(name) : undefined;
};
const OVER_UNDER_OF_PLAYER = /^(.+) ([+-]) de (\d+(?:[.,]\d+)?)$/;
const LADDER_OF_PLAYER = /^(.+) (\d+)\+$/;
const priced = (o: UnibetItem) => parsePrice(o.price) > 1;

// One market a player: "Plus 4.5" / "Moins 4.5".
const playerOverUnder =
  (family: string): Reader =>
  (m) => {
    const player = playerOfTitle(m);
    if (!player) return [];
    return m.outcomes.flatMap((o): RawOdds[] => {
      const parsed = overUnder(o);
      return parsed && isHalfLine(parsed.line) && priced(o)
        ? [{ market: playerMarketKey(family, player, parsed.line), selection: parsed.token, price: parsePrice(o.price) }]
        : [];
    });
  };

// One market for all the players: "Nom + de 12,5" / "Nom - de 12,5".
const playersOverUnder =
  (family: string): Reader =>
  (m) =>
    m.outcomes.flatMap((o): RawOdds[] => {
      const parsed = OVER_UNDER_OF_PLAYER.exec((o.desc ?? "").trim());
      const line = parsed ? numberOf(parsed[3]) : NaN;
      return parsed && isHalfLine(line) && priced(o)
        ? [{ market: playerMarketKey(family, nameOfPlayer(parsed[1]), line), selection: parsed[2] === "+" ? "over" : "under", price: parsePrice(o.price) }]
        : [];
    });

// A ladder, "Nom 18+": the over of 17.5.
const playersLadder =
  (family: string): Reader =>
  (m) =>
    m.outcomes.flatMap((o): RawOdds[] => {
      const parsed = LADDER_OF_PLAYER.exec((o.desc ?? "").trim());
      return parsed && priced(o)
        ? [{ market: playerMarketKey(family, nameOfPlayer(parsed[1]), Number(parsed[2]) - 0.5), selection: "over", price: parsePrice(o.price) }]
        : [];
    });

const playersOf = (family: string): Reader => (m) => pick(family, m, (o) => (o.desc ? nameOfPlayer(o.desc) : undefined));

const inMatch = (reader: Reader) => inPeriods([MATCH], () => reader);
basketball(994003092, [209], inMatch(playerOverUnder("player_points")));
basketball(994003094, [209], inMatch(playerOverUnder("player_rebounds")));
basketball(994003093, [209], inMatch(playerOverUnder("player_assists")));
basketball(994003095, [209], inMatch(playerOverUnder("player_threes")));
basketball(994003083, [209], inMatch(playersLadder("player_points")));
basketball(994003087, [209], inMatch(playersLadder("player_rebounds")));
basketball(994003085, [209], inMatch(playersLadder("player_assists")));
basketball(994003089, [209], inMatch(playersLadder("player_threes")));
basketball(100000560, [209], inMatch(playersOverUnder("player_pra")));
basketball(100000561, [209], inMatch(playersOverUnder("player_pr")));
basketball(100000562, [209], inMatch(playersOverUnder("player_pa")));
basketball(100000563, [209], inMatch(playersOverUnder("player_ra")));
basketball(120987, [209], inMatch(playersOf("top_scorer")));
basketball(1259, [1195], yesNo("overtime"));
// "1er Quart-Temps", "2ème Quart -Temps", "Plusieurs Quart-temps" (a tie).
basketball(13920, [1195], (m) =>
  pick("highest_quarter", m, (o) => {
    const text = (o.desc ?? "").trim();
    const quarter = /^([1-4])(?:er|ème|e) Quart ?-? ?Temps$/i.exec(text);
    return quarter ? `q${quarter[1]}` : /^plusieurs/i.test(text) ? "tie" : undefined;
  })
);
basketball(13810, [1195], halfFullTime);
basketball(994003203, [1195], sideYesNo("win_both_halves"));
basketball(994003204, [1195], sideYesNo("win_both_halves"));
basketball(994003211, [1195], sideYesNo("win_all_quarters"));
basketball(994003212, [1195], sideYesNo("win_all_quarters"));

// Ice hockey, American football and handball (real captures of 14/10/2026,
// tests/scraper/fixtures/unibet-{hockey,american-football,handball}-markets.json.gz:
// a Washington - Montréal NHL match with 1 230 items, an NFL one with 1 006, a
// Wetzlar - Erlangen handball one with 99). A period's id is the sport's, and each
// reader checks its name too (`named`), as basketball's do. Rugby union's page has
// the match's result and a three-way handicap only: no table.
type Table = Record<string, Reader>;
function register(names: Record<number, string>) {
  const table: Table = {};
  const add = (type: number, periods: Record<number, Reader>) => {
    for (const [period, reader] of Object.entries(periods)) {
      table[`${type}:${period}`] = (m, ctx) => ((m.item.period ?? "").trim().toLowerCase() === names[Number(period)] ? reader(m, ctx) : []);
    }
  };
  return { table, add };
}

// Ice hockey: 185 is the regular time ("Temps Réglementaire", the plain families), 186
// to 188 the thirds ("p1_" to "p3_"), 1191 the whole match, overtime and shootout
// included ("ot_"): its goals over a team's line come lower than the regular time's.
const hockey = register({ 185: "temps réglementaire", 186: "1er tiers-temps", 187: "2ème tiers-temps", 188: "3ème tiers-temps", 1191: "match" });
const PERIODS_OF_HOCKEY = [
  [186, "p1_"],
  [187, "p2_"],
  [188, "p3_"],
] as const;
const inThirds = (build: (prefix: string) => Reader) => Object.fromEntries(PERIODS_OF_HOCKEY.map(([id, prefix]) => [id, build(prefix)]));
// The regular time's result is the listing's.
hockey.add(361, inThirds((prefix) => results(`${prefix}1X2`)));
hockey.add(365, { 185: doubleChance("double_chance"), ...inThirds((prefix) => doubleChance(`${prefix}double_chance`)) });
hockey.add(370, { 185: yesNo("btts") });
// A third's "Face à Face" refunds a draw.
hockey.add(372, inThirds((prefix) => results(`${prefix}draw_no_bet`)));
hockey.add(10066, { 185: handicap("handicap"), ...inThirds((prefix) => handicap(`${prefix}handicap`)) });
hockey.add(10067, { 185: sideTotal("team_goals") });
hockey.add(994033019, { 185: total("total_goals") });
hockey.add(994033092, inThirds((prefix) => total(`${prefix}total_goals`)));
// A team's goals, one type a team (the team is in the title).
for (const type of [994033130, 994033131]) hockey.add(type, { 1191: sideTotal("ot_team_goals"), ...inThirds((prefix) => sideTotal(`${prefix}team_goals`)) });

// American football: 119 is the whole match, overtime included, 120 its regular time
// (left out: its families are the match's, overtime included), 122 and 123 its halves,
// 124 to 127 its quarters. The second half's bets do not say whether the overtime is in:
// only the first half is read.
const AMERICAN_FOOTBALL_PERIODS: Record<number, string> = {
  119: "match",
  120: "temps réglementaire",
  122: "1ère mi-temps",
  123: "2ème mi-temps",
  124: "1er quart-temps",
  125: "2ème quart-temps",
  126: "3ème quart-temps",
  127: "4ème quart-temps",
};
const americanFootball = register(AMERICAN_FOOTBALL_PERIODS);
const QUARTERS_OF_NFL = [
  [124, "q1_"],
  [125, "q2_"],
  [126, "q3_"],
  [127, "q4_"],
] as const;
// A family built on the first half's and the quarters' prefix, and the match's own.
const inNflPeriods = (build: (prefix: string) => Reader, match?: Reader): Record<number, Reader> => {
  const periods: Record<number, Reader> = { 122: build("ht_") };
  if (match) periods[119] = match;
  for (const [id, prefix] of QUARTERS_OF_NFL) periods[id] = build(prefix);
  return periods;
};
americanFootball.add(10089, inNflPeriods((prefix) => results(`${prefix}1X2`)));
// A half's and a quarter's "Face à Face" refunds a draw; the match's is the listing's.
americanFootball.add(11, inNflPeriods((prefix) => results(`${prefix}draw_no_bet`)));
americanFootball.add(10091, inNflPeriods((prefix) => handicap(`${prefix}spread`), handicap("spread")));
americanFootball.add(188, inNflPeriods((prefix) => total(`${prefix}total_points`), total("total_points")));
// A team's points, one type a team (the team is in the title).
for (const type of [994005037, 994005039]) americanFootball.add(type, { 119: sideTotal("team_points") });

// Handball: 1131 is the match ("Temps Réglementaire", no overtime in a league match), 140
// and 141 its halves.
const handball = register({ 1131: "temps réglementaire", 140: "1ère mi-temps", 141: "2ème mi-temps" });
handball.add(231, { 140: results("ht_1X2"), 141: results("2h_1X2") });
handball.add(3050, { 1131: total("total_goals"), 140: total("ht_total_goals") });
// "Face à Face" refunds a draw.
handball.add(3052, { 1131: results("draw_no_bet"), 140: results("ht_draw_no_bet"), 141: results("2h_draw_no_bet") });
handball.add(994031010, { 1131: handicap("handicap"), 140: handicap("ht_handicap") });
for (const type of [994031014, 994031016]) handball.add(type, { 1131: sideTotal("team_goals") });
handball.add(3048, { 1131: halfFullTime });
handball.add(1003, { 1131: highestHalf });

// A match's or a tournament's markets by its sport (the event's path).
const BY_SPORT: Record<string, Record<string, Reader>> = {
  Football: FOOTBALL,
  Tennis: TENNIS,
  Basketball: BASKETBALL,
  "Hockey Sur Glace": hockey.table,
  "Foot américain": americanFootball.table,
  Handball: handball.table,
};

// Every open price of the markets of one event of the page that the catalog
// knows. An outcome Unibet hides or does not price is not one to bet on.
export function readUnibetMarkets(page: UnibetPage, eventId: string): RawOdds[] {
  const items = page.items ?? {};
  const event = items[eventId];
  const outcomesByMarket = new Map<string, UnibetItem[]>();
  for (const [id, item] of Object.entries(items)) {
    if (kind(id) !== "o" || !item.parent || !item.desc || item.flags?.length || !item.price) continue;
    outcomesByMarket.set(item.parent, [...(outcomesByMarket.get(item.parent) ?? []), item]);
  }
  for (const outcomes of outcomesByMarket.values()) outcomes.sort((a, b) => (a.pos ?? 0) - (b.pos ?? 0));
  const sports = BY_SPORT[event?.path?.Sport ?? ""];
  const ctx = { home: event?.a?.trim() ?? "", away: event?.b?.trim() ?? "" };
  const odds: RawOdds[] = [];
  for (const [id, market] of Object.entries(items)) {
    if (kind(id) !== "m" || market.parent !== eventId || !market.desc) continue;
    const outcomes = outcomesByMarket.get(id) ?? [];
    if (sports) {
      if (ctx.home && ctx.away) odds.push(...(sports[`${market.markettypeId}:${market.periodId}`]?.({ item: market, outcomes }, ctx) ?? []));
      continue;
    }
    if (event?.path?.Sport !== "Golf") continue;
    const key = golfMarketOf(market.desc);
    if (!key) continue;
    for (const o of outcomes) odds.push({ market: key, selection: spaceInitials(o.desc!.trim()), price: parsePrice(o.price) });
  }
  return odds;
}

// A football match's markets weigh about 1 MB: the events come a few at a
// time, one request after the other, so a cycle asks for 300 matches in some
// sixty small requests, not in a flood.
const EVENTS_PER_REQUEST = 5;
const REQUEST_DELAY_MS = 250;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// The markets of the given Unibet events. A request that fails when none
// answered yet fails them all (the cycle logs it); a later one keeps what the
// earlier ones gave.
export async function fetchUnibetMarkets(eventIds: readonly string[]): Promise<Map<string, RawOdds[]>> {
  const byEvent = new Map<string, RawOdds[]>();
  if (eventIds.length === 0) return byEvent;
  const token = await fetchToken();
  for (let from = 0; from < eventIds.length; from += EVENTS_PER_REQUEST) {
    const ids = eventIds.slice(from, from + EVENTS_PER_REQUEST);
    if (from > 0) await sleep(REQUEST_DELAY_MS);
    const res = await fetch(
      `${BASE_URL}/ff/${ids.join(",")}?lineId=1&originId=3&ext=1&showPromotions=true&showMarketTypeGroups=true`,
      { headers: { ...HEADERS, "x-lvs-hstoken": token }, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }
    );
    if (!res.ok) {
      if (from === 0) throw new Error(`Unibet markets request failed: ${res.status}`);
      console.warn(`[markets:unibet] a request failed (${res.status}), keeping the ${byEvent.size} events read so far`);
      break;
    }
    const page = (await res.json()) as UnibetPage;
    for (const id of ids) byEvent.set(id, readUnibetMarkets(page, id));
  }
  return byEvent;
}
