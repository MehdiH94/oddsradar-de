import { Info } from "lucide-react";
import { formatPercent } from "../format";
import { PLAYER_VALUE_MIN_EDGE, REFERENCE_SOURCE, VALUE_MIN_EDGE } from "../value";
import styles from "./ReferenceNote.module.css";

// What "Fair", the payout and the value bets' marks mean, above a list that shows
// them; and how the players' differ, when it lists some (`players`). Folded by
// default, a tap away: on a phone, the odds come first. A real element to tap,
// not a tooltip, which a finger can't bring up.
export function ReferenceNote({ players = false }: { players?: boolean }) {
  return (
    <details className={styles.note}>
      <summary className={styles.summary}>
        <Info size={16} aria-hidden="true" />
        How to read the odds
      </summary>
      <div className={styles.body}>
        <p>
          “Fair”: the price at {REFERENCE_SOURCE}, without its margin. A price at least {formatPercent(VALUE_MIN_EDGE)} above it
          is a value bet: framed, with its edge shown (“+2.1%”).
          {players && (
            <>
              {" "}
              On players, from {formatPercent(PLAYER_VALUE_MIN_EDGE)}. “≤”: the exchange prices them too loosely, so its lay
              price serves as a ceiling.
            </>
          )}
        </p>
        <p>
          The best price of each outcome is green and ticked. The payout is that of the best prices: the closer it is to
          100%, the less margin the bookmakers take; above it, it is a surebet.
        </p>
      </div>
    </details>
  );
}
