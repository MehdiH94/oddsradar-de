import { Info } from "lucide-react";
import { formatEdge, formatPercent } from "../format";
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
        So liest du die Quoten
      </summary>
      <div className={styles.body}>
        <p>
          „Fair“: die Quote an {REFERENCE_SOURCE}, ohne ihre Marge. Eine Quote, die mindestens{" "}
          {formatPercent(VALUE_MIN_EDGE)} darüber liegt, ist eine Value Bet: eingerahmt, mit ihrem Vorteil („{formatEdge(0.021)}“).
          {players && (
            <>
              {" "}
              Bei Spielern ab {formatPercent(PLAYER_VALUE_MIN_EDGE)}. „≤“: Die Börse bewertet sie zu ungenau, daher dient ihre
              Lay-Quote als Obergrenze.
            </>
          )}
        </p>
        <p>
          Die Betfair-Wettbörse hat keine deutsche Lizenz (GGL): Ihre Kurse dienen hier nur als Referenz für die faire Quote.
        </p>
        <p>
          Die beste Quote jedes Ausgangs ist grün und abgehakt. Die Auszahlungsquote ist die der besten Quoten: Je näher sie
          an {formatPercent(1)} liegt, desto weniger Marge nehmen die Buchmacher; darüber ist es eine Surebet.
        </p>
      </div>
    </details>
  );
}
