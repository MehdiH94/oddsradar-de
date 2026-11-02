import type { MouseEvent } from "react";
import { ChevronRight } from "lucide-react";
import type { ValueBet } from "./types";
import { formatEdge, formatPrice, formatStartParts, readAgo } from "./format";
import { EventTitle } from "./components/EventTitle";
import { PriceChip } from "./components/PriceChip";
import { CheckAtBookmaker } from "./components/CheckAtBookmaker";
import { ExchangePrices } from "./components/ExchangePrices";
import { BestPrice } from "./components/BestPrice";
import { MoveArrow } from "./components/MoveArrow";
import { useIsWide } from "./useMediaQuery";
import { REFERENCE_SOURCE } from "./value";
import { BOOKMAKER_BRANDING } from "./bookmakers";
import { sportEmoji, sportLabel, VALUE_BETS } from "./sports";
import groupStyles from "./GroupedOddsTables.module.css";
import styles from "./ValueBetsTable.module.css";

const FAIR_TITLE = `Faire Quote: die Quote an ${REFERENCE_SOURCE}, ohne ihre Marge`;
const bookmakerName = (id: string) => BOOKMAKER_BRANDING[id]?.name ?? id;

// What a bet's price is weighed against, in its "Fair" column: the fair odds;
// the exchange's lay as their ceiling, "≤ 2.40", when it prices the player too
// loosely for them; or, when it doesn't price them, the other bookmaker's
// price, named.
function Reference({ bet }: { bet: ValueBet }) {
  if (bet.basis === "lay") {
    return (
      <>
        <span aria-hidden="true">≤ </span>
        <span className="visually-hidden">höchstens </span>
        {formatPrice(bet.fair)}
      </>
    );
  }
  if (bet.basis === "bookmaker") {
    return (
      <>
        {formatPrice(bet.fair)}
        {bet.referenceBookmaker && (
          <span className={styles.referenceBookmaker}>
            <span className="visually-hidden"> bei </span>
            {bookmakerName(bet.referenceBookmaker)}
          </span>
        )}
      </>
    );
  }
  return <>{formatPrice(bet.fair)}</>;
}

function referenceTitle(bet: ValueBet): string {
  if (bet.basis === "lay") {
    return `Faire Quote höchstens: die Lay-Quote an ${REFERENCE_SOURCE}, die diesen Spieler zu ungenau bewertet, um eine faire Quote zu ergeben`;
  }
  if (bet.basis === "bookmaker") {
    const other = bet.referenceBookmaker ? bookmakerName(bet.referenceBookmaker) : "dem anderen Buchmacher";
    return `Verdächtige Quote: An ${REFERENCE_SOURCE} wird dieser Spieler nicht gehandelt; die Quote bei ${other}`;
  }
  return FAIR_TITLE;
}

// When the bet's price was read, "Quote vor 4 Min.", its exact time in the
// tooltip: an old price shows before betting, as on a surebet's legs.
function ReadAt({ readAt, now }: { readAt?: string; now: Date }) {
  if (!readAt) return null;
  return (
    <span className={styles.readAt} title={`Quote gelesen: ${new Date(readAt).toLocaleString("de-DE")}`}>
      Quote {readAgo(readAt, now)}
    </span>
  );
}

// The value bets' category: one row per bet, i.e. per bookmaker's price above
// what the outcome is worth (a match can have several), in the API's order.
// Each row: the kick-off, the match (with a link to its every market), the
// outcome, the bookmaker's price, what it is weighed against and the edge.
// On a phone (useIsWide) the rows lay out as cards: the edge on top, the
// price large with its fair odds under it (BestPrice), the match's page at
// the bottom, 44 px high (ValueBetsTable.module.css).
export function ValueBetsTable({
  bets,
  matchHref,
  onOpenMatch,
  sportHref,
}: {
  bets: ValueBet[];
  // A match's page (MatchPage), like OddsTable's.
  matchHref?: (id: string) => string;
  onOpenMatch?: (id: string) => void;
  // Where a match with no other market leads: its sport's page (EventTitle).
  sportHref?: (sport: string, q: string) => string;
}) {
  const wide = useIsWide();
  const now = new Date();
  return (
    <section className={groupStyles.section} aria-labelledby="value-bets-heading">
      <h2 id="value-bets-heading" className={groupStyles.heading}>
        <span aria-hidden="true">{sportEmoji(VALUE_BETS)}</span> {sportLabel(VALUE_BETS)}
      </h2>
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col" className={styles.startHead}>
              Anstoß
            </th>
            <th scope="col">Spiel</th>
            <th scope="col">Wette</th>
            <th scope="col" className={styles.priceHead}>
              Quote
            </th>
            <th scope="col" className={styles.fairHead} title={FAIR_TITLE}>
              Fair<span className="visually-hidden"> (faire Quote)</span>
            </th>
            <th scope="col" className={styles.edgeHead}>
              Vorteil<span className="visually-hidden"> gegenüber der fairen Quote</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {bets.map((bet) => {
            const start = formatStartParts(bet.startTime, now);
            const teams = bet.participants.join(" - ");
            const hasPage = matchHref !== undefined && bet.marketCount > 1;
            const open = (e: MouseEvent<HTMLAnchorElement>) => {
              if (!onOpenMatch || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
              e.preventDefault();
              onOpenMatch(bet.eventId);
            };
            return (
              <tr key={`${bet.eventId}:${bet.market}:${bet.bookmaker}:${bet.selection}`} className={styles.row}>
                <td className={styles.start}>
                  <time dateTime={bet.startTime}>
                    {start === null ? (
                      "-"
                    ) : (
                      <>
                        <span className={styles.time}>{start.time}</span>
                        <span className={styles.day}>{start.day}</span>
                      </>
                    )}
                  </time>
                </td>
                <td className={styles.match}>
                  <EventTitle
                    className={styles.teams}
                    eventId={bet.eventId}
                    sport={bet.sport}
                    title={teams}
                    matchHref={matchHref}
                    onOpenMatch={onOpenMatch}
                    sportHref={sportHref}
                  />
                  {bet.competition && <span className={styles.competition}>{bet.competition}</span>}
                  {wide && hasPage && (
                    <a
                      className={styles.more}
                      href={matchHref(bet.eventId)}
                      aria-label={`+${bet.marketCount - 1} ${bet.marketCount === 2 ? "Markt" : "Märkte"} für ${teams}`}
                      onClick={open}
                    >
                      +{bet.marketCount - 1} {bet.marketCount === 2 ? "Markt" : "Märkte"}
                    </a>
                  )}
                </td>
                <td className={styles.bet} data-label="Wette">
                  <span className={styles.outcome}>{bet.label}</span>
                  <span className={styles.market}>
                    {bet.marketLabel}
                    {bet.basis === "bookmaker" && <span className={styles.suspect}> · verdächtige Quote</span>}
                  </span>
                </td>
                {wide ? (
                  <>
                    <td className={styles.price} data-label="Quote">
                      <PriceChip
                        bookmaker={bet.bookmaker}
                        price={bet.price}
                        best={false}
                        edge={bet.edge}
                        suspect={bet.basis === "bookmaker"}
                        moved={bet.moved}
                      />
                      <ReadAt readAt={bet.readAt} now={now} />
                      <CheckAtBookmaker bookmaker={bet.bookmaker} url={bet.url} />
                    </td>
                    <td className={styles.fair} data-label="Fair" title={referenceTitle(bet)}>
                      <Reference bet={bet} />
                      <ExchangePrices prices={bet.exchange} />
                    </td>
                  </>
                ) : (
                  <td className={styles.price}>
                    <BestPrice
                      label={bookmakerName(bet.bookmaker)}
                      name={`${bet.label}, ${bet.marketLabel}`}
                      price={bet.price}
                      bookmakers={[bet.bookmaker]}
                      fair={bet.fair}
                      edge={bet.edge}
                      showFair
                      fairLabel={
                        bet.basis === "lay"
                          ? "Fair ≤"
                          : bet.basis === "bookmaker"
                            ? (bet.referenceBookmaker ? bookmakerName(bet.referenceBookmaker) : "Andere")
                            : "Fair"
                      }
                    />
                    {bet.moved && <MoveArrow move={bet.moved} price={bet.price} />}
                    <ReadAt readAt={bet.readAt} now={now} />
                    <ExchangePrices prices={bet.exchange} />
                    <CheckAtBookmaker bookmaker={bet.bookmaker} url={bet.url} />
                  </td>
                )}
                <td className={styles.edge} data-label="Vorteil">
                  <strong className={styles.edgeValue}>{formatEdge(bet.edge)}</strong>
                </td>
                {!wide && hasPage && (
                  <td className={styles.actions}>
                    <a className={styles.allMarkets} href={matchHref(bet.eventId)} onClick={open}>
                      <span>
                        Alle Märkte des Spiels{" "}
                        <span className="visually-hidden">{teams}</span>
                      </span>
                      <ChevronRight size={16} aria-hidden="true" />
                    </a>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
