import { formatEdge, formatPrice } from "../format";
import { PINNACLE_SOURCE, REFERENCE_SOURCE } from "../value";
import styles from "./FairOdds.module.css";

// Under an outcome's prices: its fair odds (Pinnacle's price without its
// margin, `pinnacle`, or else the reference exchange's), and its best value
// bet's edge when a price is one. A player's can be a ceiling (`ceiling`):
// the exchange's lay, when it prices them too loosely for fair odds.
export function FairOdds({
  fair,
  ceiling = false,
  edge,
  pinnacle = false,
}: {
  fair: number;
  ceiling?: boolean;
  edge?: number;
  pinnacle?: boolean;
}) {
  const title = ceiling
    ? `Faire Quote höchstens: die Lay-Quote an ${REFERENCE_SOURCE}, die diesen Spieler zu ungenau bewertet, um eine faire Quote zu ergeben`
    : pinnacle
      ? `Faire Quote: die Quote von ${PINNACLE_SOURCE}, ohne ihre Marge (anteilig zur Quote verteilt)`
      : `Faire Quote: die Quote an ${REFERENCE_SOURCE}, ohne ihre Marge`;
  return (
    <span className={styles.fair} title={title}>
      <span aria-hidden="true">{ceiling ? "Fair ≤ " : "Fair "}</span>
      <span className="visually-hidden">{ceiling ? "Faire Quote: höchstens " : "Faire Quote: "}</span>
      <span className={styles.price}>{formatPrice(fair)}</span>
      {edge !== undefined && <Edge edge={edge} label="bester Value" />}
    </span>
  );
}

// Under the prices of a player the exchange doesn't price: the biggest gap of
// a bookmaker's price over the other's, when 30% or more.
export function SuspectOdds({ gap }: { gap: number }) {
  return (
    <span
      className={styles.fair}
      title={`Verdächtige Quote: An ${REFERENCE_SOURCE} wird dieser Spieler nicht gehandelt, und diese Quote liegt weit über der des anderen Buchmachers`}
    >
      Verdächtige Quote
      <Edge edge={gap} label="über dem anderen Buchmacher" after />
    </span>
  );
}

function Edge({ edge, label, after = false }: { edge: number; label: string; after?: boolean }) {
  return (
    <strong className={styles.edge}>
      <span aria-hidden="true" className={styles.dot}>
        {" · "}
      </span>
      {!after && <span className="visually-hidden">, {label}: </span>}
      {after && <span className="visually-hidden">: </span>}
      {formatEdge(edge)}
      {after && <span className="visually-hidden"> {label}</span>}
    </strong>
  );
}
