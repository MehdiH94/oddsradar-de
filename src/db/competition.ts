import { COMPETITION_WINNER_SPORTS } from "../scraper/canonical";
import { normalizeName } from "../matcher/normalize";

// A competition's winner (Ligue 1, Roland-Garros, the NBA) is an event with one
// participant, its title, in a sport with head-to-heads (src/scraper/canonical.ts,
// COMPETITION_WINNER_SPORTS). The events table has no column for the kind of an
// event: this is how a query tells them from the matches (and from a race's or a
// golf tournament's winner, which are listed with the matches of their sport).
const SPORTS = [...COMPETITION_WINNER_SPORTS].map((sport) => `'${sport.replace(/'/g, "''")}'`).join(", ");

// A SQL condition on a row of the events table (`alias`): whether it is a
// competition's winner. The sports are constants of the code, not input.
export function isCompetitionEventSql(alias = "events"): string {
  return `(json_array_length(${alias}.participants) = 1 AND ${alias}.sport IN (${SPORTS}))`;
}

// The same test on a row read from the table.
export function isCompetitionEvent(event: { sport: string; participants: readonly string[] }): boolean {
  return event.participants.length === 1 && COMPETITION_WINNER_SPORTS.has(event.sport);
}

// A season in a competition's title: "2026/2027", "26/27", "2027", "2026-27".
const SEASON = /\b(?:(?:19|20)\d{2}(?:\s*[/-]\s*(?:\d{4}|\d{2}))?|\d{2}\s*\/\s*\d{2})\b/g;

// The competition an event belongs to, as the "Compétition" filter names it: a
// match's competition ("Ligue 1"), a competition winner's title without its
// season ("Ligue 1 2026/2027" -> "Ligue 1"). A winner's own `competition`
// column is whatever its seed bookmaker calls it, a sponsor's name or its title,
// so its title is the name to go by.
export function competitionName(event: { sport: string; competition: string; participants: readonly string[] }): string {
  const name = isCompetitionEvent(event) ? event.participants[0] : event.competition;
  const withoutSeason = name.replace(SEASON, " ").replace(/\s+/g, " ").trim();
  // A title that is only a season keeps itself rather than become empty.
  return withoutSeason || name.trim();
}

// What two names of a competition are compared by: the same whatever the case,
// the accents or the punctuation.
export const competitionKey = (name: string): string => normalizeName(name);
