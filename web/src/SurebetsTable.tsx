import type { MouseEvent } from "react";
import { ChevronRight } from "lucide-react";
import type { Surebet, SurebetLeg } from "./types";
import { formatPayoutRate, formatPrice, formatStartParts } from "./format";
import { BOOKMAKER_BRANDING } from "./bookmakers";
import { BookmakerLogo } from "./BookmakerLogo";
import { EventTitle } from "./components/EventTitle";
import { useIsWide } from "./useMediaQuery";
import groupStyles from "./GroupedOddsTables.module.css";
import styles from "./SurebetsTable.module.css";

// The exchange's legs, beside the bookmakers' (src/db/surebets.ts).
const EXCHANGE = "exchange";
const sourceName = (source: string) => (source === EXCHANGE ? "Exchange" : (BOOKMAKER_BRANDING[source]?.name ?? source));
const euros = (amount: number) => `${amount.toFixed(2).replace(".", ",")} €`;
// What a lay offers under which the surebet is thin (SUREBET_MIN_SIZE).
const THIN_SIZE = 20;

// Said in the card, not in a tooltip only: a finger can't bring one up.
const KIND_LABELS: Record<Surebet["kind"], string> = {
  bookmakers: "Entre bookmakers",
  exchange: "Avec l'exchange",
  lay: "Lay sur l'exchange",
};

const KIND_TITLES: Record<Surebet["kind"], string> = {
  bookmakers: "Entre les bookmakers : la meilleure cote de chaque issue",
  exchange: "Avec l'exchange : sa cote nette de sa commission de 3 %",
  lay: "Pariée chez un bookmaker, « layée » sur l'exchange : sa commission de 3 % comprise. Sous 20 € à layer, le gain ne vaut que pour cette somme",
};

// One bet of a surebet: where, at what price, and how much (out of 100 € in
// all; a lay's stake and what it risks).
function Leg({ leg }: { leg: SurebetLeg }) {
  return (
    <li className={styles.leg} data-source={leg.source} data-side={leg.side}>
      <span className={styles.legOutcome}>
        {leg.side === "lay" && <span className={styles.lay}>Lay </span>}
        {leg.label}
      </span>
      <span className={styles.legSource}>
        {leg.source !== EXCHANGE && <BookmakerLogo bookmaker={leg.source} size={16} decorative />}
        <span className={leg.source === EXCHANGE ? styles.exchange : undefined}>{sourceName(leg.source)}</span>
        <strong className={styles.legPrice}>{formatPrice(leg.price)}</strong>
      </span>
      <span className={styles.legStake}>
        {leg.side === "lay" && leg.liability !== undefined
          ? `mise ${euros(leg.stake)} (risque ${euros(leg.liability)})`
          : `mise ${euros(leg.stake)}`}
        {leg.size !== undefined && leg.size < THIN_SIZE && (
          <span className={styles.thinSize}> · seulement {euros(leg.size)} à layer</span>
        )}
      </span>
    </li>
  );
}

// The surebets of the value bets' category, above its value bets: one row
// per market whose best prices guarantee a profit, with the bets to place for
// 100 € and what they return. Over 110 %, "à vérifier": most likely two
// different rules or lines, or an old price. On a phone (useIsWide) the rows
// lay out as cards, the match's page at their foot (SurebetsTable.module.css).
export function SurebetsTable({
  surebets,
  matchHref,
  onOpenMatch,
  sportHref,
}: {
  surebets: Surebet[];
  matchHref?: (id: string) => string;
  onOpenMatch?: (id: string) => void;
  // Where a match with no other market leads: its sport's page (EventTitle).
  sportHref?: (sport: string, q: string) => string;
}) {
  const wide = useIsWide();
  const now = new Date();
  return (
    <section className={groupStyles.section} aria-labelledby="surebets-heading">
      <h2 id="surebets-heading" className={groupStyles.heading}>
        <span aria-hidden="true">⚖️</span> Surebets
      </h2>
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col" className={styles.startHead}>
              Début
            </th>
            <th scope="col">Match</th>
            <th scope="col">Paris pour 100 €</th>
            <th scope="col" className={styles.rateHead}>
              TRJ<span className="visually-hidden"> (taux de retour)</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {surebets.map((surebet) => {
            const start = formatStartParts(surebet.startTime, now);
            const teams = surebet.participants.join(" - ");
            const legsKey = surebet.legs.map((l) => `${l.selection}@${l.source}:${l.side}`).join("|");
            const hasPage = matchHref !== undefined && surebet.marketCount > 1;
            const open = (e: MouseEvent<HTMLAnchorElement>) => {
              if (!onOpenMatch || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
              e.preventDefault();
              onOpenMatch(surebet.eventId);
            };
            return (
              <tr key={`${surebet.eventId}:${surebet.market}:${legsKey}`} className={styles.row} data-kind={surebet.kind}>
                <td className={styles.start}>
                  <time dateTime={surebet.startTime}>
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
                    eventId={surebet.eventId}
                    sport={surebet.sport}
                    title={teams}
                    matchHref={matchHref}
                    onOpenMatch={onOpenMatch}
                    sportHref={sportHref}
                  />
                  <span className={styles.market}>{surebet.marketLabel}</span>
                  {wide && hasPage && (
                    <a
                      className={styles.more}
                      href={matchHref(surebet.eventId)}
                      aria-label={`+${surebet.marketCount - 1} marchés pour ${teams}`}
                      onClick={open}
                    >
                      +{surebet.marketCount - 1} marchés
                    </a>
                  )}
                </td>
                <td className={styles.legs} data-label="Paris pour 100 €">
                  <ul className={styles.legList}>
                    {surebet.legs.map((leg) => (
                      <Leg key={`${leg.selection}@${leg.source}:${leg.side}`} leg={leg} />
                    ))}
                  </ul>
                </td>
                <td className={styles.rate} title={KIND_TITLES[surebet.kind]}>
                  <strong className={styles.rateValue}>{formatPayoutRate(surebet.payoutRate)}</strong>
                  <span className={styles.profit}>+{euros(surebet.profit)}</span>
                  {surebet.toVerify && <span className={styles.toVerify}>à vérifier</span>}
                  {surebet.thin && <span className={styles.toVerify}>liquidité limitée</span>}
                  <span className={styles.kind}>{KIND_LABELS[surebet.kind]}</span>
                </td>
                {!wide && hasPage && (
                  <td className={styles.actions}>
                    <a className={styles.allMarkets} href={matchHref(surebet.eventId)} onClick={open}>
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
