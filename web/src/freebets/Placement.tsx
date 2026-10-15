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
        <Copy size={16} aria-hidden="true" /> Copier la liste
      </button>
      <span role="status" className={styles.copied}>
        {done === "copied" ? "Liste copiée" : done === "failed" ? "Copie impossible : recopiez la liste à la main" : ""}
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
          Où placer vos FB
        </h2>
        <p className={styles.hint}>Un bookmaker ne porte jamais toutes les issues : vous placez ces paris bookmaker par bookmaker.</p>
      </div>
      <div className={styles.books}>
        {plan.bookmakers.map((group) => (
          <article key={group.bookmaker} className={styles.book} aria-label={BOOKMAKER_BRANDING[group.bookmaker]?.name ?? group.bookmaker}>
            <div className={styles.top}>
              <BookmakerLogo bookmaker={group.bookmaker} size={24} decorative />
              <span className={styles.name}>{BOOKMAKER_BRANDING[group.bookmaker]?.name ?? group.bookmaker}</span>
              <span className={styles.count}>
                <b className="num">{group.bets.length}</b> pari{group.bets.length > 1 ? "s" : ""}
              </span>
            </div>
            <Gauge to={group.fb > 0 ? group.used / group.fb : 0} />
            <p className={styles.use}>
              <b className="num">{formatFb(group.used)}</b> FB utilisés sur <span className="num">{formatFb(group.fb)}</span>
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
          Il vous reste <b className="num">{formatFb(plan.left)} FB</b> que cette conversion n'absorbe pas : ils sont à convertir autrement (une autre conversion ci-dessus, ou contre l'exchange).
        </p>
      )}
    </section>
  );
}
