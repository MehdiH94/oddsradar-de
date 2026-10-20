import { Fragment, useState, type CSSProperties, type MouseEvent } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { EventWithOdds } from "./types";
import { getBestBookmakers } from "./bestOdds";
import { ALL_BOOKMAKERS } from "./bookmakers";
import { dayHeading, formatStartParts } from "./format";
import { PriceChip } from "./components/PriceChip";
import { PayoutBadge } from "./components/PayoutBadge";
import { FairOdds } from "./components/FairOdds";
import { BestPrice } from "./components/BestPrice";
import { valueEdge } from "./value";
import { useIsTable } from "./useMediaQuery";
import styles from "./OddsTable.module.css";

// The matcher canonicalizes every head-to-head outcome to one of these three
// keys (src/matcher/match.ts, canonicalizeSelection) -- "1" (home win), "X"
// (draw), "2" (away win) -- so a 1X2 event always has at most one RawOdds
// entry per bookmaker per key, and this fixed order is what lets each match
// stay a single row with a stable column layout regardless of which
// bookmaker happened to be scraped first.
const SELECTIONS_WITH_DRAW = ["1", "X", "2"] as const;
// Two-way sports (tennis, snooker...) have no draw: their main market is
// "Vainqueur du match" (the match winner), with only "1" and "2".
const SELECTIONS_WITHOUT_DRAW = ["1", "2"] as const;

// The draw is "X", as in English and German.
const SELECTION_LABELS: Record<string, string> = { "1": "1", X: "X", "2": "2" };

// "1 Markt", "3 Märkte".
const marketsWord = (count: number) => (count === 1 ? "Markt" : "Märkte");

// What an outcome is, read out: the team, or the draw.
function selectionName(event: EventWithOdds, selection: string): string {
  if (selection === "X") return "Unentschieden";
  return (selection === "1" ? event.participants[0] : event.participants[1]) ?? SELECTION_LABELS[selection];
}

// The market most bookmakers list, the first bookmaker's first on a tie; the
// same as the API's (src/db/payoutRate.ts), so the TRJ shown is the one of the
// prices shown.
function primaryMarket(event: EventWithOdds): string | null {
  const listedBy = new Map<string, number>();
  for (const { odds } of Object.values(event.byBookmaker)) {
    for (const market of new Set(odds.map((o) => o.market))) listedBy.set(market, (listedBy.get(market) ?? 0) + 1);
  }
  let primary: string | null = null;
  for (const [market, count] of listedBy) if (primary === null || count > listedBy.get(primary)!) primary = market;
  return primary;
}

// Any bookmaker's, not only the displayed ones: unticking a bookmaker must not
// make the X column come and go.
function hasDrawOutcome(event: EventWithOdds): boolean {
  const market = primaryMarket(event);
  return Object.values(event.byBookmaker).some(({ odds }) =>
    odds.some((o) => o.market === market && o.selection === "X")
  );
}

// One row per match: its kick-off, its teams and competition, its TRJ, then
// for each outcome one price chip per ticked bookmaker, and the reference's
// fair odds under them when it prices the match (the value bets marked).
// Sorted by kick-off (`groupByDay`), a heading row opens each day and the rows
// show the hour only.
//
// On a phone, and up to 1024 px (useIsTable), each row is a card that shows the best price of each
// outcome only (BestPrice), large: "Vergleichen" unfolds every bookmaker's, and
// "N Märkte" opens the match's page. Both are 44 px high, at the
// bottom of the card.
export function OddsTable({
  events,
  bookmakers = ALL_BOOKMAKERS,
  groupByDay = false,
  matchHref,
  onOpenMatch,
}: {
  events: EventWithOdds[];
  bookmakers?: readonly string[];
  groupByDay?: boolean;
  // A match's page with its every market, linked when it has more than the
  // one shown here. A real link: it opens in a new tab too.
  matchHref?: (id: string) => string;
  onOpenMatch?: (id: string) => void;
}) {
  // A table from 1024 px; under it (a phone first), cards.
  const wide = useIsTable();
  // The phone's cards whose every bookmaker's prices are unfolded.
  const [compared, setCompared] = useState<ReadonlySet<string>>(new Set());
  const toggleCompared = (id: string) =>
    setCompared((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const hasBookmakers = bookmakers.length > 0;
  // Decided per table, i.e. per sport (GroupedOddsTables): the X column only
  // appears when at least one match has a draw price, so a sport whose
  // matches all have two outcomes doesn't get a column of dashes, while one
  // mixing both kinds keeps it, with a dash on the two-way matches.
  const selections = events.some(hasDrawOutcome) ? SELECTIONS_WITH_DRAW : SELECTIONS_WITHOUT_DRAW;
  const columnCount = 2 + (hasBookmakers ? 1 + selections.length : 0);
  const now = new Date();
  // Sorted by kick-off, the first match of each day opens it with a heading.
  const days = events.map((event) => (groupByDay ? dayHeading(event.startTime, now) : null));

  return (
    <table
      className={styles.table}
      data-layout={wide ? "table" : "cards"}
      style={{ "--outcomes": hasBookmakers ? selections.length : 1 } as CSSProperties}
    >
      <thead>
        <tr>
          <th scope="col" className={styles.startHead}>
            Anstoß
          </th>
          <th scope="col">Spiel</th>
          {hasBookmakers && (
            <th scope="col" className={styles.trjHead} title="Auszahlungsquote mit der besten Quote jedes Ausgangs">
              Auszahlung
            </th>
          )}
          {hasBookmakers &&
            selections.map((selection) => (
              <th key={selection} scope="col" className={styles.outcomeHead}>
                {SELECTION_LABELS[selection]}
              </th>
            ))}
        </tr>
      </thead>
      <tbody>
        {events.map((event, i) => {
          const market = primaryMarket(event);
          // The ticked bookmakers that list the match: with five of them, the
          // others would only add dashes. Each price carries its bookmaker's
          // icon, so the order needs no column.
          const listed = bookmakers.filter((bookmaker) => event.byBookmaker[bookmaker]);
          const listing = listed.length > 0 ? listed : bookmakers;
          const start = formatStartParts(event.startTime, now);
          const heading = days[i];
          const opensDay = heading !== null && heading.key !== days[i - 1]?.key;
          const teams = event.participants.join(" - ");
          const extraMarkets = (event.marketCount ?? 1) - 1;
          const hasPage = matchHref !== undefined && extraMarkets > 0;
          const open = (e: MouseEvent<HTMLAnchorElement>) => {
            if (!onOpenMatch || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
            e.preventDefault();
            onOpenMatch(event.id);
          };
          const isCompared = compared.has(event.id);
          const pricesId = `prices-${event.id}`;

          return (
            <Fragment key={event.id}>
              {opensDay && (
                <tr className={styles.dayRow}>
                  <th scope="colgroup" colSpan={columnCount}>
                    {heading.label}
                  </th>
                </tr>
              )}
              <tr className={styles.row}>
                <td className={styles.start}>
                  <time dateTime={event.startTime}>
                    {start === null ? (
                      "-"
                    ) : (
                      <>
                        <span className={styles.time}>{start.time}</span>
                        {!groupByDay && <span className={styles.day}>{start.day}</span>}
                      </>
                    )}
                  </time>
                </td>
                <td className={styles.match}>
                  <span className={styles.teams}>
                    {matchHref === undefined ? (
                      teams
                    ) : (
                      <a className={styles.teamsLink} href={matchHref(event.id)} onClick={open}>
                        {teams}
                      </a>
                    )}
                  </span>
                  {event.competition && <span className={styles.competition}>{event.competition}</span>}
                  {wide && hasPage && (
                    <a
                      className={styles.more}
                      href={matchHref(event.id)}
                      // The visible text first, as heard: which match is it about.
                      aria-label={`+${extraMarkets} ${marketsWord(extraMarkets)} für ${teams}`}
                      onClick={open}
                    >
                      +{extraMarkets} {marketsWord(extraMarkets)}
                    </a>
                  )}
                </td>
                {hasBookmakers && (
                  <td className={styles.trj}>
                    <PayoutBadge rate={event.payoutRate} />
                  </td>
                )}
                {hasBookmakers &&
                  selections.map((selection) => {
                    const best = market ? getBestBookmakers(event, market, selection, bookmakers) : [];
                    // The reference prices one market, the 1X2 or the winner: not the
                    // other, nor a market a bookmaker shows instead.
                    const fair = market !== null && market === event.reference?.market ? event.reference.fair[selection] : undefined;
                    const offers = listing.map((bookmaker) =>
                      event.byBookmaker[bookmaker]?.odds.find((o) => market && o.market === market && o.selection === selection)
                    );
                    const prices = offers.map((o) => o?.price);
                    const edges = prices.map((price) => valueEdge(price, fair));
                    const bestEdge = Math.max(...edges.map((edge) => edge ?? -Infinity));
                    if (!wide) {
                      const bestPrice = best.length > 0 ? prices[listing.indexOf(best[0])] : undefined;
                      // The highest boost among the listed bookmakers, shown when it beats the best price.
                      const boost = listing.reduce<{ price: number; bookmaker: string } | undefined>((top, bookmaker, b) => {
                        const boosted = offers[b]?.boosted;
                        return boosted !== undefined && boosted > (top?.price ?? bestPrice ?? Infinity) ? { price: boosted, bookmaker } : top;
                      }, undefined);
                      return (
                        <td key={selection} className={styles.outcome}>
                          <BestPrice
                            label={SELECTION_LABELS[selection]}
                            name={selectionName(event, selection)}
                            price={bestPrice}
                            bookmakers={best}
                            fair={fair}
                            edge={Number.isFinite(bestEdge) ? bestEdge : undefined}
                            boost={boost}
                          />
                          {isCompared && (
                            <span className={styles.prices} id={`${pricesId}-${selection}`}>
                              {listing.map((bookmaker, b) => (
                                <PriceChip
                                  key={bookmaker}
                                  bookmaker={bookmaker}
                                  price={prices[b]}
                                  best={best.includes(bookmaker)}
                                  edge={edges[b]}
                                  boosted={offers[b]?.boosted}
                                />
                              ))}
                            </span>
                          )}
                        </td>
                      );
                    }
                    return (
                      <td key={selection} className={styles.outcome} data-label={SELECTION_LABELS[selection]}>
                        <span className={styles.prices}>
                          {listing.map((bookmaker, b) => (
                            <PriceChip
                              key={bookmaker}
                              bookmaker={bookmaker}
                              price={prices[b]}
                              best={best.includes(bookmaker)}
                              edge={edges[b]}
                              boosted={offers[b]?.boosted}
                            />
                          ))}
                        </span>
                        {fair !== undefined && (
                          <FairOdds fair={fair} edge={Number.isFinite(bestEdge) ? bestEdge : undefined} />
                        )}
                      </td>
                    );
                  })}
                {!wide && (hasBookmakers || hasPage) && (
                  <td className={styles.actions}>
                    {hasBookmakers && listing.length > 1 && (
                      <button
                        type="button"
                        className={styles.compare}
                        aria-expanded={isCompared}
                        aria-controls={selections.map((selection) => `${pricesId}-${selection}`).join(" ")}
                        onClick={() => toggleCompared(event.id)}
                      >
                        <ChevronDown size={16} aria-hidden="true" className={styles.chevron} />
                        {isCompared ? "Ausblenden" : "Vergleichen"}
                        <span className="visually-hidden">{`: Quoten von ${listing.length} Buchmachern für ${teams}`}</span>
                      </button>
                    )}
                    {hasPage && (
                      <a
                        className={styles.allMarkets}
                        href={matchHref(event.id)}
                        aria-label={`+${extraMarkets} ${marketsWord(extraMarkets)} für ${teams}`}
                        onClick={open}
                      >
                        <span className="num">{extraMarkets}</span> {marketsWord(extraMarkets)}
                        <ChevronRight size={16} aria-hidden="true" />
                      </a>
                    )}
                  </td>
                )}
              </tr>
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}
