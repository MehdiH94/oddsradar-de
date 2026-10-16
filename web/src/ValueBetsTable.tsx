import type { MouseEvent } from "react";
import { ChevronRight } from "lucide-react";
import type { ValueBet } from "./types";
import { formatEdge, formatPrice, formatStartParts } from "./format";
import { EventTitle } from "./components/EventTitle";
import { PriceChip } from "./components/PriceChip";
import { BestPrice } from "./components/BestPrice";
import { useIsWide } from "./useMediaQuery";
import { REFERENCE_SOURCE } from "./value";
import { BOOKMAKER_BRANDING } from "./bookmakers";
import { sportEmoji, sportLabel, VALUE_BETS } from "./sports";
import groupStyles from "./GroupedOddsTables.module.css";
import styles from "./ValueBetsTable.module.css";

const FAIR_TITLE = `Fair odds: the price at ${REFERENCE_SOURCE}, without its margin`;
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
        <span className="visually-hidden">at most </span>
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
            <span className="visually-hidden"> at </span>
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
    return `Fair odds at most: the lay price at ${REFERENCE_SOURCE}, which prices this player too loosely to give fair odds`;
  }
  if (bet.basis === "bookmaker") {
    const other = bet.referenceBookmaker ? bookmakerName(bet.referenceBookmaker) : "the other bookmaker";
    return `Suspect price: ${REFERENCE_SOURCE} does not price this player; the price at ${other}`;
  }
  return FAIR_TITLE;
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
              Kick-off
            </th>
            <th scope="col">Match</th>
            <th scope="col">Bet</th>
            <th scope="col" className={styles.priceHead}>
              Price
            </th>
            <th scope="col" className={styles.fairHead} title={FAIR_TITLE}>
              Fair<span className="visually-hidden"> (fair odds)</span>
            </th>
            <th scope="col" className={styles.edgeHead}>
              Edge<span className="visually-hidden"> over the fair odds</span>
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
                      aria-label={`+${bet.marketCount - 1} markets for ${teams}`}
                      onClick={open}
                    >
                      +{bet.marketCount - 1} markets
                    </a>
                  )}
                </td>
                <td className={styles.bet} data-label="Bet">
                  <span className={styles.outcome}>{bet.label}</span>
                  <span className={styles.market}>
                    {bet.marketLabel}
                    {bet.basis === "bookmaker" && <span className={styles.suspect}> · suspect price</span>}
                  </span>
                </td>
                {wide ? (
                  <>
                    <td className={styles.price} data-label="Price">
                      <PriceChip
                        bookmaker={bet.bookmaker}
                        price={bet.price}
                        best={false}
                        edge={bet.edge}
                        suspect={bet.basis === "bookmaker"}
                      />
                    </td>
                    <td className={styles.fair} data-label="Fair" title={referenceTitle(bet)}>
                      <Reference bet={bet} />
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
                            ? (bet.referenceBookmaker ? bookmakerName(bet.referenceBookmaker) : "Other")
                            : "Fair"
                      }
                    />
                  </td>
                )}
                <td className={styles.edge} data-label="Edge">
                  <strong className={styles.edgeValue}>{formatEdge(bet.edge)}</strong>
                </td>
                {!wide && hasPage && (
                  <td className={styles.actions}>
                    <a className={styles.allMarkets} href={matchHref(bet.eventId)} onClick={open}>
                      <span>
                        Every market of the match{" "}
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
