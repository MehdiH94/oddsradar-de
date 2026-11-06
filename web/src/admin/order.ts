import { BOOKMAKER_BRANDING } from "../bookmakers";
import type { AdminBookmaker, AdminPromoReader } from "./adminApi";

// What needs looking at first: a bookmaker down, then failing or giving no
// match, then the OK ones; a promo reader failing, then empty, then OK. Each
// group by the name shown.
const nameOf = (id: string) => BOOKMAKER_BRANDING[id]?.name ?? id;
const HEALTH_ORDER: Record<AdminBookmaker["health"], number> = { down: 0, failing: 1, empty: 1, paused: 2, ok: 2 };
const readerRank = (r: AdminPromoReader) => (r.failing ? 0 : r.count === 0 ? 1 : 2);

export function problemsFirst(bookmakers: readonly AdminBookmaker[]): AdminBookmaker[] {
  return [...bookmakers].sort((a, b) => HEALTH_ORDER[a.health] - HEALTH_ORDER[b.health] || nameOf(a.bookmaker).localeCompare(nameOf(b.bookmaker)));
}

export function readerProblemsFirst(readers: readonly AdminPromoReader[]): AdminPromoReader[] {
  return [...readers].sort((a, b) => readerRank(a) - readerRank(b) || nameOf(a.bookmaker).localeCompare(nameOf(b.bookmaker)));
}
