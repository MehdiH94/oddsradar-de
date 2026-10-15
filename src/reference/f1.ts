import { GolfTournament } from "./golf";

// The reference for a Formula 1 event's winner (a race, a sprint, a qualifying
// session, a title): the exchange lists each Grand Prix as an event with a
// winner market of one runner per driver, priced like a golf tournament's
// (./golf.ts), whose placing and fair odds (placeGolfTournament, golfPrices) it
// shares. Only the reading differs: the exchange's event type of motor racing
// and its market types are not read from a fixture yet, so a market is told by
// its name and type, and the event by its title.

// Our sport key (src/scraper/canonical.ts).
export const F1_SPORT = "formule 1";

// What an F1 event's winner is the winner of. A sprint, a qualifying session
// and the Sunday's race share every driver within a weekend, so the matcher
// alone can't tell them: the exchange calls the sprint "Singapore Grand Prix
// Sprint Race", the Sunday's race by the Grand Prix's name, and the
// qualifying "Overall Qualifying Winner"; the bookmakers "Sprint", "Course"
// and "Qualification". A bookmaker's event is only ever paired with an
// exchange's of its kind.
export type F1Kind = "race" | "sprint" | "qualifying" | "sprint qualifying" | "season";

export function f1Kind(title: string): F1Kind {
  if (/qualif|shootout|\bpole\b/i.test(title)) return /sprint|shootout/i.test(title) ? "sprint qualifying" : "qualifying";
  if (/sprint/i.test(title)) return "sprint";
  if (/champion|\btitre\b|\btitle\b|saison|season|drivers/i.test(title)) return "season";
  return "race";
}

// How far apart a bookmaker's and the exchange's date of the same event can be.
// The bookmakers date a race or a sprint up to 28 hours apart from one
// another (src/matcher/match.ts); the exchange dates a qualifying session by
// its Grand Prix's race, up to 3 days after it; a week's other event is farther.
export const F1_TOLERANCE_MS: Readonly<Record<F1Kind, number>> = {
  race: 36 * 60 * 60 * 1000,
  sprint: 36 * 60 * 60 * 1000,
  qualifying: 4 * 24 * 60 * 60 * 1000,
  "sprint qualifying": 4 * 24 * 60 * 60 * 1000,
  season: Infinity,
};

// The races and titles of the sport, by the exchange's title of the event.
const F1_TITLE = /formula (1|one)|\bf1\b|grand prix|drivers.? (championship|title)/i;
// A market of an event's winner, not of its podium, pole, fastest lap or teams.
const WINNER_TYPE = /WINNER/;
const NOT_WINNER = /PODIUM|TOP|POLE|FASTEST|CONSTRUCTOR|TEAM|WITHOUT|POINTS|FINISH|MARGIN|LAP/;
// A qualifying session's winner: "Overall Qualifying Winner" (the pole).
const QUALIFYING_WINNER = /qualifying winner|pole position/i;

export const isF1WinnerMarket = (marketType: unknown): boolean =>
  typeof marketType === "string" && WINNER_TYPE.test(marketType) && !NOT_WINNER.test(marketType);

// An exchange's winner market of an F1 event, with what it is the winner of.
export interface F1Entry extends GolfTournament {
  kind: F1Kind;
}

interface ExchangeMarket {
  marketId?: unknown;
  marketName?: unknown;
  description?: { marketType?: unknown };
  runners?: unknown;
}

// The winner markets among an event's markets (a search's topMarkets, an
// event's details), each as an entry of its kind.
export function f1Entries(event: { id: string; name: string; startTime: string }, markets: unknown): F1Entry[] {
  if (!Array.isArray(markets)) return [];
  const entries: F1Entry[] = [];
  for (const m of markets as ExchangeMarket[]) {
    const name = typeof m?.marketName === "string" ? m.marketName : "";
    const qualifying = QUALIFYING_WINNER.test(name);
    if (!qualifying && !isF1WinnerMarket(m?.description?.marketType)) continue;
    if (typeof m.marketId !== "string" || !Array.isArray(m.runners)) continue;
    const runners: Record<number, string> = {};
    for (const r of m.runners as { selectionId?: unknown; runnerName?: unknown }[]) {
      if (typeof r.selectionId === "number" && typeof r.runnerName === "string") runners[r.selectionId] = r.runnerName.trim();
    }
    if (Object.keys(runners).length < 2) continue;
    // "Sprint Race Winner" in the Grand Prix's event, or "Winner" in an event
    // titled "... Sprint Race" or "... Qualifying": the market's name first.
    const kind = f1Kind(`${name} | ${event.name}`);
    entries.push({ eventId: event.id, name: event.name, startTime: event.startTime, marketId: m.marketId, runners, kind });
  }
  return entries;
}

// An F1 event of a search ("Formula 1", "Grand Prix"; ./exchange.ts,
// searchEvents), not one under way.
export interface F1Event {
  id: string;
  name: string;
  startTime: string;
  topMarkets: unknown;
}

export function parseF1Events(body: unknown): F1Event[] {
  const content = (body as { content?: unknown })?.content;
  if (!Array.isArray(content)) return [];
  const events: F1Event[] = [];
  for (const event of content) {
    if (event?.inPlay || typeof event?.id !== "string" || typeof event.name !== "string") continue;
    if (!F1_TITLE.test(event.name) || !Number.isFinite(event.openDate)) continue;
    events.push({ id: event.id, name: event.name.trim(), startTime: new Date(event.openDate).toISOString(), topMarkets: event.topMarkets });
  }
  return events;
}

// The winner markets a search lists, by event.
export function parseF1Search(body: unknown): F1Entry[] {
  const entries = new Map<string, F1Entry>();
  for (const event of parseF1Events(body)) {
    for (const entry of f1Entries(event, event.topMarkets)) entries.set(entry.marketId, entry);
  }
  return [...entries.values()];
}
