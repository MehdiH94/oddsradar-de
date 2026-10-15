import { sportLabel, VALUE_BETS } from "../sports";
import styles from "./ResultsSummary.module.css";

// "613 results · Football", "3 results for “psg” · Football", "12 results
// with player markets · Football", "8 results · Football · Bundesliga", and in
// the value bets' category "4 value bets". Read out after each
// change of filter.
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
        <strong>{total}</strong> value bet{total === 1 ? "" : "s"}
        {surebets > 0 && (
          <>
            {" · "}
            <strong>{surebets}</strong> surebet{surebets === 1 ? "" : "s"}
          </>
        )}
        {query && <> for “{query}”</>}
      </p>
    );
  }
  return (
    <p className={styles.summary} aria-live="polite">
      <strong>{total}</strong> result{total === 1 ? "" : "s"}
      {players && <> with player markets</>}
      {query && <> for “{query}”</>}
      {sport && <> · {sportLabel(sport)}</>}
      {competition && <> · {competition}</>}
    </p>
  );
}
