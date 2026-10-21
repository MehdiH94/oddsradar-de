import { ALL_BOOKMAKERS_SENTENCE } from "../bookmakers";
import { DISCORD_INVITE_URL } from "../brand";
import styles from "./AppFooter.module.css";

export function AppFooter() {
  return (
    <footer className={styles.footer}>
      <div className={styles.inner}>
        <p>
          Quoten von {ALL_BOOKMAKERS_SENTENCE}, regelmäßig gelesen. Prüf die Quote immer beim Buchmacher, bevor du
          wettest.
        </p>
        <p>
          Value-Bet-Alerts und Austausch mit dem Team:{" "}
          <a className={styles.link} href={DISCORD_INVITE_URL} target="_blank" rel="noopener noreferrer">
            Discord beitreten
          </a>
        </p>
        <p className={styles.responsible}>Glücksspiel nur für Erwachsene (18+).</p>
      </div>
    </footer>
  );
}
