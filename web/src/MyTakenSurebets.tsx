import { useState, type MouseEvent } from "react";
import { BOOKMAKER_BRANDING } from "./bookmakers";
import { formatPrice, formatStartTime } from "./format";
import { closingLabel, closingSummaryLabel, layLiability, lockedLabel, profitLabel, summaryLabel, type TakenInfo, type TakenSurebets } from "./takenSurebets";
import styles from "./MyTakenSurebets.module.css";

// "Meine Surebets": the surebets the account marked taken, in one place above
// the value bets' list, even once a price moved and the surebet left it. Each
// with its match, legs and prices as taken (its label), its kick-off, its
// payout then ("+2,4 % · 2,40 € auf 100 €"), and its reminder: asked for,
// sent, or none. Once played, each leg's closing price against the price
// taken ("Schlusskurs bei 20bet 1,98 (+3,0 %)"), and above the list their
// average ("Ø +2,1 % gegenüber dem Schlusskurs (4 Wetten)"). The server forgets one two days after
// its match (src/auth/takenSurebets.ts). With `onStakes`, the stakes
// actually placed on each leg can be written down, and what they lock in is
// said ("Gesichert: +2,40 € bei 100,00 € Einsatz").
export function MyTakenSurebets({
  taken,
  matchHref,
  onOpenMatch,
  onStakes,
  now = new Date(),
}: {
  taken: TakenSurebets;
  matchHref?: (id: string) => string;
  onOpenMatch?: (id: string) => void;
  onStakes?: (key: string, stakes: (number | null)[]) => void;
  now?: Date;
}) {
  if (taken.size === 0) return null;
  const entries = [...taken].sort(([, a], [, b]) => a.startTime.localeCompare(b.startTime));
  const list = entries.map(([, item]) => item);
  // The closing prices of the played ones only: the server sends none before kick-off.
  const closing = closingSummaryLabel(list.filter((i) => Date.parse(i.startTime) <= now.getTime()));
  return (
    <details className={styles.box}>
      <summary className={styles.summary}>Meine Surebets ({list.length})</summary>
      <p className={styles.total}>{summaryLabel(list)}</p>
      {closing && <p className={styles.total}>{closing}</p>}
      <ul className={styles.list}>
        {entries.map(([key, item]) => (
          <TakenItem
            key={key}
            item={item}
            matchHref={matchHref}
            onOpenMatch={onOpenMatch}
            onStakes={onStakes && ((stakes) => onStakes(key, stakes))}
            now={now}
          />
        ))}
      </ul>
    </details>
  );
}

function reminderLabel(item: TakenInfo): string | null {
  if (item.remindedAt) return "Erinnerung gesendet";
  return item.remind ? "Erinnerung 1 Std. vorher" : null;
}

// "1.234,5" or "50" as euros, null for empty, undefined for not an amount.
function stakeOf(text: string): number | null | undefined {
  const t = text.trim().replace(/\./g, "").replace(",", ".");
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 && n <= 100_000 ? Math.round(n * 100) / 100 : undefined;
}
const stakeText = (s: number | null | undefined) => (typeof s === "number" ? String(s).replace(".", ",") : "");
const euroText = (v: number) => `${v.toFixed(2).replace(".", ",")} €`;

// The stakes actually placed on a taken surebet's legs (a lay's is its
// backer's stake, its liability shown beside it), written down when a field is
// left, and what they lock in.
function Stakes({ item, onStakes }: { item: TakenInfo; onStakes: (stakes: (number | null)[]) => void }) {
  const legs = item.legs!;
  const [texts, setTexts] = useState(() => legs.map((_, i) => stakeText(item.stakes?.[i])));
  const commit = () => {
    const stakes = texts.map(stakeOf);
    if (stakes.some((s) => s === undefined)) return;
    if (JSON.stringify(stakes) === JSON.stringify(legs.map((_, i) => item.stakes?.[i] ?? null))) return;
    onStakes(stakes as (number | null)[]);
  };
  const locked = lockedLabel(legs, item.stakes);
  return (
    <details className={styles.stakes}>
      <summary>Meine Einsätze</summary>
      <div className={styles.stakeFields}>
        {legs.map((leg, i) => {
          const lay = leg.side === "lay";
          const name = leg.source === "exchange" ? "Börse" : (BOOKMAKER_BRANDING[leg.source]?.name ?? leg.source);
          const stake = stakeOf(texts[i]);
          return (
            <label key={i} className={styles.stakeField}>
              <span>
                {lay ? "Lay an der " : ""}
                {name} {formatPrice(leg.price)}
              </span>
              <input
                type="text"
                inputMode="decimal"
                autoComplete="off"
                value={texts[i]}
                placeholder="0"
                aria-label={lay ? `Lay-Einsatz an der Börse (${formatPrice(leg.price)}) in Euro` : `Einsatz bei ${name} (${formatPrice(leg.price)}) in Euro`}
                aria-invalid={stake === undefined}
                onChange={(e) => setTexts((t) => t.map((x, j) => (j === i ? e.target.value : x)))}
                onBlur={commit}
              />
              <span>€</span>
              {lay && typeof stake === "number" && stake > 0 && <span>Haftung {euroText(layLiability(stake, leg.price))}</span>}
            </label>
          );
        })}
      </div>
      {locked && <p className={styles.locked}>{locked}</p>}
    </details>
  );
}

function TakenItem({
  item,
  matchHref,
  onOpenMatch,
  onStakes,
  now,
}: {
  item: TakenInfo;
  matchHref?: (id: string) => string;
  onOpenMatch?: (id: string) => void;
  onStakes?: (stakes: (number | null)[]) => void;
  now: Date;
}) {
  const started = Date.parse(item.startTime) <= now.getTime();
  const reminder = reminderLabel(item);
  const closings = started ? (item.legs ?? []).map(closingLabel).filter((l): l is string => l !== null) : [];
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
      {onStakes && item.legs && item.legs.length > 0 && <Stakes item={item} onStakes={onStakes} />}
      {closings.length > 0 && (
        <p className={styles.meta}>
          {closings.map((c) => (
            <span key={c}>{c}</span>
          ))}
        </p>
      )}
    </li>
  );
}
