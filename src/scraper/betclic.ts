import {
  decodeFields,
  fieldString,
  fieldMessage,
  fieldDouble,
  encodeStringField,
  encodeVarintField,
  ProtoField,
} from "./protoWire";
import { RawEvent, RawOdds } from "../types";
import { BookmakerScraper } from "./run";
import { canonicalMarketName, canonicalSport, hasOutrights, isResultMarketTitle, MARKET_OUTRIGHT, OUTRIGHT_SPORTS } from "./canonical";
import { validateRawEvent } from "./validateRawEvent";

// Method names and message schemas: Betclic's own web bundle, whose protobuf
// descriptors name every field (offering.access.api.*, read from the
// 2026-09-12 capture of www.betclic.fr/main-TVAGGBQJ.js on the Wayback
// Machine, since the site itself turns non-French clients away).
const MATCH_SERVICE = "https://offering.begmedia.com/web/offering.access.api/offering.access.api.MatchService";

// Betclic's internal sport slugs, as used by this endpoint's request field 1.
// "football" is verified extensively against live traffic (the committed
// fixture). "tennis", "basketball", and "ice_hockey" are verified live (each
// returns HTTP 200 with a valid gRPC-Web frame header). The rest follow the
// same naming convention, confirmed against the sport-icon asset filenames
// Betclic's own sidebar loads (sport_baseball.svg, sport_biathlon.svg, etc.)
// but are not individually live-verified -- fetchAllBetclicSports (Task 2,
// Step 3 below) skips and warns on any slug the live endpoint rejects, rather
// than failing the whole scrape. The slugs from "handball" on were verified
// live (2026-09-28): each returns a gRPC-Web frame, while a wrong guess
// ("rugby", "mma", "motorsport", ...) gets an empty response. Winamax's
// "Automobile" is split per series here: "rally" and "nascar" (verified live
// 2026-09-29; "wrc", "indycar", "formula_e" answer nothing).
export const BETCLIC_SPORT_SLUGS = [
  "football",
  "tennis",
  "basketball",
  "ice_hockey",
  "baseball",
  "biathlon",
  "boxing",
  "cycling",
  "american_football",
  "australian_rules",
  "formula_1",
  "handball",
  "golf",
  "rugby_union",
  "rugby_league",
  "snooker",
  "volleyball",
  "alpine_skiing",
  "cross_country_skiing",
  "ski_jumping",
  "motorcycling",
  "martial_arts",
  "rally",
  "nascar",
  "formula_2",
  "badminton",
  "table_tennis",
  "judo",
];

// Request field .5 is a page size, but Betclic caps it at 40 matches per
// response whatever is asked (verified live: 10 returns 10, 40, 100 and 1000
// all return 40). Asking for more costs nothing and takes bigger pages should
// Betclic ever raise that cap: fetchBetclicSport advances by what each page
// actually holds.
const REQUEST_LIMIT = 1000;
// Request field .4 is where the page starts in the sport's match list
// (verified live: offset 40 returns the next 40 matches, offset 1 the same
// list shifted by one).
const OFFSET_FIELD = 4;
// Football, the largest sport, took 17 pages of 40 (2026-09-28); this only
// stops a runaway walk.
const MAX_PAGES_PER_SPORT = 50;
const REQUEST_TIMEOUT_MS = 20_000;

// GetMatchBySportRequest { sport_code .1, language .3, offset .4, limit .5 }.
function sportRequest(sportSlug: string, offset: number): Buffer {
  return Buffer.concat([
    encodeStringField(1, sportSlug),
    encodeStringField(3, "fr"),
    // Left out on the first page, which then stays the request Betclic's own
    // site sends (tests/scraper/fixtures/betclic-matchservice-request.bin).
    ...(offset > 0 ? [encodeVarintField(OFFSET_FIELD, offset)] : []),
    encodeVarintField(5, REQUEST_LIMIT),
  ]);
}

// GetMatchRequest { match_id .1, language .2, category_id .3 }: what Betclic's
// site asks for a match's own page, and for one of its tabs ("ca_ftb_goa")
// when given one.
function matchRequest(matchId: bigint, categoryId?: string): Buffer {
  return Buffer.concat([
    encodeVarintField(1, matchId),
    encodeStringField(2, "fr"),
    ...(categoryId ? [encodeStringField(3, categoryId)] : []),
  ]);
}

// Every MatchService method this uses is server-streaming: after the first
// frame (the requested page of matches, the requested match) it keeps the
// connection open and pushes live-odds deltas. This project polls on an
// interval (POLL_INTERVAL_MINUTES) rather than holding a live connection
// open, so this reads only until the first complete frame has arrived and
// then aborts, returning that frame's protobuf message bytes (with its 5-byte
// gRPC-Web frame header stripped). `what` names the request in errors.
async function fetchFirstFrame(method: string, message: Buffer, what: string): Promise<Buffer> {
  const header = Buffer.alloc(5); // flag byte (0x00) + 4-byte big-endian length
  header.writeUInt32BE(message.length, 1);
  const controller = new AbortController();
  // Without a deadline, a stream that never completes its first frame would
  // hold the whole scrape cycle, Winamax included: the scheduler skips every
  // tick while a cycle is still running.
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(`${MATCH_SERVICE}/${method}`, {
      method: "POST",
      headers: {
        "content-type": "application/grpc-web+proto",
        "x-grpc-web": "1",
        "x-bg-regulation": "FR",
        "x-bg-ref-brand": "BETCLIC",
        "x-bg-ref-regulator-zone": "FR",
        "x-bg-ref-platform": "DESKTOP",
        appversion: "10.5.0-0",
      },
      body: Buffer.concat([header, message]),
      signal: controller.signal,
    });

    if (!res.ok || !res.body) {
      throw new Error(`Betclic ${method} (${what}) failed: ${res.status}`);
    }

    const reader = res.body.getReader();
    const chunks: Buffer[] = [];
    let total = 0;
    let declaredFrameEnd: number | null = null;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      chunks.push(Buffer.from(value));
      total += value.length;
      if (declaredFrameEnd === null && total >= 5) {
        const header = Buffer.concat(chunks).subarray(0, 5);
        declaredFrameEnd = header.readUInt32BE(1) + 5;
      }
      if (declaredFrameEnd !== null && total >= declaredFrameEnd) break;
    }

    if (declaredFrameEnd === null) {
      const message = `Betclic ${method} (${what}): response too short to contain a frame header`;
      throw total === 0 ? new BetclicEmptyReply(message) : new Error(message);
    }
    return Buffer.concat(chunks).subarray(5, declaredFrameEnd);
  } catch (err) {
    if (timedOut) {
      throw new Error(`Betclic ${method} (${what}): no answer within ${REQUEST_TIMEOUT_MS} ms`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
    controller.abort();
  }
}

// An empty body, not a frame: what Betclic answers a sport with nothing to list
// (and a slug it does not know).
class BetclicEmptyReply extends Error {}

export function fetchBetclicSportFrame(sportSlug: string, offset = 0): Promise<Buffer> {
  return fetchFirstFrame("GetMatchesBySportWithNotifications", sportRequest(sportSlug, offset), `${sportSlug}, offset ${offset}`);
}

export function fetchBetclicMatchFrame(matchId: bigint, categoryId?: string): Promise<Buffer> {
  const what = categoryId ? `match ${matchId}, tab ${categoryId}` : `match ${matchId}`;
  return fetchFirstFrame("GetMatchWithNotification", matchRequest(matchId, categoryId), what);
}

function findField(fields: ProtoField[], num: number): ProtoField | undefined {
  return fields.find((f) => f.fieldNumber === num);
}

// Betclic renders start times with 7 fractional-second digits
// ("2026-09-23T16:45:00.0000000Z"); JS's Date parses this fine, and its own
// toISOString() always normalizes back to exactly 3 digits, matching every
// other timestamp this project stores.
function normalizeTimestamp(raw: string): string {
  return new Date(raw).toISOString();
}

// "Master d'Augusta  2027", "Alfred Dunhill Links Championship 2026.": the
// titles of Betclic's outright markets carry stray spaces and full stops.
function cleanTitle(title: string): string {
  return title.replace(/\s+/g, " ").replace(/[\s.]+$/, "").trim();
}

// A golf tournament's page holds its winner beside its Top 5, Top 10 and Top
// 20, the leader after round 1 and the best of each nationality; other sports'
// pages hold qualifying winners, "Double Chance - Vainqueur" and head-to-heads.
// Only the winner is the shared outright market, and a market has no type code
// at Betclic (6/10/2026): its title is all that tells them apart.
const WINNER_MARKET_TITLE = /^(vainqueur|champion)\b/;
const OTHER_MARKET_TITLE = /\b(top\s*\d+|podium|chance|face|leader|meilleur|marge|termine)\b/;

const plainTitle = (title: string): string => cleanTitle(title).toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
const isWinnerMarketTitle = (title: string): boolean => WINNER_MARKET_TITLE.test(plainTitle(title));
// A market known not to be the winner's. An unknown title is not one: a
// qualifying session's "Qualifications - Vainqueur" is the one its listing shows.
const isOtherMarketTitle = (title: string): boolean => OTHER_MARKET_TITLE.test(plainTitle(title));

// Selection { name .10, odds .12 }, the same message in the listing's
// main_selections and on the match page.
function readSelection(selection: ProtoField[], market: string): RawOdds | null {
  const labelField = findField(selection, 10);
  const priceField = findField(selection, 12);
  if (!labelField || !priceField) return null;
  return { market, selection: fieldString(labelField), price: fieldDouble(priceField) };
}

const warnedOtherMainMarkets = new Set<string>();

// Once per sport and title per process, like the unmapped sports' warning.
function warnOtherMainMarket(sport: string, title: string): void {
  const key = `${sport}|${title}`;
  if (warnedOtherMainMarkets.has(key)) return;
  warnedOtherMainMarkets.add(key);
  console.warn(`[scraper:betclic] a ${sport} match's main market is "${title}", not its result or winner: skipping it`);
}

// A winner-among-N market's event reads as one with a single participant (its
// title). Its odds are whatever the listing shows, possibly none: the listing
// carries a market's first 3 selections (Market.main_selections, .16) and
// some outrights (a qualifying session, a season's standings) with no market
// at all, so fetchBetclicSport reads the whole field from the match page.
function matchToRawEvent(match: ProtoField[]): RawEvent | null {
  const startTimeField = findField(match, 3);
  const competitionField = findField(match, 8);
  const marketField = findField(match, 9);
  const contestantFields = match.filter((f) => f.fieldNumber === 12);
  if (!startTimeField || !competitionField) return null;

  const competition = fieldMessage(competitionField);
  const competitionNameField = findField(competition, 2);
  const sportInfoField = findField(competition, 3);
  if (!competitionNameField || !sportInfoField) return null;
  const sportSlugField = findField(fieldMessage(sportInfoField), 1);
  if (!sportSlugField) return null;
  const sport = canonicalSport("betclic", fieldString(sportSlugField));

  // A winner-among-N market of a sport without head-to-heads (a race, a golf
  // tournament), or a competition's winner in one with (Ligue 1): no contestants,
  // the match's name (.2) is its title and its runners are the selections. A
  // competition's other bets (its top scorer, its Top 4) are such events too:
  // one whose main market is known and is not a winner's is left out. Anywhere
  // else, a match without two contestants is left out, as before.
  const titleField = findField(match, 2);
  const listedTitle = marketField && findField(fieldMessage(marketField), 2);
  const outright =
    contestantFields.length === 0 &&
    hasOutrights(sport) &&
    titleField !== undefined &&
    (OUTRIGHT_SPORTS.has(sport) || !listedTitle || isWinnerMarketTitle(fieldString(listedTitle)));
  if (!outright && !marketField) return null;
  // A match whose main market is not its result or winner is left out rather
  // than read as one (./canonical.ts). Never seen at Betclic (4/10/2026), but
  // its key comes from the outcome count alone, like Winamax's.
  const marketTitleField = marketField && findField(fieldMessage(marketField), 2);
  if (!outright && marketTitleField && !isResultMarketTitle(fieldString(marketTitleField))) {
    warnOtherMainMarket(sport, fieldString(marketTitleField));
    return null;
  }
  // A golf tournament's listing can name its Top 5 as the main market (6/10/2026,
  // its 3 favourites even carry the Top 20's prices): they are not the winner's,
  // so the outright is left without prices for fetchBetclicSport to read its
  // match page.
  const otherMainMarket = outright && marketTitleField !== undefined && isOtherMarketTitle(fieldString(marketTitleField));
  const selections = marketField && !otherMainMarket ? fieldMessage(marketField).filter((f) => f.fieldNumber === 16) : [];

  const participants = outright
    ? [cleanTitle(fieldString(titleField))]
    : contestantFields
        .map((f) => findField(fieldMessage(f), 3))
        .filter((f): f is ProtoField => f !== undefined)
        .map(fieldString);
  if (!outright && participants.length < 2) return null;

  // The shared cross-bookmaker market key, derived from the market's
  // selection count -- not this market's own name (.9.2, "Résultat du match
  // (t. rég)"), which never equals Winamax's name for the same market. See
  // ./canonical.ts.
  const marketName = outright ? MARKET_OUTRIGHT : canonicalMarketName(selections.length);

  const odds = selections
    .map((f) => readSelection(fieldMessage(f), marketName))
    .filter((o): o is RawOdds => o !== null);
  if (!outright && odds.length === 0) return null;

  const matchId = findField(match, 1)?.varint;
  return {
    sport,
    competition: fieldString(competitionNameField),
    startTime: normalizeTimestamp(fieldString(startTimeField)),
    participants,
    odds,
    ...(matchId !== undefined ? { sourceId: matchId.toString() } : {}),
  };
}

// A winner-among-N market as the listing shows it, for fetchBetclicSport to
// complete from its match page.
export interface BetclicOutright {
  matchId: bigint;
  // The listing's market, when it shows one: the same id on the match page.
  marketId: bigint | null;
  // Unvalidated, with the listing's favourites as odds (possibly none).
  event: RawEvent;
}

export interface BetclicListedMatch {
  id: string | null;
  // Validated. For an outright, only what the listing shows.
  event: RawEvent | null;
  outright: BetclicOutright | null;
}

export interface BetclicPage {
  // Every match of the page, in order, including the ones dropped on parsing
  // (event null): paging advances by what Betclic sent, not by what was kept.
  matches: BetclicListedMatch[];
  // The sport's announced total (the response's field .5), null if the
  // response doesn't say. It can exceed what the list holds (fetchBetclicSport).
  total: number | null;
}

export function readBetclicPage(frameBytes: Buffer): BetclicPage {
  if (frameBytes.length === 0) return { matches: [], total: null };
  const rootFields = decodeFields(frameBytes);
  const wrapperField = findField(rootFields, 1);
  if (!wrapperField) return { matches: [], total: null };
  const wrapperFields = fieldMessage(wrapperField);
  const totalField = findField(wrapperFields, 5);

  const matches = wrapperFields
    .filter((f) => f.fieldNumber === 3)
    .map((matchField): BetclicListedMatch => {
      let id: string | null = null;
      try {
        const match = fieldMessage(matchField);
        const matchId = findField(match, 1)?.varint;
        id = matchId?.toString() ?? null;
        const candidate = matchToRawEvent(match);
        const marketField = findField(match, 9);
        const outright =
          candidate !== null && candidate.participants.length === 1 && matchId !== undefined
            ? {
                matchId,
                marketId: (marketField && findField(fieldMessage(marketField), 1)?.varint) ?? null,
                event: candidate,
              }
            : null;
        // Last step before an event leaves this scraper: reject anything the
        // shared matcher/DB can't safely take (e.g. a many-contestant outright,
        // which the matcher's factorial permutation search can't handle). An
        // outright the listing shows no price for is left to fetchBetclicSport.
        const event = candidate && candidate.odds.length > 0 ? validateRawEvent(candidate, "betclic") : null;
        return { id, event, outright };
      } catch (err) {
        // A field present but with an unexpected wire type (fieldString/
        // fieldMessage/fieldDouble throw on a mismatch) or an unparseable start
        // time (normalizeTimestamp's Date parsing throws on garbage input)
        // must not take down every other match in this frame -- skip just the
        // one malformed match, same per-item isolation fetchAllBetclicSports
        // already applies at the per-sport level.
        console.warn(`[scraper:betclic] failed to parse a match, skipping it:`, err);
        return { id, event: null, outright: null };
      }
    });
  return { matches, total: totalField?.varint !== undefined ? Number(totalField.varint) : null };
}

export function parseBetclicFrame(frameBytes: Buffer): RawEvent[] {
  return readBetclicPage(frameBytes).matches.flatMap(({ event }) => (event ? [event] : []));
}

// The whole field of a winner-among-N market, from its match page, as the
// shared outright odds: the market with the listing's id, else the page's
// first one with prices (an outright with no market in the listing shows its
// winner market first: "Vainqueur", "Champion du Monde"). The page reads
// GetMatchResponse { payload .1 { match .1 Match } }, where Match has its
// main market .9, sub_categories .11 [{ markets .3 [Market] }] and markets
// .25 [Market], and Market { id .1, selection_matrix .10 [{ selections .1
// [{ selection .1 Selection }] }], main_selections .16 [Selection] }.
export function readBetclicMarket(frameBytes: Buffer, marketId: bigint | null): RawOdds[] {
  const payload = findField(decodeFields(frameBytes), 1);
  const matchField = payload && findField(fieldMessage(payload), 1);
  if (!matchField) return [];
  const match = fieldMessage(matchField);
  const markets = [
    ...match.filter((f) => f.fieldNumber === 9),
    ...match
      .filter((f) => f.fieldNumber === 11)
      .flatMap((subCategory) => fieldMessage(subCategory).filter((f) => f.fieldNumber === 3)),
    ...match.filter((f) => f.fieldNumber === 25),
  ].map(fieldMessage);

  const oddsOf = (market: ProtoField[]): RawOdds[] => {
    const matrix = market
      .filter((f) => f.fieldNumber === 10)
      .flatMap((row) => fieldMessage(row).filter((f) => f.fieldNumber === 1))
      .map((nullable) => findField(fieldMessage(nullable), 1))
      .filter((f): f is ProtoField => f !== undefined);
    const selections = matrix.length > 0 ? matrix : market.filter((f) => f.fieldNumber === 16);
    return selections
      .map((f) => readSelection(fieldMessage(f), MARKET_OUTRIGHT))
      .filter((o): o is RawOdds => o !== null);
  };

  const titleOf = (market: ProtoField[]): string => {
    const title = findField(market, 2);
    return title ? fieldString(title) : "";
  };
  // The listing's market, unless its title says it is not the winner's: a
  // golf tournament's listing names its Top 5 (isOtherMarketTitle).
  const byId = marketId === null ? undefined : markets.find((m) => findField(m, 1)?.varint === marketId);
  if (byId && !isOtherMarketTitle(titleOf(byId))) return oddsOf(byId);
  // Else a market titled as the winner's, else the first with prices. A market
  // known to be another is never read as the winner's: no price beats a wrong one.
  const candidates = markets.filter((m) => !isOtherMarketTitle(titleOf(m)));
  for (const market of [...candidates.filter((m) => isWinnerMarketTitle(titleOf(m))), ...candidates]) {
    const odds = oddsOf(market);
    if (odds.length > 0) return odds;
  }
  return [];
}

// A sport's whole match list, page after page (see REQUEST_LIMIT). The walk
// ends on an empty page as well as on the announced total: the total also
// counts entries this method never lists -- football announced 677 but its
// list ended after 640 matches (2026-09-28).
async function listBetclicSport(sportSlug: string): Promise<BetclicListedMatch[]> {
  const listed: BetclicListedMatch[] = [];
  const seen = new Set<string>();
  let offset = 0;
  for (let pageCount = 0; pageCount < MAX_PAGES_PER_SPORT; pageCount++) {
    let page: BetclicPage;
    try {
      page = readBetclicPage(await fetchBetclicSportFrame(sportSlug, offset));
    } catch (err) {
      // A sport with no event open (Australian rules out of season, a rally
      // week with none, 8/10/2026) has nothing to list: no failure to report.
      if (pageCount === 0 && err instanceof BetclicEmptyReply) return listed;
      // Nothing read yet: fetchAllBetclicSports reports the sport as failed.
      if (pageCount === 0) throw err;
      console.warn(
        `[scraper:betclic] "${sportSlug}" stopped at offset ${offset}, keeping the ${listed.length} matches read so far:`,
        err
      );
      return listed;
    }

    let fresh = 0;
    for (const match of page.matches) {
      // The list can change between two requests, putting a match already
      // read on the next page too.
      if (match.id !== null) {
        if (seen.has(match.id)) continue;
        seen.add(match.id);
      }
      fresh++;
      listed.push(match);
    }

    if (page.matches.length > 0 && fresh === 0) {
      // Only matches already read: Betclic is ignoring the offset, and asking
      // again would never end.
      console.warn(`[scraper:betclic] "${sportSlug}": the page at offset ${offset} repeats earlier ones, stopping`);
      return listed;
    }
    offset += page.matches.length;
    if (page.matches.length === 0 || page.total === null || offset >= page.total) return listed;
  }
  console.warn(`[scraper:betclic] "${sportSlug}": stopped after ${MAX_PAGES_PER_SPORT} pages, the rest is left out`);
  return listed;
}

// An outright with its whole field. Should its match page fail, it keeps the
// listing's favourites, if any.
async function completeOutright({ matchId, marketId, event }: BetclicOutright): Promise<RawEvent | null> {
  let odds = event.odds;
  try {
    const whole = readBetclicMarket(await fetchBetclicMatchFrame(matchId), marketId);
    if (whole.length > 0) odds = whole;
  } catch (err) {
    console.warn(
      `[scraper:betclic] no match page for "${event.participants[0]}", keeping the listing's ${odds.length} favourites:`,
      err
    );
  }
  return odds.length > 0 ? validateRawEvent({ ...event, odds }, "betclic") : null;
}

// Each outright costs a request of its own (its match page): the winners of a
// sport's competitions (Ligue 1, the cups...) are read up to this many. Football
// is the sport with the most.
const MAX_COMPETITION_WINNERS_PER_SPORT = 120;

export async function fetchBetclicSport(sportSlug: string): Promise<RawEvent[]> {
  const events: RawEvent[] = [];
  let competitions = 0;
  for (const { event, outright } of await listBetclicSport(sportSlug)) {
    if (outright && !OUTRIGHT_SPORTS.has(outright.event.sport) && ++competitions > MAX_COMPETITION_WINNERS_PER_SPORT) {
      if (competitions === MAX_COMPETITION_WINNERS_PER_SPORT + 1) {
        console.warn(`[scraper:betclic] "${sportSlug}": more than ${MAX_COMPETITION_WINNERS_PER_SPORT} competitions' winners, the rest is left out`);
      }
      continue;
    }
    const kept = outright ? await completeOutright(outright) : event;
    if (kept) events.push(kept);
  }
  return events;
}

async function fetchAllBetclicSports(): Promise<RawEvent[]> {
  const events: RawEvent[] = [];
  // One request at a time: the whole catalog is about 60 listing pages plus
  // one match page per outright (about 35), of a few hundred milliseconds
  // each (2026-09-29), well within POLL_INTERVAL_MINUTES.
  for (const slug of BETCLIC_SPORT_SLUGS) {
    try {
      events.push(...(await fetchBetclicSport(slug)));
    } catch (err) {
      // An unverified slug (see BETCLIC_SPORT_SLUGS) or a transient failure
      // for one sport must not drop every other sport's odds -- runScrapeCycle
      // already retries the whole fetch() once, so a truly transient failure
      // gets a second chance at the outer level.
      console.warn(`[scraper:betclic] fetch failed for sport "${slug}":`, err);
    }
  }
  return events;
}

export const betclicScraper: BookmakerScraper = {
  id: "betclic",
  fetch: fetchAllBetclicSports,
};
