import { DatabaseSync } from "node:sqlite";
import {
  bookmakerOutcomeLabel,
  compareMarketKeys,
  mainMarketLabel,
  compareOutcomes,
  marketLabel,
  outcomeLabel,
  parseMarketKey,
  ParsedMarketKey,
  mainSectionOf,
  sectionsOf,
  SectionKey,
} from "../markets/catalog";
import { ListingOptions, marketsCutoff, MOVE_SHOWN_MS, notStartedCutoff, oddsCutoff, PriceMove } from "./repository";
import { competitionName } from "./competition";
import { loadBookmakerLinks } from "./bookmakerLinks";
import { loadReferences } from "./reference";
import { loadPlayerExchange } from "./playerReference";
import { ExchangePlayer, PLAYER_MARKET_KEYS, PlayerSignal, siteSignals } from "./playerValue";
import { loadTennisReference } from "./tennisReference";
import { tennisSignals } from "./tennisValue";
import { valueEdges } from "./value";
import { Grid, isRemainder, mainOutcomeLabel, payoutRateOf, sameOutcomes } from "./marketGrid";
import { MARKET_1X2, MARKET_MATCH_WINNER, MARKET_OUTRIGHT } from "../scraper/canonical";

// Every label here is built by src/markets/catalog.ts: the listing's main
// markets, whose keys are the French names they were stored under, by
// mainMarketLabel. A bookmaker's own market ("wx:...") keeps its name, its
// outcomes' usual words read in German (bookmakerOutcomeLabel).

// One match's page (GET /api/events/:id): every market with a current price,
// in sections, each outcome with every requested bookmaker's price.

export interface OutcomeDetail {
  key: string;
  label: string;
  // By bookmaker.
  prices: Record<string, number>;
  // The bookmakers at its best price, ties included; none when fewer than two
  // price it, since there is nothing to compare.
  best: string[];
  // The 1X2's outcomes, when the reference prices the match
  // (src/db/reference.ts): their fair odds, and the edge of each bookmaker's
  // price at or above them by VALUE_MIN_EDGE (src/db/value.ts). The players'
  // of its scorer markets (src/db/playerValue.ts): their fair odds when the
  // exchange prices them reliably, else its lay as a ceiling
  // (`fairIsCeiling`) when a price is a value bet above it; value bets from
  // PLAYER_VALUE_MIN_EDGE; and a bookmaker's suspect price, by its gap over
  // the other's, when the exchange has nothing.
  fair?: number;
  fairIsCeiling?: true;
  // A 1X2's fair odds made of Pinnacle's prices rather than the exchange's.
  fairFromPinnacle?: true;
  edges?: Record<string, number>;
  suspects?: Record<string, number>;
  // A bookmaker's boosted price of it (20bet's odds boost, RawOdds.boosted),
  // shown beside its price and never counted as it.
  boosted?: Record<string, number>;
  // A bookmaker's price that moved within MOVE_SHOWN_MS: the price before,
  // and when it moved.
  moved?: Record<string, PriceMove>;
}

export type { PriceMove };

// What a market's outcome is worth, given its ticked bookmakers' prices.
type Valuation = (
  key: string,
  prices: Record<string, number>
) => Pick<OutcomeDetail, "fair" | "fairIsCeiling" | "fairFromPinnacle" | "edges" | "suspects"> | undefined;

export interface MarketLine {
  // The market's line when it has one: 2.5 for "over/under 2.5 goals".
  line: number | null;
  // Best prices' TRJ, when the market's outcomes cover every case and every
  // bookmaker pricing it prices them all.
  payoutRate: number | null;
  outcomes: OutcomeDetail[];
}

export interface MarketDetail {
  key: string;
  label: string;
  // "lines": the over/under lines of one market, as a table; "list": its
  // outcomes one under another.
  kind: "lines" | "list";
  // Priced by at least two of the requested bookmakers.
  compared: boolean;
  lines: MarketLine[];
}

export interface SectionDetail {
  key: SectionKey;
  label: string;
  markets: MarketDetail[];
}

export interface EventDetail {
  id: string;
  sport: string;
  competition: string;
  // The competition as the matches' "Compétition" filter names it (its season
  // left out, a winner's title for its own), which the competition links to.
  competitionFilter: string;
  startTime: string;
  participants: string[];
  sections: SectionDetail[];
  // Market lines compared across bookmakers, and those whose best prices
  // guarantee a profit.
  comparedCount: number;
  surebetCount: number;
  // By bookmaker pricing it (of those requested): the match's page at the
  // bookmaker, when its address can be built (./bookmakerLinks.ts).
  links: Record<string, string>;
}

interface Row {
  bookmakerId: string;
  market: string;
  selection: string;
  price: number;
  boosted: number | null;
  movedFrom: number | null;
  movedAt: string | null;
}

function bestOf(prices: Map<string, number>): string[] {
  if (prices.size < 2) return [];
  const max = Math.max(...prices.values());
  return [...prices].filter(([, p]) => p === max).map(([b]) => b);
}

function sectionOf(parsed: ParsedMarketKey, sport: string): SectionKey {
  if (parsed.kind === "family") return parsed.family.section;
  if (parsed.kind === "unrecognized") return parsed.bookmaker;
  return mainSectionOf(sport);
}

function outcomesOf(
  parsed: ParsedMarketKey,
  grid: Grid,
  participants: string[],
  valuation?: Valuation,
  boosts?: ReadonlyMap<string, Map<string, number>>,
  moves?: ReadonlyMap<string, Map<string, PriceMove>>
): OutcomeDetail[] {
  const line = parsed.kind === "family" ? parsed.line : undefined;
  const comparable = (key: string) => parsed.kind !== "family" || !isRemainder(key) || sameOutcomes(grid);
  const outcomes = [...grid].map(([key, prices]) => {
    const outcome: OutcomeDetail = {
      key,
      label:
        parsed.kind === "family"
          ? outcomeLabel(parsed.family.key, key, participants, line)
          : parsed.kind === "other"
            ? mainOutcomeLabel(key, participants)
            : bookmakerOutcomeLabel(key),
      prices: Object.fromEntries(prices),
      best: comparable(key) ? bestOf(prices) : [],
      ...(boosts?.get(key)?.size ? { boosted: Object.fromEntries(boosts.get(key)!) } : {}),
      ...(moves?.get(key)?.size ? { moved: Object.fromEntries(moves.get(key)!) } : {}),
    };
    return { ...outcome, ...valuation?.(key, outcome.prices) };
  });
  const bestPrice = (o: OutcomeDetail) => Math.max(...Object.values(o.prices));
  // Players, and a tournament's winner among them: the favourites first.
  const byPrice =
    parsed.kind === "unrecognized" ||
    (parsed.kind === "family" && parsed.family.byPrice) ||
    (parsed.kind === "other" && parsed.name === MARKET_OUTRIGHT);
  return outcomes.sort((a, b) =>
    byPrice
      ? bestPrice(a) - bestPrice(b) || a.label.localeCompare(b.label, "fr")
      : compareOutcomes(parsed.kind === "family" ? parsed.family.key : "1X2", a.key, b.key)
  );
}

// Over/under lines of one market share a card, as a table; any other market
// with a line (a scorer's number of goals, a result and a total) gets its own.
function sharesLines(parsed: ParsedMarketKey, grid: Grid): boolean {
  return parsed.kind === "family" && parsed.family.hasLine && [...grid.keys()].every((k) => k === "over" || k === "under");
}

export function getEventDetail(
  db: DatabaseSync,
  id: string,
  opts: { bookmakers?: readonly string[] } & ListingOptions = {}
): EventDetail | null {
  const event = db
    .prepare("SELECT id, sport, competition, start_time AS startTime, participants FROM events WHERE id = @id")
    .get({ id }) as { id: string; sport: string; competition: string; startTime: string; participants: string } | undefined;
  // Started matches are off the dashboard (see notStartedCutoff).
  if (!event || event.startTime <= notStartedCutoff()) return null;
  const participants: string[] = JSON.parse(event.participants);

  // A bookmaker can give an outcome in both (Unibet's 1X2 of a basketball
  // match: its list's, and its markets'): the listing's, refreshed more often,
  // comes last and is the one kept.
  const rows = db
    .prepare(
      `SELECT bookmaker_id AS bookmakerId, market, selection, price, boosted,
              CASE WHEN moved_at >= @movedSince THEN prev_price END AS movedFrom,
              CASE WHEN moved_at >= @movedSince THEN moved_at END AS movedAt, 1 AS fromListing
       FROM event_bookmaker_odds
       WHERE event_id = @id AND scraped_at >= @oddsSince
       UNION ALL
       SELECT bookmaker_id AS bookmakerId, market, selection, price, NULL AS boosted,
              CASE WHEN moved_at >= @movedSince THEN prev_price END AS movedFrom,
              CASE WHEN moved_at >= @movedSince THEN moved_at END AS movedAt, 0 AS fromListing
       FROM event_market_odds
       WHERE event_id = @id AND scraped_at >= @marketsSince
       ORDER BY bookmakerId, fromListing`
    )
    .all({
      id,
      oddsSince: oddsCutoff(opts),
      marketsSince: marketsCutoff(opts),
      movedSince: new Date(Date.now() - MOVE_SHOWN_MS).toISOString(),
    }) as unknown as Row[];
  // A match none of whose prices is current any more has nothing to show.
  if (rows.length === 0) return null;

  const grids = new Map<string, Grid>();
  // The boosted prices, by market, outcome and bookmaker: the listing's only,
  // which comes last for a bookmaker giving an outcome twice.
  const boosts = new Map<string, Map<string, Map<string, number>>>();
  // The recent moves, the same way.
  const moves = new Map<string, Map<string, Map<string, PriceMove>>>();
  for (const row of rows) {
    if (opts.bookmakers && !opts.bookmakers.includes(row.bookmakerId)) continue;
    let grid = grids.get(row.market);
    if (!grid) grids.set(row.market, (grid = new Map()));
    let prices = grid.get(row.selection);
    if (!prices) grid.set(row.selection, (prices = new Map()));
    prices.set(row.bookmakerId, row.price);
    const boosted = boosts.get(row.market)?.get(row.selection);
    if (row.boosted === null) boosted?.delete(row.bookmakerId);
    else {
      if (!boosts.has(row.market)) boosts.set(row.market, new Map());
      const bySelection = boosts.get(row.market)!;
      if (!bySelection.has(row.selection)) bySelection.set(row.selection, new Map());
      bySelection.get(row.selection)!.set(row.bookmakerId, row.boosted);
    }
    const moved = moves.get(row.market)?.get(row.selection);
    if (row.movedFrom === null || row.movedAt === null) moved?.delete(row.bookmakerId);
    else {
      if (!moves.has(row.market)) moves.set(row.market, new Map());
      const bySelection = moves.get(row.market)!;
      if (!bySelection.has(row.selection)) bySelection.set(row.selection, new Map());
      bySelection.get(row.selection)!.set(row.bookmakerId, { from: row.movedFrom, at: row.movedAt });
    }
  }

  // What the outcomes are worth: the reference's fair odds of the 1X2 (the
  // listing's main market), and the players' (src/db/playerValue.ts), weighed
  // against every bookmaker's prices, ticked or not.
  const reference = loadReferences(db, [id], oddsCutoff(opts)).get(id);
  const exchange = loadPlayerExchange(db, [id], oddsCutoff(opts)).get(id);
  // The exchange's other markets of a tennis match, of a football match, of a
  // basketball match (its handicap and total points).
  const tennis =
    event.sport === "tennis" || event.sport === "football" || event.sport === "basketball"
      ? loadTennisReference(db, [id], oddsCutoff(opts)).get(id)
      : undefined;
  // Every bookmaker's prices of a market, ticked or not, by outcome.
  const everyBookmakerOf = (key: string) => {
    const everyBookmaker = new Map<string, Map<string, number>>();
    for (const row of rows) {
      if (row.market !== key) continue;
      if (!everyBookmaker.has(row.bookmakerId)) everyBookmaker.set(row.bookmakerId, new Map());
      everyBookmaker.get(row.bookmakerId)!.set(row.selection, row.price);
    }
    return everyBookmaker;
  };
  // An outcome's value from its market's signals (a player's, a tennis
  // market's): its fair odds, else the lay as their ceiling when a price is a
  // value bet above it; and its suspect prices.
  const signalValuation =
    (known: ReadonlyMap<string, ExchangePlayer>, signals: PlayerSignal[]): Valuation =>
    (outcome, prices) => {
      const own = signals.filter((s) => s.player === outcome && prices[s.bookmaker] !== undefined);
      const edgesOf = (basis: string) => Object.fromEntries(own.filter((s) => s.basis === basis).map((s) => [s.bookmaker, s.edge]));
      const suspects = edgesOf("bookmaker");
      const value = Object.keys(suspects).length ? { suspects } : {};
      const fair = known.get(outcome)?.fair;
      if (fair !== undefined) return { fair, edges: edgesOf("fair"), ...value };
      const lay = known.get(outcome)?.lay;
      if (lay !== undefined && own.some((s) => s.basis === "lay")) {
        return { fair: lay, fairIsCeiling: true as const, edges: edgesOf("lay"), ...value };
      }
      return Object.keys(value).length ? value : undefined;
    };
  const valuationOf = (key: string): Valuation | undefined => {
    if (key === MARKET_1X2 || key === MARKET_MATCH_WINNER) {
      // Only the market the reference prices: a match with a winner and a
      // 1X2 (overtime included or not) has fair odds for one of them.
      if (reference?.market !== key) return undefined;
      return (
        reference &&
        ((outcome, prices) => {
          const fair = reference.fair[outcome as keyof typeof reference.fair];
          if (fair === undefined) return undefined;
          return {
            fair,
            ...(reference.source === "pinnacle" ? { fairFromPinnacle: true as const } : {}),
            edges: valueEdges(prices, fair, { selection: outcome, sharp: reference.sharp }),
          };
        })
      );
    }
    const tennisMarket = tennis?.get(key);
    if (tennisMarket) return signalValuation(tennisMarket, tennisSignals(tennisMarket, everyBookmakerOf(key)));
    if (!PLAYER_MARKET_KEYS.includes(key)) return undefined;
    const known = exchange?.get(key) ?? new Map();
    return signalValuation(known, siteSignals(known, everyBookmakerOf(key)));
  };

  const parsedKeys = [...grids.keys()]
    .map((key) => ({ key, parsed: parseMarketKey(key) }))
    .sort((a, b) => compareMarketKeys(a.parsed, b.parsed));

  const markets = new Map<string, { section: SectionKey; detail: MarketDetail }>();
  let comparedCount = 0;
  let surebetCount = 0;
  for (const { key, parsed } of parsedKeys) {
    const grid = grids.get(key)!;
    const payoutRate = payoutRateOf(parsed, grid);
    const compared = new Set([...grid.values()].flatMap((prices) => (prices.size >= 2 ? [...prices.keys()] : []))).size >= 2;
    if (compared) comparedCount++;
    if (payoutRate !== null && payoutRate >= 1) surebetCount++;

    const line: MarketLine = {
      line: parsed.kind === "family" ? (parsed.line ?? null) : null,
      payoutRate,
      outcomes: outcomesOf(parsed, grid, participants, valuationOf(key), boosts.get(key), moves.get(key)),
    };
    const shared = sharesLines(parsed, grid);
    // A player's statistic is a card of its own, its lines in the table.
    const cardKey = shared && parsed.kind === "family" ? `${parsed.family.key}${parsed.player ? `#${parsed.player}` : ""}` : key;
    const existing = markets.get(cardKey);
    if (existing) {
      existing.detail.lines.push(line);
      existing.detail.compared ||= compared;
      continue;
    }
    markets.set(cardKey, {
      section: sectionOf(parsed, event.sport),
      detail: {
        key: cardKey,
        label:
          parsed.kind === "family"
            ? marketLabel(parsed.family, participants, shared ? undefined : parsed.line, parsed.player)
            : parsed.kind === "other"
              ? mainMarketLabel(parsed.name, event.sport)
              : parsed.name,
        kind: shared ? "lines" : "list",
        compared,
        lines: [line],
      },
    });
  }

  const sections = sectionsOf(event.sport).map(({ key, label }) => ({
    key,
    label,
    markets: [...markets.values()].filter((m) => m.section === key).map((m) => m.detail),
  })).filter((s) => s.markets.length > 0);

  return {
    id: event.id,
    sport: event.sport,
    competition: event.competition,
    competitionFilter: competitionName({ sport: event.sport, competition: event.competition, participants }),
    startTime: event.startTime,
    participants,
    sections,
    comparedCount,
    surebetCount,
    links: linksOf(db, event.id, rows, opts.bookmakers),
  };
}

// The bookmakers' addresses of the match, for those with a current price of it.
function linksOf(db: DatabaseSync, id: string, rows: readonly Row[], bookmakers: readonly string[] | undefined): Record<string, string> {
  const pricing = new Set(rows.map((r) => r.bookmakerId).filter((b) => !bookmakers || bookmakers.includes(b)));
  return Object.fromEntries(Object.entries(loadBookmakerLinks(db, [id]).get(id) ?? {}).filter(([b]) => pricing.has(b)));
}
