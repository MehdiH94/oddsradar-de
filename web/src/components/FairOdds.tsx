import { formatEdge, formatPrice } from "../format";
import { REFERENCE_SOURCE } from "../value";
import styles from "./FairOdds.module.css";

// Under an outcome's prices: its fair odds (the reference exchange's price
// without its margin), and its best value bet's edge when a price is one. A
// player's can be a ceiling (`ceiling`): the exchange's lay, when it prices
// them too loosely for fair odds.
export function FairOdds({ fair, ceiling = false, edge }: { fair: number; ceiling?: boolean; edge?: number }) {
  const title = ceiling
    ? `Cote juste au plus : la cote de lay de ${REFERENCE_SOURCE}, qui cote ce joueur de trop loin pour en donner une`
    : `Cote juste : la cote de ${REFERENCE_SOURCE}, sans sa marge`;
  return (
    <span className={styles.fair} title={title}>
      <span aria-hidden="true">{ceiling ? "Juste ≤ " : "Juste "}</span>
      <span className="visually-hidden">{ceiling ? "Cote juste : au plus " : "Cote juste : "}</span>
      <span className={styles.price}>{formatPrice(fair)}</span>
      {edge !== undefined && <Edge edge={edge} label="meilleure value" />}
    </span>
  );
}

// Under the prices of a player the exchange doesn't price: the biggest gap of
// a bookmaker's price over the other's, when 30% or more.
export function SuspectOdds({ gap }: { gap: number }) {
  return (
    <span
      className={styles.fair}
      title={`Cote suspecte : ${REFERENCE_SOURCE} ne cote pas ce joueur, et cette cote dépasse de loin celle de l'autre bookmaker`}
    >
      Cote suspecte
      <Edge edge={gap} label="au-dessus de l'autre bookmaker" after />
    </span>
  );
}

function Edge({ edge, label, after = false }: { edge: number; label: string; after?: boolean }) {
  return (
    <strong className={styles.edge}>
      <span aria-hidden="true" className={styles.dot}>
        {" · "}
      </span>
      {!after && <span className="visually-hidden">, {label} : </span>}
      {after && <span className="visually-hidden"> : </span>}
      {formatEdge(edge)}
      {after && <span className="visually-hidden"> {label}</span>}
    </strong>
  );
}
