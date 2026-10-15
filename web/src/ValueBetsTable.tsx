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

const FAIR_TITLE = `Cote juste : la cote de ${REFERENCE_SOURCE}, sans sa marge`;
const bookmakerName = (id: string) => BOOKMAKER_BRANDING[id]?.name ?? id;

// What a bet's price is weighed against, in its "Juste" column: the fair odds;
// the exchange's lay as their ceiling, "≤ 2,40", when it prices the player too
// loosely for them; or, when it doesn't price them, the other bookmaker's
// price, named.
function Reference({ bet }: { bet: ValueBet }) {
  if (bet.basis === "lay") {
    return (
      <>
        <span aria-hidden="true">≤ </span>
        <span className="visually-hidden">au plus </span>
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
            <span className="visually-hidden"> chez </span>
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
    return `Cote juste au plus : la cote de lay de ${REFERENCE_SOURCE}, qui cote ce joueur de trop loin pour en donner une`;
  }
  if (bet.basis === "bookmaker") {
    const other = bet.referenceBookmaker ? bookmakerName(bet.referenceBookmaker) : "l'autre bookmaker";
    return `Cote suspecte : ${REFERENCE_SOURCE} ne cote pas ce joueur ; la cote de ${other}`;
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
              Début
            </th>
            <th scope="col">Match</th>
            <th scope="col">Pari</th>
            <th scope="col" className={styles.priceHead}>
              Cote
            </th>
            <th scope="col" className={styles.fairHead} title={FAIR_TITLE}>
              Juste<span className="visually-hidden"> (cote juste)</span>
            </th>
            <th scope="col" className={styles.edgeHead}>
              Écart<span className="visually-hidden"> avec la cote juste</span>
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
                      aria-label={`+${bet.marketCount - 1} marchés pour ${teams}`}
                      onClick={open}
                    >
                      +{bet.marketCount - 1} marchés
                    </a>
                  )}
                </td>
                <td className={styles.bet} data-label="Pari">
                  <span className={styles.outcome}>{bet.label}</span>
                  <span className={styles.market}>
                    {bet.marketLabel}
                    {bet.basis === "bookmaker" && <span className={styles.suspect}> · cote suspecte</span>}
                  </span>
                </td>
                {wide ? (
                  <>
                    <td className={styles.price} data-label="Cote">
                      <PriceChip
                        bookmaker={bet.bookmaker}
                        price={bet.price}
                        best={false}
                        edge={bet.edge}
                        suspect={bet.basis === "bookmaker"}
                      />
                    </td>
                    <td className={styles.fair} data-label="Juste" title={referenceTitle(bet)}>
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
                          ? "Juste ≤"
                          : bet.basis === "bookmaker"
                            ? (bet.referenceBookmaker ? bookmakerName(bet.referenceBookmaker) : "Autre")
                            : "Juste"
                      }
                    />
                  </td>
                )}
                <td className={styles.edge} data-label="Écart">
                  <strong className={styles.edgeValue}>{formatEdge(bet.edge)}</strong>
                </td>
                {!wide && hasPage && (
                  <td className={styles.actions}>
                    <a className={styles.allMarkets} href={matchHref(bet.eventId)} onClick={open}>
                      <span>
                        Tous les marchés du match{" "}
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
