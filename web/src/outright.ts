import type { EventWithOdds } from "./types";

// The main bet of a sport without head-to-heads (a race, a golf tournament):
// who wins among N competitors, one selection each. The event's only
// participant is its title. Same key as the backend's (src/scraper/canonical.ts).
export const MARKET_OUTRIGHT = "Vainqueur";

export function isOutright(event: EventWithOdds): boolean {
  return Object.values(event.byBookmaker).some(({ odds }) => odds.some((o) => o.market === MARKET_OUTRIGHT));
}

export interface OutrightRow {
  competitor: string;
  prices: Record<string, number | undefined>;
  // The highest price among the given bookmakers.
  best: number;
}

// One row per competitor priced by at least one of the given bookmakers,
// favourite first: the lowest best price. The matcher already named each
// competitor after the first bookmaker's spelling, so one name is one row.
export function outrightRows(event: EventWithOdds, bookmakers: readonly string[]): OutrightRow[] {
  const rows = new Map<string, OutrightRow>();
  for (const bookmaker of bookmakers) {
    for (const o of event.byBookmaker[bookmaker]?.odds ?? []) {
      if (o.market !== MARKET_OUTRIGHT) continue;
      const row = rows.get(o.selection) ?? { competitor: o.selection, prices: {}, best: 0 };
      row.prices[bookmaker] = o.price;
      row.best = Math.max(row.best, o.price);
      rows.set(o.selection, row);
    }
  }
  return [...rows.values()].sort((a, b) => a.best - b.best || a.competitor.localeCompare(b.competitor));
}
