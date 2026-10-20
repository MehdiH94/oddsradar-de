import { sportLabel, VALUE_BETS } from "../sports";
import styles from "./ResultsSummary.module.css";

// "613 Ergebnisse · Fußball", "3 Ergebnisse für „psg“ · Fußball", "12
// Ergebnisse mit Spielermärkten · Fußball", "8 Ergebnisse · Fußball ·
// Bundesliga", and in the value bets' category "4 Value Bets". Read out after
// each change of filter.
export function ResultsSummary({
  total,
  query,
  sport,
  players = false,
  competition = "",
  surebets = 0,
}: {
  total: number;
  query: string;
  sport: string;
  players?: boolean;
  // The competition the matches are narrowed to.
  competition?: string;
  // The value bets' category's surebets, beside its value bets.
  surebets?: number;
}) {
  if (sport === VALUE_BETS) {
    return (
      <p className={styles.summary} aria-live="polite">
        <strong>{total}</strong> Value Bet{total === 1 ? "" : "s"}
        {surebets > 0 && (
          <>
            {" · "}
            <strong>{surebets}</strong> Surebet{surebets === 1 ? "" : "s"}
          </>
        )}
        {query && <> für „{query}“</>}
      </p>
    );
  }
  return (
    <p className={styles.summary} aria-live="polite">
      <strong>{total}</strong> {total === 1 ? "Ergebnis" : "Ergebnisse"}
      {players && <> mit Spielermärkten</>}
      {query && <> für „{query}“</>}
      {sport && <> · {sportLabel(sport)}</>}
      {competition && <> · {competition}</>}
    </p>
  );
}
