import { PAGE_SIZE } from "../api";
import styles from "./LoadMore.module.css";

// The end of the phone's list: how many matches are in sight, and a button
// for the next ones, added under them (no page to turn, the place in the list
// is kept). Past `max`, the search narrows the list instead.
export function LoadMore({
  shown,
  total,
  loading,
  max,
  onMore,
}: {
  shown: number;
  total: number;
  loading: boolean;
  max: number;
  onMore: () => void;
}) {
  const next = Math.min(PAGE_SIZE, total - shown);
  return (
    <div className={styles.more}>
      <p className={styles.count} aria-live="polite">
        <span className="num">{shown}</span> sur <span className="num">{total}</span> matchs affichés
      </p>
      {shown >= max ? (
        <p className={styles.hint}>Cherchez une équipe pour trouver les autres matchs.</p>
      ) : (
        <button type="button" className={styles.button} onClick={onMore} disabled={loading}>
          {loading ? "Chargement…" : `Voir ${next} match${next > 1 ? "s" : ""} de plus`}
        </button>
      )}
    </div>
  );
}
