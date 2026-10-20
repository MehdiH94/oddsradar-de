import { useState, type CSSProperties } from "react";
import type { MarketDetail, MarketLine, OutcomeDetail } from "../types";
import { PriceChip } from "./PriceChip";
import { PayoutBadge } from "./PayoutBadge";
import { FairOdds, SuspectOdds } from "./FairOdds";
import styles from "./MarketCard.module.css";

// A long list (a match's 40-odd scorers) shows its favourites, the rest unfolds.
const SHOWN = 10;
const FOLD_FROM = 13;
// From this many outcomes on, a field to find one by name.
const FILTER_FROM = 30;
// From this many bookmakers on, a phone has under 3 rem per column: the chips
// stack their icon over their price.
const COMPACT_FROM = 6;

// "2,5": the German decimal comma.
const formatLine = (line: number) => String(line).replace(".", ",");

function Prices({ outcome, bookmakers }: { outcome: OutcomeDetail | undefined; bookmakers: readonly string[] }) {
  return (
    <span className={styles.prices}>
      {bookmakers.map((bookmaker) => (
        <PriceChip
          key={bookmaker}
          bookmaker={bookmaker}
          price={outcome?.prices[bookmaker]}
          best={outcome?.best.includes(bookmaker) ?? false}
          edge={outcome?.edges?.[bookmaker] ?? outcome?.suspects?.[bookmaker]}
          suspect={outcome?.suspects?.[bookmaker] !== undefined}
          compact={bookmakers.length >= COMPACT_FROM}
          boosted={outcome?.boosted?.[bookmaker]}
        />
      ))}
    </span>
  );
}

// An outcome's fair odds (or their ceiling) under its prices, with the best
// value bet among the ticked bookmakers; or, for a player the exchange doesn't
// price, the biggest suspect price's gap.
function OutcomeFairOdds({ outcome, bookmakers }: { outcome: OutcomeDetail; bookmakers: readonly string[] }) {
  const biggest = (byBookmaker: Record<string, number> | undefined) => {
    const values = bookmakers.flatMap((b) => (byBookmaker?.[b] === undefined ? [] : [byBookmaker[b]]));
    return values.length ? Math.max(...values) : undefined;
  };
  const suspect = biggest(outcome.suspects);
  return (
    <>
      {outcome.fair !== undefined && (
        <FairOdds fair={outcome.fair} ceiling={outcome.fairIsCeiling} edge={biggest(outcome.edges)} />
      )}
      {suspect !== undefined && <SuspectOdds gap={suspect} />}
    </>
  );
}

// Over/under lines: one row per line, "Over" and "Under" side by side.
function LinesTable({ market, bookmakers }: { market: MarketDetail; bookmakers: readonly string[] }) {
  const hasPayout = market.lines.some((l) => l.payoutRate !== null);
  return (
    <table className={styles.lines}>
      <thead>
        <tr>
          <th scope="col">Linie</th>
          <th scope="col">Über</th>
          <th scope="col">Unter</th>
          {hasPayout && (
            <th scope="col" className={styles.trjHead}>
              Auszahlung
            </th>
          )}
        </tr>
      </thead>
      <tbody>
        {market.lines.map((line) => (
          <tr key={line.line}>
            <th scope="row" className={styles.line}>
              {line.line === null ? "" : formatLine(line.line)}
            </th>
            <td data-label="Über">
              <Prices outcome={line.outcomes.find((o) => o.key === "over")} bookmakers={bookmakers} />
            </td>
            <td data-label="Unter">
              <Prices outcome={line.outcomes.find((o) => o.key === "under")} bookmakers={bookmakers} />
            </td>
            {hasPayout && (
              <td className={styles.trj}>
                <PayoutBadge rate={line.payoutRate} />
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// Outcomes one under another, the favourites first when there are many.
function OutcomeList({ market, line, bookmakers }: { market: MarketDetail; line: MarketLine; bookmakers: readonly string[] }) {
  const [expanded, setExpanded] = useState(false);
  const [filter, setFilter] = useState("");
  const needle = filter.trim().toLowerCase();
  const matching = needle ? line.outcomes.filter((o) => o.label.toLowerCase().includes(needle)) : line.outcomes;
  const folds = line.outcomes.length >= FOLD_FROM;
  // A search shows every outcome it finds, folded or not.
  const shown = folds && !expanded && !needle ? matching.slice(0, SHOWN) : matching;
  const hidden = line.outcomes.length - SHOWN;

  return (
    <>
      {line.outcomes.length >= FILTER_FROM && (
        <input
          type="search"
          className={styles.filter}
          aria-label={`In ${market.label} suchen`}
          placeholder={`Unter ${line.outcomes.length} suchen…`}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      )}
      <table className={styles.list}>
        <tbody>
          {shown.map((outcome) => (
            <tr key={outcome.key}>
              <th scope="row" className={styles.outcome}>
                {outcome.label}
              </th>
              <td>
                <Prices outcome={outcome} bookmakers={bookmakers} />
                <OutcomeFairOdds outcome={outcome} bookmakers={bookmakers} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {needle && matching.length === 0 && <p className={styles.empty}>Nichts gefunden.</p>}
      {folds && !needle && (
        <button type="button" className={styles.more} onClick={() => setExpanded(!expanded)} aria-expanded={expanded}>
          {expanded ? "Weniger anzeigen" : `Die anderen ${hidden} anzeigen`}
        </button>
      )}
    </>
  );
}

// One market of a match: its outcomes with each ticked bookmaker's price, the
// best in green, and the TRJ of the best prices when it has one.
export function MarketCard({ market, bookmakers }: { market: MarketDetail; bookmakers: readonly string[] }) {
  const single = market.kind === "list" ? market.lines[0] : undefined;
  return (
    <article
      className={`${styles.card} ${market.kind === "lines" ? styles.wide : ""}`}
      aria-label={market.label}
      // On a phone, one column of prices per bookmaker (MarketCard.module.css).
      style={{ "--bookmakers": Math.max(1, bookmakers.length) } as CSSProperties}
    >
      <header className={styles.header}>
        <h4 className={styles.title}>{market.label}</h4>
        {single && single.payoutRate !== null && (
          <span className={styles.badge} title="Auszahlungsquote mit der besten Quote jedes Ausgangs">
            <span className="visually-hidden">Auszahlungsquote: </span>
            <PayoutBadge rate={single.payoutRate} />
          </span>
        )}
      </header>
      {market.kind === "lines" ? (
        <LinesTable market={market} bookmakers={bookmakers} />
      ) : (
        single && <OutcomeList market={market} line={single} bookmakers={bookmakers} />
      )}
    </article>
  );
}
