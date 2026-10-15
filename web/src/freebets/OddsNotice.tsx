import styles from "./OddsNotice.module.css";

// What the figures above rest on, said where the bets are placed: the prices are indicative, and the calculation
// knows nothing of the bookmakers' own limits on a stake (no number here: the minimum it assumes is the engine's).
export function OddsNotice({ mode }: { mode: "bookmakers" | "exchange" }) {
  return (
    <div role="note" className={styles.notice}>
      <p>
        <strong>Cotes indicatives.</strong> Elles bougent vite : vérifiez la cote de chaque pari (et, contre l'exchange, l'argent disponible à layer) avant de le placer.
      </p>
      {mode === "bookmakers" && <p>Le calcul ne connaît ni les mises minimales ni les mises maximales de chaque bookmaker, surtout sur les combinés.</p>}
    </div>
  );
}
