import type { EventWithOdds } from "./types";

// Every bookmaker offering the highest price for this outcome: when several
// offer the same one, each is as good a place to bet.
export function getBestBookmakers(
  event: EventWithOdds,
  market: string,
  selection: string,
  bookmakers?: readonly string[]
): string[] {
  let best: { bookmakers: string[]; price: number } | null = null;

  for (const [bookmaker, { odds }] of Object.entries(event.byBookmaker)) {
    if (bookmakers && !bookmakers.includes(bookmaker)) continue;
    const match = odds.find((o) => o.market === market && o.selection === selection);
    if (!match) continue;
    if (!best || match.price > best.price) {
      best = { bookmakers: [bookmaker], price: match.price };
    } else if (match.price === best.price) {
      best.bookmakers.push(bookmaker);
    }
  }

  return best?.bookmakers ?? [];
}

// The bookmakers each outcome is shown best at: its highest price, always,
// even when one site has every outcome's (the owner, 26/10/2026: "la meilleure
// cote n'est pas sélectionnée"). The TRJ beside them takes two sites at least
// (src/db/payoutRate.ts, bestAcrossSites): every outcome of a match can't be
// bet at one bookmaker, but each outcome's best price is still that one's. With
// a single site pricing the match, none: no price is better than another.
export function getBestPrices(
  event: EventWithOdds,
  market: string,
  selections: readonly string[],
  bookmakers?: readonly string[]
): Record<string, string[]> {
  const best = Object.fromEntries(selections.map((selection) => [selection, getBestBookmakers(event, market, selection, bookmakers)]));
  const sites = new Set(
    Object.entries(event.byBookmaker)
      .filter(([bookmaker, { odds }]) => (!bookmakers || bookmakers.includes(bookmaker)) && odds.some((o) => o.market === market))
      .map(([bookmaker]) => bookmaker)
  );
  return sites.size < 2 ? {} : best;
}
