import { useState } from "react";
import { X } from "lucide-react";
import { FREEBETS_PATH } from "../routes";
import { Link } from "./Link";
import { APP_NAME, DISCORD_INVITE_URL } from "../brand";
import styles from "./WelcomeNote.module.css";

// The dashboard's first visit: what the three lists are for, in three lines,
// until the tester closes it. Remembered in the browser only (a per-device
// convenience): without storage, it shows again next time.
const STORAGE_KEY = "oddsblitzer:welcome-closed";

function wasClosed(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function WelcomeNote() {
  const [closed, setClosed] = useState(wasClosed);
  if (closed) return null;

  function close() {
    setClosed(true);
    try {
      localStorage.setItem(STORAGE_KEY, "1");
    } catch {
      // Nothing to do: it shows again on the next visit.
    }
  }

  return (
    <aside className={styles.note} aria-labelledby="welcome-title">
      <div className={styles.head}>
        <h2 id="welcome-title" className={styles.title}>
          Willkommen bei {APP_NAME}
        </h2>
        <button type="button" className={styles.close} onClick={close} aria-label="Hinweis schließen">
          <X size={18} aria-hidden="true" />
        </button>
      </div>
      <ul className={styles.list}>
        <li>
          <strong>Value Bets</strong> (Reiter „Value Bets“): Quoten, die mehr zahlen, als die faire Quote der Betfair-Wettbörse wert
          ist. Je größer der Vorteil, desto besser.
        </li>
        <li>
          <strong>Surebets</strong> (oben bei den Value Bets): Wetten bei mehreren Buchmachern, die bei jedem Ergebnis einen
          Gewinn bringen. Prüf die Quoten immer beim Buchmacher.
        </li>
        <li>
          <strong>Quoten</strong>: nach Abzug der Wettsteuer (5 % bzw. 5,3 % des Einsatzes, je nach Buchmacher); 20bet
          zieht keine ab, bei Tipico und Winamax ist sie nicht abgezogen. Beim Buchmacher siehst du daher eine etwas höhere Quote.
        </li>
        <li>
          <Link href={FREEBETS_PATH}>Freebets</Link>: Wir berechnen, wie du deine Freebets in echtes Geld umwandelst.
        </li>
      </ul>
      <p className={styles.hint}>
        Etwas stimmt nicht oder fehlt? Die Sprechblase oben rechts schickt uns dein Feedback. Die Alerts kommen auf{" "}
        <a href={DISCORD_INVITE_URL} target="_blank" rel="noopener noreferrer">
          unserem Discord
        </a>
        .
      </p>
    </aside>
  );
}
