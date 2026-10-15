import { Info } from "lucide-react";
import { formatPercent } from "../format";
import { PLAYER_VALUE_MIN_EDGE, REFERENCE_SOURCE, VALUE_MIN_EDGE } from "../value";
import styles from "./ReferenceNote.module.css";

// What "Juste", the TRJ and the value bets' marks mean, above a list that shows
// them; and how the players' differ, when it lists some (`players`). Folded by
// default, a tap away: on a phone, the odds come first. A real element to tap,
// not a tooltip, which a finger can't bring up.
export function ReferenceNote({ players = false }: { players?: boolean }) {
  return (
    <details className={styles.note}>
      <summary className={styles.summary}>
        <Info size={16} aria-hidden="true" />
        Comment lire les cotes
      </summary>
      <div className={styles.body}>
        <p>
          « Juste » : la cote de {REFERENCE_SOURCE}, sans sa marge. Une cote au moins {formatPercent(VALUE_MIN_EDGE)} au-dessus
          est un value bet : encadrée, son écart affiché (« +2,1 % »).
          {players && (
            <>
              {" "}
              Sur les joueurs, à partir de {formatPercent(PLAYER_VALUE_MIN_EDGE)}. « ≤ » : l'exchange les cote de trop loin,
              sa cote de lay sert de plafond.
            </>
          )}
        </p>
        <p>
          La meilleure cote de chaque issue est en vert, cochée. Le TRJ (taux de retour au joueur) est celui des meilleures
          cotes : plus il est proche de 100 %, moins les bookmakers prennent de marge ; au-dessus, c'est un surebet.
        </p>
      </div>
    </details>
  );
}
