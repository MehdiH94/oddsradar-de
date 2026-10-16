import { DatabaseSync } from "node:sqlite";
import { RawOdds, EventSource } from "../types";
import { alignCompetitors, alignParticipantsToSeed, bySeedOrder } from "../matcher/match";
import { familyOf, MARKET_SPORTS, parseMarketKey, playerMarketKey, swapMarketKey, swapOutcome } from "../markets/catalog";
import { isMainTour } from "../markets/tennis";
import { MARKET_MATCH_WINNER } from "./canonical";
import { EventMarketOdds, forgetOldStats, forgetStartedEvents, getMarketTargets, MarketTarget, saveMarketOdds } from "../db/repository";
import { fetchWinamaxMarkets } from "./winamaxMarkets";
import { fetchBetclicMarkets } from "./betclicMarkets";
import { fetchKambiMarkets } from "./kambiMarkets";
import { LEOVEGAS } from "./kambi";

// The second cycle of the worker: every market of the matches starting soon,
// on top of the listing's main market (./run.ts). Its bookmakers are asked by
// the ids the listing's cycle found (event_sources), so it only covers events
// that cycle has seen lately.

// A bookmaker's markets for its own match ids.
export type MarketsFetcher = (sourceIds: readonly string[]) => Promise<Map<string, RawOdds[]>>;

export const MARKET_FETCHERS: Record<string, MarketsFetcher> = {
  winamax: fetchWinamaxMarkets,
  // Winamax's and Betclic's readers stay for their real captures, which many
  // tests read; the worker no longer lists them (their sites refuse a German
  // server), so they are never asked.
  betclic: fetchBetclicMarkets,
  // LeoVegas.de's: every market a family covers of a match of the sports Kambi's
  // reader has a table for, and a golf tournament's Top N, round leaders and best
  // of a nationality (./kambiMarkets.ts).
  leovegas: (ids) => fetchKambiMarkets(LEOVEGAS, ids),
};

// The sports each bookmaker's markets are read for. A bookmaker not listed
// here is asked for every sport of the catalog (the fetchers a test gives).
const BASE_SPORTS = ["football", "tennis", "basketball", "golf"];
// The sports beyond the base that Kambi's reader has a table for (./kambiMarkets.ts).
const MORE_SPORTS = ["football américain", "rugby à xv", "hockey sur glace", "handball"];
export const MARKETS_BY_BOOKMAKER: Readonly<Record<string, ReadonlySet<string>>> = {
  winamax: new Set(BASE_SPORTS),
  betclic: new Set(BASE_SPORTS),
  leovegas: new Set([...BASE_SPORTS, ...MORE_SPORTS]),
};
const asksFor = (bookmaker: string, sport: string): boolean => MARKETS_BY_BOOKMAKER[bookmaker]?.has(sport) ?? true;

// The sports the catalog (src/markets/catalog.ts) has the markets of; of
// tennis, the main tours' matches only (src/markets/tennis.ts).
const isTarget = (t: MarketTarget) => t.sport !== "tennis" || isMainTour(t.competition);
// Matches starting within this window: every market of a few hundred matches
// is what a cycle can ask for without hammering either bookmaker.
export const MARKETS_HORIZON_MS = 48 * 60 * 60 * 1000;
// A golf tournament's markets, a week ahead: it is played over four days and
// bet on from the week before, its Top 5 and 10 with the winner.
const HORIZON_BY_SPORT: Readonly<Record<string, number>> = { golf: 7 * 24 * 60 * 60 * 1000 };
// A bookmaker that listed the match within this time (three listing cycles).
const SOURCE_MAX_AGE_MS = 15 * 60 * 1000;
// Matches read, then saved, at a time.
const MATCHES_PER_BATCH = 25;
// Prices of matches started this long ago are deleted.
const FORGET_AFTER_MS = 24 * 60 * 60 * 1000;
// The players' stats and the alerts sent are kept this long (the stats page
// reads the last weeks), then deleted.
export const STATS_KEPT_MS = 180 * 24 * 60 * 60 * 1000;
// The bookmaker whose spelling of the players' names is kept, the others'
// being aligned onto it: the one the matcher seeds events with.
const SEED_ORDER = bySeedOrder;

// Whether a bookmaker lists the match's teams the other way round from the
// event (a neutral venue, a mix-up of home and away).
function isReversed(own: readonly string[], event: readonly string[]): boolean {
  if (own.length !== 2 || event.length !== 2 || own[0] === own[1]) return false;
  const aligned = alignParticipantsToSeed([...own], [...event]);
  return aligned[0] === own[1] && aligned[1] === own[0];
}

// A price read in the bookmaker's team order, in the event's.
function turnRound(o: RawOdds): RawOdds {
  const parsed = parseMarketKey(o.market);
  // The winner of the match is no family, but its outcomes are the teams.
  if (parsed.kind === "other" && parsed.name === MARKET_MATCH_WINNER) {
    return { ...o, selection: swapOutcome(MARKET_MATCH_WINNER, o.selection) };
  }
  if (parsed.kind !== "family") return o;
  return { ...o, market: swapMarketKey(o.market), selection: swapOutcome(parsed.family.key, o.selection) };
}

// A market whose outcomes are players, one each ("Serhou Guirassy") or
// several ("S. Guirassy / M. Albert").
function playersOf(market: string): "one" | "several" | undefined {
  const parsed = parseMarketKey(market);
  const family = parsed.kind === "family" ? familyOf(parsed.family.key) : undefined;
  if (!family?.byPrice) return undefined;
  return family.combo ? "several" : "one";
}

// The players a bookmaker's markets carry in their keys ("player_points#LeBron
// James|27.5"), by statistic: in one statistic the players are as many as he
// lists, and a seed's name is taken once in each (a bookmaker can write a
// player "S.Umude" in his 3-pointers and "Stanley Umude" in the others).
function keyPlayersOf(odds: RawOdds[]): Map<string, string[]> {
  const byFamily = new Map<string, Set<string>>();
  for (const o of odds) {
    const parsed = parseMarketKey(o.market);
    if (parsed.kind !== "family" || parsed.player === undefined) continue;
    byFamily.set(parsed.family.key, (byFamily.get(parsed.family.key) ?? new Set()).add(parsed.player));
  }
  return new Map([...byFamily].map(([family, players]) => [family, [...players]]));
}

// Renames each bookmaker's players after the seed bookmaker's spelling, so
// that one player's prices line up on one row ("Vinícius Júnior" and
// "Vinicius Junior"). Pairs of players come with short names ("J. Félix /
// C. Ronaldo", "J. Felix / C. Ronaldo"), the seed's included: each one takes
// the seed's full name, then the pair is put in name order.
function alignPlayers(byBookmaker: Record<string, RawOdds[]>): void {
  const [seed] = Object.keys(byBookmaker).sort(SEED_ORDER);
  if (seed === undefined) return;
  const namesIn = (odds: RawOdds[], kind: "one" | "several") => [
    ...new Set(
      odds.filter((o) => playersOf(o.market) === kind).flatMap((o) => (kind === "one" ? [o.selection] : o.selection.split(" / ")))
    ),
  ];
  // A player in a market's key is named once for all his statistics.
  const seedNames = [...new Set([...namesIn(byBookmaker[seed], "one"), ...[...keyPlayersOf(byBookmaker[seed]).values()].flat()])];
  for (const [bookmaker, own] of Object.entries(byBookmaker)) {
    const keyNames = new Map<string, Map<string, string>>();
    if (bookmaker !== seed) {
      for (const [family, players] of keyPlayersOf(own)) keyNames.set(family, alignCompetitors(players, seedNames));
    }
    // Market by market: a bookmaker can spell a player two ways in two markets
    // ("Schauffele, Xander" in a Top 5, "Xander Schauffele" in the best
    // American), and a seed's name is taken once in each.
    const namesByMarket = new Map<string, Map<string, string>>();
    if (bookmaker !== seed) {
      for (const market of new Set(own.filter((o) => playersOf(o.market) === "one").map((o) => o.market))) {
        namesByMarket.set(market, alignCompetitors(namesIn(own.filter((o) => o.market === market), "one"), seedNames));
      }
    }
    const shortNames = alignCompetitors(namesIn(own, "several"), seedNames);
    byBookmaker[bookmaker] = own.map((o) => {
      const parsed = parseMarketKey(o.market);
      if (parsed.kind === "family" && parsed.player !== undefined) {
        const name = keyNames.get(parsed.family.key)?.get(parsed.player);
        return name === undefined || name === parsed.player ? o : { ...o, market: playerMarketKey(parsed.family.key, name, parsed.line) };
      }
      switch (playersOf(o.market)) {
        case "one": {
          const name = namesByMarket.get(o.market)?.get(o.selection);
          return name === undefined ? o : { ...o, selection: name };
        }
        case "several": {
          const pair = o.selection.split(" / ").map((n) => shortNames.get(n) ?? n);
          return { ...o, selection: pair.sort((a, b) => a.localeCompare(b, "fr")).join(" / ") };
        }
        default:
          return o;
      }
    });
  }
}

// The event's prices at each bookmaker, in the event's team order.
export function eventMarketOdds(
  eventParticipants: readonly string[],
  sources: Record<string, EventSource>,
  fetched: Record<string, Map<string, RawOdds[]>>
): Record<string, RawOdds[]> {
  const byBookmaker: Record<string, RawOdds[]> = {};
  for (const [bookmaker, source] of Object.entries(sources)) {
    const own = fetched[bookmaker]?.get(source.sourceId);
    if (!own || own.length === 0) continue;
    byBookmaker[bookmaker] = isReversed(source.participants, eventParticipants) ? own.map(turnRound) : own;
  }
  alignPlayers(byBookmaker);
  return byBookmaker;
}

// Across the matches read, by bookmaker and sport: of their markets, how
// many the catalog knows. Betclic renaming a market shows here as a drop.
interface Tally {
  asked: number;
  matches: number;
  markets: number;
  recognized: number;
}

function tallyMatch(tally: Tally, odds: RawOdds[]): void {
  const markets = new Set(odds.map((o) => o.market));
  tally.matches++;
  tally.markets += markets.size;
  tally.recognized += [...markets].filter((m) => parseMarketKey(m).kind === "family").length;
}

export async function runMarketsCycle(
  db: DatabaseSync,
  opts: { fetchers?: Record<string, MarketsFetcher>; now?: Date } = {}
): Promise<void> {
  const fetchers = opts.fetchers ?? MARKET_FETCHERS;
  const now = opts.now ?? new Date();
  const byHorizon = new Map<number, string[]>();
  for (const sport of MARKET_SPORTS) {
    const horizon = HORIZON_BY_SPORT[sport] ?? MARKETS_HORIZON_MS;
    byHorizon.set(horizon, [...(byHorizon.get(horizon) ?? []), sport]);
  }
  const targets = [...byHorizon]
    .flatMap(([horizon, sports]) =>
      getMarketTargets(db, {
        sports,
        from: now.toISOString(),
        to: new Date(now.getTime() + horizon).toISOString(),
        seenSince: new Date(now.getTime() - SOURCE_MAX_AGE_MS).toISOString(),
      })
    )
    .filter(isTarget);

  // A few matches at a time, saved as they come: a whole cycle's prices (a
  // few hundred thousand) are never all in memory at once, and the first
  // matches' are up to date before the last ones are read.
  const tallies: Record<string, Tally> = {};
  for (let start = 0; start < targets.length; start += MATCHES_PER_BATCH) {
    const chunk = targets.slice(start, start + MATCHES_PER_BATCH);
    // Both bookmakers at once: they are different servers.
    const fetched: Record<string, Map<string, RawOdds[]>> = {};
    await Promise.all(
      Object.entries(fetchers).map(async ([bookmaker, fetch]) => {
        const asked = chunk.filter((t) => t.sources[bookmaker] && asksFor(bookmaker, t.sport));
        const ids = [...new Set(asked.map((t) => t.sources[bookmaker].sourceId))];
        const tallyOf = (t: MarketTarget) =>
          (tallies[`${bookmaker} ${t.sport}`] ??= { asked: 0, matches: 0, markets: 0, recognized: 0 });
        for (const t of asked) tallyOf(t).asked++;
        try {
          fetched[bookmaker] = await fetch(ids);
          for (const t of asked) {
            const odds = fetched[bookmaker].get(t.sources[bookmaker].sourceId);
            if (odds) tallyMatch(tallyOf(t), odds);
          }
        } catch (err) {
          console.error(`[markets:${bookmaker}] failed:`, err);
        }
      })
    );
    const batches: EventMarketOdds[] = chunk.flatMap((target) =>
      Object.entries(eventMarketOdds(target.participants, target.sources, fetched)).map(([bookmakerId, odds]) => ({
        eventId: target.eventId,
        bookmakerId,
        odds,
      }))
    );
    // The prices are as old as the end of their fetch.
    saveMarketOdds(db, batches, (opts.now ?? new Date()).toISOString());
  }

  for (const [key, t] of Object.entries(tallies)) {
    const [bookmaker, sport] = key.split(" ");
    console.log(
      `[markets:${bookmaker}] ${sport}: ${t.matches} of ${t.asked} matches read, ${t.recognized} of ${t.markets} markets recognized`
    );
  }
  const forgotten = forgetStartedEvents(db, new Date(now.getTime() - FORGET_AFTER_MS).toISOString());
  if (forgotten > 0) console.log(`[markets] forgot ${forgotten} prices of matches started over a day ago`);
  const expired = forgetOldStats(db, new Date(now.getTime() - STATS_KEPT_MS).toISOString());
  if (expired > 0) console.log(`[markets] forgot ${expired} stats and alerts older than ${STATS_KEPT_MS / (24 * 60 * 60 * 1000)} days`);
}
