import styles from "./MyTakenSurebets.module.css";

// "Entfernen" on a taken surebet or value bet: takes its mark off, so that a
// bet marked by mistake can go once it has left the lists too. With stakes
// written down, it asks first, as they go with it.
export function RemoveButton({ label, hasStakes, onRemove }: { label: string; hasStakes: boolean; onRemove: () => void }) {
  return (
    <button
      type="button"
      className={styles.remove}
      aria-label={`Entfernen: ${label}`}
      onClick={() => {
        if (hasStakes && !window.confirm("Entfernen? Die eingetragenen Einsätze gehen mit.")) return;
        onRemove();
      }}
    >
      Entfernen
    </button>
  );
}
