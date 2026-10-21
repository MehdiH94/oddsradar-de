import { RawEvent } from "../types";
import { BookmakerScraper } from "./run";
import { EntainSite, fetchEntain, parseEntainFixtures, EntainReply } from "./entain";

// Sportingbet.de's prices (Entain's, as ODDSET's and bwin's), read from the
// API its site reads them from (www.sportingbet.de/cds-api, 21/10/2026,
// tests/scraper/fixtures/sportingbet-*.json), as every Entain site is
// (./entain.ts). No challenge stands in front of the API; the site's pages
// send a visitor outside Germany to help.sportingbet.de/closed, the API does
// not. The same matches as ODDSET, some prices of its own (the football's,
// a tennis match's), the others ODDSET's.

// The German betting tax as Sportingbet.de's terms take it: 5% of the gross
// return (stake × price) of a winning bet ("Gewinnabzug zur Deckung der
// Sportwettensteuer", A2.2, help.sportingbet.de, 21/10/2026). The prices the
// API gives, the ones the site shows, are before it.
export const SPORTINGBET_TAX = 0.05;

export const SPORTINGBET: EntainSite = {
  id: "sportingbet",
  origin: "https://www.sportingbet.de",
  // The site's msApp.publicAccessId (./entain.ts says where it is read).
  accessId: "ZjM5MGQxNTItZTYzZi00MGVjLTg1NWQtMmFjZTgxZGVjMjJl",
  tax: SPORTINGBET_TAX,
};

export const parseSportingbetFixtures = (reply: EntainReply, sportId: string): RawEvent[] => parseEntainFixtures(reply, sportId, SPORTINGBET);

export const fetchSportingbet = (opts: { delayMs?: number } = {}): Promise<RawEvent[]> => fetchEntain(SPORTINGBET, opts);

export const sportingbetScraper: BookmakerScraper = { id: "sportingbet", fetch: fetchSportingbet };
