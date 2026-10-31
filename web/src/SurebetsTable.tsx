import { useState, type MouseEvent } from "react";
import { ChevronRight } from "lucide-react";
import type { Surebet, SurebetLeg } from "./types";
import { formatPayoutRate, formatPrice, formatStartParts, readAgo } from "./format";
import { BOOKMAKER_BRANDING } from "./bookmakers";
import { BookmakerLogo } from "./BookmakerLogo";
import { EventTitle } from "./components/EventTitle";
import { CheckAtBookmaker } from "./components/CheckAtBookmaker";
import { ExchangePrices } from "./components/ExchangePrices";
import { useIsWide } from "./useMediaQuery";
import { hasExchangeLeg, surebetKey, useTakenSurebets, type TakenSurebetsState } from "./takenSurebets";
import groupStyles from "./GroupedOddsTables.module.css";
import styles from "./SurebetsTable.module.css";

// Whether the surebets whose lay has under 20 € on it are shown: hidden unless
// asked for, since such a lay cannot take a real stake (the owner's backlog,
// #27). This browser remembers it; one that refuses its storage (a private
// window) asks again on the next visit.
const SHOW_THIN_KEY = "oddsblitzer.showThinLays";

function loadShowThin(): boolean {
  try {
    return localStorage.getItem(SHOW_THIN_KEY) === "1";
  } catch {
    return false;
  }
}

function saveShowThin(show: boolean): void {
  try {
    if (show) localStorage.setItem(SHOW_THIN_KEY, "1");
    else localStorage.removeItem(SHOW_THIN_KEY);
  } catch {
    // Nothing to do: the choice lasts as long as the page.
  }
}

// The exchange's legs, beside the bookmakers' (src/db/surebets.ts).
const EXCHANGE = "exchange";
const sourceName = (source: string) => (source === EXCHANGE ? "Börse" : (BOOKMAKER_BRANDING[source]?.name ?? source));
// "10,67 €", with a no-break space.
const euros = (amount: number) => `${amount.toFixed(2).replace(".", ",")}\u00a0€`;
// What a lay offers under which the surebet is thin (SUREBET_MIN_SIZE).
const THIN_SIZE = 20;
// A leg read this long before the surebet's newest is "älter": its price may
// have moved since. Over the 5-minute cycle and under the 15-minute markets
// cycle's, so that a market's normal lag is not flagged. The same as the
// API's STALE_LEG_MS (src/db/surebets.ts), whose surebets the alerts leave out.
const OLDER_LEG_MS = 10 * 60 * 1000;

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

// A surebet a leg of which is far out of line with the other sources'.
const SUSPECT_TITLE =
  "Eine Quote weicht stark von den anderen Quellen ab: vertauschte Teams, eine alte Quote oder ein anderes Spiel? Vor dem Wetten beim Buchmacher prüfen";

// When the surebet's most recently read leg was, in ms; none read, none.
const newestRead = (surebet: Surebet): number | undefined => {
  const times = surebet.legs.flatMap((l) => (l.readAt ? [Date.parse(l.readAt)] : []));
  return times.length > 0 ? Math.max(...times) : undefined;
};

// The other sources' price of the suspect's leg, for that leg only.
const suspectOthers = (surebet: Surebet, leg: SurebetLeg): number | undefined => {
  const s = surebet.suspect?.leg;
  return s && s.selection === leg.selection && s.source === leg.source && s.side === leg.side ? surebet.suspect!.others : undefined;
};

// One bet of a surebet: where, at what price, and how much (out of 100 € in
// all; a lay's stake and what it risks); a bookmaker's, the match's page there
// when the API gives it, to check the price before betting.
// `others`: the leg is the suspect's, out of line with the other sources'
// price, said under it.
// `newest`: when the surebet's most recently read leg was, and `now`, for how
// long ago this one was read and whether it is "älter".
function Leg({ leg, others, newest, now }: { leg: SurebetLeg; others?: number; newest?: number; now: Date }) {
  const older = leg.readAt !== undefined && newest !== undefined && newest - Date.parse(leg.readAt) > OLDER_LEG_MS;
  return (
    <li className={styles.leg} data-source={leg.source} data-side={leg.side} data-suspect={others !== undefined || undefined}>
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
        {others !== undefined && (
          <span className={styles.suspectNote}> · ⚠️ andere Quellen {formatPrice(others)}: Quote prüfen</span>
        )}
        {leg.readAt && (
          <span className={styles.readAt} title={`Quote gelesen: ${new Date(leg.readAt).toLocaleString("de-DE")}`}>
            {" "}
            · {readAgo(leg.readAt, now)}
            {older && <strong className={styles.older}> · älter</strong>}
          </span>
        )}
        {leg.source !== EXCHANGE && <ExchangePrices prices={leg.exchange} />}
      </span>
      <span className={styles.legCheck}>
        {leg.source !== EXCHANGE && <CheckAtBookmaker bookmaker={leg.source} url={leg.url} />}
      </span>
    </li>
  );
}

// Whether the account took the surebet ("Genommen", a toggle button), and,
// when one of its bets is at the exchange, its reminder an hour before
// kick-off to check that bet was matched there.
function TakenControls({
  teams,
  taken,
  remind,
  exchange,
  onTaken,
  onRemind,
}: {
  teams: string;
  taken: boolean;
  remind: boolean;
  exchange: boolean;
  onTaken: (taken: boolean) => void;
  onRemind: (remind: boolean) => void;
}) {
  return (
    <span className={styles.takenControls}>
      <button
        type="button"
        className={styles.takenButton}
        aria-pressed={taken}
        aria-label={`Genommen: ${teams}`}
        title={taken ? "Als nicht genommen markieren" : "Als genommen markieren"}
        onClick={() => onTaken(!taken)}
      >
        {taken ? "✓ Genommen" : "Genommen?"}
      </button>
      {taken && exchange && (
        <label className={styles.remind} title="Eine E-Mail eine Stunde vor Anstoß: prüfen, ob die Börsenwette gematcht ist">
          <input type="checkbox" checked={remind} onChange={(e) => onRemind(e.target.checked)} /> Erinnerung 1&nbsp;Std. vorher
        </label>
      )}
    </span>
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
  takenSurebets,
}: {
  surebets: Surebet[];
  // The dashboard's taken surebets, shared with "Meine Surebets"; read here when not given.
  takenSurebets?: TakenSurebetsState;
  matchHref?: (id: string) => string;
  onOpenMatch?: (id: string) => void;
  // Where a match with no other market leads: its sport's page (EventTitle).
  sportHref?: (sport: string, q: string) => string;
}) {
  const wide = useIsWide();
  const now = new Date();
  const [showThin, setShowThin] = useState(loadShowThin);
  // The ones the account took: greyed and last (src/takenSurebets.ts).
  const own = useTakenSurebets(!takenSurebets);
  const { taken, setTaken, setRemind } = takenSurebets ?? own;
  const thinCount = surebets.filter((s) => s.thin).length;
  const visible = showThin ? surebets : surebets.filter((s) => !s.thin);
  const shown = [...visible.filter((s) => !taken.has(surebetKey(s))), ...visible.filter((s) => taken.has(surebetKey(s)))];
  return (
    <section className={groupStyles.section} aria-labelledby="surebets-heading">
      <h2 id="surebets-heading" className={groupStyles.heading}>
        <span aria-hidden="true">⚖️</span> Surebets
      </h2>
      {thinCount > 0 && (
        <label className={styles.thinToggle}>
          <input
            type="checkbox"
            checked={showThin}
            onChange={(e) => {
              setShowThin(e.target.checked);
              saveShowThin(e.target.checked);
            }}
          />{" "}
          Auch dünne Lays zeigen ({thinCount}): unter {THIN_SIZE}&nbsp;€ zum Layen
        </label>
      )}
      {shown.length === 0 && <p className={styles.allThin}>Gerade nur Surebets mit dünnen Lays, ausgeblendet.</p>}
      {shown.length > 0 && (
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
            {shown.map((surebet) => {
              const start = formatStartParts(surebet.startTime, now);
              const teams = surebet.participants.join(" - ");
              const key = surebetKey(surebet);
              const mark = taken.get(key);
              const hasPage = matchHref !== undefined && surebet.marketCount > 1;
              const open = (e: MouseEvent<HTMLAnchorElement>) => {
                if (!onOpenMatch || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
                e.preventDefault();
                onOpenMatch(surebet.eventId);
              };
              return (
                <tr
                  key={key}
                  className={styles.row}
                  data-kind={surebet.kind}
                  data-suspect={surebet.suspect ? true : undefined}
                  data-taken={mark ? true : undefined}
                >
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
                        <Leg
                          key={`${leg.selection}@${leg.source}:${leg.side}`}
                          leg={leg}
                          others={suspectOthers(surebet, leg)}
                          newest={newestRead(surebet)}
                          now={now}
                        />
                      ))}
                    </ul>
                  </td>
                  <td className={styles.rate} title={KIND_TITLES[surebet.kind]}>
                    <strong className={styles.rateValue}>{formatPayoutRate(surebet.payoutRate)}</strong>
                    <span className={styles.profit}>+{euros(surebet.profit)}</span>
                    {surebet.suspect && (
                      <span className={styles.toVerify} title={SUSPECT_TITLE}>
                        ⚠️ verdächtig
                      </span>
                    )}
                    {surebet.toVerify && !surebet.suspect && <span className={styles.toVerify}>zu prüfen</span>}
                    {surebet.thin && <span className={styles.toVerify}>geringe Liquidität</span>}
                    <span className={styles.kind}>{KIND_LABELS[surebet.kind]}</span>
                    <TakenControls
                      teams={teams}
                      taken={mark !== undefined}
                      remind={mark?.remind ?? false}
                      exchange={hasExchangeLeg(surebet)}
                      onTaken={(value) => setTaken(surebet, value)}
                      onRemind={(value) => setRemind(surebet, value)}
                    />
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
      )}
    </section>
  );
}
