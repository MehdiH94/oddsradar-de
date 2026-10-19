export interface RawOdds {
  market: string;
  selection: string;
  price: number;
  // What the bookmaker pays on this outcome with its odds boost, when it
  // boosts it (20bet, src/scraper/twentybet.ts): shown beside the price,
  // never weighed in the surebets, the value bets or the alerts, which read
  // `price` only.
  boosted?: number;
}

export interface RawEvent {
  sport: string;
  competition: string;
  startTime: string; // ISO 8601
  participants: string[];
  odds: RawOdds[];
  // The bookmaker's own id for the event, which its match page is asked by
  // (src/scraper/marketsRun.ts).
  sourceId?: string;
}

// An event as one bookmaker lists it: its id there and its own spelling and
// order of the participants.
export interface EventSource {
  sourceId: string;
  participants: string[];
}

export interface CanonicalEvent {
  id: string;
  sport: string;
  competition: string;
  startTime: string;
  participants: string[];
  byBookmaker: Record<string, RawOdds[]>;
  // By bookmaker, for those that gave their id for the event.
  sources?: Record<string, EventSource>;
}

export interface EventWithOdds {
  id: string;
  sport: string;
  competition: string;
  startTime: string;
  participants: string[];
  byBookmaker: Record<string, { scrapedAt: string; odds: RawOdds[] }>;
}
