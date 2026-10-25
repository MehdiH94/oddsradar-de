export interface RawOdds {
  market: string;
  selection: string;
  price: number;
  // Its odds boost's price, when the bookmaker boosts it (20bet): shown
  // beside the price, never counted as the price.
  boosted?: number;
}

export interface EventWithOdds {
  id: string;
  sport: string;
  competition: string;
  startTime: string;
  participants: string[];
  byBookmaker: Record<string, { scrapedAt: string; odds: RawOdds[] }>;
  // TRJ of the match's best prices among the requested bookmakers, computed
  // by the API (src/db/payoutRate.ts), which also sorts by it. Null when an
  // outcome has no price among them.
  payoutRate?: number | null;
  // Its markets with a current price, the main one included: what its page
  // (MatchPage) shows.
  marketCount?: number;
  // The reference's current fair odds for its main market: an exchange's mid
  // prices without their margin (src/db/reference.ts).
  reference?: Reference | null;
  // Its best price against them among the requested bookmakers, value bet or
  // not (src/db/value.ts): what the "value" sort ranks by.
  value?: { edge: number; selection: string; bookmaker: string } | null;
}

export interface Reference {
  // The market they price, "1X2", "Vainqueur du match" or, for a golf
  // tournament, "Vainqueur" (its fair odds by player): a bookmaker's
  // prices of another market (a winner overtime included against a 1X2 on
  // regular time) are not weighed against them.
  market: string;
  fair: Record<string, number>;
  // Amount matched on the exchange's market, in euros.
  matched: number;
  scrapedAt: string;
  // The edge from which a price is a value bet, when it is not VALUE_MIN_EDGE:
  // a golf tournament's winner, whose players' prices are wider (5%).
  minEdge?: number;
}

// One value bet (GET /api/value-bets, src/db/repository.ts): a bookmaker's
// price above what the outcome is worth, on a match's 1X2 (from 1%) or one of
// its players' markets (from 5%, src/db/playerValue.ts).
// One bet of a surebet (src/db/surebets.ts): an outcome backed at a
// bookmaker or on the exchange, or laid on the exchange.
export interface SurebetLeg {
  selection: string;
  label: string;
  // "winamax", "betclic" or "exchange".
  source: string;
  side: "back" | "lay";
  price: number;
  // Out of 100 € in all; a lay's stake against its back's 100 €, and what it risks.
  stake: number;
  liability?: number;
  // A lay's money offered on the exchange, in euros.
  size?: number;
  // A bookmaker's back: the match's page there, when its address can be built.
  url?: string;
  // The exchange's prices of this outcome, when it prices it: the reference market.
  exchange?: ExchangeOutcome;
  // When this price was read, ISO 8601.
  readAt?: string;
}

// The exchange's back and lay of an outcome, and the money on each, in euros.
export interface ExchangeOutcome {
  back?: number;
  backSize?: number;
  lay?: number;
  laySize?: number;
}

// A market whose best prices guarantee a profit whatever happens: between
// the bookmakers ("bookmakers"), with the exchange's back prices
// ("exchange"), or backed at a bookmaker and laid on the exchange ("lay").
export interface Surebet {
  eventId: string;
  sport: string;
  competition: string;
  startTime: string;
  participants: string[];
  marketCount: number;
  market: string;
  marketLabel: string;
  kind: "bookmakers" | "exchange" | "lay";
  // Above 1: 100 € return this many times themselves.
  payoutRate: number;
  // The profit on 100 €, in euros.
  profit: number;
  // Over 110 %: most likely two different rules or lines, or an old price.
  toVerify: boolean;
  // A lay has under 20 € on the exchange: the profit holds for that much only.
  thin: boolean;
  legs: SurebetLeg[];
  // A leg's price far out of line with the other sources' (their median,
  // `others`): a swapped team, an old price, or a real one to check before
  // betting. Shown marked (src/db/surebets.ts).
  suspect?: { leg: SurebetLeg; others: number };
}

export interface ValueBet {
  eventId: string;
  sport: string;
  competition: string;
  startTime: string;
  participants: string[];
  marketCount: number;
  // "1X2", "anytime_scorer"..., and its name ("Buteur").
  market: string;
  marketLabel: string;
  // "1", "X", "2" or a player, and how it reads ("PSG", "Nul", the player).
  selection: string;
  label: string;
  bookmaker: string;
  price: number;
  // What `fair` is: "fair", the exchange's fair odds; "lay", its lay, a
  // ceiling on them when it prices the player too loosely; "bookmaker", the
  // other bookmaker's price (`referenceBookmaker`) when the exchange has
  // nothing: a suspect price, 30% above it at least (the API counts them but
  // doesn't send them for now, src/db/playerValue.ts SHOWN_BASES).
  basis: "fair" | "lay" | "bookmaker";
  fair: number;
  referenceBookmaker?: string;
  // 0.021 for +2.1%: price / fair - 1.
  edge: number;
  matched: number;
  // The match's page at the bookmaker, when the API can build it
  // (src/db/bookmakerLinks.ts).
  url?: string;
  // The exchange's prices of this outcome, when it prices it: the reference market.
  exchange?: ExchangeOutcome;
}

// One match's page (GET /api/events/:id, src/db/eventDetail.ts).
export interface OutcomeDetail {
  key: string;
  label: string;
  // By bookmaker.
  prices: Record<string, number>;
  // At its best price, ties included; none when fewer than two price it.
  best: string[];
  // The 1X2's and the players' outcomes, when the reference prices them: their
  // fair odds, and each bookmaker's value bet on it (its edge, 0.021 for
  // +2.1%). A player's `fair` can be a ceiling (`fairIsCeiling`): the
  // exchange's lay, when it prices them too loosely for fair odds.
  fair?: number;
  fairIsCeiling?: true;
  edges?: Record<string, number>;
  // A player the exchange doesn't price: each bookmaker's price 30% or more
  // above the other's, by how much (not sent for now, like `basis`
  // "bookmaker").
  suspects?: Record<string, number>;  // A bookmaker's boosted price (20bet's odds boost), shown beside its price.
  boosted?: Record<string, number>;
}

export interface MarketLine {
  // 2.5 for "over/under 2.5 goals".
  line: number | null;
  // The best prices' TRJ, when the market's outcomes cover every case.
  payoutRate: number | null;
  outcomes: OutcomeDetail[];
}

export interface MarketDetail {
  key: string;
  label: string;
  // "lines": one over/under market's lines, as a table; "list": its outcomes.
  kind: "lines" | "list";
  // Priced by at least two of the requested bookmakers.
  compared: boolean;
  lines: MarketLine[];
}

export interface SectionDetail {
  key: string;
  label: string;
  markets: MarketDetail[];
}

export interface EventDetail {
  id: string;
  sport: string;
  competition: string;
  // The "Compétition" filter's name for it (see MatchPage's competition link).
  competitionFilter: string;
  startTime: string;
  participants: string[];
  sections: SectionDetail[];
  comparedCount: number;
  surebetCount: number;
  // By bookmaker: the match's page there, when its address can be built.
  // Optional: an API from before it sends none.
  links?: Record<string, string>;
}
