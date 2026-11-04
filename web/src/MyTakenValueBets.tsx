import { useState, type MouseEvent } from "react";
import { BOOKMAKER_BRANDING } from "./bookmakers";
import { formatEdge, formatPrice, formatStartTime } from "./format";
import styles from "./MyTakenSurebets.module.css";
import { closingValue, expectedLabel, stakesSummaryLabel, valueSummaryLabel, type TakenValueBet, type TakenValueBets } from "./takenValueBets";

// "Meine Value Bets (N)": the account's taken value bets, soonest first, even
// once their price moved and they left the list: the bet, its bookmaker and
// price as taken, its edge then, kick-off or "Gespielt" and, once played, its
// closing price against the price taken ("Schlusskurs 3,30 (+6,1 %)"). Above
// them, the average edge and closing line value. With `onStake`, the stake
// placed on each can be written down ("Mein Einsatz"), and what it is expected
// to win at its edge is said, for each and in all. Shares "Meine Surebets"'s
// look (MyTakenSurebets.module.css).
export function MyTakenValueBets({
  taken,
  matchHref,
  onOpenMatch,
  onStake,
  now = new Date(),
}: {
  taken: TakenValueBets;
  onStake?: (key: string, stake: number | null) => void;
  matchHref?: (id: string) => string;
  onOpenMatch?: (id: string) => void;
  now?: Date;
}) {
  if (taken.size === 0) return null;
  const entries = [...taken].sort(([, a], [, b]) => a.startTime.localeCompare(b.startTime));
  const list = entries.map(([, bet]) => bet);
  const stakes = stakesSummaryLabel(list);
  return (
    <details className={styles.box}>
      <summary className={styles.summary}>Meine Value Bets ({list.length})</summary>
      <p className={styles.total}>{valueSummaryLabel(list)}</p>
      {stakes && <p className={styles.total}>{stakes}</p>}
      <ul className={styles.list}>
        {entries.map(([key, bet]) => (
          <TakenValueBetItem
            key={key}
            bet={bet}
            matchHref={matchHref}
            onOpenMatch={onOpenMatch}
            onStake={onStake && ((stake) => onStake(key, stake))}
            now={now}
          />
        ))}
      </ul>
    </details>
  );
}

function TakenValueBetItem({
  bet,
  matchHref,
  onOpenMatch,
  onStake,
  now,
}: {
  bet: TakenValueBet;
  onStake?: (stake: number | null) => void;
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
      {onStake && <Stake bet={bet} bookmaker={bookmaker} onStake={onStake} />}
    </li>
  );
}

// "1.234,5" or "50" as euros, null for empty, undefined for not an amount.
function stakeOf(text: string): number | null | undefined {
  const t = text.trim().replace(/\./g, "").replace(",", ".");
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 && n <= 100_000 ? Math.round(n * 100) / 100 : undefined;
}

// The stake placed on a taken value bet, written down when the field is left,
// and what it is expected to win.
function Stake({ bet, bookmaker, onStake }: { bet: TakenValueBet; bookmaker: string; onStake: (stake: number | null) => void }) {
  const [text, setText] = useState(() => (typeof bet.stake === "number" ? String(bet.stake).replace(".", ",") : ""));
  const value = stakeOf(text);
  const expected = expectedLabel(bet);
  return (
    <p className={styles.meta}>
      <label className={styles.stakeField}>
        <span>Mein Einsatz</span>
        <input
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={text}
          placeholder="0"
          aria-label={`Einsatz bei ${bookmaker} (${formatPrice(bet.price)}) in Euro`}
          aria-invalid={value === undefined}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => {
            if (value !== undefined && value !== (bet.stake ?? null)) onStake(value);
          }}
        />
        <span>€</span>
      </label>
      {expected && <span className={styles.profit}>{expected}</span>}
    </p>
  );
}
