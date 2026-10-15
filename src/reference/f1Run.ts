import { DatabaseSync } from "node:sqlite";
import { getReferenceTargets, golfCompetitors, saveReferenceMarkets } from "../db/reference";
import { DEFAULT_ODDS_MAX_AGE_MS } from "../db/repository";
import { fetchEventDetails, fetchExchangePrices, MarketPrices, searchEvents } from "./exchange";
import { F1_SPORT, F1_TOLERANCE_MS, F1Entry, f1Entries, f1Kind, parseF1Events } from "./f1";
import { golfPrices, placeGolfTournament } from "./golf";

// The reference for a Formula 1 race's winner (./f1.ts), in the worker's
// reference cycle after the golf's (./golfRun.ts, whose steps it follows
// without the Top N): the exchange's races are searched, those of the week are
// placed in it and priced together, each cycle.

const HORIZON_MS = 7 * 24 * 60 * 60 * 1000;
const QUERIES = ["Formula 1", "Grand Prix"];

export interface F1ReferenceOptions {
  search?: (query: string, opts?: { size?: number }) => Promise<unknown>;
  prices?: (markets: { marketId: string; eventId: string }[]) => Promise<Map<string, MarketPrices>>;
  // An event's markets, as the exchange answers (./exchange.ts, fetchEventDetails).
  details?: (exchangeEventId: string) => Promise<unknown>;
  now?: Date;
  oddsMaxAgeMs?: number;
}

export async function runF1ReferenceCycle(db: DatabaseSync, opts: F1ReferenceOptions = {}): Promise<void> {
  const search = opts.search ?? searchEvents;
  const prices = opts.prices ?? ((markets) => fetchExchangePrices(markets));
  const now = (opts.now ?? new Date()).getTime();
  const oddsSince = new Date(now - (opts.oddsMaxAgeMs ?? DEFAULT_ODDS_MAX_AGE_MS)).toISOString();
  const targets = getReferenceTargets(db, {
    from: new Date(now).toISOString(),
    to: new Date(now + HORIZON_MS).toISOString(),
    oddsSince,
    sports: [F1_SPORT],
  });
  if (targets.length === 0) return;

  const bodies = await Promise.all(QUERIES.map((query) => search(query, { size: 50 })));
  const events = [...new Map(bodies.flatMap(parseF1Events).map((e) => [e.id, e])).values()];
  const races: F1Entry[] = events.flatMap((e) => f1Entries(e, e.topMarkets));

  // A qualifying session's winner is not among a search's top markets: it is
  // read from the details of the Grand Prix's event, once per event.
  const details = opts.details ?? fetchEventDetails;
  const wantsQualifying = (kind: string) => kind === "qualifying" || kind === "sprint qualifying";
  const qualifyingTargets = targets.filter((t) => wantsQualifying(f1Kind(t.participants[0])));
  const read = new Set<string>();
  for (const event of events) {
    const near = qualifyingTargets.some(
      (t) => Math.abs(Date.parse(event.startTime) - Date.parse(t.startTime)) <= F1_TOLERANCE_MS.qualifying
    );
    if (!near || read.has(event.id)) continue;
    read.add(event.id);
    try {
      const body = (await details(event.id)) as { marketCatalogues?: unknown };
      for (const entry of f1Entries(event, body?.marketCatalogues)) {
        if (wantsQualifying(entry.kind) && !races.some((r) => r.marketId === entry.marketId)) races.push(entry);
      }
    } catch (err) {
      console.error(`[reference:f1] details of ${event.name}:`, err);
    }
  }
  const placed = targets.flatMap((target) => {
    const competitors = golfCompetitors(db, target.eventId, oddsSince);
    // Its own kind only: a sprint shares every driver with its Grand Prix.
    const kind = f1Kind(target.participants[0]);
    const sameKind = races.filter(
      (r) =>
        r.kind === kind && Math.abs(Date.parse(r.startTime) - Date.parse(target.startTime)) <= F1_TOLERANCE_MS[kind]
    );
    // A qualifying session is dated by its Grand Prix's race on the exchange:
    // moved to ours, so that the matcher's own 48 hours don't drop it.
    const dated = kind === "qualifying" || kind === "sprint qualifying";
    const race = placeGolfTournament(
      { participants: target.participants, startTime: target.startTime, competitors, sport: F1_SPORT },
      dated ? sameKind.map((r) => ({ ...r, startTime: target.startTime })) : sameKind
    );
    return race ? [{ target, race, competitors }] : [];
  });

  const fair = new Set<string>();
  if (placed.length > 0) {
    const markets = await prices(placed.map(({ race }) => ({ marketId: race.marketId, eventId: race.eventId })));
    // The prices are as old as the end of their read.
    const scrapedAt = new Date().toISOString();
    for (const { target, race, competitors } of placed) {
      const rows = golfPrices(race, competitors, markets.get(race.marketId));
      // Not answered this time: its last prices stay, and age out.
      if (rows.length === 0) continue;
      saveReferenceMarkets(db, target.eventId, rows, scrapedAt);
      if (rows.some((r) => r.fair !== undefined)) fair.add(target.eventId);
    }
  }
  console.log(
    `[reference:f1] races within 7 days / on the exchange / with fair odds: ${targets.length}/${placed.length}/${fair.size} (${races.length} winner markets listed)`
  );
}
