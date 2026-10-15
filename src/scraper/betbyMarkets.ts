import { RawOdds } from "../types";
import { golfBestOf, marketKey, playerMarketKey } from "../markets/catalog";
import {
  BETIFY,
  BetbyEventDescriptions,
  BetbyMarketDescription,
  BetbyMarketDescriptions,
  BetbyMarketPrices,
  betbyGet,
  LANG,
  resolveBetbyFeed,
} from "./betby";
import { canonicalSport } from "./canonical";
import { pool } from "./pool";

// The markets of a football, a tennis or a basketball match at Betify, mapped
// onto the shared catalog (src/markets/catalog.ts). Betby's feed lists 8 to 10
// markets of a match (./betby.ts); the page of a match asks for the others:
// `event/fr/<id>` answers with every market of the match (183 for a Champions
// League match, 155 for a Portuguese second division one) and
// `descriptions/brand/<brand>/event/<id>/fr` with the names of the outcomes the
// descriptions of all markets (`markets/fr`) do not give: the players' (real
// captures of 14/10/2026, tests/scraper/fixtures/betify-event-*.json).
//
// A market is a number, the same from a match to another; its prices are by
// variant ("total=2.5", "hcp=-1.5", "quarternr=1|total=42.5", or a player's
// "variant=dst:playerprops:..."), then by outcome id, as text ("1.56"; "0.0" and
// `b: 1` for a blocked one). The outcomes are named by their description:
// "{$competitor1}" and "{$competitor2}" are the teams, "match nul" the draw,
// "plus de {total}" an over, "oui" a yes.
//
// Only half lines are read ("2.5"): a whole line refunds a push and a quarter one
// splits the stake, markets the other bookmakers do not offer. The main market
// (the listing's own), the three-way handicaps and the markets of no family
// (corners, cards, shots, parity...) are left out.

const CONCURRENCY = 2;
const REQUEST_DELAY_MS = 300;
// The sports whose players' markets are read: their names are in the match's own descriptions.
const PLAYER_SPORTS: ReadonlySet<string> = new Set(["football", "basketball", "golf"]);

type Spec = Record<string, string>;
interface Outcome {
  id: string;
  name: string;
  price: number;
}
interface Variant {
  spec: Spec;
  // The variant's own name: a player's market names the player.
  title: string;
  outcomes: Outcome[];
}
interface Market {
  variants: Variant[];
}
type Reader = (market: Market) => RawOdds[];
// A market's family: the same for every variant, or told by its specifiers (a quarter's).
type Family = string | ((spec: Spec) => string | undefined);
type Token = (name: string) => string | undefined;

export interface BetbyEventReply {
  sports?: Record<string, { name: string }>;
  events?: Record<string, { desc?: { sport?: string }; markets?: Record<string, BetbyMarketPrices> }>;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const isHalfLine = (line: number) => Math.abs(line % 1) === 0.5;
const familyFor = (family: Family, spec: Spec) => (typeof family === "string" ? family : family(spec));

// "goalnr=1|type=general" as { goalnr: "1", type: "general" }.
function parseSpec(key: string): Spec {
  return Object.fromEntries(
    key
      .split("|")
      .filter(Boolean)
      .map((part): [string, string] => {
        const at = part.indexOf("=");
        return at < 0 ? [part, ""] : [part.slice(0, at), part.slice(at + 1)];
      })
  );
}

// The variant of a description a prices' key stands for: the key without the
// specifiers the description lists ("total=2.5" is the variant "") or, for a
// market with none ("goalnr=1|type=general"), the key itself.
function describedVariant(description: BetbyMarketDescription | undefined, key: string) {
  const variants = description?.variants;
  if (!variants) return undefined;
  const specifiers = description.specifiers ?? [];
  const rest = key
    .split("|")
    .filter((part) => !specifiers.includes(part.split("=")[0]))
    .join("|");
  return (variants[key] ?? variants[rest])?.[0];
}

// A market's prices with the names of their outcomes; an outcome that is blocked
// or has no price is left out.
function marketOf(prices: BetbyMarketPrices, description: BetbyMarketDescription | undefined): Market {
  const variants = Object.entries(prices).flatMap(([key, byOutcome]): Variant[] => {
    const described = describedVariant(description, key);
    if (!described) return [];
    const outcomes = described.outcomes.flatMap((o): Outcome[] => {
      const p = byOutcome[o.id];
      const price = Number(p?.k);
      return p && !p.b && price > 1 ? [{ id: o.id, name: o.name, price }] : [];
    });
    return outcomes.length > 0 ? [{ spec: parseSpec(key), title: described.name ?? description?.name ?? "", outcomes }] : [];
  });
  return { variants };
}

// --- what the outcomes' names say ---------------------------------------------

const TEAM_1 = "{$competitor1}";
const TEAM_2 = "{$competitor2}";

// "{$competitor1}" is the first team, "match nul" the draw.
function sideOf(text: string): "1" | "2" | "X" | undefined {
  const t = text.trim();
  if (t === TEAM_1) return "1";
  if (t === TEAM_2) return "2";
  return /^(match )?nul$/i.test(t) ? "X" : undefined;
}
const yesNoOf: Token = (name) => ({ oui: "yes", non: "no" })[name.trim().toLowerCase() as "oui"];
const overUnderOf: Token = (name) => (/^plus de\b/i.test(name.trim()) ? "over" : /^moins de\b/i.test(name.trim()) ? "under" : undefined);
// "{$competitor1} ({+hcp})": the first team's side of a handicap.
const handicapSideOf: Token = (name) => (name.startsWith(TEAM_1) ? "1" : name.startsWith(TEAM_2) ? "2" : undefined);
const teamOf: Token = (name) => {
  const side = sideOf(name);
  return side === "1" || side === "2" ? side : undefined;
};
const resultOf: Token = (name) => sideOf(name);
// "{$competitor1}/match nul" or "{$competitor1} ou match nul": the double chance "1X".
const doubleChanceOf: Token = (name) => {
  const [a, b] = name.split(/\/| ou /).map(sideOf);
  if (!a || !b || a === b) return undefined;
  return ({ "1X": "1X", "12": "12", "2X": "X2" } as Record<string, string>)[[a, b].sort().join("")];
};
// "{$competitor1}/{$competitor2}": the half-time result, then the match's.
const halfFullOf: Token = (name) => {
  const [a, b] = name.split("/").map(sideOf);
  return a && b ? `${a}/${b}` : undefined;
};
// "2:1" is the score "2-1".
const scoreOf: Token = (name) => (/^\d+:\d+$/.test(name.trim()) ? name.trim().replace(":", "-") : undefined);
const countOf: Token = (name) => (/^\d+$/.test(name.trim()) ? name.trim() : undefined);
// "0-1 but", "2-3 buts", "7+ buts".
const bandOf: Token = (name) => /^(\d+(?:-\d+|\+)) buts?$/.exec(name.trim())?.[1];
// "1-10" minutes, "aucun" for no goal.
const minutesOf: Token = (name) => (/^aucun/i.test(name.trim()) ? "none" : /^\d+-\d+$/.test(name.trim()) ? name.trim() : undefined);
const firstOrLastOf: Token = (name) => (/^(aucun|pas de)/i.test(name.trim()) ? "none" : teamOf(name));
const halfOf: Token = (name) => ({ "1ère mi-temps": "1st", "2ème mi-temps": "2nd", égal: "equal" })[name.trim().toLowerCase() as "égal"];

// "{$competitor1} & moins de {total}": two parts, each read, joined.
const both =
  (first: Token, second: Token, join: string): Token =>
  (name) => {
    const [a, b, ...more] = name.split(" & ");
    const x = a === undefined ? undefined : first(a);
    const y = b === undefined ? undefined : second(b);
    return more.length === 0 && x !== undefined && y !== undefined ? `${x}${join}${y}` : undefined;
  };
// "{$competitor1} & {$competitor2}": who scores first, then the result, "1>2".
const firstGoalResultOf: Token = (name) => {
  const [result, first] = name.split(" & ");
  if (result === undefined || first === undefined) return undefined;
  if (/^ni l'une ni l'autre$/i.test(first.trim())) return sideOf(result) === "X" ? "none" : undefined;
  const r = sideOf(result);
  const f = teamOf(first);
  return r && f ? `${f}>${r}` : undefined;
};

// --- readers ------------------------------------------------------------------

// A market's outcomes under a family, one token each; `when` keeps some variants only.
const pick =
  (family: Family, token: Token, when: (spec: Spec) => boolean = () => true): Reader =>
  (market) =>
    market.variants.flatMap((v) => {
      const key = familyFor(family, v.spec);
      if (!key || !when(v.spec)) return [];
      return v.outcomes.flatMap((o): RawOdds[] => {
        const selection = token(o.name);
        return selection === undefined ? [] : [{ market: key, selection, price: o.price }];
      });
    });

// A market on a line: the total's or the handicap's, half lines only.
const onLine =
  (specifier: "total" | "hcp", family: Family, token: Token): Reader =>
  (market) =>
    market.variants.flatMap((v) => {
      const base = familyFor(family, v.spec);
      const line = Number(v.spec[specifier]);
      if (!base || !isHalfLine(line)) return [];
      return v.outcomes.flatMap((o): RawOdds[] => {
        const selection = token(o.name);
        return selection === undefined ? [] : [{ market: marketKey(base, line), selection, price: o.price }];
      });
    });

const total = (family: Family) => onLine("total", family, overUnderOf);
const handicap = (family: Family) => onLine("hcp", family, handicapSideOf);
const yesNo = (family: Family) => pick(family, yesNoOf);
const result = (family: Family) => pick(family, resultOf);
const twoWay = (family: Family) => pick(family, teamOf);

const GENERAL = (spec: Spec) => spec.type === undefined || spec.type === "general";
const THE_FIRST = (spec: Spec) => GENERAL(spec) && spec.goalnr === "1";

// A quarter's family, by its number: "q1_total_points".
const quarter =
  (suffix: string): Family =>
  (spec) =>
    /^[1-4]$/.test(spec.quarternr ?? "") ? `q${spec.quarternr}_${suffix}` : undefined;
// One of the first two sets: "set1_winner".
const set =
  (suffix: string, only?: readonly string[]): Family =>
  (spec) =>
    /^[12]$/.test(spec.setnr ?? "") && (!only || only.includes(spec.setnr)) ? `set${spec.setnr}_${suffix}` : undefined;

const isPlayer = (o: Outcome) => o.id.includes(":player:");
const trimmed = (name: string) => name.trim();
// "Devon Hall 13+": a player and the number he reaches.
const ladderOf = (name: string): { player: string; count: number } | undefined => {
  const m = /^(.+) (\d+)\+$/.exec(name.trim());
  return m ? { player: m[1], count: Number(m[2]) } : undefined;
};

// The players of a market, by name, whatever he is priced for.
const players =
  (family: string, when: (spec: Spec) => boolean = GENERAL): Reader =>
  (market) =>
    market.variants.flatMap((v) =>
      when(v.spec) ? v.outcomes.filter(isPlayer).map((o): RawOdds => ({ market: family, selection: trimmed(o.name), price: o.price })) : []
    );

// "Wilson Isidor 2+": at least 2 goals, "scorer_goals|2". The first goal is the scorer market's.
const scorerGoals: Reader = (market) =>
  market.variants.flatMap((v) =>
    v.outcomes.flatMap((o): RawOdds[] => {
      const ladder = ladderOf(o.name);
      return ladder && ladder.count >= 2 ? [{ market: marketKey("scorer_goals", ladder.count), selection: ladder.player, price: o.price }] : [];
    })
  );

// "Wilson Isidor 1+": a goal or an assist.
const decisivePlayer: Reader = (market) =>
  market.variants.flatMap((v) =>
    v.outcomes.flatMap((o): RawOdds[] => {
      const ladder = ladderOf(o.name);
      return ladder?.count === 1 ? [{ market: "decisive_player", selection: ladder.player, price: o.price }] : [];
    })
  );

// A player's statistic as a ladder, "13+" being the over of 12.5.
const playersLadder =
  (family: string): Reader =>
  (market) =>
    market.variants.flatMap((v) =>
      v.outcomes.flatMap((o): RawOdds[] => {
        const ladder = ladderOf(o.name);
        return ladder ? [{ market: playerMarketKey(family, ladder.player, ladder.count - 0.5), selection: "over", price: o.price }] : [];
      })
    );

// A market a player and a line, over and under, the player in its variant's name.
const playerOverUnder =
  (family: string, title: RegExp): Reader =>
  (market) =>
    market.variants.flatMap((v) => {
      const player = title.exec(v.title)?.[1]?.trim();
      const line = Number(v.spec.total);
      if (!player || !isHalfLine(line)) return [];
      return v.outcomes.flatMap((o): RawOdds[] => {
        const selection = overUnderOf(o.name);
        return selection === undefined ? [] : [{ market: playerMarketKey(family, player, line), selection, price: o.price }];
      });
    });

// --- the sports' tables, by market number --------------------------------------

const FOOTBALL: Record<string, Reader> = {
  // Totals, by period and by team.
  "18": total("total_goals"),
  "19": total("team_goals@1"),
  "20": total("team_goals@2"),
  "68": total("ht_total_goals"),
  "69": total("ht_team_goals@1"),
  "70": total("ht_team_goals@2"),
  // The two-way handicap, and the results, chances and refunds.
  "16": handicap("handicap"),
  "66": handicap("ht_handicap"),
  "10": pick("double_chance", doubleChanceOf),
  "63": pick("ht_double_chance", doubleChanceOf),
  "11": twoWay("draw_no_bet"),
  "64": twoWay("ht_draw_no_bet"),
  "60": result("ht_1X2"),
  "47": pick("ht_ft", halfFullOf),
  // Both teams scoring, the first and last to score, the best half, the first goal's minute.
  "29": yesNo("btts"),
  "75": yesNo("ht_btts"),
  "8": pick("first_team_to_score", firstOrLastOf, (spec) => spec.goalnr === "1"),
  "62": pick("ht_first_team_to_score", firstOrLastOf, (spec) => spec.goalnr === "1"),
  "13670": pick("last_team_to_score", firstOrLastOf),
  "52": pick("highest_scoring_half", halfOf),
  "101": pick("first_goal_minute_10", minutesOf, (spec) => spec.goalnr === "1"),
  // Counts and bands of goals.
  "25": pick("goal_bands", bandOf),
  "50063": pick("exact_goals", countOf),
  "50064": pick("team_exact_goals@1", countOf),
  "50065": pick("team_exact_goals@2", countOf),
  "50066": pick("ht_exact_goals", countOf),
  // Scores.
  "45": pick("correct_score", scoreOf),
  "81": pick("ht_correct_score", scoreOf),
  // Combinations.
  "37": onLine("total", "result_total", both(resultOf, overUnderOf, "&")),
  "79": onLine("total", "ht_result_total", both(resultOf, overUnderOf, "&")),
  "35": pick("result_btts", both(resultOf, yesNoOf, "&")),
  "78": pick("ht_result_btts", both(resultOf, yesNoOf, "&")),
  "547": onLine("total", "dc_total", both(doubleChanceOf, overUnderOf, "&")),
  "546": pick("dc_btts", both(doubleChanceOf, yesNoOf, "&")),
  "542": pick("ht_dc_btts", both(doubleChanceOf, yesNoOf, "&")),
  "50060": pick("first_goal_result", firstGoalResultOf),
  // A team's own: clean sheet, win to nil, halves.
  "31": yesNo("clean_sheet@1"),
  "32": yesNo("clean_sheet@2"),
  "76": yesNo("ht_clean_sheet@1"),
  "77": yesNo("ht_clean_sheet@2"),
  "33": yesNo("win_to_nil@1"),
  "34": yesNo("win_to_nil@2"),
  "48": yesNo("win_both_halves@1"),
  "49": yesNo("win_both_halves@2"),
  "50": yesNo("win_either_half@1"),
  "51": yesNo("win_either_half@2"),
  "56": yesNo("score_both_halves@1"),
  "57": yesNo("score_both_halves@2"),
  // The players'.
  "40": players("anytime_scorer"),
  "38": players("first_scorer", THE_FIRST),
  "39": players("last_scorer"),
  "50807": players("scorer_team_wins"),
  "50808": players("scorer_both_halves"),
  "50031": scorerGoals,
  "50296": decisivePlayer,
};

const TENNIS: Record<string, Reader> = {
  "189": total("total_games"),
  "187": handicap("games_handicap"),
  "188": handicap("set_handicap"),
  "314": total("total_sets"),
  "45": pick("set_betting", scoreOf),
  "202": pick(set("winner"), teamOf),
  "204": onLine("total", set("total_games", ["1"]), overUnderOf),
  "203": onLine("hcp", set("games_handicap", ["1"]), handicapSideOf),
};

// The winner overtime included (219) is the listing's; the result (1) is in
// regular time, a draw possible.
const BASKETBALL: Record<string, Reader> = {
  "1": result("1X2"),
  "223": handicap("spread"),
  "225": total("total_points"),
  "227": total("team_points@1"),
  "228": total("team_points@2"),
  "292": onLine("total", "winner_total", both(teamOf, overUnderOf, "&")),
  "220": yesNo("overtime"),
  // The first half's.
  "60": result("ht_1X2"),
  "64": twoWay("ht_draw_no_bet"),
  "66": handicap("ht_spread"),
  "68": total("ht_total_points"),
  "69": total("ht_team_points@1"),
  "70": total("ht_team_points@2"),
  // A quarter's, by its number.
  "235": pick(quarter("1X2"), resultOf),
  "303": handicap(quarter("spread")),
  "236": total(quarter("total_points")),
  "756": total(quarter("team_points@1")),
  "757": total(quarter("team_points@2")),
  // The players': a ladder for a statistic, and a market a player and a line.
  "768": playersLadder("player_points"),
  "770": playersLadder("player_assists"),
  "772": playersLadder("player_rebounds"),
  "774": playersLadder("player_threes"),
  "50287": playersLadder("player_pra"),
  "921": playerOverUnder("player_points", /^(.+?) nombre de points/i),
  "922": playerOverUnder("player_assists", /^(.+?) nombre de passes décisives/i),
  "923": playerOverUnder("player_rebounds", /^(.+?) nombre de rebonds/i),
  "924": playerOverUnder("player_threes", /^(.+?) total de field goal à 3-points/i),
  "50286": playerOverUnder("player_pra", /^Points au total de (.+?) \+ rebonds/i),
};

// --- golf: a tournament's markets, read by the name of the match's description ----

// "Terminer dans le Top 10": a market of several winners. "Leader After Round 1": the
// leader after a round. "Meilleur Américain": the best of a nationality. The winner
// (2000000) is the listing's own; the other bets of the tournament have no family.
function golfMarketOf(name: string): string | undefined {
  const title = name.trim();
  const top = /^(?:terminer dans le )?top (\d+)$/i.exec(title);
  if (top) return marketKey("golf_top", Number(top[1]));
  const round = /^leader (?:after|apr[eè]s) (?:the )?(?:round|le tour) (\d)$/i.exec(title);
  return round ? marketKey("golf_round_leader", Number(round[1])) : golfBestOf(title);
}

function readGolfMarkets(
  event: NonNullable<BetbyEventReply["events"]>[string],
  descriptions: BetbyEventDescriptions | undefined,
  global: BetbyMarketDescriptions,
  id: string
): RawOdds[] {
  return Object.entries(event.markets ?? {}).flatMap(([marketId, prices]) => {
    const description = descriptions?.markets?.[marketId] ?? global[marketId];
    const key = description === undefined ? undefined : golfMarketOf(description.name);
    if (key === undefined) return [];
    try {
      return marketOf(prices, description).variants.flatMap((v) =>
        v.outcomes.map((o): RawOdds => ({ market: key, selection: o.name.trim(), price: o.price }))
      );
    } catch (err) {
      console.warn(`[markets:${BETIFY.id}] failed to read market ${marketId} of tournament ${id}, skipping it:`, err);
      return [];
    }
  });
}

// A match's markets by its canonical sport.
const BY_SPORT: Record<string, Record<string, Reader>> = { football: FOOTBALL, tennis: TENNIS, basketball: BASKETBALL };

function sportOf(reply: BetbyEventReply | undefined, id: string): string | undefined {
  const sportId = reply?.events?.[id]?.desc?.sport;
  const name = sportId === undefined ? undefined : reply?.sports?.[sportId]?.name;
  return name === undefined ? undefined : canonicalSport(BETIFY.id, name);
}

// One match's markets, from the answers to its page: football's, tennis's or
// basketball's by the match's sport, a golf tournament's Top N and round leaders. Another sport, a match the answer does not
// hold (started, removed), a market this has no reader for or cannot read give nothing.
export function readBetifyEventMarkets(
  id: string,
  reply: BetbyEventReply,
  descriptions: BetbyEventDescriptions | undefined,
  global: BetbyMarketDescriptions
): RawOdds[] {
  const sport = sportOf(reply, id);
  const table = sport === undefined ? undefined : BY_SPORT[sport];
  const event = reply?.events?.[id];
  if (event && sport === "golf") return readGolfMarkets(event, descriptions, global, id);
  if (!table || !event) return [];
  return Object.entries(event.markets ?? {}).flatMap(([marketId, prices]) => {
    const read = table[marketId];
    if (!read) return [];
    try {
      return read(marketOf(prices, descriptions?.markets?.[marketId] ?? global[marketId]));
    } catch (err) {
      // One malformed market must not take down the match's others.
      console.warn(`[markets:${BETIFY.id}] failed to read market ${marketId} of match ${id}, skipping it:`, err);
      return [];
    }
  });
}

// The markets of the given Betify matches, by their ids: two requests a match
// (its markets, its descriptions when it has players' markets), a few matches at a
// time. A request that fails costs only its own match; all of them failing is the
// bookmaker failing.
export async function fetchBetifyMarkets(ids: readonly string[]): Promise<Map<string, RawOdds[]>> {
  const markets = new Map<string, RawOdds[]>();
  if (ids.length === 0) return markets;
  const { api, brand } = await resolveBetbyFeed(BETIFY);
  const global = await betbyGet<BetbyMarketDescriptions>(`${api}/api/v3/descriptions/brand/${brand}/markets/${LANG}`);

  const read = await pool(ids, CONCURRENCY, async (id) => {
    const reply = await betbyGet<BetbyEventReply>(`${api}/api/v4/prematch/brand/${brand}/event/${LANG}/${id}`);
    let descriptions: BetbyEventDescriptions | undefined;
    const sport = sportOf(reply, id);
    if (sport !== undefined && PLAYER_SPORTS.has(sport)) {
      try {
        descriptions = await betbyGet<BetbyEventDescriptions>(`${api}/api/v3/descriptions/brand/${brand}/event/${id}/${LANG}`);
      } catch (err) {
        console.warn(`[markets:${BETIFY.id}] failed to read the descriptions of match ${id}, reading it without its players:`, err);
      }
    }
    await sleep(REQUEST_DELAY_MS);
    return readBetifyEventMarkets(id, reply, descriptions, global);
  });
  read.forEach((r, i) => {
    if (r.status === "fulfilled") markets.set(ids[i], r.value);
    else console.warn(`[markets:${BETIFY.id}] match ${ids[i]} failed, skipping it:`, r.reason);
  });
  if (read.every((r) => r.status === "rejected")) throw new Error(`every ${BETIFY.id} match failed`);
  return markets;
}
