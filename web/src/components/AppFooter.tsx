import { ALL_BOOKMAKERS_SENTENCE } from "../bookmakers";
import styles from "./AppFooter.module.css";

export function AppFooter() {
  return (
    <footer className={styles.footer}>
      <div className={styles.inner}>
        <p>
          Odds read from {ALL_BOOKMAKERS_SENTENCE} at regular intervals. Always check the price at the bookmaker before
          betting.
        </p>
        <p className={styles.responsible}>Gambling is for adults only (18+).</p>
      </div>
    </footer>
  );
}
