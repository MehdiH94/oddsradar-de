import type { MouseEvent } from "react";
import { BOOKMAKER_BRANDING } from "./bookmakers";
import { formatEdge, formatPrice, formatStartTime } from "./format";
import styles from "./MyTakenSurebets.module.css";
import { closingValue, valueSummaryLabel, type TakenValueBet, type TakenValueBets } from "./takenValueBets";

// "Meine Value Bets (N)": the account's taken value bets, soonest first, even
// once their price moved and they left the list: the bet, its bookmaker and
// price as taken, its edge then, kick-off or "Gespielt" and, once played, its
// closing price against the price taken ("Schlusskurs 3,30 (+6,1 %)"). Above
// them, the average edge and closing line value. Shares "Meine Surebets"'s
// look (MyTakenSurebets.module.css).
export function MyTakenValueBets({
  taken,
  matchHref,
  onOpenMatch,
  now = new Date(),
}: {
  taken: TakenValueBets;
  matchHref?: (id: string) => string;
  onOpenMatch?: (id: string) => void;
  now?: Date;
}) {
  if (taken.size === 0) return null;
  const entries = [...taken].sort(([, a], [, b]) => a.startTime.localeCompare(b.startTime));
  const list = entries.map(([, bet]) => bet);
  return (
    <details className={styles.box}>
      <summary className={styles.summary}>Meine Value Bets ({list.length})</summary>
      <p className={styles.total}>{valueSummaryLabel(list)}</p>
      <ul className={styles.list}>
        {entries.map(([key, bet]) => (
          <TakenValueBetItem key={key} bet={bet} matchHref={matchHref} onOpenMatch={onOpenMatch} now={now} />
        ))}
      </ul>
    </details>
  );
}

function TakenValueBetItem({
  bet,
  matchHref,
  onOpenMatch,
  now,
}: {
  bet: TakenValueBet;
  matchHref?: (id: string) => string;
  onOpenMatch?: (id: string) => void;
  now: Date;
}) {
  const started = Date.parse(bet.startTime) <= now.getTime();
  const value = started ? closingValue(bet) : null;
  const href = matchHref?.(bet.eventId);
  const open = (e: MouseEvent<HTMLAnchorElement>) => {
    if (!onOpenMatch || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    onOpenMatch(bet.eventId);
  };
  const bookmaker = BOOKMAKER_BRANDING[bet.bookmaker]?.name ?? bet.bookmaker;
  return (
    <li className={styles.item} data-started={started || undefined}>
      <p className={styles.label}>
        {bet.label} @ {bookmaker} {formatPrice(bet.price)}
      </p>
      <p className={styles.meta}>
        <span>{started ? "Gespielt" : `Anstoß ${formatStartTime(bet.startTime, now)}`}</span>
        <span className={styles.profit}>Vorteil {formatEdge(bet.edge)}</span>
        {value !== null && typeof bet.closing === "number" && (
          <span>
            Schlusskurs {formatPrice(bet.closing)} ({formatEdge(value)})
          </span>
        )}
        {href && !started && (
          <a href={href} onClick={open}>
            Spielseite
          </a>
        )}
      </p>
    </li>
  );
}
