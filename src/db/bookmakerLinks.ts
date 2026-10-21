import { DatabaseSync } from "node:sqlite";
import { EventSource } from "../types";
import { inChunks } from "./playerReference";

// Where a bookmaker shows a match, so that a user checks its price there
// before betting: built from the bookmaker's own id for the match (its
// sourceId, event_sources). Only the addresses opened on the bookmaker's site
// and seen to show that very match (21/10/2026, a real id of each, in
// Chromium) are built; a bookmaker missing here gets no link rather than a
// broken one:
// - 20bet: its site refuses visitors outside its countries, the address of a
//   match could not be checked;
// - Admiralbet: a match's address is its sport's, league's and teams' German
//   names ("/fussball/champions-league/ligaphase/bayern-muenchen-vs-arsenal"),
//   which its snapshot doesn't give;
// - Tipico and Winamax.de: their id is The Odds API's, not theirs.
//
// LeoVegas.de (Kambi): its sportsbook opens the event by its Kambi id.
// Merkur Bets: www.merkurbets.de refuses visitors outside Germany; its
//   sportsbook's own host (the one its odds service serves) opens the game by
//   the id its odds service gives.
// bet-at-home.de: the address names the sport, region, competition and teams
//   before the id, but only the id is read (any words open the match).
// ODDSET: "<slug>-<id>", the id being the API's ("2:7867098" or "20014863");
//   any slug is sent on to the match's own.
// Betway.de: by the id of its API.
const BUILDERS: Readonly<Record<string, (source: EventSource) => string | undefined>> = {
  leovegas: ({ sourceId }) => (/^\d+$/.test(sourceId) ? `https://www.leovegas.de/de-de/sportwetten#event/${sourceId}` : undefined),
  merkurbets: ({ sourceId }) =>
    /^\d+$/.test(sourceId) ? `https://v3-msw-mb-de.cashpoint.solutions/de/sports/game-details/${sourceId}` : undefined,
  betathome: ({ sourceId }) =>
    /^\d+$/.test(sourceId) ? `https://www.bet-at-home.de/de/sports/i/event/0/x/x/x/x/${sourceId}` : undefined,
  oddset: ({ sourceId, participants }) =>
    /^(\d+:)?\d+$/.test(sourceId) ? `https://www.oddset.de/de/sports/events/${slugOf(participants)}-${sourceId}` : undefined,
  betway: ({ sourceId }) => (/^\d+$/.test(sourceId) ? `https://betway.de/de/de/sports/event/${sourceId}` : undefined),
};

// "FC Bayern München", "Arsenal" -> "fc-bayern-munchen-arsenal".
function slugOf(participants: readonly string[]): string {
  const slug = participants
    .join(" ")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "event";
}

// The address of the match's page at the bookmaker, when it can be built.
export function bookmakerEventUrl(bookmaker: string, source: EventSource): string | undefined {
  return BUILDERS[bookmaker]?.(source);
}

// The bookmakers' addresses of the given matches, by match and bookmaker.
export function loadBookmakerLinks(db: DatabaseSync, eventIds: readonly string[]): Map<string, Record<string, string>> {
  const links = new Map<string, Record<string, string>>();
  if (eventIds.length === 0) return links;
  const rows = inChunks(
    db,
    [...new Set(eventIds)],
    "SELECT event_id AS eventId, bookmaker_id AS bookmaker, source_id AS sourceId, participants FROM event_sources WHERE event_id IN",
    {}
  ) as { eventId: string; bookmaker: string; sourceId: string; participants: string }[];
  for (const row of rows) {
    const url = bookmakerEventUrl(row.bookmaker, { sourceId: row.sourceId, participants: JSON.parse(row.participants) });
    if (!url) continue;
    if (!links.has(row.eventId)) links.set(row.eventId, {});
    links.get(row.eventId)![row.bookmaker] = url;
  }
  return links;
}
