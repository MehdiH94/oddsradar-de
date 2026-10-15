import { RawOdds } from "../types";
import { golfBestOf, marketKey, parseMarketKey, playerMarketKey } from "../markets/catalog";
import { KambiBetOffer, KambiEvent, KAMBI_QUERY, KAMBI_REQUEST_DELAY_MS, kambiGet, kambiOutcomePrice, KambiSite, sleep } from "./kambi";
import { pool } from "./pool";

// The markets of a football, a tennis or a basketball match, and of a golf
// tournament, at a Kambi operator (LeoVegas.de), mapped onto the shared catalog
// (src/markets/catalog.ts). The offering API its site reads (see ./kambi.ts) answers `betoffer/event/<id>` with every offer of the match:
// 280 for a Premier League Championship match, 34 for an ATP one, 168 for a
// WNBA one (real captures of PMU, a French operator of the platform, 11/10/2026,
// tests/scraper/fixtures/pmu-event-*.json.gz). An offer's market is its criterion's id, the same from
// a match to another ("Total Goals" is 1001159926); the first team's own
// markets and the second's have an id each (1001159967 and 1001159633 are the
// goals of the home and the away team). Its outcomes have a type (OT_ONE,
// OT_OVER, OT_YES...), a line in thousandths and, for a player's market, the
// player's name. The prices are thousandths too.
//
// Only half lines are read ("2.5"): a whole line refunds a push, a market the
// other bookmakers do not offer. The main market (the listing's own), the
// three-way handicaps and the markets of no family are left out.

const BATCH_SIZE = 10;
const CONCURRENCY = 2;

type Reader = (offer: KambiBetOffer) => RawOdds[];
type Tokens = Record<string, string>;

const isHalfLine = (line: number) => Math.abs(line % 1) === 0.5;
const lineOf = (o: { line?: number }): number => (typeof o.line === "number" ? o.line / 1000 : NaN);
const nameOf = (o: { participant?: string }): string => o.participant?.trim() ?? "";

// An offer's outcomes under a family's key, one token each, by the outcome's type.
const pick =
  (family: string, tokens: Tokens): Reader =>
  (offer) =>
    offer.outcomes.flatMap((o): RawOdds[] => {
      const selection = tokens[o.type ?? ""];
      const price = kambiOutcomePrice(o);
      return selection !== undefined && price > 1 ? [{ market: family, selection, price }] : [];
    });

const RESULT: Tokens = { OT_ONE: "1", OT_CROSS: "X", OT_TWO: "2" };
const TWO_WAY: Tokens = { OT_ONE: "1", OT_TWO: "2" };
const YES_NO: Tokens = { OT_YES: "yes", OT_NO: "no" };
const DOUBLE_CHANCE: Tokens = { OT_ONE_OR_CROSS: "1X", OT_ONE_OR_TWO: "12", OT_CROSS_OR_TWO: "X2" };
const FIRST_GOAL: Tokens = { OT_ONE: "1", OT_CROSS: "none", OT_TWO: "2" };
const OVER_UNDER: Tokens = { OT_OVER: "over", OT_UNDER: "under" };

// Half-time / full-time: OT_ONE_CROSS is "1/X".
const HALF_FULL: Tokens = Object.fromEntries(
  (["ONE", "CROSS", "TWO"] as const).flatMap((a) =>
    (["ONE", "CROSS", "TWO"] as const).map((b): [string, string] => [`OT_${a}_${b}`, `${RESULT[`OT_${a}`]}/${RESULT[`OT_${b}`]}`])
  )
);

const result = (family: string) => pick(family, RESULT);
const twoWay = (family: string) => pick(family, TWO_WAY);
const yesNo = (family: string) => pick(family, YES_NO);

// Over and under a half line, the line in the key.
const total =
  (family: string): Reader =>
  (offer) =>
    offer.outcomes.flatMap((o): RawOdds[] => {
      const selection = OVER_UNDER[o.type ?? ""];
      const price = kambiOutcomePrice(o);
      const line = lineOf(o);
      return selection !== undefined && isHalfLine(line) && price > 1 ? [{ market: marketKey(family, line), selection, price }] : [];
    });

// A handicap with two outcomes, on the first team's line (the home outcome's).
const handicap =
  (family: string): Reader =>
  (offer) => {
    const line = lineOf(offer.outcomes.find((o) => o.type === "OT_ONE") ?? {});
    if (!isHalfLine(line)) return [];
    return pick(marketKey(family, line), TWO_WAY)(offer);
  };

// A score: "2-1", home first.
const scores =
  (family: string): Reader =>
  (offer) =>
    offer.outcomes.flatMap((o): RawOdds[] => {
      const price = kambiOutcomePrice(o);
      return /^\d+-\d+$/.test(o.label ?? "") && price > 1 ? [{ market: family, selection: o.label!, price }] : [];
    });

// A yes-or-no offer about a result "and" something else, the yes only: its no is
// not the catalog's "&no" ("not both").
const yesAnd =
  (family: string, prefix: string, line?: number): Reader =>
  (offer) =>
    pick(line === undefined ? family : marketKey(family, line), { OT_YES: `${prefix}&${family === "dc_total" ? "over" : "yes"}` })(offer);

// "Coventry City to win or draw and over 2.5 goals in the match": a double chance
// and a total, the line in the title.
const doubleChanceAndTotal =
  (prefix: string): Reader =>
  (offer) => {
    const line = Number(/over (\d+(?:\.\d+)?) goals/i.exec(offer.criterion?.englishLabel ?? "")?.[1]);
    return isHalfLine(line) ? yesAnd("dc_total", prefix, line)(offer) : [];
  };

// A player's market: one offer a player (and a line), the yes only, his name in
// the participant.
const players =
  (family: string, opts: { line?: boolean; only?: number } = {}): Reader =>
  (offer) =>
    offer.outcomes.flatMap((o): RawOdds[] => {
      const price = kambiOutcomePrice(o);
      const line = lineOf(o);
      if (o.type !== "OT_YES" || !nameOf(o) || !(price > 1)) return [];
      if (opts.only !== undefined && line !== opts.only) return [];
      return [{ market: opts.line ? marketKey(family, line) : family, selection: nameOf(o), price }];
    });

// The first scorer: every player, and "no goal", which the catalog leaves out.
const firstScorer: Reader = (offer) =>
  offer.outcomes.flatMap((o): RawOdds[] => {
    const price = kambiOutcomePrice(o);
    return o.type === "OT_PLAYER_PARTICIPANT" && nameOf(o) && price > 1 ? [{ market: "first_scorer", selection: nameOf(o), price }] : [];
  });

// "15+ Points & Rebounds": a ladder, one offer a player and a number. "N+" is
// the over of N - 0.5.
const ladder =
  (family: string): Reader =>
  (offer) =>
    offer.outcomes.flatMap((o): RawOdds[] => {
      const price = kambiOutcomePrice(o);
      const line = lineOf(o);
      return o.type === "OT_YES" && nameOf(o) && Number.isInteger(line) && price > 1
        ? [{ market: playerMarketKey(family, nameOf(o), line - 0.5), selection: "over", price }]
        : [];
    });

// The number of tiebreaks over 0.5 is a tiebreak in the match.
const tiebreak: Reader = (offer) =>
  offer.outcomes.flatMap((o): RawOdds[] => {
    const price = kambiOutcomePrice(o);
    const selection = { OT_OVER: "yes", OT_UNDER: "no" }[o.type ?? ""];
    return lineOf(o) === 0.5 && price > 1 && selection ? [{ market: "tiebreak", selection, price }] : [];
  });

// A tennis set's winner, which the offer's title gives: "Set 1".
const setWinner: Reader = (offer) => {
  const set = /^Set ([12])$/.exec(offer.criterion?.englishLabel ?? "")?.[1];
  return set ? pick(`set${set}_winner`, TWO_WAY)(offer) : [];
};

const firstSetScore: Reader = (offer) =>
  offer.criterion?.englishLabel === "Correct Score - Set 1" ? scores("set1_correct_score")(offer) : [];

// By the criterion's id (see the top of the file).
const FOOTBALL: Record<number, Reader> = {
  // Totals, by period and by team: the home team's id, then the away's.
  1001159926: total("total_goals"),
  1001159967: total("team_goals@1"),
  1001159633: total("team_goals@2"),
  1001159532: total("ht_total_goals"),
  1003194958: total("ht_team_goals@1"),
  1003194956: total("ht_team_goals@2"),
  1001243173: total("2h_total_goals"),
  1003194959: total("2h_team_goals@1"),
  1003194957: total("2h_team_goals@2"),
  // The two-way handicap, and the results, chances and refunds.
  1001159711: handicap("handicap"),
  1001159922: pick("double_chance", DOUBLE_CHANCE),
  1001159666: twoWay("draw_no_bet"),
  1001159830: pick("ht_ft", HALF_FULL),
  1000316018: result("ht_1X2"),
  1001159826: result("2h_1X2"),
  1001159884: twoWay("ht_draw_no_bet"),
  1001421321: twoWay("2h_draw_no_bet"),
  1001159668: pick("ht_double_chance", DOUBLE_CHANCE),
  1001421320: pick("2h_double_chance", DOUBLE_CHANCE),
  // Both teams scoring, the scores, the first team to score.
  1001642858: yesNo("btts"),
  1001642863: yesNo("ht_btts"),
  1001642868: yesNo("2h_btts"),
  1001159780: scores("correct_score"),
  1000505272: scores("ht_correct_score"),
  1001159750: pick("first_team_to_score", FIRST_GOAL),
  // A team's own: win to nil, win a half, then the combinations.
  1001642866: yesNo("win_to_nil@1"),
  1001642867: yesNo("win_to_nil@2"),
  1001657419: yesNo("win_either_half@1"),
  1001657420: yesNo("win_either_half@2"),
  1001957106: yesAnd("result_btts", "1"),
  1001957108: yesAnd("result_btts", "2"),
  2100111420: yesAnd("dc_btts", "1X"),
  2100111421: yesAnd("dc_btts", "X2"),
  2100111422: yesAnd("dc_btts", "12"),
  2100111423: doubleChanceAndTotal("1X"),
  2100111424: doubleChanceAndTotal("X2"),
  2100111425: doubleChanceAndTotal("12"),
  // The players'.
  1001159886: players("anytime_scorer"),
  1005153925: players("scorer_goals", { line: true }),
  1005153918: firstScorer,
  1003314795: players("decisive_player", { only: 1 }),
  2100124437: players("ht_scorer", { only: 1 }),
};

const TENNIS: Record<number, Reader> = {
  1001159891: total("total_games"),
  1001159979: total("set1_total_games"),
  1001159758: total("total_sets"),
  2100017181: total("player_games@1"),
  2100017182: total("player_games@2"),
  1001419385: handicap("set_handicap"),
  1001512920: scores("set_betting"),
  2100017183: yesNo("win_a_set@1"),
  2100017184: yesNo("win_a_set@2"),
  1001159846: setWinner,
  1001159818: firstSetScore,
  1001229618: tiebreak,
};

// A women's or a men's match alike: the winner overtime included is the
// listing's, "Moneyline - Including Overtime".
const BASKETBALL: Record<number, Reader> = {
  1001159509: total("total_points"),
  1001159512: handicap("spread"),
  1001159855: total("team_points@1"),
  1001159837: total("team_points@2"),
  // The first half's.
  1001159947: total("ht_total_points"),
  1001159940: handicap("ht_spread"),
  1001159815: twoWay("ht_draw_no_bet"),
  1001159488: result("ht_1X2"),
  1001159567: total("ht_team_points@1"),
  1001159579: total("ht_team_points@2"),
  // The first quarter's.
  1001159866: twoWay("q1_draw_no_bet"),
  1001159576: handicap("q1_spread"),
  1001159802: total("q1_total_points"),
  1001159585: result("q1_1X2"),
  1002167437: total("q1_team_points@1"),
  1002167438: total("q1_team_points@2"),
  1001402299: pick("ht_ft", HALF_FULL),
  // The players': points and rebounds, points and assists, rebounds and assists.
  2100097478: ladder("player_pr"),
  2100097477: ladder("player_pa"),
  2100097479: ladder("player_ra"),
};

// A match's markets by its sport, as the API names it.
const BY_SPORT: Record<string, Record<number, Reader>> = { FOOTBALL, TENNIS, BASKETBALL };

// A golf tournament's markets (14/10/2026, tests/scraper/fixtures/pmu-event-golf.
// json.gz: the DP World India Championship and the Buick LPGA Shanghai). Its
// offers do not tell what they are by their criterion alone, so they are read by
// their title and description:
// - "Finishing Position" is the winner ("Vainqueur", the listing's own market) and
//   the Top 5, 10 and 20 ("Top 5"...);
// - "Leader after Round N" is the leader of the round ("Leader après le 1er tour")
//   and also, under the same criterion, the Top 5, 10 and 20 after the 1st round
//   ("Top 5 après le 1er tour"), which are other bets;
// - "Top Spanish Player" ("Meilleur joueur espagnol") is the best of a nationality.
// "Top 5 - Including Ties" is a yes or no a player, ties counted another way than
// the Top 5 of the other bookmakers: left out, like the forecasts, the holes in one
// and the other bets of no family. A player is named in his outcome's participant.
function golfOffer(offer: KambiBetOffer): RawOdds[] {
  const english = offer.criterion?.englishLabel ?? "";
  const description = offer.description?.trim() ?? "";
  const top = english === "Finishing Position" ? /^Top (\d+)$/.exec(description)?.[1] : undefined;
  const round = /^Leader after Round (\d)$/i.exec(english)?.[1];
  const market =
    top !== undefined
      ? marketKey("golf_top", Number(top))
      : round !== undefined && /^Leader/i.test(description)
        ? marketKey("golf_round_leader", Number(round))
        : /^Top .+ Player$/.test(english)
          ? golfBestOf(offer.criterion?.label ?? "")
          : undefined;
  if (market === undefined) return [];
  return offer.outcomes.flatMap((o): RawOdds[] => {
    const selection = (nameOf(o) || o.label?.trim()) ?? "";
    const price = kambiOutcomePrice(o);
    return selection && price > 1 ? [{ market, selection, price }] : [];
  });
}

// --- ice hockey, rugby union, American football, handball -----------------------
//
// These sports' offers are told by their English title, not by an id (the ids
// differ from a sport to the next for the same bet: "Total Goals" is 1001105863 in
// hockey, 1001105866 in handball). A title is a bet and its qualifiers, "Total
// Goals by Hartford Wolf Pack - Regular Time", "Handicap - 1st Half", "Puck Line -
// Including Overtime and Penalty Shootout", "Total Points - Quarter 1", and a period
// alone is its 3-way result ("Period 2", "1st Half"). Captured on 14/10/2026,
// tests/scraper/fixtures/pmu-event-{ice-hockey,rugby-union,american-football,handball}.json.gz.
// A line is read on half lines only, like the others'.

interface LabelledShape {
  // The lines are goals (hockey, handball) or points (the others).
  goals: boolean;
  // The overtime-included bets are the plain families (American football's, like
  // basketball's: its own markets include the overtime; rugby's "Including Overtime" is
  // the extra time of a cup tie, a league match's own bet). Otherwise they are the
  // "ot_" ones (ice hockey's, whose plain families are regular time's).
  overtimeIsPlain: boolean;
  // A bet that says "Regular Time" is a plain family (not American football's: its
  // regular-time bets are others than the match's).
  regularTimeIsPlain: boolean;
  // The second half has its overtime-included version only (American football's).
  secondHalfNeedsOvertime: boolean;
  periods: "halves" | "halves and quarters" | "periods";
}

const SHAPES: Record<string, LabelledShape> = {
  ICE_HOCKEY: { goals: true, overtimeIsPlain: false, regularTimeIsPlain: true, secondHalfNeedsOvertime: false, periods: "periods" },
  HANDBALL: { goals: true, overtimeIsPlain: false, regularTimeIsPlain: true, secondHalfNeedsOvertime: false, periods: "halves" },
  RUGBY_UNION: { goals: false, overtimeIsPlain: true, regularTimeIsPlain: true, secondHalfNeedsOvertime: false, periods: "halves" },
  AMERICAN_FOOTBALL: { goals: false, overtimeIsPlain: true, regularTimeIsPlain: false, secondHalfNeedsOvertime: true, periods: "halves and quarters" },
};

// What a bet's qualifiers say: the period it is about, and whether the overtime
// is in it. A prefix of the families ("ht_", "q1_", "p2_", "ot_"), or undefined
// for a bet the catalog has no family of.
// The qualifiers this reads: the time of the bet ("Regular Time", "Including Overtime and
// penalty shootout") and the period ("Period 2", "1st Half", "Quarter 1"). Another is a
// bet of another kind ("Total Goals - 0:00-4:59", the goals of the first minutes).
const KNOWN_QUALIFIER = /^(Regular Time|Including (Overtime|Extra Time)( and penalty shootout)?|(Period|Quarter) \d|(1st|2nd) Half)$/i;

function prefixOf(shape: LabelledShape, qualifiers: readonly string[]): string | undefined {
  if (!qualifiers.every((q) => KNOWN_QUALIFIER.test(q.replace(/\s+/g, " ")))) return undefined;
  const text = qualifiers.join(" - ");
  const overtime = /Including (Overtime|Extra)/i.test(text);
  const period = qualifiers.map((q) => /^(?:Period|Quarter) (\d)\b|^(1st|2nd) Half\b/.exec(q)).find((m) => m !== null);
  if (period) {
    const kind = period[0];
    if (/^Period/.test(kind)) return shape.periods === "periods" && Number(period[1]) <= 3 ? `p${period[1]}_` : undefined;
    if (/^Quarter/.test(kind)) return shape.periods === "halves and quarters" && Number(period[1]) <= 4 ? `q${period[1]}_` : undefined;
    if (shape.periods === "periods") return undefined;
    if (period[2] === "1st") return "ht_";
    return shape.secondHalfNeedsOvertime && !overtime ? undefined : "2h_";
  }
  if (overtime) return shape.overtimeIsPlain ? "" : "ot_";
  if (/Regular Time/i.test(text)) return shape.regularTimeIsPlain ? "" : undefined;
  return "";
}

// A team's bet: "by Hartford Wolf Pack" is the first side's ("@1") when it is the home name.
const sideOf = (name: string, event: KambiEvent): "1" | "2" | undefined => {
  const [home, away] = [event.homeName?.trim(), event.awayName?.trim()];
  return name.trim() === home ? "1" : name.trim() === away ? "2" : undefined;
};

type LabelledReader = (offer: KambiBetOffer, event: KambiEvent) => RawOdds[];

// A period alone ("Period 2", "1st Half", "Quarter 1", with or without "(3-way)") is
// that period's 3-way result; the whole match's ("Regular Time (3-way)", "Full Time",
// "Match Odds") is the listing's.
const PERIOD_RESULT = /^(?:Period \d|Quarter \d|(?:1st|2nd) Half)(?: \(3-way\))?$/;

function labelled(shape: LabelledShape): LabelledReader {
  const unit = shape.goals ? "goals" : "points";
  return (offer, event) => {
    const [base, ...qualifiers] = (offer.criterion?.englishLabel ?? "").split(/\s+-\s+/).map((part) => part.trim());
    const isResult = PERIOD_RESULT.test(base);
    const prefix = prefixOf(shape, isResult ? [base.replace(/ \(3-way\)$/, ""), ...qualifiers] : qualifiers);
    if (prefix === undefined) return [];
    const read = (): RawOdds[] => {
      if (isResult) return prefix === "" ? [] : result(`${prefix}1X2`)(offer);
      if (base === "Draw No Bet") return twoWay(`${prefix}draw_no_bet`)(offer);
      if (base === "Double Chance") return shape.goals || shape.periods === "halves" ? pick(`${prefix}double_chance`, DOUBLE_CHANCE)(offer) : [];
      if (base === "Both Teams To Score") return shape.goals ? yesNo(`${prefix}btts`)(offer) : [];
      if (base === "To go into Overtime") return shape.overtimeIsPlain && shape.periods === "halves and quarters" ? yesNo("overtime")(offer) : [];
      if (base === "Total Goals" || base === "Total Points") return (base === "Total Goals") === shape.goals ? total(`${prefix}total_${unit}`)(offer) : [];
      const team = /^Total (Goals|Points) by (.+)$/.exec(base);
      if (team) {
        const side = sideOf(team[2], event);
        return side && (team[1] === "Goals") === shape.goals ? total(`${prefix}team_${unit}@${side}`)(offer) : [];
      }
      // The two-way handicap: a puck line, a point spread, a handicap. The three-way ones are other bets.
      if (base === "Puck Line" || base === "Point Spread" || base === "Handicap") {
        return handicap(`${prefix}${shape.goals ? "handicap" : "spread"}`)(offer);
      }
      return [];
    };
    // What the catalog has no family of (a handball half's both teams to score...) is left out.
    return read().filter((o) => parseMarketKey(o.market).kind === "family");
  };
}

const LABELLED: Record<string, LabelledReader> = Object.fromEntries(
  Object.entries(SHAPES).map(([sport, shape]): [string, LabelledReader] => [sport, labelled(shape)])
);

export interface KambiEventsReply {
  events: KambiEvent[];
  betOffers: (KambiBetOffer | null)[];
}

// The markets of every match an answer holds, by the match's id: its offers
// read by its sport's table. A sport this has no table for, an offer it does
// not know or cannot read are left out; a match without an offer is empty.
export function readKambiMarkets(reply: KambiEventsReply): Map<string, RawOdds[]> {
  const offersByEvent = new Map<number, KambiBetOffer[]>();
  for (const offer of reply?.betOffers ?? []) {
    if (offer?.eventId === undefined) continue;
    offersByEvent.set(offer.eventId, [...(offersByEvent.get(offer.eventId) ?? []), offer]);
  }
  const markets = new Map<string, RawOdds[]>();
  for (const event of reply?.events ?? []) {
    const golf = event?.sport === "GOLF";
    const table = BY_SPORT[event?.sport ?? ""];
    const read = LABELLED[event?.sport ?? ""];
    if ((!table && !read && !golf) || event.id === undefined) continue;
    markets.set(
      String(event.id),
      (offersByEvent.get(event.id) ?? []).flatMap((offer) => {
        try {
          return golf ? golfOffer(offer) : read ? read(offer, event) : (table[offer.criterion?.id ?? 0]?.(offer) ?? []);
        } catch (err) {
          // One malformed offer must not take down the match's others.
          console.warn(`[markets:kambi] failed to read offer ${offer.criterion?.id} of match ${event.id}, skipping it:`, err);
          return [];
        }
      })
    );
  }
  return markets;
}

// The markets of the given matches of a Kambi operator, by their ids: a few
// matches a request, a few requests at a time. A request that fails costs only
// its own matches; all of them failing is the bookmaker failing.
export async function fetchKambiMarkets(site: KambiSite, ids: readonly string[]): Promise<Map<string, RawOdds[]>> {
  const markets = new Map<string, RawOdds[]>();
  if (ids.length === 0) return markets;
  const batches = Array.from({ length: Math.ceil(ids.length / BATCH_SIZE) }, (_, i) => ids.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE));
  const read = await pool(batches, CONCURRENCY, async (batch) => {
    const reply = await kambiGet<KambiEventsReply>(site, `betoffer/event/${batch.join(",")}.json?${KAMBI_QUERY}&includeParticipants=true`);
    await sleep(KAMBI_REQUEST_DELAY_MS);
    return readKambiMarkets(reply);
  });
  read.forEach((r, i) => {
    if (r.status === "fulfilled") for (const [id, odds] of r.value) markets.set(id, odds);
    else console.warn(`[markets:${site.id}] matches ${batches[i].join(",")} failed, skipping them:`, r.reason);
  });
  if (read.every((r) => r.status === "rejected")) throw new Error(`every ${site.id} request failed`);
  return markets;
}
