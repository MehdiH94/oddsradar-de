import { DatabaseSync } from "node:sqlite";
import { getDistinctSports, getLatestEvents, ListingOptions } from "./repository";

// What the home page shows to anyone, signed in or not: how many matches and
// which sports are listed. Totals only -- no price, no match, no value bet,
// which are for accounts.
export function getPublicHomeStats(db: DatabaseSync, listing: ListingOptions = {}): { matches: number; sports: string[] } {
  return {
    matches: getLatestEvents(db, { pageSize: 1, ...listing }).total,
    sports: getDistinctSports(db, listing),
  };
}
