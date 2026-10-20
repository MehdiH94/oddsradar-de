import { ALL_BOOKMAKERS_SENTENCE } from "../bookmakers";
import styles from "./AppFooter.module.css";

export function AppFooter() {
  return (
    <footer className={styles.footer}>
      <div className={styles.inner}>
        <p>
          Quoten von {ALL_BOOKMAKERS_SENTENCE}, regelmäßig gelesen. Prüf die Quote immer beim Buchmacher, bevor du
          wettest.
        </p>
        <p className={styles.responsible}>Glücksspiel nur für Erwachsene (18+).</p>
      </div>
    </footer>
  );
}
