import { ALL_BOOKMAKERS_SENTENCE } from "../bookmakers";
import styles from "./AppFooter.module.css";

export function AppFooter() {
  return (
    <footer className={styles.footer}>
      <div className={styles.inner}>
        <p>
          Cotes relevées sur {ALL_BOOKMAKERS_SENTENCE} à intervalles réguliers. Vérifiez toujours la cote chez le
          bookmaker avant de parier.
        </p>
        <p className={styles.responsible}>Interdit aux moins de 18 ans.</p>
      </div>
    </footer>
  );
}
