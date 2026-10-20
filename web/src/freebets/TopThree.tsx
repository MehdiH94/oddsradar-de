import type { ReactNode } from "react";
import { Gauge } from "./Gauge";
import styles from "./TopThree.module.css";

export interface TopCard {
  key: string;
  rank: number;
  // A word on the card, with a tone for the eye (the word says it all).
  badge?: { text: string; tone: "good" | "warning" };
  // Already written: "75,6 %" and "10,67 €".
  rate: string;
  cash: string;
  // The part of the wallet it uses, from `from` to `to` (0 to 1).
  from?: number;
  to: number;
  caption: ReactNode;
  // The matches it is about, one line each.
  lines: string[];
}

// The three best conversions side by side (one under the other on a phone), one of them chosen: its detail comes
// below. Buttons that stay pressed, as the dashboard's chips.
export function TopThree({
  title,
  hint,
  cards,
  selected,
  onSelect,
  busy,
}: {
  title: string;
  hint: string;
  cards: TopCard[];
  selected: number;
  onSelect: (index: number) => void;
  busy: boolean;
}) {
  return (
    <section aria-labelledby="top-heading" aria-busy={busy}>
      <div className={styles.head}>
        <h2 id="top-heading" className={styles.title}>
          {title}
        </h2>
        <p className={styles.hint}>{hint}</p>
      </div>
      <div className={styles.cards}>
        {cards.map((card, index) => (
          <button key={card.key} type="button" className={index === selected ? styles.cardOn : styles.card} aria-pressed={index === selected} onClick={() => onSelect(index)}>
            <span className={styles.top}>
              <span className={`${styles.rank} num`}>{card.rank}</span>
              {card.badge && <span className={card.badge.tone === "good" ? styles.good : styles.warning}>{card.badge.text}</span>}
            </span>
            <span className={styles.label}>Umwandlungsrate</span>
            <span className={`${styles.rate} num`}>{card.rate}</span>
            <span className={styles.cash}>
              Garantierte Auszahlung <strong className="num">{card.cash}</strong>
            </span>
            <Gauge from={card.from} to={card.to} />
            <span className={styles.caption}>{card.caption}</span>
            <span className={styles.lines}>
              {card.lines.map((line, i) => (
                <span key={i}>{line}</span>
              ))}
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
