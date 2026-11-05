import { BOOKMAKER_BRANDING } from "./bookmakers";
import { formatEdge, formatPrice } from "./format";
import { lockedLabel, profitLabel, type TakenSurebets } from "./takenSurebets";
import type { TakenValueBets } from "./takenValueBets";
import styles from "./TakenOnMatch.module.css";

// At the top of a match's page, what the account already took on it: each
// taken surebet (its legs and prices as taken) and value bet (its outcome,
// bookmaker, price and edge), from the dashboard's taken lists, so that a bet
// already placed is not placed twice. Nothing when none was taken.
export function TakenOnMatch({
  eventId,
  surebets,
  valueBets,
}: {
  eventId: string;
  surebets?: TakenSurebets;
  valueBets?: TakenValueBets;
}) {
  const own = [...(surebets ?? [])].filter(([, s]) => s.eventId === eventId);
  const bets = [...(valueBets ?? [])].filter(([, b]) => b.eventId === eventId);
  if (own.length === 0 && bets.length === 0) return null;
  return (
    <section className={styles.box} aria-labelledby="taken-on-match">
      <h3 id="taken-on-match" className={styles.heading}>
        Schon genommen
      </h3>
      <ul className={styles.list}>
        {own.map(([key, surebet]) => {
          const locked = lockedLabel(surebet.legs, surebet.stakes);
          return (
            <li key={key}>
              <span className={styles.kind}>Surebet</span> {surebet.label}
              {surebet.payoutRate !== null && <span className={styles.note}> · {profitLabel(surebet.payoutRate)}</span>}
              {locked && <span className={styles.note}> · {locked}</span>}
            </li>
          );
        })}
        {bets.map(([key, bet]) => (
          <li key={key}>
            <span className={styles.kind}>Value Bet</span> {bet.label} @ {BOOKMAKER_BRANDING[bet.bookmaker]?.name ?? bet.bookmaker}{" "}
            {formatPrice(bet.price)}
            <span className={styles.note}> · Vorteil {formatEdge(bet.edge)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
