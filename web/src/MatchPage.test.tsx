import { ALL_BOOKMAKERS } from "./bookmakers";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MatchPage } from "./MatchPage";
import type { EventDetail, MarketDetail } from "./types";

const outcome = (key: string, label: string, prices: Record<string, number>, best: string[] = []) => ({
  key,
  label,
  prices,
  best,
});

const scorers: MarketDetail = {
  key: "anytime_scorer",
  label: "Buteur",
  kind: "list",
  compared: true,
  lines: [
    {
      line: null,
      payoutRate: null,
      outcomes: Array.from({ length: 34 }, (_, i) =>
        outcome(`p${i}`, i === 20 ? "Serhou Guirassy" : `Joueur ${i}`, { winamax: 2 + i, betclic: 2.1 + i }, ["betclic"])
      ),
    },
  ],
};

const detail: EventDetail = {
  id: "bvb",
  sport: "football",
  competition: "Bundesliga",
  competitionFilter: "Bundesliga",
  startTime: "2026-10-09T18:30:00.000Z",
  participants: ["Borussia Dortmund", "Werder Brême"],
  comparedCount: 3,
  surebetCount: 1,
  sections: [
    {
      key: "result",
      label: "Résultat",
      markets: [
        {
          key: "double_chance",
          label: "Double chance",
          kind: "list",
          compared: true,
          lines: [
            {
              line: null,
              payoutRate: null,
              outcomes: [
                outcome("1X", "Borussia Dortmund ou nul", { winamax: 1.07, betclic: 1.08 }, ["betclic"]),
                outcome("X2", "Nul ou Werder Brême", { betclic: 2.85 }),
              ],
            },
          ],
        },
      ],
    },
    {
      key: "goals",
      label: "Buts",
      markets: [
        {
          key: "total_goals",
          label: "Nombre de buts",
          kind: "lines",
          compared: true,
          lines: [
            {
              line: 2.5,
              payoutRate: 1.012,
              outcomes: [
                outcome("over", "Plus de 2.5", { winamax: 1.3, betclic: 1.31 }, ["betclic"]),
                outcome("under", "Moins de 2.5", { winamax: 4.8, betclic: 2.67 }, ["winamax"]),
              ],
            },
            {
              line: 3.5,
              payoutRate: null,
              outcomes: [outcome("over", "Plus de 3.5", { winamax: 1.8 })],
            },
          ],
        },
      ],
    },
    { key: "scorers", label: "Buteurs", markets: [scorers] },
    {
      key: "winamax",
      label: "Seulement at Winamax",
      markets: [
        {
          key: "wx:Remplaçant buteur",
          label: "Remplaçant buteur",
          kind: "list",
          compared: false,
          lines: [{ line: null, payoutRate: null, outcomes: [outcome("Oui", "Oui", { winamax: 2.15 })] }],
        },
      ],
    },
  ],
};

function stubFetch(body: unknown, status = 200) {
  const fetchMock = vi.fn(() => Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderPage(props: Partial<Parameters<typeof MatchPage>[0]> = {}) {
  return render(
    <MatchPage
      id="bvb"
      bookmakers={[...ALL_BOOKMAKERS]}
      onBookmakersChange={() => {}}
      backHref="?sport=football&sort=trj"
      onBack={() => {}}
      reloads={0}
      onStatus={() => {}}
      {...props}
    />
  );
}

describe("MatchPage", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("asks for the match's markets and titles the page with its teams", async () => {
    const fetchMock = stubFetch(detail);
    renderPage();

    expect(await screen.findByRole("heading", { level: 2, name: "Borussia Dortmund – Werder Brême" })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("/api/events/bvb");
    expect(screen.getByText(/3 markets compared/)).toBeInTheDocument();
    expect(screen.getByText("1 surebet")).toBeInTheDocument();
  });

  describe("the competition", () => {
    const competitionHref = (sport: string, competition: string) =>
      `?sport=${sport}&sort=trj&competition=${encodeURIComponent(competition)}`;

    it("is a link to the matches' list narrowed to it, named for what it leads to", async () => {
      stubFetch(detail);
      const onOpenCompetition = vi.fn();
      renderPage({ competitionHref, onOpenCompetition });

      const link = await screen.findByRole("link", { name: "Show the matches: Bundesliga" });
      expect(link).toHaveTextContent("Bundesliga");
      expect(link).toHaveAttribute("href", "?sport=football&sort=trj&competition=Bundesliga");

      fireEvent.click(link);
      expect(onOpenCompetition).toHaveBeenCalledWith("football", "Bundesliga");
    });

    it("leads to the filter's name for it, not the one the page shows", async () => {
      stubFetch({ ...detail, competition: "Ligue 1 McDonald's® 2026/2027", competitionFilter: "Ligue 1 McDonald's®" });
      const onOpenCompetition = vi.fn();
      renderPage({ competitionHref, onOpenCompetition });

      const link = await screen.findByRole("link", { name: "Show the matches: Ligue 1 McDonald's® 2026/2027" });
      expect(link).toHaveTextContent("Ligue 1 McDonald's® 2026/2027");
      fireEvent.click(link);
      expect(onOpenCompetition).toHaveBeenCalledWith("football", "Ligue 1 McDonald's®");
    });

    it("opens in a new tab with a modified click, the page staying where it is", async () => {
      stubFetch(detail);
      const onOpenCompetition = vi.fn();
      renderPage({ competitionHref, onOpenCompetition });

      fireEvent.click(await screen.findByRole("link", { name: "Show the matches: Bundesliga" }), { ctrlKey: true });
      expect(onOpenCompetition).not.toHaveBeenCalled();
    });

    it("is plain text without anywhere to lead to, or without a name", async () => {
      stubFetch(detail);
      const { unmount } = renderPage();
      expect(await screen.findByText(/Bundesliga/)).toBeInTheDocument();
      expect(screen.queryByRole("link", { name: /Show the matches/ })).not.toBeInTheDocument();
      unmount();

      stubFetch({ ...detail, competition: "", competitionFilter: "" });
      renderPage({ competitionHref, onOpenCompetition: () => {} });
      await screen.findByRole("heading", { level: 2 });
      expect(screen.queryByRole("link", { name: /Show the matches/ })).not.toBeInTheDocument();
    });
  });

  it("asks only for the ticked bookmakers' prices", async () => {
    const fetchMock = stubFetch(detail);
    renderPage({ bookmakers: ["betclic"] });
    await screen.findByRole("heading", { level: 2 });
    expect(fetchMock).toHaveBeenCalledWith("/api/events/bvb?bookmakers=betclic");
  });

  it("sizes the markets' columns for the ticked bookmakers, so that no price is cut", async () => {
    stubFetch(detail);
    const { container, rerender } = renderPage();
    const card = await screen.findByRole("article", { name: "Double chance" });
    const markets = () => card.parentElement as HTMLElement;
    expect(markets().style.getPropertyValue("--bookmakers")).toBe(String(ALL_BOOKMAKERS.length));
    expect(container).toContainElement(markets());

    rerender(
      <MatchPage
        id="bvb"
        bookmakers={["betclic"]}
        onBookmakersChange={() => {}}
        backHref="?sport=football&sort=trj"
        onBack={() => {}}
        reloads={0}
        onStatus={() => {}}
      />
    );
    await waitFor(() => expect(markets().style.getPropertyValue("--bookmakers")).toBe("1"));
  });

  it("shows each market in its section, each outcome with every bookmaker's price and the best ticked", async () => {
    stubFetch(detail);
    renderPage();

    const card = await screen.findByRole("article", { name: "Double chance" });
    const row = within(card).getByRole("row", { name: /Borussia Dortmund ou nul/ });
    expect(row).toHaveTextContent("Winamax: 1.07");
    expect(row).toHaveTextContent("Betclic: 1.08 (best price)");
    // One bookmaker's price only: nothing to compare, no best.
    expect(within(card).getByRole("row", { name: /Nul ou Werder Brême/ })).not.toHaveTextContent("best price");
  });

  it("lays over/under lines out as a table, with each line's TRJ", async () => {
    stubFetch(detail);
    renderPage();

    const card = await screen.findByRole("article", { name: "Nombre de buts" });
    const table = within(card).getByRole("table");
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual([
      "Line",
      "Over",
      "Under",
      "Payout",
    ]);
    const line = within(table).getByRole("row", { name: /2.5/ });
    expect(line).toHaveTextContent("101.2");
    expect(line).toHaveTextContent("Surebet");
  });

  it("folds a long list to its favourites, and finds the rest by name", async () => {
    stubFetch(detail);
    renderPage();

    const card = await screen.findByRole("article", { name: "Buteur" });
    expect(within(card).getAllByRole("row")).toHaveLength(10);
    fireEvent.change(within(card).getByRole("searchbox", { name: "Search in Buteur" }), { target: { value: "guir" } });
    expect(within(card).getAllByRole("row").map((r) => r.querySelector("th")?.textContent)).toEqual(["Serhou Guirassy"]);
    fireEvent.change(within(card).getByRole("searchbox"), { target: { value: "" } });
    fireEvent.click(within(card).getByRole("button", { name: "Show the 24 others" }));
    expect(within(card).getAllByRole("row")).toHaveLength(34);
  });

  it("folds the markets only one bookmaker offers, and opens a section from its link", async () => {
    stubFetch(detail);
    renderPage();

    const toggle = await screen.findByRole("button", { name: "Seulement at Winamax, 1 market" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("article", { name: "Remplaçant buteur" })).not.toBeInTheDocument();

    fireEvent.click(within(screen.getByRole("navigation", { name: "Sections" })).getByRole("button", { name: "Seulement at Winamax" }));
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("article", { name: "Remplaçant buteur" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Buts, 1 market" }));
    expect(screen.queryByRole("article", { name: "Nombre de buts" })).not.toBeInTheDocument();
  });

  it("goes back to the list by its link, which also works as a plain link", async () => {
    stubFetch(detail);
    const onBack = vi.fn();
    renderPage({ onBack });

    const back = await screen.findByRole("link", { name: "All matches" });
    expect(back).toHaveAttribute("href", "?sport=football&sort=trj");
    fireEvent.click(back);
    expect(onBack).toHaveBeenCalled();
  });

  it("says so when the match is no longer offered", async () => {
    stubFetch({ error: "not found" }, 404);
    renderPage();
    expect(await screen.findByText(/This match is no longer offered/)).toBeInTheDocument();
  });

  it("reports how fresh its prices are, and tries again after a failure", async () => {
    const onStatus = vi.fn();
    const fetchMock = vi.fn(() => Promise.reject(new Error("offline")));
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "error").mockImplementation(() => {});
    renderPage({ onStatus });

    await waitFor(() => expect(onStatus).toHaveBeenLastCalledWith({ refreshing: false, failed: true }));
    stubFetch(detail);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(onStatus).toHaveBeenLastCalledWith(expect.objectContaining({ failed: false, updated: expect.any(Date) })));
  });
});
