import type { MouseEvent } from "react";
import { formatStartTime } from "./format";
import { profitLabel, type TakenInfo, type TakenSurebets } from "./takenSurebets";
import styles from "./MyTakenSurebets.module.css";

// "Meine Surebets": the surebets the account marked taken, in one place above
// the value bets' list, even once a price moved and the surebet left it. Each
// with its match, legs and prices as taken (its label), its kick-off, its
// payout then ("+2,4 % · 2,40 € auf 100 €"), and its reminder: asked for,
// sent, or none. The server forgets one two days after
// its match (src/auth/takenSurebets.ts).
export function MyTakenSurebets({
  taken,
  matchHref,
  onOpenMatch,
  now = new Date(),
}: {
  taken: TakenSurebets;
  matchHref?: (id: string) => string;
  onOpenMatch?: (id: string) => void;
  now?: Date;
}) {
  if (taken.size === 0) return null;
  const list = [...taken.values()].sort((a, b) => a.startTime.localeCompare(b.startTime));
  return (
    <details className={styles.box}>
      <summary className={styles.summary}>Meine Surebets ({list.length})</summary>
      <ul className={styles.list}>
        {list.map((item) => (
          <TakenItem key={`${item.eventId}|${item.label}`} item={item} matchHref={matchHref} onOpenMatch={onOpenMatch} now={now} />
        ))}
      </ul>
    </details>
  );
}

function reminderLabel(item: TakenInfo): string | null {
  if (item.remindedAt) return "Erinnerung gesendet";
  return item.remind ? "Erinnerung 1 Std. vorher" : null;
}

function TakenItem({
  item,
  matchHref,
  onOpenMatch,
  now,
}: {
  item: TakenInfo;
  matchHref?: (id: string) => string;
  onOpenMatch?: (id: string) => void;
  now: Date;
}) {
  const started = Date.parse(item.startTime) <= now.getTime();
  const reminder = reminderLabel(item);
  const href = matchHref?.(item.eventId);
  const open = (e: MouseEvent<HTMLAnchorElement>) => {
    if (!onOpenMatch || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    onOpenMatch(item.eventId);
  };
  return (
    <li className={styles.item} data-started={started || undefined}>
      <p className={styles.label}>{item.label}</p>
      <p className={styles.meta}>
        <span>{started ? "Gespielt" : `Anstoß ${formatStartTime(item.startTime, now)}`}</span>
        {item.payoutRate !== null && <span className={styles.profit}>{profitLabel(item.payoutRate)}</span>}
        {reminder && <span>{reminder}</span>}
        {href && !started && (
          <a href={href} onClick={open}>
            Spielseite
          </a>
        )}
      </p>
    </li>
  );
}
