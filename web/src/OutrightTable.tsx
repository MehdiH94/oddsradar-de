import { useState, type CSSProperties, type MouseEvent } from "react";
import type { EventWithOdds } from "./types";
import { ALL_BOOKMAKERS } from "./bookmakers";
import { BookmakerLogo } from "./BookmakerLogo";
import { getBestBookmakers } from "./bestOdds";
import { formatStartTime } from "./format";
import { MARKET_OUTRIGHT, outrightRows } from "./outright";
import { sportEmoji } from "./sports";
import { PriceChip } from "./components/PriceChip";
import { FairOdds } from "./components/FairOdds";
import { valueEdge } from "./value";
import { PayoutBadge } from "./components/PayoutBadge";
import { useIsWide } from "./useMediaQuery";
import styles from "./OutrightTable.module.css";

// A race can list over 100 competitors: the favourites show, the rest unfolds.
const FAVOURITES_SHOWN = 10;
// From this many competitors on, a field to find one by name.
const FILTER_FROM = 30;

// One card per winner-among-N market (a race, a golf tournament): its date,
// title and TRJ, then its competitors, favourite first, with each ticked
// bookmaker's price and the best one highlighted, like OddsTable.
export function OutrightTable({
  events,
  bookmakers = ALL_BOOKMAKERS,
  matchHref,
  onOpenMatch,
}: {
  events: EventWithOdds[];
  bookmakers?: readonly string[];
  // A tournament's page (MatchPage), linked from its card when it has more
  // markets than its winner: its Top 5, 10 and 20, the leader after a round.
  matchHref?: (id: string) => string;
  onOpenMatch?: (id: string) => void;
}) {
  return (
    <div className={styles.grid}>
      {events.map((event) => (
        <OutrightCard key={event.id} event={event} bookmakers={bookmakers} matchHref={matchHref} onOpenMatch={onOpenMatch} />
      ))}
    </div>
  );
}

function OutrightCard({
  event,
  bookmakers: ticked,
  matchHref,
  onOpenMatch,
}: {
  event: EventWithOdds;
  bookmakers: readonly string[];
  matchHref?: (id: string) => string;
  onOpenMatch?: (id: string) => void;
}) {
  // A column per ticked bookmaker that prices the race: the others would be
  // dashes only.
  const wide = useIsWide();
  const pricing = ticked.filter((bookmaker) => event.byBookmaker[bookmaker]);
  const bookmakers = pricing.length > 0 ? pricing : ticked;
  const [expanded, setExpanded] = useState(false);
  const [filter, setFilter] = useState("");
  const rows = outrightRows(event, bookmakers).map((row, i) => ({ ...row, rank: i + 1 }));
  const needle = filter.trim().toLowerCase();
  const matching = needle ? rows.filter((row) => row.competitor.toLowerCase().includes(needle)) : rows;
  // A search shows every competitor it finds, folded or not.
  const shown = expanded || needle ? matching : matching.slice(0, FAVOURITES_SHOWN);
  const hidden = rows.length - FAVOURITES_SHOWN;
  const title = event.participants.join(" - ");
  // A golf tournament the week it is played: the exchange's fair odds of the
  // players whose prices are tight enough, and its value bets from 5%.
  const reference = event.reference?.market === MARKET_OUTRIGHT ? event.reference : undefined;
  // A click opens the page in place; a new tab keeps the link's own way.
  const open = (e: MouseEvent<HTMLAnchorElement>) => {
    if (!onOpenMatch || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    onOpenMatch(event.id);
  };

  return (
    <article
      className={styles.card}
      aria-label={title}
      style={{ "--bookmakers": Math.max(1, bookmakers.length) } as CSSProperties}
    >
      <header className={styles.header}>
        <div className={styles.heading}>
          <h3 className={styles.title}>
            <span aria-hidden="true">{sportEmoji(event.sport)}</span>{" "}
            {matchHref === undefined ? (
              title
            ) : (
              <a className={styles.titleLink} href={matchHref(event.id)} onClick={open}>
                {title}
              </a>
            )}
          </h3>
          <p className={styles.meta}>
            <time dateTime={event.startTime}>{formatStartTime(event.startTime)}</time>
            {event.competition && event.competition !== title && <> · {event.competition}</>}
          </p>
          {matchHref && (event.marketCount ?? 0) > 1 && (
            <a
              className={styles.more}
              href={matchHref(event.id)}
              // The visible text first, as heard: which tournament it is about.
              aria-label={`+${(event.marketCount ?? 1) - 1} markets for ${title}`}
              onClick={open}
            >
              +{(event.marketCount ?? 1) - 1} markets
            </a>
          )}
        </div>
        {bookmakers.length > 0 && (
          <div className={styles.trj} title="Payout, with the best price of each contender">
            <span className={styles.trjLabel}>
              Payout
            </span>
            <PayoutBadge rate={event.payoutRate} />
          </div>
        )}
      </header>

      {rows.length >= FILTER_FROM && (
        <input
          type="search"
          className={styles.filter}
          aria-label={`Find a contender of ${title}`}
          placeholder={`Find a contender among ${rows.length}…`}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      )}

      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col" className={styles.rankHead}>
              <span aria-hidden="true">#</span>
              <span className="visually-hidden">Rank</span>
            </th>
            <th scope="col">Contender</th>
            {bookmakers.map((bookmaker) => (
              <th key={bookmaker} scope="col" className={styles.bookmakerHead}>
                <BookmakerLogo bookmaker={bookmaker} size={18} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map((row) => {
            // Only when there is something to compare: a competitor priced by
            // a single bookmaker would be highlighted for nothing.
            const priced = bookmakers.filter((bookmaker) => row.prices[bookmaker] !== undefined);
            const best = priced.length > 1 ? getBestBookmakers(event, MARKET_OUTRIGHT, row.competitor, bookmakers) : [];
            const fair = reference?.fair[row.competitor];
            const edges = bookmakers.map((bookmaker) => valueEdge(row.prices[bookmaker], fair, reference?.minEdge));
            const bestEdge = Math.max(...edges.map((edge) => edge ?? -Infinity));
            return (
              <tr key={row.competitor}>
                <td className={styles.rank}>{row.rank}</td>
                <td className={styles.competitor}>
                  {row.competitor}
                  {fair !== undefined && <FairOdds fair={fair} edge={Number.isFinite(bestEdge) ? bestEdge : undefined} />}
                </td>
                {bookmakers.map((bookmaker, b) => (
                  <td key={bookmaker} className={styles.price}>
                    <PriceChip
                      bookmaker={bookmaker}
                      price={row.prices[bookmaker]}
                      best={best.includes(bookmaker)}
                      edge={edges[b]}
                      // On a phone the columns' heads are hidden: each price
                      // shows its bookmaker.
                      showLogo={!wide}
                    />
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
      {needle && matching.length === 0 && <p className={styles.empty}>No contender matches.</p>}

      {!needle && hidden > 0 && (
        <button type="button" className={styles.more} onClick={() => setExpanded(!expanded)} aria-expanded={expanded}>
          {expanded ? "Show fewer" : `Show the ${hidden} others`}
        </button>
      )}
    </article>
  );
}
