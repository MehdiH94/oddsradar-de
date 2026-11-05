import { useEffect, useRef, useState, type CSSProperties } from "react";
import { ArrowLeft, ChevronDown } from "lucide-react";
import { fetchEventDetail } from "./api";
import type { EventDetail, SectionDetail } from "./types";
import { ALL_BOOKMAKERS, BOOKMAKER_BRANDING } from "./bookmakers";
import { formatStartParts } from "./format";
import { sportEmoji } from "./sports";
import { APP_NAME } from "./brand";
import { BookmakerMenu } from "./components/BookmakerMenu";
import { MarketCard } from "./components/MarketCard";
import { CheckAtBookmaker } from "./components/CheckAtBookmaker";
import { BookmakerLogo } from "./BookmakerLogo";
import { EmptyState, ErrorBanner, Skeleton } from "./components/StatusViews";
import styles from "./MatchPage.module.css";
import { TakenOnMatch } from "./TakenOnMatch";
import type { TakenSurebets } from "./takenSurebets";
import type { TakenValueBets } from "./takenValueBets";

const POLL_MS = 60_000;

// Collapsed at first: the markets only one bookmaker offers, nothing to
// compare in them (a section keyed by the bookmaker, src/markets/catalog.ts).
const FOLDED_SECTIONS = new Set<string>(["winamax", "betclic", ...ALL_BOOKMAKERS]);

export interface PageStatus {
  updated?: Date;
  refreshing: boolean;
  failed: boolean;
}

function Section({
  section,
  bookmakers,
  open,
  onToggle,
}: {
  section: SectionDetail;
  bookmakers: readonly string[];
  open: boolean;
  onToggle: () => void;
}) {
  const headingId = `section-${section.key}`;
  const bodyId = `section-${section.key}-markets`;
  const count = section.markets.length;
  return (
    <section className={styles.section} aria-labelledby={headingId} id={`rubrique-${section.key}`}>
      <h3 id={headingId} className={styles.sectionHeading}>
        <button
          type="button"
          className={styles.toggle}
          aria-expanded={open}
          aria-controls={bodyId}
          aria-label={`${section.label}, ${count} ${count === 1 ? "Markt" : "Märkte"}`}
          onClick={onToggle}
        >
          {section.label}
          <span className={styles.count} aria-hidden="true">
            {count}
          </span>
          <ChevronDown size={18} className={styles.chevron} aria-hidden="true" />
        </button>
      </h3>
      <div
        id={bodyId}
        className={styles.markets}
        hidden={!open}
        // Each column is wide enough for one price per bookmaker (MatchPage.module.css).
        style={{ "--bookmakers": Math.max(1, bookmakers.length) } as CSSProperties}
      >
        {section.markets.map((market) => (
          <MarketCard key={market.key} market={market} bookmakers={bookmakers} />
        ))}
      </div>
    </section>
  );
}

// One match's every market, compared between the ticked bookmakers, in
// sections: Résultat, Buts, 1re mi-temps... It lives in the URL (?match=<id>)
// over the list's filters, which the back link returns to.
export function MatchPage({
  id,
  bookmakers,
  onBookmakersChange,
  backHref,
  backLabel = "Alle Spiele",
  onBack,
  competitionHref,
  onOpenCompetition,
  reloads,
  onStatus,
  takenSurebets,
  takenValueBets,
}: {
  id: string;
  // The account's taken surebets and value bets: those of this match show at
  // its top (TakenOnMatch).
  takenSurebets?: TakenSurebets;
  takenValueBets?: TakenValueBets;
  bookmakers: string[];
  onBookmakersChange: (bookmakers: string[]) => void;
  // The list's URL, for the back link to work as a link too.
  backHref: string;
  // What the back link leads to: the matches, or the value bets.
  backLabel?: string;
  onBack: () => void;
  // The competition's name leads to the matches' list narrowed to it: its
  // address, for the link to work as a link too, and what a click does.
  competitionHref?: (sport: string, competition: string) => string;
  onOpenCompetition?: (sport: string, competition: string) => void;
  // Bumped by the header's refresh button.
  reloads: number;
  onStatus: (status: PageStatus) => void;
}) {
  // undefined while loading, null once the API says it has no such match.
  const [detail, setDetail] = useState<EventDetail | null | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const [toggled, setToggled] = useState<Set<string>>(new Set());
  // Bumped by "Réessayer".
  const [retries, setRetries] = useState(0);
  // Sent only when some bookmakers are unticked, like the list's. A string, so
  // the effect below compares it by value.
  const bookmakersParam = bookmakers.length === ALL_BOOKMAKERS.length ? undefined : bookmakers.join(",");
  // The latest callback, without refetching each time App renders a new one.
  const statusRef = useRef(onStatus);
  useEffect(() => {
    statusRef.current = onStatus;
  });

  // The browser tab names the open match ("Bayern München – Arsenal ·
  // OddsBlitzer"), and gives the dashboard's title back when it closes.
  const tabTitle = detail ? `${detail.participants.join(" – ")} · ${APP_NAME}` : undefined;
  useEffect(() => {
    if (!tabTitle) return;
    const previous = document.title;
    document.title = tabTitle;
    return () => {
      document.title = previous;
    };
  }, [tabTitle]);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      statusRef.current({ refreshing: true, failed: false });
      fetchEventDetail(id, { bookmakers: bookmakersParam === undefined ? undefined : bookmakersParam.split(",").filter(Boolean) })
        .then((result) => {
          if (cancelled) return;
          setDetail(result);
          setFailed(false);
          statusRef.current({ updated: new Date(), refreshing: false, failed: false });
        })
        .catch((err) => {
          if (cancelled) return;
          console.error(err);
          setFailed(true);
          statusRef.current({ refreshing: false, failed: true });
        });
    };
    load();
    const interval = setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [id, bookmakersParam, reloads, retries]);

  const isOpen = (key: string) => FOLDED_SECTIONS.has(key) === toggled.has(key);
  const toggle = (key: string) =>
    setToggled((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  // From the section links: open it if folded, then go to it.
  function goToSection(key: string) {
    if (!isOpen(key)) toggle(key);
    requestAnimationFrame(() => {
      const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      document.getElementById(`rubrique-${key}`)?.scrollIntoView?.({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
    });
  }

  const back = (
    <a
      href={backHref}
      className={styles.back}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        onBack();
      }}
    >
      <ArrowLeft size={16} aria-hidden="true" />
      {backLabel}
    </a>
  );

  if (detail === undefined) {
    return (
      <div className={styles.page}>
        {back}
        {failed ? (
          <ErrorBanner onRetry={() => setRetries((n) => n + 1)}>
            Die Märkte dieses Spiels konnten nicht geladen werden.
          </ErrorBanner>
        ) : (
          <Skeleton />
        )}
      </div>
    );
  }

  if (detail === null) {
    return (
      <div className={styles.page}>
        {back}
        <EmptyState action={{ label: `${backLabel} anzeigen`, onClick: onBack }}>
          Dieses Spiel wird nicht mehr angeboten: Es hat begonnen, oder die Buchmacher haben es entfernt.
        </EmptyState>
      </div>
    );
  }

  const start = formatStartParts(detail.startTime, new Date());
  const title = detail.participants.join(" – ");
  // The ticked bookmakers whose page of the match the API gives, in the filter's order.
  const checks = ALL_BOOKMAKERS.filter((b) => bookmakers.includes(b) && detail.links?.[b]);
  return (
    <div className={styles.page}>
      {back}
      <header className={styles.header}>
        <div className={styles.heading}>
          <p className={styles.meta}>
            <span aria-hidden="true">{sportEmoji(detail.sport)}</span>{" "}
            {detail.competition && competitionHref && onOpenCompetition ? (
              <a
                href={competitionHref(detail.sport, detail.competitionFilter)}
                className={styles.competition}
                aria-label={`Spiele anzeigen: ${detail.competition}`}
                onClick={(e) => {
                  if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
                  e.preventDefault();
                  onOpenCompetition(detail.sport, detail.competitionFilter);
                }}
              >
                {detail.competition}
              </a>
            ) : (
              detail.competition
            )}
            {start && (
              <>
                {" · "}
                <time dateTime={detail.startTime}>
                  {start.day} {start.time}
                </time>
              </>
            )}
          </p>
          <h2 className={styles.title}>{title}</h2>
          <p className={styles.summary}>
            {detail.comparedCount} {detail.comparedCount === 1 ? "Markt" : "Märkte"} verglichen
            {detail.surebetCount > 0 && (
              <>
                {" · "}
                <strong className={styles.sure}>
                  {detail.surebetCount} Surebet{detail.surebetCount === 1 ? "" : "s"}
                </strong>
              </>
            )}
          </p>
        </div>
        <BookmakerMenu selected={bookmakers} onChange={onBookmakersChange} />
      </header>
      <TakenOnMatch eventId={id} surebets={takenSurebets} valueBets={takenValueBets} />

      {checks.length > 0 && (
        <ul className={styles.checks} aria-label="Das Spiel bei den Buchmachern">
          {checks.map((bookmaker) => (
            <li key={bookmaker} className={styles.check}>
              <BookmakerLogo bookmaker={bookmaker} size={16} decorative />
              <span>{BOOKMAKER_BRANDING[bookmaker]?.name ?? bookmaker}</span>
              <CheckAtBookmaker bookmaker={bookmaker} url={detail.links?.[bookmaker]} />
            </li>
          ))}
        </ul>
      )}

      {failed && (
        <ErrorBanner onRetry={() => setRetries((n) => n + 1)}>
          Die Märkte konnten nicht aktualisiert werden: Die angezeigten sind womöglich veraltet.
        </ErrorBanner>
      )}

      {bookmakers.length === 0 ? (
        <EmptyState action={{ label: "Alle Buchmacher auswählen", onClick: () => onBookmakersChange([...ALL_BOOKMAKERS]) }}>
          Wähle mindestens einen Buchmacher, um die Quoten zu vergleichen.
        </EmptyState>
      ) : (
        <>
          <nav className={styles.nav} aria-label="Rubriken">
            {detail.sections.map((section) => (
              <button key={section.key} type="button" className={styles.navItem} onClick={() => goToSection(section.key)}>
                {section.label}
              </button>
            ))}
          </nav>
          {detail.sections.map((section) => (
            <Section
              key={section.key}
              section={section}
              bookmakers={bookmakers}
              open={isOpen(section.key)}
              onToggle={() => toggle(section.key)}
            />
          ))}
        </>
      )}
    </div>
  );
}
