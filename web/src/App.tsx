// web/src/App.tsx
import { useEffect, useRef, useState } from "react";
import {
  fetchCompetitions,
  fetchEvents,
  fetchEventSuggestions,
  fetchFirstEvents,
  fetchSports,
  fetchValueBets,
  PAGE_SIZE,
  type EventSort,
} from "./api";
import { GroupedOddsTables } from "./GroupedOddsTables";
import { ValueBetsTable } from "./ValueBetsTable";
import { SurebetsTable } from "./SurebetsTable";
import { MyTakenSurebets } from "./MyTakenSurebets";
import { useTakenSurebets } from "./takenSurebets";
import { useTakenValueBets } from "./takenValueBets";
import { MyTakenValueBets } from "./MyTakenValueBets";
import { MatchPage, type PageStatus } from "./MatchPage";
import { AppHeader } from "./components/AppHeader";
import { GamblingBanner } from "./components/GamblingBanner";
import { AppFooter } from "./components/AppFooter";
import { AppNav, type View } from "./components/AppNav";
import { FilterBar } from "./components/FilterBar";
import { FilterSheet } from "./components/FilterSheet";
import { LoadMore } from "./components/LoadMore";
import { Pagination } from "./components/Pagination";
import { ResultsSummary } from "./components/ResultsSummary";
import { ReferenceNote } from "./components/ReferenceNote";
import { WelcomeNote } from "./components/WelcomeNote";
import { EmptyState, ErrorBanner, Skeleton } from "./components/StatusViews";
import { ALL_BOOKMAKERS, DEFAULT_BOOKMAKERS, isDefaultBookmakers } from "./bookmakers";
import { DEFAULT_SPORT, readUrlFilters, urlFiltersQuery } from "./urlFilters";
import { useFavoriteSports } from "./favoriteSports";
import { mergeInitialFilters, type Preferences } from "./preferences";
import { usePreferencesSync } from "./usePreferencesSync";
import { hasMarkets, hasReference, VALUE_BETS } from "./sports";
import { formatPercent } from "./format";
import { PLAYER_VALUE_MIN_EDGE, VALUE_MIN_EDGE } from "./value";
import { useIsWide } from "./useMediaQuery";
import { FREEBETS_PATH, navigate, PROMOS_PATH } from "./routes";
import type { EventWithOdds, Surebet, ValueBet } from "./types";
import styles from "./App.module.css";

const POLL_MS = 30_000;
const SEARCH_DEBOUNCE_MS = 250;
const MIN_SUGGESTION_QUERY_LENGTH = 2;
const MAX_SUGGESTIONS = 10;
const TIME_FORMAT = new Intl.DateTimeFormat("de-DE",{ hour: "2-digit", minute: "2-digit" });
// The phone's list grows by this many with "Voir plus", up to the API's last.
const MAX_SHOWN = 500;
const FILTER_SHEET_ID = "filter-sheet";

// `preferences` are the account's saved filters and favorites, when the server
// has some (Root loads them before drawing the dashboard).
export function App({ preferences = null }: { preferences?: Preferences | null } = {}) {
  // A phone first: the filters in a sheet, the list growing with "Voir plus".
  // From 768 px, the filter bar's menus and numbered pages (useIsWide).
  const wide = useIsWide();
  // The filters and the page start from the URL, so a reload or a shared link
  // shows the same view (see the effect writing them back below). An address
  // that names no filter gets the account's saved ones instead.
  const [initial] = useState(() => mergeInitialFilters(window.location.search, preferences));
  const [events, setEvents] = useState<EventWithOdds[]>([]);
  // The value bets' category's list; null while the list shown is a sport's.
  const [bets, setBets] = useState<ValueBet[] | null>(null);
  // Its surebets (SurebetsTable), above its value bets.
  const [surebets, setSurebets] = useState<Surebet[]>([]);
  // The surebets the account took, shared by the surebets' table and "Meine Surebets".
  const takenSurebets = useTakenSurebets();
  const takenValueBets = useTakenValueBets();
  const [total, setTotal] = useState(0);
  const [pageSize, setPageSize] = useState(20);
  const [sport, setSport] = useState<string>(initial.sport);
  const [sort, setSort] = useState<EventSort>(initial.sort);
  const [sports, setSports] = useState<string[]>([]);
  // Starred with the account, not in the URL: not a filter either (the reset
  // button leaves them).
  const favoriteSports = useFavoriteSports(sports, preferences?.favoriteSports);
  const [page, setPage] = useState(initial.page);
  // The phone's: how many matches are shown. A link to page 3 shows the first
  // three pages' worth.
  const [limit, setLimit] = useState(() => Math.min(MAX_SHOWN, Math.max(1, initial.page) * PAGE_SIZE));
  const [sheetOpen, setSheetOpen] = useState(false);
  const [bookmakers, setBookmakers] = useState<string[]>(initial.bookmakers);
  const [players, setPlayers] = useState(initial.players ?? false);
  // Only one competition's matches and winner ("" for every one), and the
  // competitions the sport shown has (CompetitionMenu), with the sport they are
  // the competitions of.
  const [competition, setCompetition] = useState(initial.competition ?? "");
  const [competitionList, setCompetitionList] = useState<{ sport: string; names: string[] }>({ sport: "", names: [] });
  // `search` follows every keystroke; `query` is its debounced value, the one
  // actually sent to the API. Both start from the URL's: a query arriving only
  // after the debounce would count as a new search and drop the URL's page.
  const [search, setSearch] = useState(initial.q);
  const [query, setQuery] = useState(initial.q);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  // How fresh the table is (AppHeader): when the last answer came, whether a
  // request is on its way, whether the last one failed. `reloads` counts the
  // refresh button's clicks, to fetch again at once.
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloads, setReloads] = useState(0);
  // A match's page open over the list (?match=<id>), and how fresh it is.
  const [matchId, setMatchId] = useState<string | null>(initial.match ?? null);
  const [matchStatus, setMatchStatus] = useState<PageStatus>({ refreshing: false, failed: false });
  // Only sent when some bookmakers are unticked: they change every TRJ, and so
  // the TRJ order. A string, so the effects below compare it by value.
  const bookmakersParam = bookmakers.length === ALL_BOOKMAKERS.length ? undefined : bookmakers.join(",");
  // Only the matches with players' markets: for the sports that have some.
  const playersFilter = players && hasMarkets(sport);
  // The value bets' category (ValueBetsTable): sorted by value unless by
  // kick-off, on one page.
  const isValueBets = sport === VALUE_BETS;
  // The value bets are every competition's: the filter is not theirs.
  const competitionFilter = isValueBets ? "" : competition;
  const competitions = competitionList.sport === sport ? competitionList.names : [];
  // The sort by value for the sports the reference prices; elsewhere it falls
  // back to the TRJ's.
  const effectiveSort: EventSort = isValueBets
    ? sort === "start"
      ? "start"
      : "value"
    : sort === "value" && !hasReference(sport)
      ? "trj"
      : sort;
  const sortOrders: EventSort[] = isValueBets
    ? ["value", "start"]
    : hasReference(sport)
      ? ["trj", "start", "value"]
      : ["trj", "start"];
  // The phone's list has no pages: its URL keeps none.
  const shownPage = isValueBets || !wide ? 1 : page;
  // The sport the "Matchs" tab returns to from the value bets.
  const [lastSport, setLastSport] = useState<string | null>(isValueBets ? null : initial.sport);
  const previousFiltersRef = useRef(JSON.stringify([sport, query, effectiveSort, bookmakersParam, playersFilter, competitionFilter]));
  const resultsRef = useRef<HTMLElement>(null);

  useEffect(() => {
    fetchSports()
      .then((list) => {
        setSports(list);
        // No listable match for this sport right now (no football today, or an
        // old link): switch to football, else to the first sport that has
        // some, rather than an empty table under a sport the select can't even
        // display. There is no "every sport" choice to fall back on.
        setSport((current) => {
          if (current === VALUE_BETS || list.includes(current) || list.length === 0) return current;
          return list.includes(DEFAULT_SPORT) ? DEFAULT_SPORT : list[0];
        });
      })
      .catch(console.error);
  }, []);

  // The account keeps the filters and the favorites (not the search, the page
  // nor the open match). Once the sports are in: the sport may be corrected
  // above, and that is not the visitor's choice.
  usePreferencesSync(
    { sport, sort, bookmakers, players, favoriteSports: favoriteSports.favorites },
    sports.length > 0,
  );

  useEffect(() => {
    const timeout = setTimeout(() => setQuery(search.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timeout);
  }, [search]);

  useEffect(() => {
    const qs = urlFiltersQuery({
      sport,
      sort: effectiveSort,
      q: query,
      bookmakers,
      players: playersFilter,
      ...(competitionFilter ? { competition: competitionFilter } : {}),
      page: shownPage,
      ...(matchId ? { match: matchId } : {}),
    });
    // replaceState: a filter change adds no history entry, so Back still
    // leaves the page instead of stepping through every past filter.
    if (window.location.search !== `?${qs}`) window.history.replaceState(window.history.state, "", `?${qs}`);
  }, [sport, effectiveSort, query, bookmakers, playersFilter, competitionFilter, shownPage, matchId]);

  // Back and Forward between the list and a match's page.
  useEffect(() => {
    const onPopState = () => setMatchId(readUrlFilters(window.location.search).match ?? null);
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    // The value bets' suggestions are their own matches (below).
    if (query.length < MIN_SUGGESTION_QUERY_LENGTH || isValueBets) return;
    let cancelled = false;
    fetchEventSuggestions({ q: query, sport: sport || undefined, kind: "all", competition: competitionFilter || undefined })
      .then((result) => {
        if (!cancelled) setSuggestions(result);
      })
      .catch((err) => {
        if (!cancelled) console.error(err);
      });
    return () => {
      cancelled = true;
    };
  }, [query, sport, isValueBets, competitionFilter]);

  // The sport's competitions, for the filter: again at each refresh.
  useEffect(() => {
    if (isValueBets) return;
    let cancelled = false;
    fetchCompetitions(sport)
      .then((names) => {
        if (!cancelled) setCompetitionList({ sport, names });
      })
      .catch((err) => {
        if (!cancelled) console.error(err);
      });
    return () => {
      cancelled = true;
    };
  }, [sport, isValueBets, reloads]);

  useEffect(() => {
    // The list waits behind a match's page, which polls on its own.
    if (matchId) return;
    // Set by this run's cleanup, i.e. once a filter/page changes (or on unmount).
    // A request from a superseded run can still resolve after the current
    // run's own response -- without this check it would then overwrite the
    // table with the old sport/page's data until the next poll, up to
    // POLL_MS later.
    let cancelled = false;

    // A sport, search, sort, bookmaker or markets change invalidates whatever page we
    // were on (a bookmaker change reorders a TRJ sort). We must
    // not fetch the new filters with the old page number, so the effective
    // page for THIS fetch is computed directly rather than waiting for `page`
    // state to catch up (setPage below only takes effect on the next commit).
    const filters = JSON.stringify([sport, query, effectiveSort, bookmakersParam, playersFilter, competitionFilter]);
    const filtersChanged = previousFiltersRef.current !== filters;
    previousFiltersRef.current = filters;
    const effectivePage = filtersChanged ? 1 : page;
    if (filtersChanged && page !== 1) setPage(1);
    const effectiveLimit = filtersChanged ? PAGE_SIZE : limit;
    if (filtersChanged && limit !== PAGE_SIZE) setLimit(PAGE_SIZE);

    // The sport's matches, with the winners of its competitions, narrowed to a
    // competition when one is chosen.
    const matchesListing = {
      sport: sport || undefined,
      kind: "all" as const,
      competition: competitionFilter || undefined,
    };

    const load = () => {
      setRefreshing(true);
      const request = isValueBets
        ? fetchValueBets({
            q: query || undefined,
            sort: effectiveSort === "start" ? "start" : "value",
            bookmakers: bookmakersParam?.split(",").filter(Boolean),
          }).then((result) => {
            if (cancelled) return;
            setBets(result.bets);
            setSurebets(result.surebets ?? []);
            setTotal(result.total);
            setLastUpdated(new Date());
            setLoadFailed(false);
          })
        : (wide
            ? fetchEvents({
                ...matchesListing,
                q: query || undefined,
                sort: effectiveSort,
                bookmakers: bookmakersParam?.split(",").filter(Boolean),
                players: playersFilter,
                page: effectivePage,
              })
            : fetchFirstEvents({
                ...matchesListing,
                q: query || undefined,
                sort: effectiveSort,
                bookmakers: bookmakersParam?.split(",").filter(Boolean),
                players: playersFilter,
                count: effectiveLimit,
              })
          ).then((result) => {
            if (cancelled) return;
            // A page past the end (an old link, or matches that started since)
            // would show nothing, with no pager to go back: go to the last one.
            const lastPage = Math.max(1, Math.ceil(result.total / result.pageSize));
            if (wide && effectivePage > lastPage) {
              setPage(lastPage);
              return;
            }
            setBets(null);
            setEvents(result.events);
            setTotal(result.total);
            setPageSize(result.pageSize);
            setLastUpdated(new Date());
            setLoadFailed(false);
          });
      return request
        .catch((err) => {
          if (cancelled) return;
          console.error(err);
          setLoadFailed(true);
        })
        .finally(() => {
          if (!cancelled) setRefreshing(false);
        });
    };
    load();
    const interval = setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [sport, isValueBets, query, effectiveSort, bookmakersParam, playersFilter, competitionFilter, page, limit, wide, reloads, matchId]);

  // In the value bets' category, the matches of the surebets and bets found.
  const visibleSuggestions =
    query.length < MIN_SUGGESTION_QUERY_LENGTH
      ? []
      : isValueBets
        ? [...new Set([...surebets, ...(bets ?? [])].map((bet) => bet.participants.join(" - ")))].slice(0, MAX_SUGGESTIONS)
        : suggestions;
  // The list shown is the one asked for: a sport's matches, or the value bets.
  // Switching between the two shows placeholder rows until it arrives.
  const loaded = lastUpdated !== null && (bets !== null) === isValueBets;
  // The sport "Réinitialiser" goes back to: football, else the first sport
  // with odds, like the fallback above.
  const defaultSport = sports.includes(DEFAULT_SPORT) || sports.length === 0 ? DEFAULT_SPORT : sports[0];
  // The value bets are a list of their own (AppNav): resetting their filters
  // keeps them, it doesn't go back to football.
  const filtersAreDefault =
    (isValueBets ? effectiveSort === "value" : sport === defaultSport && effectiveSort === "trj") &&
    search === "" &&
    isDefaultBookmakers(bookmakers) &&
    !playersFilter &&
    competitionFilter === "";
  // The phone's "Filtres" badge: the filters in its sheet that differ from
  // their default (the sports and the search are in sight).
  const activeFilters =
    Number(effectiveSort !== (isValueBets ? "value" : "trj")) +
    Number(!isDefaultBookmakers(bookmakers)) +
    Number(playersFilter) +
    Number(competitionFilter !== "");
  const view: View = isValueBets ? "value-bets" : "matches";

  function reload() {
    setReloads((n) => n + 1);
  }

  // A new page starts at the top of the results, when they were scrolled
  // past (not if the list's top is already in view).
  function goToPage(next: number) {
    setPage(next);
    const results = resultsRef.current;
    if (results && results.getBoundingClientRect().top < 0) {
      const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      results.scrollIntoView?.({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
    }
  }

  const shownFilters = {
    sport,
    sort: effectiveSort,
    q: query,
    bookmakers,
    players: playersFilter,
    ...(competitionFilter ? { competition: competitionFilter } : {}),
    page: shownPage,
  };
  const listHref = `?${urlFiltersQuery(shownFilters)}`;
  const matchHref = (id: string) => `?${urlFiltersQuery({ ...shownFilters, match: id })}`;
  // A sport's page searched on one event, with the ticked bookmakers kept: where
  // a value bet or a surebet's title leads when its match has no page of its own.
  const sportHref = (sportKey: string, q: string) =>
    `?${urlFiltersQuery({ sport: sportKey, sort: "trj", q, bookmakers, page: 1 })}`;
  const busy = matchId ? matchStatus.refreshing && !matchStatus.updated : !loaded && !loadFailed;

  // A match's competition: the matches' list narrowed to it, a sport's page
  // with the ticked bookmakers kept.
  const competitionHref = (sportKey: string, name: string) =>
    `?${urlFiltersQuery({ sport: sportKey, sort: "trj", q: "", bookmakers, competition: name, page: 1 })}`;

  // The competition's link, followed in the page: a new history entry, so that
  // Back returns to the match.
  function openCompetition(sportKey: string, name: string) {
    window.history.pushState(null, "", competitionHref(sportKey, name));
    setMatchId(null);
    setSport(sportKey);
    setCompetition(name);
    setSearch("");
    setSort("trj");
    setPage(1);
    window.scrollTo?.({ top: 0 });
  }

  // A match's page is a new history entry: Back returns to the list.
  function openMatch(id: string) {
    window.history.pushState({ oddsblitzerMatch: true }, "", matchHref(id));
    setMatchStatus({ refreshing: true, failed: false });
    setMatchId(id);
    window.scrollTo?.({ top: 0 });
  }

  function closeMatch() {
    // Opened from the list: going back keeps the browser's history in step.
    if ((window.history.state as { oddsblitzerMatch?: boolean } | null)?.oddsblitzerMatch) {
      window.history.back();
    } else {
      setMatchId(null);
    }
  }

  function changeView(next: View) {
    // The Freebets and Promos pages are pages of their own, not lists of this one.
    if (next === "freebets" || next === "promos") {
      navigate(next === "freebets" ? FREEBETS_PATH : PROMOS_PATH);
      return;
    }
    // Back to the list, from a match's page too.
    if (matchId) setMatchId(null);
    if (next === "value-bets") {
      if (!isValueBets) setLastSport(sport);
      setSport(VALUE_BETS);
    } else if (isValueBets) setSport(lastSport ?? defaultSport);
    window.scrollTo?.({ top: 0 });
  }

  // A sport's competitions are not another's.
  function changeSport(next: string) {
    setSport(next);
    setCompetition("");
  }

  function resetFilters() {
    if (!isValueBets) setSport(defaultSport);
    setCompetition("");
    setSort("trj");
    setSearch("");
    setBookmakers([...DEFAULT_BOOKMAKERS]);
    setPlayers(false);
  }

  // The sheet's: its own filters only, the list shown stays (the value bets
  // stay the value bets).
  function resetSheetFilters() {
    setCompetition("");
    setSort("trj");
    setBookmakers([...DEFAULT_BOOKMAKERS]);
    setPlayers(false);
  }

  const nav = (
    <AppNav
      view={view}
      onChange={changeView}
      placement={wide ? "header" : "bar"}
      filters={
        wide || matchId
          ? undefined
          : { count: activeFilters, open: sheetOpen, onOpen: () => setSheetOpen(true), controls: FILTER_SHEET_ID }
      }
    />
  );
  const shownCount = isValueBets ? total + surebets.length : total;
  const resultsLabel = !loaded ? "Ergebnisse anzeigen" : shownCount === 1 ? "1 Ergebnis anzeigen" : `${shownCount} Ergebnisse anzeigen`;

  return (
    <div className={wide ? styles.app : `${styles.app} ${styles.withBar}`}>
      <GamblingBanner sportsBetting={Boolean(matchId)} />
      <AppHeader
        lastUpdated={matchId ? (matchStatus.updated ?? null) : lastUpdated}
        refreshing={matchId ? matchStatus.refreshing : refreshing}
        failed={matchId ? matchStatus.failed : loadFailed}
        onRefresh={reload}
      >
        {wide && nav}
      </AppHeader>
      {!matchId && (
        <FilterBar
          wide={wide}
          sports={isValueBets ? undefined : sports}
          favoriteSports={favoriteSports.favorites}
          onToggleFavoriteSport={favoriteSports.toggle}
          canAddFavoriteSport={favoriteSports.canAdd}
          sport={sport}
          onSportChange={changeSport}
          search={search}
          suggestions={visibleSuggestions}
          onSearchChange={setSearch}
          sort={effectiveSort}
          sortOrders={sortOrders}
          onSortChange={setSort}
          bookmakers={bookmakers}
          onBookmakersChange={setBookmakers}
          players={players}
          onPlayersChange={hasMarkets(sport) ? setPlayers : undefined}
          competition={competitionFilter}
          competitions={isValueBets ? undefined : competitions}
          onCompetitionChange={setCompetition}
          onReset={filtersAreDefault ? undefined : resetFilters}
        />
      )}
      {!wide && !matchId && (
        <FilterSheet
          id={FILTER_SHEET_ID}
          open={sheetOpen}
          onClose={() => setSheetOpen(false)}
          resultsLabel={resultsLabel}
          sort={effectiveSort}
          sortOrders={sortOrders}
          onSortChange={setSort}
          bookmakers={bookmakers}
          onBookmakersChange={setBookmakers}
          players={players}
          onPlayersChange={hasMarkets(sport) ? setPlayers : undefined}
          sport={sport}
          competition={competitionFilter}
          competitions={isValueBets ? undefined : competitions}
          onCompetitionChange={setCompetition}
          sports={isValueBets ? undefined : sports}
          favoriteSports={favoriteSports.favorites}
          onToggleFavoriteSport={favoriteSports.toggle}
          canAddFavoriteSport={favoriteSports.canAdd}
          onReset={activeFilters > 0 ? resetSheetFilters : undefined}
        />
      )}

      <main className={styles.main} ref={resultsRef} aria-busy={busy}>
        <h1 className="visually-hidden">Quotenvergleich und Value Bets</h1>
        {matchId ? (
          <MatchPage
            id={matchId}
            bookmakers={bookmakers}
            onBookmakersChange={setBookmakers}
            backHref={listHref}
            backLabel={isValueBets ? "Alle Value Bets" : undefined}
            onBack={closeMatch}
            competitionHref={competitionHref}
            onOpenCompetition={openCompetition}
            reloads={reloads}
            onStatus={(status) => setMatchStatus((current) => ({ ...current, ...status }))}
          />
        ) : (
          <>
            {loadFailed && (
              <ErrorBanner onRetry={reload}>
                {!loaded || lastUpdated === null
                  ? "Die Quoten konnten nicht geladen werden."
                  : `Die Quoten konnten nicht aktualisiert werden: Die angezeigten stammen von ${TIME_FORMAT.format(lastUpdated)} Uhr.`}
              </ErrorBanner>
            )}
            {!loaded ? (
              !loadFailed && <Skeleton />
            ) : (
              <>
                <WelcomeNote />
                <div className={styles.summary}>
                  <ResultsSummary
                    total={total}
                    query={query}
                    sport={sport}
                    players={playersFilter}
                    competition={competitionFilter}
                    surebets={isValueBets ? surebets.length : 0}
                  />
                  {bookmakers.length > 0 && total > 0 && (isValueBets || events.some((event) => event.reference)) && (
                    <ReferenceNote players={isValueBets && (bets ?? []).some((bet) => bet.market !== "1X2")} />
                  )}
                </div>
                {bookmakers.length === 0 ? (
                  <EmptyState action={{ label: "Alle Buchmacher auswählen", onClick: () => setBookmakers([...ALL_BOOKMAKERS]) }}>
                    Wähle mindestens einen Buchmacher, um die Quoten zu vergleichen.
                  </EmptyState>
                ) : total === 0 && !(isValueBets && surebets.length > 0) ? (
                  query ? (
                    <EmptyState
                      action={{
                        label: isValueBets ? "Alle Value Bets anzeigen" : "Alle Spiele anzeigen",
                        onClick: () => setSearch(""),
                      }}
                    >
                      {isValueBets ? "Keine Value Bet" : "Kein Spiel"} passt zu „{query}“.
                    </EmptyState>
                  ) : isValueBets ? (
                    <EmptyState action={{ label: "Spiele anzeigen", onClick: () => changeView("matches") }}>
                      Gerade keine Value Bet: Keine Quote liegt weit genug über den fairen Quoten der Börse (um{" "}
                      {formatPercent(VALUE_MIN_EDGE)}, bei Spielern um {formatPercent(PLAYER_VALUE_MIN_EDGE)}).
                    </EmptyState>
                  ) : competitionFilter ? (
                    <EmptyState action={{ label: "Alle Wettbewerbe", onClick: () => setCompetition("") }}>
                      Gerade keine Quoten für {competitionFilter}.
                    </EmptyState>
                  ) : playersFilter ? (
                    <EmptyState action={{ label: "Alle Spiele anzeigen", onClick: () => setPlayers(false) }}>
                      Gerade kein Spiel mit Spielermärkten: Die Buchmacher bieten sie meist am Vortag oder am Spieltag an.
                    </EmptyState>
                  ) : (
                    <EmptyState>Gerade keine Quoten für diese Sportart.</EmptyState>
                  )
                ) : isValueBets ? (
                  <>
                    <MyTakenSurebets taken={takenSurebets.taken} matchHref={matchHref} onOpenMatch={openMatch} onStakes={takenSurebets.setStakes} results={takenSurebets.results} />
                    <MyTakenValueBets taken={takenValueBets.taken} matchHref={matchHref} onOpenMatch={openMatch} onStake={takenValueBets.setStake} results={takenValueBets.results} />
                    {surebets.length > 0 && (
                      <SurebetsTable
                        surebets={surebets}
                        matchHref={matchHref}
                        onOpenMatch={openMatch}
                        sportHref={sportHref}
                        takenSurebets={takenSurebets}
                      />
                    )}
                    {total > 0 && (
                      <ValueBetsTable bets={bets ?? []} matchHref={matchHref} onOpenMatch={openMatch} sportHref={sportHref} takenValueBets={takenValueBets} />
                    )}
                  </>
                ) : (
                  <GroupedOddsTables
                    events={events}
                    bookmakers={bookmakers}
                    groupByDay={effectiveSort === "start"}
                    matchHref={matchHref}
                    onOpenMatch={openMatch}
                  />
                )}
                {!isValueBets && bookmakers.length > 0 && total > pageSize &&
                  (wide ? (
                    <Pagination page={page} pageSize={pageSize} total={total} onChange={goToPage} />
                  ) : (
                    <LoadMore
                      shown={events.length}
                      total={total}
                      loading={refreshing && events.length < limit}
                      max={MAX_SHOWN}
                      onMore={() => setLimit((current) => Math.min(MAX_SHOWN, current + PAGE_SIZE))}
                    />
                  ))}
              </>
            )}
          </>
        )}
      </main>
      <AppFooter />
      {!wide && nav}
    </div>
  );
}
