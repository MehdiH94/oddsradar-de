import styles from "./OddsNotice.module.css";

// What the figures above rest on, said where the bets are placed: the prices are indicative, and the calculation
// knows nothing of the bookmakers' own limits on a stake (no number here: the minimum it assumes is the engine's).
export function OddsNotice({ mode }: { mode: "bookmakers" | "exchange" }) {
  return (
    <div role="note" className={styles.notice}>
      <p>
        <strong>Unverbindliche Quoten.</strong> Sie ändern sich schnell: Prüfe vor dem Platzieren die Quote jeder Wette (und gegen die Wettbörse das Geld, das für den Lay verfügbar ist).
      </p>
      {mode === "bookmakers" && <p>Die Berechnung kennt weder die Mindest- noch die Höchsteinsätze der einzelnen Buchmacher, besonders bei Kombiwetten.</p>}
    </div>
  );
}
