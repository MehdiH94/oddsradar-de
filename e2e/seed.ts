import { DatabaseSync } from "node:sqlite";
import { saveMarketOdds, upsertCanonicalEvents } from "../src/db/repository";
import { saveReferenceOdds } from "../src/db/reference";
import { CanonicalEvent, RawOdds } from "../src/types";
import { COMPETITION_WINNER, EXCHANGE_MATCH, SECOND_VALUE_MATCH, SUREBET_MATCH, TENNIS_MATCH, VALUE_MATCH } from "./fixtures";

const hoursFromNow = (hours: number) => new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();

const oneXTwo = (prices: Record<"1" | "X" | "2", number>): RawOdds[] =>
  (["1", "X", "2"] as const).map((selection) => ({ market: "1X2", selection, price: prices[selection] }));

const winner = (prices: Record<"1" | "2", number>): RawOdds[] =>
  (["1", "2"] as const).map((selection) => ({ market: "Vainqueur du match", selection, price: prices[selection] }));

const outright = (prices: Record<string, number>): RawOdds[] =>
  Object.entries(prices).map(([selection, price]) => ({ market: "Vainqueur", selection, price }));

// Five upcoming matches, and the winner of a league, priced just now (a price the worker has not refreshed
// for a few cycles counts as withdrawn): two value bets (the first the bigger),
// a surebet, a tennis match for the sport filter, and a match with money to lay
// on the exchange (neither a value bet nor a surebet) for the freebets page.
export function seedOdds(db: DatabaseSync): void {
  const events: CanonicalEvent[] = [
    {
      id: VALUE_MATCH.id,
      sport: "football",
      competition: VALUE_MATCH.competition,
      startTime: hoursFromNow(3),
      participants: VALUE_MATCH.participants,
      byBookmaker: {
        leovegas: oneXTwo(VALUE_MATCH.leovegas),
        betway: oneXTwo(VALUE_MATCH.betway),
      },
    },
    {
      id: SUREBET_MATCH.id,
      sport: "football",
      competition: SUREBET_MATCH.competition,
      startTime: hoursFromNow(5),
      participants: SUREBET_MATCH.participants,
      byBookmaker: { leovegas: oneXTwo(SUREBET_MATCH.leovegas), betway: oneXTwo(SUREBET_MATCH.betway) },
    },
    {
      id: SECOND_VALUE_MATCH.id,
      sport: "football",
      competition: SECOND_VALUE_MATCH.competition,
      startTime: hoursFromNow(6),
      participants: SECOND_VALUE_MATCH.participants,
      byBookmaker: { leovegas: oneXTwo(SECOND_VALUE_MATCH.leovegas), betway: oneXTwo(SECOND_VALUE_MATCH.betway) },
    },
    {
      id: TENNIS_MATCH.id,
      sport: "tennis",
      competition: TENNIS_MATCH.competition,
      startTime: hoursFromNow(4),
      participants: TENNIS_MATCH.participants,
      byBookmaker: { leovegas: winner(TENNIS_MATCH.leovegas), betway: winner(TENNIS_MATCH.betway) },
    },
    {
      id: EXCHANGE_MATCH.id,
      sport: "football",
      competition: EXCHANGE_MATCH.competition,
      startTime: hoursFromNow(8),
      participants: EXCHANGE_MATCH.participants,
      byBookmaker: { leovegas: oneXTwo(EXCHANGE_MATCH.leovegas), betway: oneXTwo(EXCHANGE_MATCH.betway) },
    },
    {
      // A competition's winner: one participant, its title, a season away.
      id: COMPETITION_WINNER.id,
      sport: "football",
      competition: COMPETITION_WINNER.competition,
      startTime: hoursFromNow(24 * 200),
      participants: [COMPETITION_WINNER.title],
      byBookmaker: { leovegas: outright(COMPETITION_WINNER.leovegas), betway: outright(COMPETITION_WINNER.betway) },
    },
  ];
  upsertCanonicalEvents(db, events);

  const now = new Date().toISOString();
  // The exchange's fair odds, the reference a value bet is measured against.
  for (const { id, fair } of [VALUE_MATCH, SECOND_VALUE_MATCH]) {
    saveReferenceOdds(db, id, { fair, back: fair, lay: fair, matched: 5000 }, now);
  }
  // No back price on the exchange (without money to back there is no exchange
  // leg of a surebet), lay prices above the bookmakers' best with money on each.
  saveReferenceOdds(db, EXCHANGE_MATCH.id, { fair: EXCHANGE_MATCH.fair, back: EXCHANGE_MATCH.fair, lay: EXCHANGE_MATCH.lay, laySize: EXCHANGE_MATCH.laySize, matched: 5000 }, now);
  // A market beyond the main one, so that the match has a page of its own.
  for (const [bookmakerId, { over, under }] of Object.entries(VALUE_MATCH.totals)) {
    saveMarketOdds(
      db,
      [
        {
          eventId: VALUE_MATCH.id,
          bookmakerId,
          odds: [
            { market: "total_goals|2.5", selection: "over", price: over },
            { market: "total_goals|2.5", selection: "under", price: under },
          ],
        },
      ],
      now
    );
  }
}
