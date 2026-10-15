import styles from "./OddsNotice.module.css";

// What the figures above rest on, said where the bets are placed: the prices are indicative, and the calculation
// knows nothing of the bookmakers' own limits on a stake (no number here: the minimum it assumes is the engine's).
export function OddsNotice({ mode }: { mode: "bookmakers" | "exchange" }) {
  return (
    <div role="note" className={styles.notice}>
      <p>
        <strong>Indicative prices.</strong> They move fast: check the price of each bet (and, against the exchange, the money available to lay) before placing it.
      </p>
      {mode === "bookmakers" && <p>The calculation knows neither the minimum nor the maximum stakes of each bookmaker, especially on accumulators.</p>}
    </div>
  );
}
