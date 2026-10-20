import { useEffect, useRef, useState } from "react";
import { Copy } from "lucide-react";
import { BookmakerLogo } from "../BookmakerLogo";
import { BOOKMAKER_BRANDING } from "../bookmakers";
import { copyText } from "./copyText";
import { formatFb } from "./format";
import type { PlanView } from "./freebetsApi";
import { Gauge } from "./Gauge";
import styles from "./Placement.module.css";

type Group = PlanView["bookmakers"][number];

function CopyButton({ group }: { group: Group }) {
  // What the button last did, announced to a screen reader and shown for a moment.
  const [done, setDone] = useState<"copied" | "failed" | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  async function copy() {
    try {
      await navigator.clipboard.writeText(copyText(group));
      setDone("copied");
    } catch {
      setDone("failed");
    }
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setDone(null), 2500);
  }
  return (
    <>
      <button type="button" className={styles.copy} onClick={() => void copy()}>
        <Copy size={16} aria-hidden="true" /> Liste kopieren
      </button>
      <span role="status" className={styles.copied}>
        {done === "copied" ? "Liste kopiert" : done === "failed" ? "Kopieren fehlgeschlagen: Kopiere die Liste von Hand" : ""}
      </span>
    </>
  );
}

// Where to place the bets of a plan, bookmaker by bookmaker: no bookmaker carries every outcome, and each one's
// freebets are used up at its own site.
export function Placement({ plan }: { plan: PlanView }) {
  return (
    <section aria-labelledby="placement-heading">
      <div className={styles.head}>
        <h2 id="placement-heading" className={styles.title}>
          Wo du deine FB platzierst
        </h2>
        <p className={styles.hint}>Kein Buchmacher bietet alle Ausgänge an: Du platzierst diese Wetten Buchmacher für Buchmacher.</p>
      </div>
      <div className={styles.books}>
        {plan.bookmakers.map((group) => (
          <article key={group.bookmaker} className={styles.book} aria-label={BOOKMAKER_BRANDING[group.bookmaker]?.name ?? group.bookmaker}>
            <div className={styles.top}>
              <BookmakerLogo bookmaker={group.bookmaker} size={24} decorative />
              <span className={styles.name}>{BOOKMAKER_BRANDING[group.bookmaker]?.name ?? group.bookmaker}</span>
              <span className={styles.count}>
                <b className="num">{group.bets.length}</b> {group.bets.length === 1 ? "Wette" : "Wetten"}
              </span>
            </div>
            <Gauge to={group.fb > 0 ? group.used / group.fb : 0} />
            <p className={styles.use}>
              <b className="num">{formatFb(group.used)}</b> FB von <span className="num">{formatFb(group.fb)}</span> genutzt
            </p>
            <ul className={styles.bets}>
              {group.bets.map((bet) => (
                <li key={bet.label} className={styles.bet}>
                  <span className={styles.combo}>{bet.label}</span>
                  <span className={`${styles.stake} num`}>{formatFb(bet.stake)} FB</span>
                </li>
              ))}
            </ul>
            <CopyButton group={group} />
          </article>
        ))}
      </div>
      {plan.left >= 0.01 && (
        <p className={styles.rest}>
          Dir bleiben <b className="num">{formatFb(plan.left)} FB</b>, die diese Umwandlung nicht nutzt: Wandle sie auf anderem Weg um (mit einer anderen Umwandlung oben oder gegen die Wettbörse).
        </p>
      )}
    </section>
  );
}
