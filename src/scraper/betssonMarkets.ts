import { RawOdds } from "../types";
import { marketKey, playerMarketKey } from "../markets/catalog";
import { BetssonSelection, fractionalToDecimal, post } from "./betsson";
import { MARKET_1X2 } from "./canonical";
import { pool } from "./pool";

// Every market of a football, a tennis or a basketball match at Betsson, mapped onto the
// shared catalog (src/markets/catalog.ts). Betsson's content service answers
// the "event" of a match with all its markets: 148 for a Brasileirao match, 27
// for an ATP one (real captures of 8/10/2026, tests/scraper/fixtures/
// betsson-event-*.json.gz). A market has Betsson's own code (`idefmarkettype`:
// 21 is a total, 20 a handicap...), its selections the teams' names ("FC
// Santos ou Match nul"), their lines ("Moins de 2.5") and fractional prices.
//
// Only half-goal and half-game lines are read ("2.5"): a whole line refunds a
// push, a market the other bookmakers do not offer. A market of no family, the
// three-way handicaps, and the main market (the listing's own) are left out.

const CONCURRENCY = 3;

interface Market {
  name?: string;
  idefmarkettype?: string | number;
  selections: BetssonSelection[];
}
interface Context {
  home: string;
  away: string;
}
type Reader = (market: Market, ctx: Context) => RawOdds[];

const isHalfLine = (line: number) => Math.abs(line % 1) === 0.5;
const nameOf = (s: BetssonSelection) => s.name?.trim() ?? "";

// A market's selections under a family's key, one token each.
function pick(
  key: string,
  market: Market,
  ctx: Context,
  token: (name: string, ctx: Context) => string | undefined
): RawOdds[] {
  return market.selections.flatMap((s): RawOdds[] => {
    const selection = token(nameOf(s), ctx);
    const price = fractionalToDecimal(s.currentpriceup, s.currentpricedown);
    return selection !== undefined && price > 1 ? [{ market: key, selection, price }] : [];
  });
}

// "FC Santos" is the first team, "CR Flamengo RJ" the second, "Match nul" the draw.
function teamToken(text: string, ctx: Context): "1" | "2" | "X" | undefined {
  const t = text.trim();
  if (/^(match nul|nul|égal)$/i.test(t)) return "X";
  return t === ctx.home ? "1" : t === ctx.away ? "2" : undefined;
}

const YES_NO = (name: string) => ({ oui: "yes", non: "no" })[name.toLowerCase() as "oui" | "non"];

const yesNo =
  (family: string): Reader =>
  (m, ctx) =>
    pick(family, m, ctx, YES_NO);

const result =
  (family: string): Reader =>
  (m, ctx) =>
    pick(family, m, ctx, teamToken);

// "Moins de 2.5" / "Plus de 2.5": the line of an over/under market, its tokens.
function overUnderLine(name: string): { line: number; token: "over" | "under" } | undefined {
  const m = /^(moins|plus) de (\d+(?:\.\d+)?)$/i.exec(name);
  return m ? { line: Number(m[2]), token: m[1].toLowerCase() === "plus" ? "over" : "under" } : undefined;
}

const total =
  (family: string): Reader =>
  (m, ctx) =>
    m.selections.flatMap((s): RawOdds[] => {
      const parsed = overUnderLine(nameOf(s));
      const price = fractionalToDecimal(s.currentpriceup, s.currentpricedown);
      return parsed && isHalfLine(parsed.line) && price > 1
        ? [{ market: marketKey(family, parsed.line), selection: parsed.token, price }]
        : [];
    });

// "FC Santos (-0.5)" / "CR Flamengo RJ (+0.5)": a handicap with two outcomes, the
// line the first team's.
const handicap =
  (family: string): Reader =>
  (m, ctx) => {
    const parsed = m.selections.map((s) => {
      const match = /^(.*) \(([+-]\d+(?:\.\d+)?)\)$/.exec(nameOf(s));
      return { s, team: match ? teamToken(match[1], ctx) : undefined, line: match ? Number(match[2]) : NaN };
    });
    const home = parsed.find((p) => p.team === "1");
    if (!home || !isHalfLine(home.line)) return [];
    return parsed.flatMap(({ s, team }): RawOdds[] => {
      const price = fractionalToDecimal(s.currentpriceup, s.currentpricedown);
      return (team === "1" || team === "2") && price > 1
        ? [{ market: marketKey(family, home.line), selection: team, price }]
        : [];
    });
  };

// "FC Santos ou Match nul" is the double chance "1X".
function doubleChanceToken(name: string, ctx: Context): string | undefined {
  const [a, b] = name.split(" ou ").map((t) => teamToken(t, ctx));
  if (!a || !b || a === b) return undefined;
  const tokens = [a, b].sort().join("");
  return { "1X": "1X", "12": "12", "2X": "X2" }[tokens];
}

// "FC Santos/Match nul": the half-time result, then the match's.
function halfFullToken(name: string, ctx: Context): string | undefined {
  const [a, b] = name.split("/").map((t) => teamToken(t, ctx));
  return a && b ? `${a}/${b}` : undefined;
}

// "0:2" is the score "0-2"; "autre" every other score.
const scoreToken = (name: string): string | undefined =>
  /^\d+:\d+$/.test(name) ? name.replace(":", "-") : /^autre$/i.test(name) ? "other" : undefined;

const scores =
  (family: string): Reader =>
  (m, ctx) =>
    pick(family, m, ctx, scoreToken);

// A number of goals, or "3+": the family's own tokens.
const countToken = (name: string): string | undefined => (/^\d+\+?$/.test(name) ? name : undefined);
// Bands: "0-1", "2-3", "6+".
const bandToken = (name: string): string | undefined => (/^\d+(?:-\d+|\+)$/.test(name) ? name : undefined);

// The team that scores first or last, or "Aucun".
const firstOrLast =
  (family: string): Reader =>
  (m, ctx) =>
    pick(family, m, ctx, (name) => (/^aucun$/i.test(name) ? "none" : teamToken(name, ctx)));

// "FC Santos & moins de 1.5" on its line, the result's "1".."2" or the draw's "X".
const resultAndTotal =
  (family: string): Reader =>
  (m, ctx) =>
    m.selections.flatMap((s): RawOdds[] => {
      const [side, rest] = nameOf(s).split(" & ");
      const team = teamToken(side ?? "", ctx);
      const parsed = overUnderLine(rest ?? "");
      const price = fractionalToDecimal(s.currentpriceup, s.currentpricedown);
      return team && parsed && isHalfLine(parsed.line) && price > 1
        ? [{ market: marketKey(family, parsed.line), selection: `${team}&${parsed.token}`, price }]
        : [];
    });

// "FC Santos & oui" is "1&yes".
const resultAndBtts =
  (family: string): Reader =>
  (m, ctx) =>
    pick(family, m, ctx, (name) => {
      const [side, rest] = name.split(" & ");
      const team = teamToken(side ?? "", ctx);
      const yn = YES_NO(rest ?? "");
      return team && yn ? `${team}&${yn}` : undefined;
    });

// "but FC Santos & Match nul" is "1>X": who scores first, then the result.
const firstGoalResult: Reader = (m, ctx) =>
  pick("first_goal_result", m, ctx, (name) => {
    if (/^aucun but$/i.test(name)) return "none";
    const match = /^but (.*) & (.*)$/.exec(name);
    const [first, end] = match ? [teamToken(match[1], ctx), teamToken(match[2], ctx)] : [];
    return first && first !== "X" && end ? `${first}>${end}` : undefined;
  });

// "FC Santos par 3 ou +" is "1:3+", "CR Flamengo RJ par 1" "2:1", "Match nul" "X".
const winningMargin: Reader = (m, ctx) =>
  pick("winning_margin", m, ctx, (name) => {
    const match = /^(.*) par (\d)( ou \+)?$/.exec(name);
    if (!match) return teamToken(name, ctx) === "X" ? "X" : undefined;
    const team = teamToken(match[1], ctx);
    return team === "1" || team === "2" ? `${team}:${match[2]}${match[3] ? "+" : ""}` : undefined;
  });

const highestHalf: Reader = (m, ctx) =>
  pick("highest_scoring_half", m, ctx, (name) => ({ "1mt": "1st", "2ème mi-temps": "2nd", égal: "equal" })[name.toLowerCase() as "1mt"]);

// A minute band: "1-15", "Aucun" for no goal.
const minutes =
  (family: string): Reader =>
  (m, ctx) =>
    pick(family, m, ctx, (name) => (/^aucun$/i.test(name) ? "none" : /^\d+-\d+$/.test(name) ? name : undefined));

const FOOTBALL: Record<string, Reader> = {
  // Totals, by period and by team.
  "21": total("total_goals"),
  "22": total("team_goals@1"),
  "23": total("team_goals@2"),
  "72": total("ht_total_goals"),
  "73": total("ht_team_goals@1"),
  "74": total("ht_team_goals@2"),
  "94": total("2h_total_goals"),
  "95": total("2h_team_goals@1"),
  "96": total("2h_team_goals@2"),
  // Handicaps with two outcomes.
  "20": handicap("handicap"),
  "71": handicap("ht_handicap"),
  "93": handicap("2h_handicap"),
  // Results, chances and refunds, by period.
  "65": result("ht_1X2"),
  "88": result("2h_1X2"),
  "10": (m, ctx) => pick("double_chance", m, ctx, doubleChanceToken),
  "68": (m, ctx) => pick("ht_double_chance", m, ctx, doubleChanceToken),
  "90": (m, ctx) => pick("2h_double_chance", m, ctx, doubleChanceToken),
  "11": result("draw_no_bet"),
  "69": result("ht_draw_no_bet"),
  "91": result("2h_draw_no_bet"),
  "52": (m, ctx) => pick("ht_ft", m, ctx, halfFullToken),
  // Both teams scoring.
  "37": yesNo("btts"),
  "81": yesNo("ht_btts"),
  "99": yesNo("2h_btts"),
  // First and last to score, the half with the most goals, the first goal's minute.
  "8": firstOrLast("first_team_to_score"),
  "9": firstOrLast("last_team_to_score"),
  "67": firstOrLast("ht_first_team_to_score"),
  "89": firstOrLast("2h_first_team_to_score"),
  "57": highestHalf,
  "103": minutes("first_goal_minute_15"),
  "104": minutes("first_goal_minute_10"),
  // Counts and bands of goals.
  "25": (m, ctx) => pick("exact_goals", m, ctx, countToken),
  "27": (m, ctx) => pick("team_exact_goals@1", m, ctx, countToken),
  "29": (m, ctx) => pick("team_exact_goals@2", m, ctx, countToken),
  "76": (m, ctx) => pick("ht_exact_goals", m, ctx, countToken),
  "97": (m, ctx) => pick("2h_exact_goals", m, ctx, countToken),
  "32": (m, ctx) => pick("goal_bands", m, ctx, bandToken),
  // Scores.
  "50": scores("correct_score"),
  "87": scores("ht_correct_score"),
  "102": scores("2h_correct_score"),
  "17": winningMargin,
  // Combinations.
  "45": resultAndTotal("result_total"),
  "85": resultAndTotal("ht_result_total"),
  "43": resultAndBtts("result_btts"),
  "84": resultAndBtts("ht_result_btts"),
  "178": firstGoalResult,
  // A team's clean sheet, win to nil, halves.
  "39": yesNo("clean_sheet@1"),
  "40": yesNo("clean_sheet@2"),
  "82": yesNo("ht_clean_sheet@1"),
  "83": yesNo("ht_clean_sheet@2"),
  "100": yesNo("2h_clean_sheet@1"),
  "101": yesNo("2h_clean_sheet@2"),
  "41": yesNo("win_to_nil@1"),
  "42": yesNo("win_to_nil@2"),
  "53": yesNo("win_both_halves@1"),
  "54": yesNo("win_both_halves@2"),
  "55": yesNo("win_either_half@1"),
  "56": yesNo("win_either_half@2"),
  "61": yesNo("score_both_halves@1"),
  "62": yesNo("score_both_halves@2"),
};

// "Sakamoto, Rei & moins de 22.5": the player's win and the match's games over a line.
const winnerAndTotalGames: Reader = (m, ctx) =>
  m.selections.flatMap((s): RawOdds[] => {
    const [side, rest] = nameOf(s).split(" & ");
    const player = teamToken(side ?? "", ctx);
    const parsed = overUnderLine(rest ?? "");
    const price = fractionalToDecimal(s.currentpriceup, s.currentpricedown);
    return (player === "1" || player === "2") && parsed && isHalfLine(parsed.line) && price > 1
      ? [{ market: marketKey("winner_total_games", parsed.line), selection: `${player}&${parsed.token}`, price }]
      : [];
  });

// "Sakamoto, Rei/Rublev, Andrey": the first set's winner, then the match's.
const setAndMatch: Reader = (m, ctx) =>
  pick("set1_match", m, ctx, (name) => {
    const [a, b] = name.split("/").map((t) => teamToken(t, ctx));
    return (a === "1" || a === "2") && (b === "1" || b === "2") ? `${a}/${b}` : undefined;
  });

const TENNIS: Record<string, Reader> = {
  "182": total("total_games"),
  "183": total("player_games@1"),
  "184": total("player_games@2"),
  "472": total("total_sets"),
  "213": total("set1_total_games"),
  "180": handicap("games_handicap"),
  "181": handicap("set_handicap"),
  "193": (m, ctx) => pick("set_betting", m, ctx, (name) => (/^\d+:\d+$/.test(name) ? name.replace(":", "-") : undefined)),
  "189": (m, ctx) => pick("exact_sets", m, ctx, (name) => (/^\d+$/.test(name) ? name : undefined)),
  "203": result("set1_winner"),
  "204": result("set2_winner"),
  "228": (m, ctx) => pick("set1_correct_score", m, ctx, (name) => (/^\d:\d$/.test(name) ? name.replace(":", "-") : undefined)),
  "202": setAndMatch,
  "185": yesNo("win_a_set@1"),
  "186": yesNo("win_a_set@2"),
  "187": yesNo("bagel"),
  "2218": winnerAndTotalGames,
};

// Betsson writes a player "Lo, Maodo": "Maodo Lo".
const personOf = (name: string) =>
  name.includes(",")
    ? name
        .split(",")
        .map((part) => part.trim())
        .reverse()
        .join(" ")
    : name.trim();

// A ladder, one market for all the players of a statistic: "Lo, Maodo 6+" is
// the over of 5.5.
const playersLadder =
  (family: string): Reader =>
  (m) =>
    m.selections.flatMap((s): RawOdds[] => {
      const parsed = /^(.+) (\d+)\+$/.exec(nameOf(s));
      const price = fractionalToDecimal(s.currentpriceup, s.currentpricedown);
      return parsed && price > 1
        ? [{ market: playerMarketKey(family, personOf(parsed[1]), Number(parsed[2]) - 0.5), selection: "over", price }]
        : [];
    });

// A market a player, his name first in its title: "Ulanovas, Edgaras nombre
// de points", over and under a line.
const playerOverUnder =
  (family: string): Reader =>
  (m) => {
    const player = /^(.+?) nombre de /i.exec((m.name ?? "").trim())?.[1];
    if (!player) return [];
    return m.selections.flatMap((s): RawOdds[] => {
      const parsed = overUnderLine(nameOf(s));
      const price = fractionalToDecimal(s.currentpriceup, s.currentpricedown);
      return parsed && isHalfLine(parsed.line) && price > 1
        ? [{ market: playerMarketKey(family, personOf(player), parsed.line), selection: parsed.token, price }]
        : [];
    });
  };

// Basketball (a Euroleague match: 195 markets, 9/10/2026,
// tests/scraper/fixtures/betsson-event-basketball.json.gz). The winner,
// overtime included (288, "Vainqueur (prolongations incluses)"), is the
// listing's; the result (1) is in regular time, a draw possible.
const BASKETBALL: Record<string, Reader> = {
  "1": result(MARKET_1X2),
  "11": result("draw_no_bet"),
  "52": (m, ctx) => pick("ht_ft", m, ctx, halfFullToken),
  "53": yesNo("win_both_halves@1"),
  "54": yesNo("win_both_halves@2"),
  // "1er quart-temps", "2ème quart-temps"..., "égal".
  "302": (m, ctx) =>
    pick("highest_quarter", m, ctx, (name) => {
      const quarter = /^([1-4])(?:er|ème) quart-temps$/i.exec(name);
      return quarter ? `q${quarter[1]}` : /^[ée]gal/i.test(name) ? "tie" : undefined;
    }),
  "4732": yesNo("win_all_quarters@1"),
  "4733": yesNo("win_all_quarters@2"),
  // The match's own markets say "(prolongations incluses)".
  "292": handicap("spread"),
  "294": total("total_points"),
  "296": total("team_points@1"),
  "297": total("team_points@2"),
  "413": resultAndTotal("winner_total"),
  // A half's: the same codes as football's.
  "65": result("ht_1X2"),
  "88": result("2h_1X2"),
  "69": result("ht_draw_no_bet"),
  "91": result("2h_draw_no_bet"),
  "71": handicap("ht_spread"),
  "93": handicap("2h_spread"),
  "72": total("ht_total_points"),
  "94": total("2h_total_points"),
  // A quarter's (the first one's totals of a team only, the others' codes not
  // seen).
  "303": result("q1_1X2"),
  "304": result("q2_1X2"),
  "305": result("q3_1X2"),
  "306": result("q4_1X2"),
  "428": result("q1_draw_no_bet"),
  "432": handicap("q1_spread"),
  "433": handicap("q2_spread"),
  "434": handicap("q3_spread"),
  "435": handicap("q4_spread"),
  "307": total("q1_total_points"),
  "308": total("q2_total_points"),
  "309": total("q3_total_points"),
  "310": total("q4_total_points"),
  "1428": total("q1_team_points@1"),
  "1432": total("q1_team_points@2"),
  // The players': a ladder a statistic, and a market a player.
  "1538": playersLadder("player_points"),
  "1540": playersLadder("player_assists"),
  "1542": playersLadder("player_rebounds"),
  "1544": playersLadder("player_threes"),
  "1729": playerOverUnder("player_points"),
  "1730": playerOverUnder("player_assists"),
  "1731": playerOverUnder("player_rebounds"),
};

// A match's markets by its sport's code.
const BY_SPORT: Record<string, Record<string, Reader>> = { FBL: FOOTBALL, BKB: BASKETBALL, TNS: TENNIS };

interface EventReply {
  errorType?: string;
  data?: {
    participantname_home?: string;
    participantname_away?: string;
    idfosporttype?: string;
    markets?: Market[];
  };
}

// One match's markets, from the answer to its "event": football's, basketball's
// or tennis's by the event's sport. Other sports, an answer without an event (a match
// gone: CONTENT_NOT_FOUND) read nothing.
export function readBetssonEventMarkets(reply: EventReply): RawOdds[] {
  const event = reply.data;
  const table = event?.idfosporttype === undefined ? undefined : BY_SPORT[event.idfosporttype];
  const [home, away] = [event?.participantname_home?.trim(), event?.participantname_away?.trim()];
  if (!event || !table || !home || !away || !Array.isArray(event.markets)) return [];
  const ctx = { home, away };
  return event.markets.flatMap((market) => table[String(market.idefmarkettype)]?.(market, ctx) ?? []);
}

// The markets of the given Betsson matches, by their ids: one request each,
// a few at a time. A match that fails costs only its own markets; all of them
// failing is the bookmaker failing.
export async function fetchBetssonMarkets(ids: readonly string[]): Promise<Map<string, RawOdds[]>> {
  const markets = new Map<string, RawOdds[]>();
  if (ids.length === 0) return markets;
  const read = await pool(ids, CONCURRENCY, async (id) => readBetssonEventMarkets((await post("event", id)) as EventReply));
  read.forEach((r, i) => {
    if (r.status === "fulfilled") markets.set(ids[i], r.value);
    else console.warn(`[markets:betsson] match ${ids[i]} failed, skipping it:`, r.reason);
  });
  if (read.every((r) => r.status === "rejected")) throw new Error("every betsson match failed");
  return markets;
}
