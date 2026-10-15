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
