// The players' value bets (scorer, first scorer, 2 goals, hat-trick): a
// bookmaker's price against what the exchange says the player is worth, or
// failing that against the other bookmaker's. Three ways, from the surest:
// - "fair": the exchange's mid price, when its back and lay are reliable
//   (src/reference/exchange.ts, "shown"): a value bet from 5% above it, a
//   players' market moving more than a 1X2;
// - "lay": its best lay alone, when they aren't. The real odds are at most
//   the lay (what the exchange charges to bet against the player), so a price
//   5% above it is a value bet whatever the back -- even a near-sure one, laid
//   off on the exchange. It catches a bookmaker's mistake on a player too few
//   bettors trade;
// - "bookmaker": neither, the exchange having no lay for the player: a price
//   30% above the other bookmaker's is a suspect price, maybe a mistake,
//   though nothing says what the player is worth. Counted, not shown
//   (SHOWN_BASES).

import { PLAYER_MARKETS } from "../reference/exchange";

export const PLAYER_VALUE_MIN_EDGE = 0.05;
export const SUSPECT_MIN_GAP = 0.3;

// The players' markets weighed this way: those the exchange has too.
export const PLAYER_MARKET_KEYS: readonly string[] = Object.values(PLAYER_MARKETS);
export type PlayerBasis = "fair" | "lay" | "bookmaker";

// What the exchange says about one player: its reliable mid price, its best
// lay.
export interface ExchangePlayer {
  fair?: number;
  lay?: number;
}

export interface PlayerSignal {
  player: string;
  bookmaker: string;
  price: number;
  basis: PlayerBasis;
  // The price compared to: the fair odds, the lay, the other bookmaker's.
  reference: number;
  // The other bookmaker, for "bookmaker".
  referenceBookmaker?: string;
  edge: number;
}

export interface SignalThresholds {
  fair: number;
  lay: number;
  bookmaker: number;
}

export const SITE_THRESHOLDS: SignalThresholds = {
  fair: PLAYER_VALUE_MIN_EDGE,
  lay: PLAYER_VALUE_MIN_EDGE,
  bookmaker: SUSPECT_MIN_GAP,
};

// The ways the site shows (the match page, the value bets' category). Not
// the suspect prices: on 2 October 2026, 4,017 of them on 58 matches at 30%,
// 662 even on the 9 matches the exchange priced players for -- the two
// bookmakers' players' prices routinely differ that much (flat prices on
// outsiders: first scorer, 2 goals, hat-trick), mistake or not. They are
// still counted (src/db/playerStats.ts), for a narrower rule.
export const SHOWN_BASES: readonly PlayerBasis[] = ["fair", "lay"];

// One market's signals as the site shows them.
export function siteSignals(
  exchange: ReadonlyMap<string, ExchangePlayer>,
  bookmakers: ReadonlyMap<string, ReadonlyMap<string, number>>
): PlayerSignal[] {
  return playerSignals(exchange, bookmakers).filter((s) => SHOWN_BASES.includes(s.basis));
}

// One market's signals: every bookmaker price at or above its threshold, by
// the surest way the exchange allows for its player. `bookmakers` is every
// bookmaker's prices by player (all of them: the comparison needs the
// others').
export function playerSignals(
  exchange: ReadonlyMap<string, ExchangePlayer>,
  bookmakers: ReadonlyMap<string, ReadonlyMap<string, number>>,
  thresholds: SignalThresholds = SITE_THRESHOLDS
): PlayerSignal[] {
  const signals: PlayerSignal[] = [];
  for (const [bookmaker, prices] of bookmakers) {
    for (const [player, price] of prices) {
      const known = exchange.get(player);
      if (known?.fair !== undefined) {
        const edge = price / known.fair - 1;
        if (edge >= thresholds.fair) signals.push({ player, bookmaker, price, basis: "fair", reference: known.fair, edge });
      } else if (known?.lay !== undefined) {
        const edge = price / known.lay - 1;
        if (edge >= thresholds.lay) signals.push({ player, bookmaker, price, basis: "lay", reference: known.lay, edge });
      } else {
        // The other bookmakers' best price for the player.
        let other: { bookmaker: string; price: number } | undefined;
        for (const [name, theirs] of bookmakers) {
          const p = name === bookmaker ? undefined : theirs.get(player);
          if (p !== undefined && (!other || p > other.price)) other = { bookmaker: name, price: p };
        }
        if (!other) continue;
        const edge = price / other.price - 1;
        if (edge >= thresholds.bookmaker) {
          signals.push({ player, bookmaker, price, basis: "bookmaker", reference: other.price, referenceBookmaker: other.bookmaker, edge });
        }
      }
    }
  }
  return signals;
}
