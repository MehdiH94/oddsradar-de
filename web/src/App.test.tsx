import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act, within } from "@testing-library/react";
import axe from "axe-core";
import { App } from "./App";

// What /api/competitions answers when a test has no competition to filter by.
const emptyList = () => Promise.resolve({ ok: true, json: () => Promise.resolve([]) });

// The sort and the bookmakers are menus: open one, then click an option (a
// click closes the sort menu, the bookmakers' one stays open).
function pickSort(name: string) {
  fireEvent.click(screen.getByRole("button", { name: /^Tri :/ }));
  const option = screen.getByRole("radio", { name });
  fireEvent.pointerDown(option);
  fireEvent.click(option);
}

function pickMarkets(name: string) {
  fireEvent.click(screen.getByRole("button", { name: /^Marchés :/ }));
  const option = screen.getByRole("radio", { name });
  fireEvent.pointerDown(option);
  fireEvent.click(option);
}

function toggleBookmaker(name: string) {
  if (!screen.queryByRole("checkbox", { name })) {
    fireEvent.click(screen.getByRole("button", { name: /^Bookmakers :/ }));
  }
  fireEvent.click(screen.getByRole("checkbox", { name }));
}

describe("App", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    // The filters live in the URL: don't let one test's leak into the next.
    window.history.replaceState(null, "", "/");
  });

  it("never fetches the new sport with a stale (pre-reset) page number", async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.startsWith("/api/competitions")) return emptyList();
      if (url === "/api/sports") {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(["football", "tennis"]) });
      }
      // Enough total to keep "Suivant" enabled at page 1 (pageSize 20, total 50).
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ events: [], total: 50, page: 1, pageSize: 20 }),
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    // Wait for the sport choices to populate and the initial page-1 fetch to land.
    await waitFor(() => expect(screen.getByRole("radio", { name: "Tennis" })).toBeInTheDocument());
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/events?sport=football&sort=trj&kind=all&page=1"));

    // Navigate to page 2 (no sport filter yet). "Suivant" only enables once the
    // page-1 response (total 50) has been applied, not when it is requested.
    await waitFor(() => expect(screen.getByRole("button", { name: "Suivant" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Suivant" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/events?sport=football&sort=trj&kind=all&page=2"));

    // Now switch sport while still "on" page 2. This is the exact scenario that
    // previously raced: one effect resetting page state, another effect
    // capturing the stale page in its closure and firing a bad request.
    fireEvent.click(screen.getByRole("radio", { name: "Tennis" }));

    // Give effects/microtasks a chance to settle, then check every call made
    // with sport=tennis used page=1, never the stale page=2.
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/events?sport=tennis&sort=trj&kind=all&page=1"));

    const staleCall = fetchMock.mock.calls.find(
      ([url]) => typeof url === "string" && url.includes("sport=tennis") && url.includes("page=2"),
    );
    expect(staleCall).toBeUndefined();
  });

  it("ignores a response that arrives after the sport it was fetched for has been replaced", async () => {
    const event = (id: string, sport: string, participants: string[]) => ({
      id,
      sport,
      competition: "Test",
      startTime: "2026-09-24T18:00:00.000Z",
      participants,
      byBookmaker: {
        winamax: { scrapedAt: "2026-09-23T18:00:00.000Z", odds: [{ market: "1X2", selection: "1", price: 1.5 }] },
      },
    });
    const pageOf = (events: unknown[]) => ({
      ok: true,
      json: () => Promise.resolve({ events, total: events.length, page: 1, pageSize: 20 }),
    });

    // The initial (football) request is held open, so it can resolve AFTER
    // the user has already switched to tennis and tennis's own response landed.
    let resolveStale: (value: unknown) => void = () => {};
    const staleResponse = new Promise((resolve) => {
      resolveStale = resolve;
    });

    const fetchMock = vi.fn((url: string) => {
      if (url.startsWith("/api/competitions")) return emptyList();
      if (url === "/api/sports") {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(["football", "tennis"]) });
      }
      if (url === "/api/events?sport=football&sort=trj&kind=all&page=1") return staleResponse;
      return Promise.resolve(pageOf([event("t1", "tennis", ["Nadal", "Alcaraz"])]));
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);
    await waitFor(() => expect(screen.getByRole("radio", { name: "Tennis" })).toBeInTheDocument());
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/events?sport=football&sort=trj&kind=all&page=1"));

    fireEvent.click(screen.getByRole("radio", { name: "Tennis" }));
    await waitFor(() => expect(screen.getByText("Nadal - Alcaraz")).toBeInTheDocument());

    // Now the superseded football request finally resolves.
    await act(async () => {
      resolveStale(pageOf([event("f1", "football", ["PSG", "OM"])]));
      // A macrotask boundary: lets the whole fetch -> json() -> setState chain
      // run to completion before asserting nothing was painted.
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(screen.queryByText("PSG - OM")).not.toBeInTheDocument();
    expect(screen.getByText("Nadal - Alcaraz")).toBeInTheDocument();
  });

  it("searches with the debounced text, from page 1, and offers matching event labels as suggestions", async () => {
    const reply = (body: unknown) => Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
    const fetchMock = vi.fn((url: string) => {
      if (url.startsWith("/api/competitions")) return emptyList();
      if (url === "/api/sports") return reply(["football"]);
      if (url.startsWith("/api/events/suggestions")) return reply(["PSG - OM", "PSG - Lens"]);
      return reply({ events: [], total: 50, page: 1, pageSize: 20 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/events?sport=football&sort=trj&kind=all&page=1"));

    // Clicking before the page-1 response lands hits a still-disabled button
    // (total is 0 until then) and silently does nothing.
    await waitFor(() => expect(screen.getByRole("button", { name: "Suivant" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Suivant" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/events?sport=football&sort=trj&kind=all&page=2"));

    fireEvent.change(screen.getByRole("combobox", { name: "Rechercher un match" }), { target: { value: "psg" } });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/events?sport=football&q=psg&sort=trj&kind=all&page=1"));
    expect(fetchMock).toHaveBeenCalledWith("/api/events/suggestions?q=psg&sport=football&kind=all");
    await waitFor(() =>
      expect([...document.querySelectorAll("#event-suggestions option")].map((o) => o.getAttribute("value"))).toEqual([
        "PSG - OM",
        "PSG - Lens",
      ])
    );
    const staleCall = fetchMock.mock.calls.find(([url]) => url.includes("q=psg") && url.includes("page=2"));
    expect(staleCall).toBeUndefined();
  });

  describe("defaults and sorting", () => {
    const reply = (body: unknown) => Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
    const stubFetch = (sports: string[], total = 50) => {
      const fetchMock = vi.fn((url: string) => {
        if (url.startsWith("/api/competitions")) return emptyList();
        if (url === "/api/sports") return reply(sports);
        return reply({ events: [], total, page: 1, pageSize: 20 });
      });
      vi.stubGlobal("fetch", fetchMock);
      return fetchMock;
    };

    it("shows the current page out of the last one", async () => {
      stubFetch(["football"]);
      render(<App />);

      // 50 matches at 20 per page: 3 pages.
      await waitFor(() => expect(screen.getByText(/Page 1 \/ 3/)).toBeInTheDocument());
      fireEvent.click(screen.getByRole("button", { name: "Suivant" }));
      await waitFor(() => expect(screen.getByText(/Page 2 \/ 3/)).toBeInTheDocument());
    });

    it("says so instead of paging when there is no match at all", async () => {
      const fetchMock = stubFetch(["football"], 0);
      render(<App />);
      await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/events?sport=football&sort=trj&kind=all&page=1"));

      await waitFor(() => expect(screen.getByText("Aucune cote disponible pour ce sport pour le moment.")).toBeInTheDocument());
      expect(screen.queryByRole("navigation", { name: "Pagination" })).not.toBeInTheDocument();
    });

    it("marks the current page and jumps straight to another one", async () => {
      const fetchMock = stubFetch(["football"], 100);
      render(<App />);

      await waitFor(() => expect(screen.getByRole("button", { name: "Page 1" })).toHaveAttribute("aria-current", "page"));
      expect(screen.getByText("1–20 sur 100")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Page 5" }));

      await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/events?sport=football&sort=trj&kind=all&page=5"));
      await waitFor(() => expect(screen.getByRole("button", { name: "Page 5" })).toHaveAttribute("aria-current", "page"));
    });

    it("goes to the last page when the URL's page is past the end", async () => {
      window.history.replaceState(null, "", "/?sport=football&page=9");
      const fetchMock = stubFetch(["football"], 50);
      render(<App />);

      await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/events?sport=football&sort=trj&kind=all&page=3"));
      await waitFor(() => expect(screen.getByText(/Page 3 \/ 3/)).toBeInTheDocument());
    });

    it("starts on football, sorted by TRJ", async () => {
      const fetchMock = stubFetch(["football", "tennis"]);
      render(<App />);

      await waitFor(() => expect(screen.getByRole("radio", { name: "Tennis" })).toBeInTheDocument());
      expect(screen.getByRole("radio", { name: "Football" })).toBeChecked();
      expect(screen.getByRole("button", { name: "Tri : Meilleur TRJ" })).toBeInTheDocument();
      expect(fetchMock).toHaveBeenCalledWith("/api/events?sport=football&sort=trj&kind=all&page=1");
    });

    it("only offers the listed sports, with no every-sport choice", async () => {
      stubFetch(["football", "tennis"]);
      render(<App />);

      await waitFor(() => expect(screen.getByRole("radio", { name: "Tennis" })).toBeInTheDocument());
      const sportChoices = within(screen.getByRole("group", { name: "Sport" })).getAllByRole("radio");
      // The value bets are a list of their own, in the navigation, not a sport.
      expect(sportChoices.map((radio) => radio.getAttribute("value"))).toEqual(["football", "tennis"]);
      const views = within(screen.getByRole("group", { name: "Afficher" })).getAllByRole("radio");
      // The Freebets page is the last entry: it moves to its own address.
      expect(views.map((radio) => radio.getAttribute("value"))).toEqual(["value-bets", "matches", "freebets"]);
      expect(screen.queryByRole("radio", { name: "Tous les sports" })).not.toBeInTheDocument();
    });

    it("falls back to the first listed sport when there is no football match to list", async () => {
      const fetchMock = stubFetch(["basketball", "tennis"]);
      render(<App />);

      await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/events?sport=basketball&sort=trj&kind=all&page=1"));
      expect(screen.getByRole("radio", { name: "Basketball" })).toBeChecked();
      const allSports = fetchMock.mock.calls.find(([url]) => url.startsWith("/api/events?") && !url.includes("sport="));
      expect(allSports).toBeUndefined();
    });

    it("switches to kick-off order from page 1", async () => {
      const fetchMock = stubFetch(["football"]);
      render(<App />);
      await waitFor(() => expect(screen.getByRole("button", { name: "Suivant" })).toBeEnabled());
      fireEvent.click(screen.getByRole("button", { name: "Suivant" }));
      await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/events?sport=football&sort=trj&kind=all&page=2"));

      pickSort("Date de début");

      await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/events?sport=football&sort=start&kind=all&page=1"));
      const stale = fetchMock.mock.calls.find(([url]) => url.includes("sort=start") && url.includes("page=2"));
      expect(stale).toBeUndefined();
    });

    it("keeps only the matches with players' markets, from page 1", async () => {
      const fetchMock = stubFetch(["football"]);
      render(<App />);
      await waitFor(() => expect(screen.getByRole("button", { name: "Suivant" })).toBeEnabled());
      fireEvent.click(screen.getByRole("button", { name: "Suivant" }));
      await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/events?sport=football&sort=trj&kind=all&page=2"));

      pickMarkets("Avec marchés joueurs");

      await waitFor(() =>
        expect(fetchMock).toHaveBeenCalledWith("/api/events?sport=football&sort=trj&players=1&kind=all&page=1")
      );
      expect(screen.getByRole("button", { name: "Marchés : Joueurs" })).toBeInTheDocument();
      await waitFor(() => expect(screen.getByText(/avec marchés joueurs/)).toBeInTheDocument());
    });

    it("says when no match has players' markets yet, and shows them all again", async () => {
      const fetchMock = stubFetch(["football"], 0);
      render(<App />);
      pickMarkets("Avec marchés joueurs");

      expect(await screen.findByText(/Aucun match avec des marchés joueurs pour le moment/)).toBeInTheDocument();
      fetchMock.mockClear();
      fireEvent.click(screen.getByRole("button", { name: "Voir tous les matchs" }));
      await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/events?sport=football&sort=trj&kind=all&page=1"));
    });

    it("offers the markets menu only for the sports with a page of markets", async () => {
      stubFetch(["football", "tennis"]);
      render(<App />);
      await waitFor(() => expect(screen.getByRole("button", { name: "Marchés : Tous" })).toBeInTheDocument());

      fireEvent.click(screen.getByRole("radio", { name: "Tennis" }));

      await waitFor(() => expect(screen.queryByRole("button", { name: /^Marchés :/ })).not.toBeInTheDocument());
    });

    it("sorts by value, from page 1", async () => {
      const fetchMock = stubFetch(["football"]);
      render(<App />);
      await waitFor(() => expect(screen.getByRole("button", { name: "Suivant" })).toBeEnabled());
      fireEvent.click(screen.getByRole("button", { name: "Suivant" }));
      await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/events?sport=football&sort=trj&kind=all&page=2"));

      pickSort("Meilleure value");

      await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/events?sport=football&sort=value&kind=all&page=1"));
    });

    it("offers the value order only for the sports the reference prices, and no value menu", async () => {
      const fetchMock = stubFetch(["football", "tennis", "basketball", "handball"]);
      render(<App />);
      await waitFor(() => expect(screen.getByRole("button", { name: "Marchés : Tous" })).toBeInTheDocument());
      expect(screen.queryByRole("button", { name: /^Value :/ })).not.toBeInTheDocument();
      pickSort("Meilleure value");
      await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/events?sport=football&sort=value&kind=all&page=1"));

      // Tennis's and basketball's winners have fair odds too.
      fireEvent.click(screen.getByRole("radio", { name: "Tennis" }));
      await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/events?sport=tennis&sort=value&kind=all&page=1"));
      fireEvent.click(screen.getByRole("radio", { name: "Basketball" }));
      await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/events?sport=basketball&sort=value&kind=all&page=1"));

      fireEvent.click(screen.getByRole("radio", { name: "Handball" }));

      // The value order falls back to the TRJ's.
      await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/events?sport=handball&sort=trj&kind=all&page=1"));
      expect(screen.getByRole("button", { name: "Tri : Meilleur TRJ" })).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Tri : Meilleur TRJ" }));
      expect(screen.queryByRole("radio", { name: "Meilleure value" })).not.toBeInTheDocument();
    });

    it("asks for TRJs over the ticked bookmakers only", async () => {
      const fetchMock = stubFetch(["football"]);
      render(<App />);
      await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/events?sport=football&sort=trj&kind=all&page=1"));

      toggleBookmaker("Winamax");

      await waitFor(() =>
        expect(fetchMock).toHaveBeenCalledWith("/api/events?sport=football&sort=trj&bookmakers=betclic&kind=all&page=1")
      );

      // Every bookmaker ticked again: the default, sent as no filter.
      fetchMock.mockClear();
      toggleBookmaker("Winamax");

      await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/events?sport=football&sort=trj&kind=all&page=1"));
    });
  });

  describe("the value bets' category", () => {
    const reply = (body: unknown) => Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
    const bet = (eventId: string, participants: string[], selection: string, bookmaker: string, price: number, fair: number) => ({
      eventId,
      sport: "football",
      competition: "Ligue 1",
      startTime: "2099-01-01T20:00:00.000Z",
      participants,
      marketCount: 42,
      market: "1X2",
      marketLabel: "Résultat du match",
      selection,
      label: selection === "X" ? "Nul" : participants[selection === "1" ? 0 : 1],
      bookmaker,
      price,
      basis: "fair",
      fair,
      edge: price / fair - 1,
      matched: 4200,
    });
    const BETS = [
      bet("psg-om", ["PSG", "OM"], "1", "betclic", 1.6, 1.5),
      bet("lens-lille", ["Lens", "Lille"], "X", "winamax", 3.5, 3.4),
    ];
    const stubFetch = (bets: unknown[] = BETS, surebets: unknown[] = []) => {
      const fetchMock = vi.fn((url: string) => {
        if (url.startsWith("/api/competitions")) return emptyList();
        if (url === "/api/sports") return reply(["football", "tennis"]);
        if (url.startsWith("/api/events/suggestions")) return reply([]);
        if (url.startsWith("/api/events/psg-om")) {
          const { eventId: id, sport, competition, startTime, participants } = BETS[0];
          return reply({ id, sport, competition, startTime, participants, sections: [], comparedCount: 0, surebetCount: 0 });
        }
        if (url.startsWith("/api/value-bets")) {
          const q = new URLSearchParams(url.split("?")[1]).get("q");
          const teams = (b: unknown) => (b as { participants: string[] }).participants.join(" - ").toLowerCase();
          const found = q ? bets.filter((b) => teams(b).includes(q)) : bets;
          return reply({ bets: found, total: found.length, surebets });
        }
        return reply({ events: [], total: 50, page: 1, pageSize: 20 });
      });
      vi.stubGlobal("fetch", fetchMock);
      return fetchMock;
    };
    const urlParams = () => Object.fromEntries(new URLSearchParams(window.location.search));

    it("shows the surebets above the value bets, even without a value bet", async () => {
      const surebet = {
        ...bet("nba", ["Lakers", "Celtics"], "1", "winamax", 2.2, 2),
        market: "Vainqueur du match",
        marketLabel: "Vainqueur du match",
        kind: "bookmakers",
        payoutRate: 1.0745,
        profit: 7.45,
        toVerify: false,
        legs: [
          { selection: "1", label: "Lakers", source: "winamax", side: "back", price: 2.2, stake: 48.84 },
          { selection: "2", label: "Celtics", source: "betclic", side: "back", price: 2.1, stake: 51.16 },
        ],
      };
      stubFetch([], [surebet]);
      window.history.replaceState(null, "", "/?sport=value-bets");
      render(<App />);
      expect(await screen.findByRole("heading", { level: 2, name: "Surebets" })).toBeInTheDocument();
      expect(screen.getByText(/surebet$/).textContent).toBe("0 value bet · 1 surebet");
      expect(screen.queryByRole("heading", { level: 2, name: "Value bets" })).not.toBeInTheDocument();
      expect(screen.queryByText(/Aucun value bet pour le moment/)).not.toBeInTheDocument();
    });

    it("leads the title of a surebet or a value bet with a single market to its page, keeping the bookmakers", async () => {
      const race = "Femmes - Classement Général Relais 2026/2027";
      const surebet = {
        ...bet("relais", [race], "1", "winamax", 2.2, 2),
        sport: "ski de fond",
        marketCount: 1,
        market: "Vainqueur",
        marketLabel: "Vainqueur",
        kind: "bookmakers",
        payoutRate: 1.0745,
        profit: 7.45,
        toVerify: false,
        legs: [
          { selection: "1", label: "Norvège", source: "winamax", side: "back", price: 2.2, stake: 48.84 },
          { selection: "2", label: "Suède", source: "betclic", side: "back", price: 2.1, stake: 51.16 },
        ],
      };
      const single = { ...bet("lens-lille", ["Lens", "Lille"], "X", "betclic", 3.5, 3.4), sport: "tennis", marketCount: 1 };
      window.history.replaceState(null, "", "/?sport=value-bets&sort=value&bookmakers=betclic");
      stubFetch([BETS[0], single], [surebet]);
      render(<App />);

      expect(await screen.findByRole("link", { name: race })).toHaveAttribute(
        "href",
        "?sport=value-bets&sort=value&bookmakers=betclic&match=relais"
      );
      expect(screen.getByRole("img", { name: "Ski de fond" })).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Lens - Lille" })).toHaveAttribute(
        "href",
        "?sport=value-bets&sort=value&bookmakers=betclic&match=lens-lille"
      );
      // Whatever its number of markets, an event opens its page, in place.
      const psg = screen.getByRole("link", { name: "PSG - OM" });
      expect(psg).toHaveAttribute("href", "?sport=value-bets&sort=value&bookmakers=betclic&match=psg-om");
      fireEvent.click(psg);
      await waitFor(() => expect(urlParams().match).toBe("psg-om"));
    });

    it("lists every value bet, biggest edge first, with neither pages nor markets menu", async () => {
      const fetchMock = stubFetch();
      render(<App />);
      await waitFor(() => expect(screen.getByRole("button", { name: "Suivant" })).toBeEnabled());
      fireEvent.click(screen.getByRole("button", { name: "Suivant" }));
      await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/events?sport=football&sort=trj&kind=all&page=2"));

      fireEvent.click(screen.getByRole("radio", { name: "Value bets" }));

      await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/value-bets?sort=value"));
      await waitFor(() => expect(urlParams()).toEqual({ sport: "value-bets", sort: "value" }));
      expect(await screen.findByText("PSG - OM")).toBeInTheDocument();
      expect(screen.getByRole("heading", { level: 2, name: "Value bets" })).toBeInTheDocument();
      expect(screen.getByText(/value bets$/, { selector: "p" }).textContent).toBe("2 value bets");
      expect(screen.getByText(/sans sa marge\. Une cote au moins 1 % au-dessus est un value bet/)).toBeInTheDocument();
      // No player among them: nothing on the players' rules.
      expect(screen.queryByText(/Sur les joueurs/)).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Tri : Meilleure value" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /^Marchés :/ })).not.toBeInTheDocument();
      expect(screen.queryByRole("navigation", { name: "Pagination" })).not.toBeInTheDocument();
      // Never a page, nor the sports' list behind it.
      expect(fetchMock.mock.calls.some(([url]) => url.includes("sport=value-bets"))).toBe(false);
    });

    it("says how the players' value bets differ when it lists some", async () => {
      window.history.replaceState(null, "", "/?sport=value-bets&sort=value");
      stubFetch([...BETS, { ...BETS[0], market: "anytime_scorer", marketLabel: "Buteur", selection: "Dembélé", label: "Dembélé" }]);
      render(<App />);
      expect(
        await screen.findByText(
          /Sur les joueurs, à partir de 5 %\. « ≤ » : l'exchange les cote de trop loin, sa cote de lay sert de plafond\.$/
        )
      ).toBeInTheDocument();
    });

    it("sorts by kick-off, counts the ticked bookmakers only, and searches", async () => {
      window.history.replaceState(null, "", "/?sport=value-bets&sort=value");
      const fetchMock = stubFetch();
      render(<App />);
      expect(await screen.findByText("PSG - OM")).toBeInTheDocument();
      expect(screen.getByRole("radio", { name: "Value bets" })).toBeChecked();

      fireEvent.click(screen.getByRole("button", { name: "Tri : Meilleure value" }));
      expect(screen.getAllByRole("radio", { name: /Meilleur|Date/ }).map((r) => r.parentElement?.textContent)).toEqual([
        "Meilleure value",
        "Date de début",
      ]);
      const byStart = screen.getByRole("radio", { name: "Date de début" });
      fireEvent.pointerDown(byStart);
      fireEvent.click(byStart);
      await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/value-bets?sort=start"));

      toggleBookmaker("Winamax");
      await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/value-bets?sort=start&bookmakers=betclic"));

      fireEvent.change(screen.getByRole("combobox", { name: "Rechercher un match" }), { target: { value: "ps" } });
      await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/value-bets?q=ps&sort=start&bookmakers=betclic"));
      // The suggestions are the matches of the bets found.
      await waitFor(() =>
        expect([...document.querySelectorAll("#event-suggestions option")].map((o) => o.getAttribute("value"))).toEqual([
          "PSG - OM",
        ])
      );
      expect(fetchMock.mock.calls.some(([url]) => url.startsWith("/api/events/suggestions"))).toBe(false);
      expect(urlParams()).toEqual({ sport: "value-bets", sort: "start", q: "ps", bookmakers: "betclic" });
    });

    it("says when there is no value bet, and leads back to the matches", async () => {
      window.history.replaceState(null, "", "/?sport=value-bets&sort=value");
      const fetchMock = stubFetch([]);
      render(<App />);

      expect(
        await screen.findByText(
          "Aucun value bet pour le moment : aucune cote ne dépasse assez la cote juste de l'exchange (de 1 %, de 5 % sur les joueurs)."
        )
      ).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Voir les matchs" }));
      await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/events?sport=football&sort=value&kind=all&page=1"));
      expect(screen.getByRole("radio", { name: "Football" })).toBeChecked();
    });

    it("says when a search finds no value bet, and offers to clear it", async () => {
      window.history.replaceState(null, "", "/?sport=value-bets&sort=value&q=zzz");
      stubFetch();
      render(<App />);

      expect(await screen.findByText("Aucun value bet ne correspond à « zzz ».")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Voir tous les value bets" }));
      expect(await screen.findByText("PSG - OM")).toBeInTheDocument();
    });

    it("stays on the category while the sports load, and resets its own filters only", async () => {
      window.history.replaceState(null, "", "/?sport=value-bets&sort=start");
      stubFetch();
      render(<App />);
      expect(await screen.findByText("PSG - OM")).toBeInTheDocument();
      expect(urlParams().sport).toBe("value-bets");

      fireEvent.click(screen.getByRole("button", { name: "Réinitialiser les filtres" }));

      // Still the value bets, sorted by value again.
      await waitFor(() => expect(urlParams()).toEqual({ sport: "value-bets", sort: "value" }));
      expect(screen.getByRole("radio", { name: "Value bets" })).toBeChecked();
      expect(screen.getByText("PSG - OM")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Réinitialiser les filtres" })).not.toBeInTheDocument();
    });

    it("is offered before the sports are known", () => {
      // /api/sports never answers.
      vi.stubGlobal(
        "fetch",
        vi.fn((url: string) =>
          url === "/api/sports" ? new Promise(() => {}) : url.startsWith("/api/competitions") ? emptyList() : reply({ events: [], total: 0, page: 1, pageSize: 20 }),
        )
      );
      render(<App />);

      const views = screen.getByRole("group", { name: "Afficher" });
      expect(within(views).getByRole("radio", { name: "Value bets" })).toBeInTheDocument();
    });

    it("is still offered when no sport has odds", async () => {
      const fetchMock = vi.fn((url: string) =>
        url === "/api/sports" || url.startsWith("/api/competitions") ? reply([]) : reply({ events: [], total: 0, page: 1, pageSize: 20 })
      );
      vi.stubGlobal("fetch", fetchMock);
      render(<App />);
      await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/sports"));
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      const views = screen.getByRole("group", { name: "Afficher" });
      expect(within(views).getByRole("radio", { name: "Value bets" })).toBeInTheDocument();
    });

    it("shows placeholders, never the bets, while a sport's matches load", async () => {
      window.history.replaceState(null, "", "/?sport=value-bets&sort=value");
      vi.stubGlobal(
        "fetch",
        vi.fn((url: string) => {
          if (url.startsWith("/api/competitions")) return emptyList();
          if (url === "/api/sports") return reply(["football"]);
          if (url.startsWith("/api/value-bets")) return reply({ bets: BETS, total: 2 });
          return new Promise(() => {});
        })
      );
      render(<App />);
      expect(await screen.findByText("PSG - OM")).toBeInTheDocument();
      // The value bets have no sports' row: they are every sport's.
      expect(screen.queryByRole("radio", { name: "Football" })).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole("radio", { name: "Matchs" }));

      expect(await screen.findByText("Chargement des cotes…")).toBeInTheDocument();
      expect(screen.queryByText("PSG - OM")).not.toBeInTheDocument();
      expect(screen.queryByText(/résultat/)).not.toBeInTheDocument();
    });

    it("goes to the Freebets page, an address of its own, from the navigation", async () => {
      stubFetch(["football", "tennis"]);
      render(<App />);
      await waitFor(() => expect(screen.getByRole("radio", { name: "Tennis" })).toBeInTheDocument());
      fireEvent.click(screen.getByRole("radio", { name: "Freebets" }));
      expect(window.location.pathname).toBe("/freebets");
    });

    it("shows every bet on one page, whatever the URL's page", async () => {
      window.history.replaceState(null, "", "/?sport=value-bets&sort=value&page=3");
      stubFetch(Array.from({ length: 25 }, (_, i) => bet(`m${i}`, [`Home ${i}`, `Away ${i}`], "1", "betclic", 2, 1.9)));
      render(<App />);

      expect(await screen.findByText("Home 24 - Away 24")).toBeInTheDocument();
      expect(screen.getAllByRole("row")).toHaveLength(26);
      expect(screen.queryByRole("navigation", { name: "Pagination" })).not.toBeInTheDocument();
      await waitFor(() => expect(urlParams()).toEqual({ sport: "value-bets", sort: "value" }));
    });

    it("opens a bet's match, and goes back to the value bets", async () => {
      window.history.replaceState(null, "", "/?sport=value-bets&sort=value");
      const fetchMock = stubFetch();
      render(<App />);

      const link = await screen.findByRole("link", { name: "+41 marchés pour PSG - OM" });
      expect(link).toHaveAttribute("href", "?sport=value-bets&sort=value&match=psg-om");
      fireEvent.click(link);
      await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/events/psg-om"));
      expect(urlParams()).toEqual({ sport: "value-bets", sort: "value", match: "psg-om" });

      fireEvent.click(screen.getByRole("link", { name: "Tous les value bets" }));
      expect(await screen.findByText("PSG - OM")).toBeInTheDocument();
      expect(screen.getByRole("radio", { name: "Value bets" })).toBeChecked();
      // Going back left the match's entry ahead in the shared history: a new
      // entry drops it, so the next test counts entries from a clean end.
      window.history.pushState(null, "", "/");
    });
  });

  describe("the winners of the competitions, with the matches", () => {
    const reply = (body: unknown) => Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
    const match = (id: string, competition: string, participants: string[]) => ({
      id,
      sport: "football",
      competition,
      startTime: "2026-10-20T18:00:00.000Z",
      participants,
      payoutRate: 0.95,
      marketCount: 1,
      byBookmaker: {
        unibet: {
          scrapedAt: "2026-10-14T10:00:00.000Z",
          odds: [
            { market: "1X2", selection: "1", price: 1.5 },
            { market: "1X2", selection: "X", price: 4 },
            { market: "1X2", selection: "2", price: 6 },
          ],
        },
      },
    });
    const winner = (id: string, title: string) => ({
      id,
      sport: "football",
      competition: title,
      startTime: "2027-05-30T00:00:00.000Z",
      participants: [title],
      payoutRate: 0.81,
      marketCount: 1,
      byBookmaker: {
        unibet: {
          scrapedAt: "2026-10-14T10:00:00.000Z",
          odds: [
            { market: "Vainqueur", selection: "Paris Saint-Germain", price: 1.5 },
            { market: "Vainqueur", selection: "Olympique de Marseille", price: 3.2 },
          ],
        },
      },
    });
    const LIGUE_1 = [match("psg-om", "Ligue 1", ["PSG", "OM"]), winner("l1", "Ligue 1 2026/2027")];
    const stubFetch = (sports = ["football", "tennis"]) => {
      const fetchMock = vi.fn((url: string) => {
        if (url === "/api/sports") return reply(sports);
        if (url.startsWith("/api/competitions")) return reply(["Coupe de France", "Ligue 1"]);
        if (url.startsWith("/api/events/suggestions")) return reply([]);
        if (url.includes("competition=Ligue")) return reply({ events: LIGUE_1, total: 2, page: 1, pageSize: 20 });
        return reply({
          events: [...LIGUE_1, match("lens-lille", "Coupe de France", ["Lens", "Lille"])],
          total: 3,
          page: 1,
          pageSize: 20,
        });
      });
      vi.stubGlobal("fetch", fetchMock);
      return fetchMock;
    };
    const urlParams = () => Object.fromEntries(new URLSearchParams(window.location.search));
    const pickCompetition = (name: string) => {
      fireEvent.click(screen.getByRole("button", { name: /^Compétition :/ }));
      const option = screen.getByRole("radio", { name });
      fireEvent.pointerDown(option);
      fireEvent.click(option);
    };

    it("are listed in the matches, as cards under their sport, with no list of their own", async () => {
      const fetchMock = stubFetch();
      render(<App />);

      await waitFor(() =>
        expect(fetchMock).toHaveBeenCalledWith("/api/events?sport=football&sort=trj&kind=all&page=1")
      );
      expect(await screen.findByText("PSG - OM")).toBeInTheDocument();
      expect(screen.getByRole("article", { name: "Ligue 1 2026/2027" })).toBeInTheDocument();
      expect(screen.queryByRole("radio", { name: "Vainqueurs" })).not.toBeInTheDocument();
      expect(screen.getByRole("radio", { name: "Matchs" })).toBeChecked();
    });

    it("are searched with the matches, their suggestions too", async () => {
      const fetchMock = stubFetch();
      render(<App />);
      await screen.findByText("PSG - OM");

      fireEvent.change(screen.getByRole("combobox"), { target: { value: "ligue" } });
      await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/events/suggestions?q=ligue&sport=football&kind=all"));
    });

    it("narrow to a competition from its menu: its matches and its winner, from page 1, in the address", async () => {
      const fetchMock = stubFetch();
      render(<App />);
      await screen.findByText("Lens - Lille");
      expect(screen.getByRole("button", { name: "Compétition : Toutes" })).toBeInTheDocument();

      pickCompetition("Ligue 1");

      await waitFor(() =>
        expect(fetchMock).toHaveBeenCalledWith(
          "/api/events?sport=football&sort=trj&kind=all&competition=Ligue+1&page=1"
        )
      );
      await waitFor(() => expect(screen.queryByText("Lens - Lille")).not.toBeInTheDocument());
      expect(screen.getByText("PSG - OM")).toBeInTheDocument();
      expect(screen.getByRole("article", { name: "Ligue 1 2026/2027" })).toBeInTheDocument();
      expect(urlParams()).toEqual({ sport: "football", sort: "trj", competition: "Ligue 1" });
      expect(screen.getByRole("button", { name: "Compétition : Ligue 1" })).toBeInTheDocument();
      expect(screen.getByText(/Football · Ligue 1$/, { selector: "p" }).textContent).toBe("2 résultats · Football · Ligue 1");

      // The reset button undoes it, with the other filters.
      fireEvent.click(screen.getByRole("button", { name: "Réinitialiser les filtres" }));
      await waitFor(() => expect(screen.getByText("Lens - Lille")).toBeInTheDocument());
      expect(urlParams()).toEqual({ sport: "football", sort: "trj" });
    });

    it("lists football's competitions with the big leagues first, folded, searchable from the menu", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn((url: string) =>
          reply(
            url === "/api/sports"
              ? ["football"]
              : url.startsWith("/api/competitions")
                ? ["Bundesliga", "Championship", "Coupe de France", "Eredivisie", "Ligue 1", "Ligue 2", "Serie A", "Super Lig"]
                : url.includes("/suggestions")
                  ? []
                  : { events: LIGUE_1, total: 2, page: 1, pageSize: 20 }
          )
        )
      );
      render(<App />);
      await screen.findByText("PSG - OM");

      fireEvent.click(screen.getByRole("button", { name: "Compétition : Toutes" }));
      const names = () => screen.getAllByRole("radio").filter((r) => r.getAttribute("name") === "competition").map((r) => r.parentElement?.textContent);
      expect(names()).toEqual(["Toutes les compétitions", "Ligue 1", "Serie A", "Bundesliga", "Championship", "Coupe de France", "Eredivisie"]);

      fireEvent.change(screen.getByRole("searchbox", { name: "Rechercher une compétition" }), { target: { value: "super" } });
      expect(names()).toEqual(["Super Lig"]);
    });

    it("is read from the address, and left with the sport", async () => {
      window.history.replaceState(null, "", "/?sport=football&sort=trj&competition=Ligue%201");
      const fetchMock = stubFetch();
      render(<App />);

      await waitFor(() =>
        expect(fetchMock).toHaveBeenCalledWith(
          "/api/events?sport=football&sort=trj&kind=all&competition=Ligue+1&page=1"
        )
      );
      expect(await screen.findByRole("button", { name: "Compétition : Ligue 1" })).toBeInTheDocument();
      // The competitions are the sport's: the menu is of football's.
      await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/competitions?sport=football"));

      fireEvent.click(screen.getByRole("radio", { name: "Tennis" }));
      await waitFor(() => expect(urlParams()).toEqual({ sport: "tennis", sort: "trj" }));
      expect(screen.getByRole("button", { name: "Compétition : Toutes" })).toBeInTheDocument();
      expect(fetchMock).toHaveBeenCalledWith("/api/competitions?sport=tennis");
    });

    it("says there is no odds for a competition, and offers to leave it", async () => {
      window.history.replaceState(null, "", "/?sport=football&sort=trj&competition=Ligue%202");
      vi.stubGlobal(
        "fetch",
        vi.fn((url: string) =>
          reply(
            url === "/api/sports"
              ? ["football"]
              : url.startsWith("/api/competitions") || url.includes("/suggestions")
                ? []
                : { events: [], total: 0, page: 1, pageSize: 20 }
          )
        )
      );
      render(<App />);

      expect(await screen.findByText("Aucune cote disponible pour Ligue 2 pour le moment.")).toBeInTheDocument();
      // Still in the menu, to be undone.
      fireEvent.click(screen.getByRole("button", { name: "Compétition : Ligue 2" }));
      expect(screen.getByRole("radio", { name: "Ligue 2" })).toBeChecked();
      fireEvent.click(screen.getByRole("button", { name: "Toutes les compétitions" }));
      await waitFor(() => expect(urlParams()).toEqual({ sport: "football", sort: "trj" }));
    });

    it("has no list of its own: an old link to it opens football", async () => {
      window.history.replaceState(null, "", "/?sport=vainqueurs&sort=trj");
      stubFetch();
      render(<App />);

      await waitFor(() => expect(screen.getByRole("radio", { name: "Football" })).toBeChecked());
      await waitFor(() => expect(urlParams().sport).toBe("football"));
      expect(screen.queryByRole("radio", { name: "Vainqueurs" })).not.toBeInTheDocument();
    });

    it("is not a value bet filter: the value bets list has no competition menu", async () => {
      stubFetch();
      render(<App />);
      await screen.findByText("PSG - OM");
      expect(screen.getByRole("button", { name: /^Compétition :/ })).toBeInTheDocument();

      fireEvent.click(screen.getByRole("radio", { name: "Value bets" }));
      await waitFor(() => expect(screen.queryByRole("button", { name: /^Compétition :/ })).not.toBeInTheDocument());
    });
  });
  describe("filters kept in the URL", () => {
    const reply = (body: unknown) => Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
    const stubFetch = (sports: string[]) => {
      const fetchMock = vi.fn((url: string) => {
        if (url.startsWith("/api/competitions")) return emptyList();
        if (url === "/api/sports") return reply(sports);
        if (url.startsWith("/api/events/suggestions")) return reply([]);
        return reply({ events: [], total: 50, page: 1, pageSize: 20 });
      });
      vi.stubGlobal("fetch", fetchMock);
      return fetchMock;
    };
    const urlParams = () => Object.fromEntries(new URLSearchParams(window.location.search));

    it("starts from the filters and the page in the URL", async () => {
      window.history.replaceState(null, "", "/?sport=tennis&sort=start&q=psg&bookmakers=betclic&page=2");
      const fetchMock = stubFetch(["football", "tennis"]);
      render(<App />);

      await waitFor(() => expect(screen.getByRole("radio", { name: "Tennis" })).toBeInTheDocument());
      // The very first request already has them all, page included.
      expect(fetchMock.mock.calls.find(([url]) => url.startsWith("/api/events?"))?.[0]).toBe(
        "/api/events?sport=tennis&q=psg&sort=start&bookmakers=betclic&kind=all&page=2"
      );
      expect(screen.getByRole("radio", { name: "Tennis" })).toBeChecked();
      expect(screen.getByRole("button", { name: "Tri : Date de début" })).toBeInTheDocument();
      expect(screen.getByRole("combobox", { name: "Rechercher un match" })).toHaveValue("psg");
      expect(screen.getByRole("button", { name: "Bookmakers : Betclic" })).toBeInTheDocument();
      await waitFor(() => expect(screen.getByText(/Page 2 \/ 3/)).toBeInTheDocument());
      // Still page 2 once the debounced search has settled.
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(urlParams().page).toBe("2");
    });

    it("writes each filter change to the URL, back to page 1", async () => {
      stubFetch(["football", "tennis"]);
      render(<App />);
      await waitFor(() => expect(urlParams()).toEqual({ sport: "football", sort: "trj" }));

      await waitFor(() => expect(screen.getByRole("button", { name: "Suivant" })).toBeEnabled());
      fireEvent.click(screen.getByRole("button", { name: "Suivant" }));
      await waitFor(() => expect(urlParams().page).toBe("2"));

      pickSort("Date de début");
      await waitFor(() => expect(urlParams()).toEqual({ sport: "football", sort: "start" }));

      toggleBookmaker("Winamax");
      await waitFor(() => expect(urlParams().bookmakers).toBe("betclic"));

      fireEvent.click(screen.getByRole("radio", { name: "Tennis" }));
      fireEvent.change(screen.getByRole("combobox", { name: "Rechercher un match" }), { target: { value: " nadal " } });
      await waitFor(() =>
        expect(urlParams()).toEqual({ sport: "tennis", sort: "start", q: "nadal", bookmakers: "betclic" })
      );
    });

    it("keeps the players' markets filter in the URL, and resets it", async () => {
      window.history.replaceState(null, "", "/?sport=football&sort=trj&players=1");
      const fetchMock = stubFetch(["football"]);
      render(<App />);

      await waitFor(() => expect(screen.getByRole("button", { name: "Marchés : Joueurs" })).toBeInTheDocument());
      expect(fetchMock.mock.calls.find(([url]) => url.startsWith("/api/events?"))?.[0]).toBe(
        "/api/events?sport=football&sort=trj&players=1&kind=all&page=1"
      );

      fireEvent.click(screen.getByRole("button", { name: "Réinitialiser les filtres" }));

      await waitFor(() => expect(urlParams()).toEqual({ sport: "football", sort: "trj" }));
      expect(screen.getByRole("button", { name: "Marchés : Tous" })).toBeInTheDocument();
    });

    it("keeps the value order in the URL, and resets it", async () => {
      window.history.replaceState(null, "", "/?sport=football&sort=value");
      const fetchMock = stubFetch(["football"]);
      render(<App />);

      await waitFor(() => expect(screen.getByRole("button", { name: "Tri : Meilleure value" })).toBeInTheDocument());
      expect(fetchMock.mock.calls.find(([url]) => url.startsWith("/api/events?"))?.[0]).toBe(
        "/api/events?sport=football&sort=value&kind=all&page=1"
      );

      fireEvent.click(screen.getByRole("button", { name: "Réinitialiser les filtres" }));

      await waitFor(() => expect(urlParams()).toEqual({ sport: "football", sort: "trj" }));
    });

    it("ignores an old link's value filter", async () => {
      window.history.replaceState(null, "", "/?sport=tennis&sort=trj&value=1");
      const fetchMock = stubFetch(["football", "tennis"]);
      render(<App />);

      await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/events?sport=tennis&sort=trj&kind=all&page=1"));
      expect(fetchMock.mock.calls.some(([url]) => url.includes("value=1"))).toBe(false);
      await waitFor(() => expect(urlParams()).toEqual({ sport: "tennis", sort: "trj" }));
    });

    it("explains the fair odds above a list that shows some", async () => {
      const event = {
        id: "e1",
        sport: "football",
        competition: "Ligue 1",
        startTime: "2099-01-01T20:00:00.000Z",
        participants: ["PSG", "OM"],
        byBookmaker: { winamax: { scrapedAt: "", odds: [{ market: "1X2", selection: "1", price: 1.6 }] } },
        reference: { market: "1X2", fair: { "1": 1.55, X: 3.3, "2": 5.5 }, matched: 100, scrapedAt: "" },
      };
      vi.stubGlobal(
        "fetch",
        vi.fn((url: string) => {
          if (url.startsWith("/api/competitions")) return emptyList();
          if (url === "/api/sports") return reply(["football"]);
          return reply({ events: [event], total: 1, page: 1, pageSize: 20 });
        })
      );
      render(<App />);
      expect(await screen.findByText(/sans sa marge\. Une cote au moins 1 % au-dessus est un value bet/)).toBeInTheDocument();
    });

    it("falls back to football when the URL's sport has no match to list", async () => {
      window.history.replaceState(null, "", "/?sport=curling");
      const fetchMock = stubFetch(["basketball", "football"]);
      render(<App />);

      await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/events?sport=football&sort=trj&kind=all&page=1"));
      expect(screen.getByRole("radio", { name: "Football" })).toBeChecked();
      await waitFor(() => expect(urlParams().sport).toBe("football"));
    });
  });

  describe("filters kept with the account", () => {
    const reply = (body: unknown) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
    const SAVED = { sport: "tennis", sort: "start" as const, bookmakers: ["betclic"], players: false, favoriteSports: ["tennis"] };
    const stubFetch = (sports: string[]) => {
      const fetchMock = vi.fn((url: string, init?: RequestInit) => {
        if (url.startsWith("/api/competitions")) return emptyList();
        if (url === "/api/sports") return reply(sports);
        if (url.startsWith("/api/events/suggestions")) return reply([]);
        if (url === "/api/preferences") return Promise.resolve({ ok: true, status: 204, json: () => Promise.resolve(null) });
        void init;
        return reply({ events: [], total: 50, page: 1, pageSize: 20 });
      });
      vi.stubGlobal("fetch", fetchMock);
      return fetchMock;
    };
    const puts = (fetchMock: ReturnType<typeof stubFetch>) =>
      fetchMock.mock.calls.filter(([url, init]) => url === "/api/preferences" && init?.method === "PUT");

    it("opens a bare address on the saved filters, from the very first request", async () => {
      window.history.replaceState(null, "", "/cotes");
      const fetchMock = stubFetch(["football", "tennis"]);
      render(<App preferences={SAVED} />);

      await waitFor(() => expect(screen.getByRole("radio", { name: "Tennis" })).toBeChecked());
      expect(fetchMock.mock.calls.find(([url]) => url.startsWith("/api/events?"))?.[0]).toBe(
        "/api/events?sport=tennis&sort=start&bookmakers=betclic&kind=all&page=1"
      );
      expect(screen.getByRole("button", { name: "Tri : Date de début" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Bookmakers : Betclic" })).toBeInTheDocument();
    });

    it("lets the address win over the saved filters", async () => {
      window.history.replaceState(null, "", "/cotes?sport=football&sort=value");
      const fetchMock = stubFetch(["football", "tennis"]);
      render(<App preferences={SAVED} />);

      await waitFor(() => expect(screen.getByRole("radio", { name: "Football" })).toBeChecked());
      expect(fetchMock.mock.calls.find(([url]) => url.startsWith("/api/events?"))?.[0]).toBe(
        "/api/events?sport=football&sort=value&kind=all&page=1"
      );
    });

    it("starts the favorite sports from the account's, not this browser's", async () => {
      localStorage.setItem("coteradar.favoriteSports", JSON.stringify(["golf"]));
      window.history.replaceState(null, "", "/cotes");
      stubFetch(["football", "golf", "tennis"]);
      render(<App preferences={SAVED} />);

      await waitFor(() => expect(screen.getByRole("radio", { name: "Tennis" })).toBeChecked());
      // The account's favorite leads the row; the browser's golf stays in its place.
      const chips = within(screen.getByRole("group", { name: "Sport" })).getAllByRole("radio");
      expect(chips.map((radio) => radio.getAttribute("value"))).toEqual(["tennis", "football", "golf"]);
    });

    it("sends nothing while the visitor changes nothing", async () => {
      window.history.replaceState(null, "", "/cotes?sport=tennis&sort=start");
      const fetchMock = stubFetch(["football", "tennis"]);
      render(<App preferences={SAVED} />);

      await waitFor(() => expect(screen.getByRole("radio", { name: "Tennis" })).toBeChecked());
      await new Promise((resolve) => setTimeout(resolve, 1300));
      expect(puts(fetchMock)).toHaveLength(0);
    });

    it("saves the filters a second after the visitor changes one", async () => {
      window.history.replaceState(null, "", "/cotes");
      const fetchMock = stubFetch(["football", "tennis"]);
      render(<App />);
      await waitFor(() => expect(screen.getByRole("radio", { name: "Football" })).toBeChecked());

      pickSort("Date de début");
      toggleBookmaker("Winamax");

      await waitFor(() => expect(puts(fetchMock)).toHaveLength(1), { timeout: 3000 });
      const [url, init] = puts(fetchMock)[0];
      expect(url).toBe("/api/preferences");
      expect(JSON.parse(init!.body as string)).toEqual({
        sport: "football",
        sort: "start",
        bookmakers: ["betclic"],
        players: false,
        favoriteSports: [],
      });
    });

    it("doesn't save the sport it fell back to when the saved one has no match today", async () => {
      window.history.replaceState(null, "", "/cotes");
      const fetchMock = stubFetch(["football"]);
      render(<App preferences={SAVED} />);

      await waitFor(() => expect(screen.getByRole("radio", { name: "Football" })).toBeChecked());
      await new Promise((resolve) => setTimeout(resolve, 1300));
      expect(puts(fetchMock)).toHaveLength(0);
    });
  });

  describe("loading, errors and empty results", () => {
    const reply = (body: unknown) => Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
    const page = (total: number) => ({ events: [], total, page: 1, pageSize: 20 });

    it("shows placeholder rows until the first odds arrive", async () => {
      let answer: (value: unknown) => void = () => {};
      vi.stubGlobal(
        "fetch",
        vi.fn((url: string) => {
          if (url.startsWith("/api/competitions")) return emptyList();
          if (url === "/api/sports") return reply(["football"]);
          return new Promise((resolve) => {
            answer = resolve;
          });
        })
      );
      render(<App />);

      expect(screen.getByRole("main")).toHaveAttribute("aria-busy", "true");
      expect(screen.getAllByText("Chargement des cotes…").length).toBeGreaterThan(0);

      await act(async () => {
        answer({ ok: true, json: () => Promise.resolve(page(50)) });
      });
      await waitFor(() => expect(screen.getByRole("main")).toHaveAttribute("aria-busy", "false"));
      expect(screen.getByText("résultats", { exact: false })).toHaveTextContent("50 résultats · Football");
    });

    it("says the odds could not load, and loads them again on request", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      let fail = true;
      const fetchMock = vi.fn((url: string) => {
        if (url.startsWith("/api/competitions")) return emptyList();
        if (url === "/api/sports") return reply(["football"]);
        return fail ? Promise.resolve({ ok: false, status: 502 }) : reply(page(50));
      });
      vi.stubGlobal("fetch", fetchMock);
      render(<App />);

      await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Impossible de charger les cotes."));
      fail = false;
      fireEvent.click(screen.getByRole("button", { name: "Réessayer" }));

      await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
      expect(screen.getByText("résultats", { exact: false })).toHaveTextContent("50 résultats");
    });

    it("keeps the odds shown when a refresh fails, saying how old they are", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      let fail = false;
      vi.stubGlobal(
        "fetch",
        vi.fn((url: string) => {
          if (url.startsWith("/api/competitions")) return emptyList();
          if (url === "/api/sports") return reply(["football"]);
          return fail ? Promise.resolve({ ok: false, status: 502 }) : reply(page(50));
        })
      );
      render(<App />);
      await waitFor(() => expect(screen.getByText("résultats", { exact: false })).toHaveTextContent("50 résultats"));

      fail = true;
      fireEvent.click(screen.getByRole("button", { name: "Actualiser les cotes" }));

      await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/celles affichées datent de \d\d:\d\d/));
      expect(screen.getByText("résultats", { exact: false })).toHaveTextContent("50 résultats");
    });

    it("offers to clear a search that finds nothing", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn((url: string) => {
          if (url.startsWith("/api/competitions")) return emptyList();
          if (url === "/api/sports") return reply(["football"]);
          if (url.startsWith("/api/events/suggestions")) return reply([]);
          return reply(page(url.includes("q=") ? 0 : 50));
        })
      );
      render(<App />);
      fireEvent.change(screen.getByRole("combobox", { name: "Rechercher un match" }), { target: { value: "zzz" } });

      await waitFor(() => expect(screen.getByText("Aucun match ne correspond à « zzz ».")).toBeInTheDocument());
      fireEvent.click(screen.getByRole("button", { name: "Voir tous les matchs" }));

      expect(screen.getByRole("combobox", { name: "Rechercher un match" })).toHaveValue("");
    });

    it("asks to tick a bookmaker when none is, and offers to tick them all", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn((url: string) =>
          url === "/api/sports" ? reply(["football"]) : url.startsWith("/api/competitions") ? emptyList() : reply(page(50)),
        )
      );
      render(<App />);
      await waitFor(() => expect(screen.getByText("résultats", { exact: false })).toBeInTheDocument());

      for (const name of ["Winamax", "Betclic"]) toggleBookmaker(name);
      await waitFor(() => expect(screen.getByText("Cochez au moins un bookmaker pour comparer les cotes.")).toBeInTheDocument());
      fireEvent.click(screen.getByRole("button", { name: "Cocher tous les bookmakers" }));

      expect(screen.getByRole("button", { name: "Bookmakers : Tous" })).toBeInTheDocument();
      // All of them is the default: the address no longer names them.
      await waitFor(() => expect(new URLSearchParams(window.location.search).get("bookmakers")).toBeNull());
    });

    it("ends with a footer carrying the age limit", () => {
      vi.stubGlobal("fetch", vi.fn(() => reply([])));
      render(<App />);

      expect(screen.getByRole("contentinfo")).toHaveTextContent("Interdit aux moins de 18 ans");
    });
  });

  describe("header and filter bar", () => {
    const reply = (body: unknown) => Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
    const stubFetch = (sports: string[]) => {
      const fetchMock = vi.fn((url: string) => {
        if (url.startsWith("/api/competitions")) return emptyList();
        if (url === "/api/sports") return reply(sports);
        if (url.startsWith("/api/events/suggestions")) return reply([]);
        return reply({ events: [], total: 50, page: 1, pageSize: 20 });
      });
      vi.stubGlobal("fetch", fetchMock);
      return fetchMock;
    };
    const urlParams = () => Object.fromEntries(new URLSearchParams(window.location.search));

    it("says when the odds were last updated, and when an update failed", async () => {
      let fail = false;
      vi.stubGlobal(
        "fetch",
        vi.fn((url: string) => {
          if (url.startsWith("/api/competitions")) return emptyList();
          if (url === "/api/sports") return reply(["football"]);
          if (fail) return Promise.resolve({ ok: false, status: 502 });
          return reply({ events: [], total: 0, page: 1, pageSize: 20 });
        })
      );
      vi.spyOn(console, "error").mockImplementation(() => {});
      render(<App />);

      await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/Mis à jour à \d\d:\d\d/));

      fail = true;
      fireEvent.click(screen.getByRole("button", { name: "Actualiser les cotes" }));
      await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Actualisation impossible"));
    });

    it("fetches the same page again at once when asked to refresh", async () => {
      window.history.replaceState(null, "", "/?sport=football&page=2");
      const fetchMock = stubFetch(["football"]);
      render(<App />);
      const pageTwo = "/api/events?sport=football&sort=trj&kind=all&page=2";
      await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(pageTwo));
      await waitFor(() => expect(screen.getByRole("button", { name: "Actualiser les cotes" })).toBeEnabled());

      fireEvent.click(screen.getByRole("button", { name: "Actualiser les cotes" }));

      await waitFor(() => expect(fetchMock.mock.calls.filter(([url]) => url === pageTwo)).toHaveLength(2));
    });

    it("offers to reset the filters only once one differs, and resets them all", async () => {
      stubFetch(["football", "tennis"]);
      render(<App />);
      await waitFor(() => expect(screen.getByRole("radio", { name: "Tennis" })).toBeInTheDocument());
      expect(screen.queryByRole("button", { name: "Réinitialiser les filtres" })).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Bookmakers : Tous" })).toBeInTheDocument();

      fireEvent.click(screen.getByRole("radio", { name: "Tennis" }));
      pickSort("Date de début");
      toggleBookmaker("Winamax");
      fireEvent.change(screen.getByRole("combobox", { name: "Rechercher un match" }), { target: { value: "nadal" } });
      fireEvent.click(screen.getByRole("button", { name: "Réinitialiser les filtres" }));

      expect(screen.getByRole("radio", { name: "Football" })).toBeChecked();
      expect(screen.getByRole("button", { name: "Tri : Meilleur TRJ" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Bookmakers : Tous" })).toBeInTheDocument();
      expect(screen.getByRole("checkbox", { name: "Winamax" })).toBeChecked();
      expect(screen.getByRole("combobox", { name: "Rechercher un match" })).toHaveValue("");
      expect(screen.queryByRole("button", { name: "Réinitialiser les filtres" })).not.toBeInTheDocument();
      await waitFor(() => expect(urlParams()).toEqual({ sport: "football", sort: "trj" }));
    });

    it("opens on every bookmaker, and counts unticking one as a change", async () => {
      stubFetch(["football"]);
      render(<App />);
      await waitFor(() => expect(screen.getByRole("radio", { name: "Football" })).toBeInTheDocument());

      fireEvent.click(screen.getByRole("button", { name: "Bookmakers : Tous" }));
      for (const name of ["Winamax", "Betclic"]) expect(screen.getByRole("checkbox", { name })).toBeChecked();
      expect(screen.queryByRole("button", { name: "Réinitialiser les filtres" })).not.toBeInTheDocument();

      toggleBookmaker("Betclic");
      expect(screen.getByRole("button", { name: "Bookmakers : Winamax" })).toBeInTheDocument();
      await waitFor(() => expect(urlParams().bookmakers).toBe("winamax"));

      fireEvent.click(screen.getByRole("button", { name: "Réinitialiser les filtres" }));

      expect(screen.getByRole("button", { name: "Bookmakers : Tous" })).toBeInTheDocument();
      await waitFor(() => expect(urlParams()).toEqual({ sport: "football", sort: "trj" }));
    });

    it("has no accessibility violation axe can find", async () => {
      stubFetch(["football", "tennis"]);
      const { container } = render(<App />);
      await waitFor(() => expect(screen.getByRole("radio", { name: "Tennis" })).toBeInTheDocument());

      // jsdom renders no pixels: contrast is checked on real pages instead.
      const results = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
      expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(", ")}`)).toEqual([]);
    });
  });

  describe("favorite sports", () => {
    const reply = (body: unknown) => Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
    const stubFetch = () =>
      vi.stubGlobal(
        "fetch",
        vi.fn((url: string) =>
          url === "/api/sports"
            ? reply(["basketball", "football", "golf", "tennis"])
            : url.startsWith("/api/competitions")
              ? emptyList()
              : reply({ events: [], total: 0, page: 1, pageSize: 20 }),
        ),
      );
    const sportsInOrder = () =>
      screen
        .getAllByRole("radio")
        .filter((radio) => radio.getAttribute("name") === "sport")
        .map((radio) => radio.getAttribute("value"));
    const star = (name: string) => screen.getByRole("button", { name: `Favori : ${name}` });

    it("puts a starred sport first, and keeps it there after a reload", async () => {
      stubFetch();
      const { unmount } = render(<App />);
      await screen.findByRole("radio", { name: "Tennis" });

      fireEvent.click(star("Tennis"));
      expect(sportsInOrder()).toEqual(["tennis", "basketball", "football", "golf"]);

      unmount();
      render(<App />);
      await screen.findByRole("radio", { name: "Tennis" });
      expect(sportsInOrder()).toEqual(["tennis", "basketball", "football", "golf"]);

      fireEvent.click(star("Tennis"));
      expect(sportsInOrder()).toEqual(["basketball", "football", "golf", "tennis"]);
    });

    it("stops at three: the other stars close until one is taken off", async () => {
      stubFetch();
      render(<App />);
      await screen.findByRole("radio", { name: "Tennis" });

      for (const name of ["Basketball", "Football", "Golf"]) fireEvent.click(star(name));
      expect(star("Tennis")).toBeDisabled();

      fireEvent.click(star("Golf"));
      expect(star("Tennis")).toBeEnabled();
    });

    it("is not a filter: it stays out of the URL, and of what the reset button undoes", async () => {
      stubFetch();
      render(<App />);
      await screen.findByRole("radio", { name: "Tennis" });

      fireEvent.click(star("Tennis"));

      expect(window.location.search).not.toMatch(/tennis/);
      expect(screen.queryByRole("button", { name: /Réinitialiser/ })).not.toBeInTheDocument();
    });
  });

  describe("a match's every market", () => {
    const reply = (body: unknown, status = 200) =>
      Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) });
    const match = {
      id: "bvb",
      sport: "football",
      competition: "Bundesliga",
      startTime: new Date(Date.now() + 5 * 3600e3).toISOString(),
      participants: ["Borussia Dortmund", "Werder Brême"],
      byBookmaker: {
        winamax: {
          scrapedAt: new Date().toISOString(),
          odds: [
            { market: "1X2", selection: "1", price: 1.29 },
            { market: "1X2", selection: "X", price: 4.9 },
            { market: "1X2", selection: "2", price: 5.6 },
          ],
        },
      },
      payoutRate: 0.9,
      marketCount: 42,
    };
    const detail = {
      id: "bvb",
      sport: "football",
      competition: "Bundesliga",
      competitionFilter: "Bundesliga",
      startTime: match.startTime,
      participants: match.participants,
      comparedCount: 41,
      surebetCount: 0,
      sections: [
        {
          key: "goals",
          label: "Buts",
          markets: [
            {
              key: "btts",
              label: "Les deux équipes marquent",
              kind: "list",
              compared: true,
              lines: [
                {
                  line: null,
                  payoutRate: 0.88,
                  outcomes: [
                    { key: "yes", label: "Oui", prices: { winamax: 1.5, betclic: 1.52 }, best: ["betclic"] },
                    { key: "no", label: "Non", prices: { winamax: 2.05, betclic: 2.07 }, best: ["betclic"] },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const stubFetch = () => {
      const fetchMock = vi.fn((url: string) => {
        if (url.startsWith("/api/competitions")) return emptyList();
        if (url === "/api/sports") return reply(["football"]);
        if (url.startsWith("/api/events/suggestions")) return reply([]);
        if (url.startsWith("/api/events/bvb")) return reply(detail);
        if (url.startsWith("/api/events/")) return reply({ error: "not found" }, 404);
        return reply({ events: [match], total: 1, page: 1, pageSize: 20 });
      });
      vi.stubGlobal("fetch", fetchMock);
      return fetchMock;
    };
    const urlParams = () => Object.fromEntries(new URLSearchParams(window.location.search));

    it("opens from its row, in the URL and the history, and goes back to the list as it was", async () => {
      window.history.replaceState(null, "", "/?sport=football&sort=start");
      stubFetch();
      render(<App />);

      const link = await screen.findByRole("link", { name: "+41 marchés pour Borussia Dortmund - Werder Brême" });
      expect(link).toHaveAttribute("href", "?sport=football&sort=start&match=bvb");
      const entries = window.history.length;
      fireEvent.click(link);

      expect(await screen.findByRole("heading", { level: 2, name: "Borussia Dortmund – Werder Brême" })).toBeInTheDocument();
      expect(urlParams()).toEqual({ sport: "football", sort: "start", match: "bvb" });
      expect(window.history.length).toBe(entries + 1);
      // The list's filters make way for the match's page.
      expect(screen.queryByRole("search", { name: "Filtres" })).not.toBeInTheDocument();
      expect(screen.getByRole("article", { name: "Les deux équipes marquent" })).toBeInTheDocument();

      fireEvent.click(screen.getByRole("link", { name: "Tous les matchs" }));
      expect(await screen.findByRole("search", { name: "Filtres" })).toBeInTheDocument();
      await waitFor(() => expect(urlParams()).toEqual({ sport: "football", sort: "start" }));
    });

    it("leads from its competition to the matches' list narrowed to it, and Back returns to the match", async () => {
      window.history.replaceState(null, "", "/?sport=football&sort=start&bookmakers=betclic");
      const fetchMock = stubFetch();
      render(<App />);

      fireEvent.click(await screen.findByRole("link", { name: "+41 marchés pour Borussia Dortmund - Werder Brême" }));
      const link = await screen.findByRole("link", { name: "Voir les matchs : Bundesliga" });
      expect(link).toHaveAttribute("href", "?sport=football&sort=trj&bookmakers=betclic&competition=Bundesliga");

      fireEvent.click(link);
      await waitFor(() =>
        expect(fetchMock).toHaveBeenCalledWith(
          "/api/events?sport=football&sort=trj&bookmakers=betclic&kind=all&competition=Bundesliga&page=1"
        )
      );
      expect(await screen.findByRole("button", { name: "Compétition : Bundesliga" })).toBeInTheDocument();
      expect(screen.queryByRole("heading", { level: 2, name: "Borussia Dortmund – Werder Brême" })).not.toBeInTheDocument();
      expect(urlParams()).toEqual({ sport: "football", sort: "trj", bookmakers: "betclic", competition: "Bundesliga" });
      expect(screen.getByRole("radio", { name: "Matchs" })).toBeChecked();

      window.history.back();
      expect(await screen.findByRole("heading", { level: 2, name: "Borussia Dortmund – Werder Brême" })).toBeInTheDocument();
    });

    it("opens from the match's name as well, in the same way", async () => {
      window.history.replaceState(null, "", "/?sport=football&sort=start");
      stubFetch();
      render(<App />);

      const name = await screen.findByRole("link", { name: "Borussia Dortmund - Werder Brême" });
      expect(name).toHaveAttribute("href", "?sport=football&sort=start&match=bvb");
      fireEvent.click(name);

      expect(await screen.findByRole("heading", { level: 2, name: "Borussia Dortmund – Werder Brême" })).toBeInTheDocument();
      expect(urlParams()).toEqual({ sport: "football", sort: "start", match: "bvb" });
      expect(screen.getByRole("article", { name: "Les deux équipes marquent" })).toBeInTheDocument();

      fireEvent.click(screen.getByRole("link", { name: "Tous les matchs" }));
      expect(await screen.findByRole("search", { name: "Filtres" })).toBeInTheDocument();
    });

    it("opens straight from a shared link, and its back link leads to the list", async () => {
      window.history.replaceState(null, "", "/?sport=football&sort=trj&match=bvb");
      const fetchMock = stubFetch();
      render(<App />);

      expect(await screen.findByRole("heading", { level: 2, name: "Borussia Dortmund – Werder Brême" })).toBeInTheDocument();
      // The list is not asked for behind the match's page.
      expect(fetchMock.mock.calls.some(([url]) => url.startsWith("/api/events?"))).toBe(false);

      fireEvent.click(screen.getByRole("link", { name: "Tous les matchs" }));
      expect(await screen.findByRole("link", { name: /\+41 marchés/ })).toBeInTheDocument();
      expect(urlParams()).toEqual({ sport: "football", sort: "trj" });
    });

    it("says so when the shared match has started", async () => {
      window.history.replaceState(null, "", "/?sport=football&sort=trj&match=gone");
      stubFetch();
      render(<App />);
      expect(await screen.findByText(/Ce match n'est plus proposé/)).toBeInTheDocument();
    });
  });
});
