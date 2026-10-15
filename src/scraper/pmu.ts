import { RawEvent, RawOdds } from "../types";
import { BookmakerScraper } from "./run";
import { canonicalMarketName, canonicalSport, hasOutrights, MARKET_OUTRIGHT, verifiedSportNames } from "./canonical";
import { pool } from "./pool";
import { validateRawEvent } from "./validateRawEvent";

// PMU's prices, from the offering API its sports site reads them from (Kambi's,
// eu.offering-api.kambicdn.com/offering/v2018/pmusportsfr, captured 11/10/2026,
// tests/scraper/fixtures/pmu-*.json): JSON GETs, without an account, a cookie or
// a token. The sports list gives each sport's term key, and a sport's list
// carries every event with its main offers: the matches' result and the
// outrights' winner, which is all this reads.

export const PMU_BASE_URL = "https://eu.offering-api.kambicdn.com/offering/v2018/pmusportsfr";
// What the site itself sends with every request.
export const PMU_QUERY = "lang=fr_FR&market=FR&client_id=200&channel_id=1";
// The sport whose events are sports of their own, named by the second step of
// their path ("Ski Alpin", "Biathlon").
const WINTER_SPORTS = "Sports d'hiver";
export const PMU_REQUEST_DELAY_MS = 300;
// Sports read at once.
const CONCURRENCY = 2;
// A stalled request must fail rather than hang: the worker's overlap guard
// would otherwise skip every later cycle, for every bookmaker.
const REQUEST_TIMEOUT_MS = 20_000;

const HEADERS = {
  accept: "application/json, text/plain, */*",
  "accept-language": "fr-FR",
  origin: "https://www.pmu.fr",
  referer: "https://www.pmu.fr/",
  "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36",
};

export interface PmuOutcome {
  label?: string;
  // "OT_ONE", "OT_CROSS" (the draw) and "OT_TWO" for a result; "OT_UNTYPED" for a runner.
  type?: string;
  // The price in thousandths: 1470 is 1.47.
  odds?: number | null;
  // "OPEN"; anything else (suspended, say) has no price to offer.
  status?: string;
  // The line of a total or a handicap, in thousandths: 2500 is 2.5.
  line?: number;
  // The player or the team the outcome is about.
  participant?: string;
}
export interface PmuBetOffer {
  eventId?: number;
  // The id is the market's kind, the same from a match to another.
  criterion?: { id?: number; englishLabel?: string; label?: string };
  betOfferType?: { englishName?: string };
  // Tells apart the offers of one criterion: a golf tournament's "Finishing
  // Position" is listed four times, as "Vainqueur" (tagged MAIN), "Top 5", "Top
  // 10" and "Top 20".
  description?: string;
  tags?: string[];
  outcomes: PmuOutcome[];
}
export interface PmuEvent {
  id?: number;
  name?: string;
  homeName?: string;
  awayName?: string;
  start?: string;
  // The competition.
  group?: string;
  // "NOT_STARTED" or "STARTED" (live).
  state?: string;
  // "FOOTBALL", "TENNIS", "BASKETBALL"...
  sport?: string;
  // "MATCH" for a head-to-head, "COMPETITION" for an outright.
  tags?: string[];
  path?: { name?: string }[];
}
export interface PmuListEntry {
  event: PmuEvent;
  betOffers?: PmuBetOffer[];
}

// The decimal price the site shows for the thousandths the API gives: 1470 is 1.47.
export function pmuOddsToDecimal(odds: number | null | undefined): number {
  return typeof odds === "number" && Number.isFinite(odds) ? Math.round(odds) / 1000 : NaN;
}

// An outcome that is not open has no price to offer.
export const pmuOutcomePrice = (outcome: PmuOutcome): number =>
  outcome.status === "OPEN" ? pmuOddsToDecimal(outcome.odds) : NaN;

// A match as a raw event: its two sides, its start, its result market's prices
// labelled with the teams' names and "Match nul" (the matcher reads them as 1, X
// and 2, src/matcher/match.ts). The result is the offer of type Match tagged
// MAIN ("Full Time", "Match Odds", "Moneyline - Including Overtime", "Bout
// Odds"...); the totals and handicaps listed after it are not. A match already
// started has live prices, and one without that offer in the list (rugby league's
// has a handicap only, 11/10/2026) is not one to compare.
function matchToRawEvent(entry: PmuListEntry, sport: string): RawEvent | null {
  const { event } = entry;
  const home = event.homeName?.trim();
  const away = event.awayName?.trim();
  const offer = entry.betOffers?.find((o) => o.betOfferType?.englishName === "Match" && o.tags?.includes("MAIN"));
  if (!home || !away || !event.start || event.state !== "NOT_STARTED" || !offer) return null;
  if (offer.outcomes.length !== 2 && offer.outcomes.length !== 3) return null;
  const marketName = canonicalMarketName(offer.outcomes.length);
  const selections: Record<string, string> = { OT_ONE: home, OT_CROSS: "Match nul", OT_TWO: away };
  const odds: RawOdds[] = [];
  for (const outcome of offer.outcomes) {
    const selection = selections[outcome.type ?? ""];
    if (!selection) return null;
    odds.push({ market: marketName, selection, price: pmuOutcomePrice(outcome) });
  }
  return {
    sport,
    // PMU ends some with a space ("Prochains Combats ").
    competition: event.group?.trim() ?? "",
    startTime: event.start,
    participants: [home, away],
    odds,
    sourceId: String(event.id),
  };
}

// The offer that is an outright's winner: "Winner" (cycling, biathlon), "GP
// Winner" (Formula 1), "Finishing Position" (golf, alpine skiing), which lists
// the runners' odds to win. Not every one is tagged MAIN.
const WINNER_OFFER = /^(?:gp |race )?winner$|^finishing position$/i;

// PMU lists, beside a tournament, the same field without its favourite ("DP World
// India Championship Winner without Rory McIlroy 2026", 14/10/2026, 142 runners to
// the tournament's 144): another bet on the same players, which would be read as a
// second tournament (and be paired with the real one's winner by the matcher).
const FIELD_WITHOUT_A_RUNNER = /\b(?:without|sans)\b/i;

// An outright (a tournament, a Grand Prix, a race) as a winner market: its
// title and its runners, in the sports without head-to-heads (OUTRIGHT_SPORTS) or
// the winner of a competition in the others (COMPETITION_WINNER_SPORTS). A sport's
// list holds few of them (14/10/2026: golf's tournaments, AFL 2027): the winner of a
// league is in the list of the league, which is not read.
function outrightToRawEvent(entry: PmuListEntry, sport: string): RawEvent | null {
  const { event } = entry;
  const title = event.name?.trim();
  const offer = entry.betOffers?.find((o) => WINNER_OFFER.test(o.criterion?.englishLabel ?? ""));
  if (!hasOutrights(sport) || !title || !event.start || event.state !== "NOT_STARTED" || !offer) return null;
  if (FIELD_WITHOUT_A_RUNNER.test(title)) return null;
  return {
    sport,
    competition: event.group?.trim() ?? "",
    startTime: event.start,
    participants: [title],
    odds: offer.outcomes.map(
      (o): RawOdds => ({ market: MARKET_OUTRIGHT, selection: o.label?.trim() ?? "", price: pmuOutcomePrice(o) })
    ),
    sourceId: String(event.id),
  };
}

// A sport's list as raw events. The sport is the one the sports list names
// (which is how it is asked for), except for the winter sports, whose events
// name theirs in their path.
export function parsePmuEvents(list: readonly PmuListEntry[], sportName: string): RawEvent[] {
  const events: RawEvent[] = [];
  for (const entry of list) {
    try {
      const name = sportName === WINTER_SPORTS ? (entry.event.path?.[1]?.name ?? sportName) : sportName;
      const sport = canonicalSport("pmu", name);
      const tags = entry.event.tags ?? [];
      const raw = tags.includes("MATCH")
        ? matchToRawEvent(entry, sport)
        : tags.includes("COMPETITION")
          ? outrightToRawEvent(entry, sport)
          : null;
      const checked = raw && validateRawEvent(raw, "pmu");
      if (checked) events.push(checked);
    } catch (err) {
      // One malformed event must not take down the rest of the list.
      console.warn(`[scraper:pmu] failed to read event ${entry?.event?.id}, skipping it:`, err);
    }
  }
  return events;
}

export async function pmuGet<T>(path: string): Promise<T> {
  const res = await fetch(`${PMU_BASE_URL}/${path}`, { headers: HEADERS, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`PMU ${path.split("?")[0]}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

interface PmuSport {
  name: string;
  termKey: string;
}

// The site's sports this project reads, by the names ./canonical.ts lists.
async function readSports(): Promise<PmuSport[]> {
  const reply = await pmuGet<{ group?: { groups?: Partial<PmuSport>[] } }>(`group.json?${PMU_QUERY}&depth=1`);
  const wanted = new Set([...verifiedSportNames("pmu"), WINTER_SPORTS].map((name) => name.toLowerCase()));
  return (reply.group?.groups ?? []).flatMap((g) =>
    g.name && g.termKey && wanted.has(g.name.toLowerCase()) ? [{ name: g.name, termKey: g.termKey }] : []
  );
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchSport(sport: PmuSport): Promise<RawEvent[]> {
  const reply = await pmuGet<{ events?: PmuListEntry[] }>(`listView/${sport.termKey}.json?${PMU_QUERY}&useCombined=true`);
  await sleep(PMU_REQUEST_DELAY_MS);
  return parsePmuEvents(reply.events ?? [], sport.name);
}

export async function fetchPmu(): Promise<RawEvent[]> {
  const sports = await readSports();
  if (sports.length === 0) throw new Error("PMU's sports list holds none of the sports it is read for");

  const read = await pool(sports, CONCURRENCY, fetchSport);
  // Every sport failing is the bookmaker failing (runScrapeCycle retries it);
  // one failing costs only its own matches.
  if (read.every((r) => r.status === "rejected")) throw new Error("every pmu sport failed");
  return read.flatMap((r, i) => {
    if (r.status === "fulfilled") return r.value;
    console.warn(`[scraper:pmu] "${sports[i].name}" failed, skipping it:`, r.reason);
    return [];
  });
}

export const pmuScraper: BookmakerScraper = { id: "pmu", fetch: fetchPmu };
