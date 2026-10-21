import type { MouseEvent } from "react";
import { ChevronRight } from "lucide-react";
import type { Surebet, SurebetLeg } from "./types";
import { formatPayoutRate, formatPrice, formatStartParts } from "./format";
import { BOOKMAKER_BRANDING } from "./bookmakers";
import { BookmakerLogo } from "./BookmakerLogo";
import { EventTitle } from "./components/EventTitle";
import { CheckAtBookmaker } from "./components/CheckAtBookmaker";
import { useIsWide } from "./useMediaQuery";
import groupStyles from "./GroupedOddsTables.module.css";
import styles from "./SurebetsTable.module.css";

// The exchange's legs, beside the bookmakers' (src/db/surebets.ts).
const EXCHANGE = "exchange";
const sourceName = (source: string) => (source === EXCHANGE ? "Börse" : (BOOKMAKER_BRANDING[source]?.name ?? source));
// "10,67 €", with a no-break space.
const euros = (amount: number) => `${amount.toFixed(2).replace(".", ",")}\u00a0€`;
// What a lay offers under which the surebet is thin (SUREBET_MIN_SIZE).
const THIN_SIZE = 20;

// Said in the card, not in a tooltip only: a finger can't bring one up.
const KIND_LABELS: Record<Surebet["kind"], string> = {
  bookmakers: "Zwischen Buchmachern",
  exchange: "Mit der Börse",
  lay: "Lay an der Börse",
};

const KIND_TITLES: Record<Surebet["kind"], string> = {
  bookmakers: "Zwischen den Buchmachern: die beste Quote jedes Ausgangs",
  exchange: "Mit der Börse: ihre Quote abzüglich 3\u00a0% Provision",
  lay: "Beim Buchmacher gesetzt, an der Börse gelayt: 3\u00a0% Provision inbegriffen. Unter 20\u00a0€ zum Layen gilt der Gewinn nur für diesen Betrag",
};

// One bet of a surebet: where, at what price, and how much (out of 100 € in
// all; a lay's stake and what it risks); a bookmaker's, the match's page there
// when the API gives it, to check the price before betting.
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
          ? `Einsatz ${euros(leg.stake)} (Haftung ${euros(leg.liability)})`
          : `Einsatz ${euros(leg.stake)}`}
        {leg.size !== undefined && leg.size < THIN_SIZE && (
          <span className={styles.thinSize}> · nur {euros(leg.size)} zum Layen</span>
        )}
      </span>
      <span className={styles.legCheck}>
        {leg.source !== EXCHANGE && <CheckAtBookmaker bookmaker={leg.source} url={leg.url} />}
      </span>
    </li>
  );
}

// The surebets of the value bets' category, above its value bets: one row
// per market whose best prices guarantee a profit, with the bets to place for
// 100 € and what they return. Over 110 %, "to verify": most likely two
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
              Anstoß
            </th>
            <th scope="col">Spiel</th>
            <th scope="col">Wetten für 100&nbsp;€</th>
            <th scope="col" className={styles.rateHead}>
              Auszahlung
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
                      aria-label={`+${surebet.marketCount - 1} ${surebet.marketCount === 2 ? "Markt" : "Märkte"} für ${teams}`}
                      onClick={open}
                    >
                      +{surebet.marketCount - 1} {surebet.marketCount === 2 ? "Markt" : "Märkte"}
                    </a>
                  )}
                </td>
                <td className={styles.legs} data-label={"Wetten für 100\u00a0€"}>
                  <ul className={styles.legList}>
                    {surebet.legs.map((leg) => (
                      <Leg key={`${leg.selection}@${leg.source}:${leg.side}`} leg={leg} />
                    ))}
                  </ul>
                </td>
                <td className={styles.rate} title={KIND_TITLES[surebet.kind]}>
                  <strong className={styles.rateValue}>{formatPayoutRate(surebet.payoutRate)}</strong>
                  <span className={styles.profit}>+{euros(surebet.profit)}</span>
                  {surebet.toVerify && <span className={styles.toVerify}>zu prüfen</span>}
                  {surebet.thin && <span className={styles.toVerify}>geringe Liquidität</span>}
                  <span className={styles.kind}>{KIND_LABELS[surebet.kind]}</span>
                </td>
                {!wide && hasPage && (
                  <td className={styles.actions}>
                    <a className={styles.allMarkets} href={matchHref(surebet.eventId)} onClick={open}>
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
