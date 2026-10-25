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

// The bookmakers each outcome is shown best at, so that they make two sites at
// least (the owner, 25/10/2026: every outcome of a match can't be bet at one
// bookmaker): when every best price is at the same one, the outcome where
// another site costs the least goes to that site; with a single site pricing
// the match, none. The API's TRJ takes the same ones (src/db/payoutRate.ts,
// bestAcrossSites).
export function getBestAcrossSites(
  event: EventWithOdds,
  market: string,
  selections: readonly string[],
  bookmakers?: readonly string[]
): Record<string, string[]> {
  const priced = (selection: string) =>
    Object.entries(event.byBookmaker).flatMap(([bookmaker, { odds }]) => {
      if (bookmakers && !bookmakers.includes(bookmaker)) return [];
      const price = odds.find((o) => o.market === market && o.selection === selection)?.price;
      return price !== undefined && price > 0 ? [{ bookmaker, price }] : [];
    });
  const outcomes = selections.map((selection) => ({ selection, prices: priced(selection) }));
  const best: Record<string, { bookmakers: string[]; price: number }> = {};
  for (const { selection, prices } of outcomes) {
    if (prices.length === 0) continue;
    const top = Math.max(...prices.map((p) => p.price));
    best[selection] = { bookmakers: prices.filter((p) => p.price === top).map((p) => p.bookmaker), price: top };
  }
  const sites = new Set(Object.values(best).flatMap((b) => b.bookmakers));
  const result = (): Record<string, string[]> => Object.fromEntries(Object.entries(best).map(([s, b]) => [s, b.bookmakers]));
  if (sites.size !== 1 || Object.keys(best).length < 2) return result();
  const [only] = sites;
  let swap: { selection: string; bookmakers: string[]; price: number; cost: number } | undefined;
  for (const { selection, prices } of outcomes) {
    const others = prices.filter((p) => p.bookmaker !== only);
    if (others.length === 0 || !best[selection]) continue;
    const top = Math.max(...others.map((p) => p.price));
    const cost = 1 / top - 1 / best[selection].price;
    if (!swap || cost < swap.cost) swap = { selection, bookmakers: others.filter((p) => p.price === top).map((p) => p.bookmaker), price: top, cost };
  }
  if (!swap) return {};
  best[swap.selection] = { bookmakers: swap.bookmakers, price: swap.price };
  return result();
}
