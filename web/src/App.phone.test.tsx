import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import axe from "axe-core";
import { App } from "./App";
import { mockPhone } from "./testUtils";
import type { EventWithOdds } from "./types";

// The site is used on a phone first (README): the same App, laid out for a
// 375 px screen. App.test.tsx covers the desktop's.

const reply = (body: unknown) => Promise.resolve({ ok: true, json: () => Promise.resolve(body) });

const match = (id: string, participants: string[], prices: Record<string, [number, number, number]>): EventWithOdds => ({
  id,
  sport: "football",
  competition: "Ligue 1",
  startTime: "2099-01-01T20:00:00.000Z",
  participants,
  marketCount: 42,
  payoutRate: 0.95,
  byBookmaker: Object.fromEntries(
    Object.entries(prices).map(([bookmaker, [one, draw, two]]) => [
      bookmaker,
      {
        scrapedAt: "2099-01-01T10:00:00.000Z",
        odds: [
          { market: "1X2", selection: "1", price: one },
          { market: "1X2", selection: "X", price: draw },
          { market: "1X2", selection: "2", price: two },
        ],
      },
    ])
  ),
});

const PSG_OM = match("psg-om", ["PSG", "OM"], { leovegas: [1.5, 4.1, 6.2], betway: [1.55, 4.0, 6.0] });

const BET = {
  eventId: "psg-om",
  sport: "football",
  competition: "Ligue 1",
  startTime: "2099-01-01T20:00:00.000Z",
  participants: ["PSG", "OM"],
  marketCount: 42,
  market: "1X2",
  marketLabel: "Résultat du match",
  selection: "1",
  label: "PSG",
  bookmaker: "betway",
  price: 1.6,
  basis: "fair",
  fair: 1.5,
  edge: 0.0667,
  matched: 4200,
};

function stubFetch({ total = 50, competitions = ["Coupe de France", "Ligue 1"] }: { total?: number; competitions?: string[] } = {}) {
  const fetchMock = vi.fn((url: string) => {
    if (url.startsWith("/api/competitions")) return reply(competitions);
    if (url === "/api/sports") return reply(["football", "tennis"]);
    if (url.startsWith("/api/events/suggestions")) return reply([]);
    if (url.startsWith("/api/events/psg-om")) {
      return reply({ ...PSG_OM, sections: [], comparedCount: 0, surebetCount: 0 });
    }
    if (url.startsWith("/api/value-bets")) return reply({ bets: [BET], total: 1, surebets: [] });
    return reply({ events: [PSG_OM], total, page: 1, pageSize: 20 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const urlParams = () => Object.fromEntries(new URLSearchParams(window.location.search));

describe("App on a phone", () => {
  beforeEach(() => mockPhone());
  afterEach(() => {
    vi.unstubAllGlobals();
    window.history.replaceState(null, "", "/");
  });

  it("keeps the sports and the search in sight, the other filters in a sheet", async () => {
    stubFetch();
    render(<App />);
    await screen.findByText("PSG - OM");

    expect(screen.getByRole("radio", { name: "Football" })).toBeChecked();
    expect(screen.getByRole("combobox", { name: "Search for a match" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Sort:/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Bookmakers :/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    const open = screen.getByRole("button", { name: "Filters" });
    expect(open).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(open);

    const sheet = screen.getByRole("dialog", { name: "Filters" });
    expect(open).toHaveAttribute("aria-expanded", "true");
    expect(within(sheet).getByRole("radio", { name: "Best payout" })).toBeChecked();
    expect(within(sheet).getByRole("checkbox", { name: "LeoVegas" })).toBeChecked();
    expect(within(sheet).getByRole("checkbox", { name: "Betway" })).toBeChecked();
    expect(within(sheet).getByRole("radio", { name: "With player markets" })).not.toBeChecked();
  });

  it("applies a filter of the sheet at once, counts it on its button, and resets it", async () => {
    const fetchMock = stubFetch();
    render(<App />);
    await screen.findByText("PSG - OM");
    fireEvent.click(screen.getByRole("button", { name: "Filters" }));
    const sheet = screen.getByRole("dialog", { name: "Filters" });

    fireEvent.click(within(sheet).getByRole("radio", { name: "Kick-off time" }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/events?sport=football&sort=start&kind=all&page=1&pageSize=20"
      )
    );
    expect(urlParams().sort).toBe("start");

    fireEvent.click(within(sheet).getByRole("button", { name: "Reset" }));
    expect(within(sheet).getByRole("radio", { name: "Best payout" })).toBeChecked();
    expect(within(sheet).queryByRole("button", { name: "Reset" })).not.toBeInTheDocument();

    fireEvent.click(within(sheet).getByRole("checkbox", { name: "Betway" }));
    fireEvent.click(within(sheet).getByRole("button", { name: "Show the 50 results" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Filters, 1 active" })).toBeInTheDocument();
  });

  it("narrows to a competition from the sheet: the sport's, counted on the button, in the address, and reset", async () => {
    const fetchMock = stubFetch();
    render(<App />);
    await screen.findByText("PSG - OM");
    fireEvent.click(screen.getByRole("button", { name: "Filters" }));
    const sheet = screen.getByRole("dialog", { name: "Filters" });
    expect(within(sheet).getByRole("radio", { name: "All competitions" })).toBeChecked();

    fireEvent.click(within(sheet).getByRole("radio", { name: "Ligue 1" }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/events?sport=football&sort=trj&kind=all&competition=Ligue+1&page=1&pageSize=20"
      )
    );
    expect(urlParams().competition).toBe("Ligue 1");

    fireEvent.click(within(sheet).getByRole("button", { name: "Show the 50 results" }));
    expect(screen.getByRole("button", { name: "Filters, 1 active" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Filters, 1 active" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Filters" })).getByRole("button", { name: "Reset" }));
    await waitFor(() => expect(urlParams().competition).toBeUndefined());
  });

  it("lists football's competitions folded, the big leagues first, and searches them from the sheet", async () => {
    const fetchMock = stubFetch({
      competitions: ["Bundesliga", "Championship", "Coupe de France", "Eredivisie", "Ligue 1", "Ligue 2", "Premier League", "Serie A", "Super Lig"],
    });
    render(<App />);
    await screen.findByText("PSG - OM");
    fireEvent.click(screen.getByRole("button", { name: "Filters" }));
    const sheet = screen.getByRole("dialog", { name: "Filters" });
    const names = () =>
      within(sheet)
        .getAllByRole("radio")
        .filter((radio) => radio.getAttribute("name") === "sheet-competition")
        .map((radio) => radio.parentElement?.textContent);

    expect(names()).toEqual([
      "All competitions",
      "Bundesliga",
      "Premier League",
      "Serie A",
      "Ligue 1",
      "Championship",
      "Coupe de France",
      "Eredivisie",
    ]);
    fireEvent.click(within(sheet).getByRole("button", { name: "Show all 9 competitions" }));
    expect(names()).toHaveLength(10);

    fireEvent.change(within(sheet).getByRole("searchbox", { name: "Search for a competition" }), { target: { value: "super" } });
    expect(names()).toEqual(["Super Lig"]);
    fireEvent.click(within(sheet).getByRole("radio", { name: "Super Lig" }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/events?sport=football&sort=trj&kind=all&competition=Super+Lig&page=1&pageSize=20"
      )
    );
  });

  it("closes the sheet with Escape and gives the focus back to its button", async () => {
    stubFetch();
    render(<App />);
    await screen.findByText("PSG - OM");
    const open = screen.getByRole("button", { name: "Filters" });
    open.focus();
    fireEvent.click(open);
    expect(screen.getByRole("dialog", { name: "Filters" })).toHaveFocus();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(open).toHaveFocus();
  });

  it("shows each outcome's best price, and every bookmaker's on demand", async () => {
    stubFetch();
    render(<App />);
    await screen.findByText("PSG - OM");

    // Betway's 1,55 is the best "1"; LeoVegas's 1,50 shows only once compared.
    expect(screen.getByText("PSG: 1.55 at Betway")).toBeInTheDocument();
    expect(screen.getByText("Draw: 4.10 at LeoVegas")).toBeInTheDocument();
    expect(screen.queryByText("1.50")).not.toBeInTheDocument();

    const compare = screen.getByRole("button", { name: /^Compare the prices of 2 bookmakers for PSG - OM/ });
    expect(compare).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(compare);
    expect(compare).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("1.50").closest("[data-bookmaker]")).toHaveAttribute("data-bookmaker", "leovegas");

    expect(screen.getByRole("link", { name: "+41 markets for PSG - OM" })).toHaveAttribute(
      "href",
      "?sport=football&sort=trj&match=psg-om"
    );
  });

  it("grows the list with “Show more” instead of turning pages", async () => {
    const fetchMock = stubFetch({ total: 50 });
    render(<App />);
    await screen.findByText("PSG - OM");

    expect(screen.queryByRole("navigation", { name: "Pagination" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show 20 more matches" }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/events?sport=football&sort=trj&kind=all&page=1&pageSize=40"
      )
    );
    // A phone's URL keeps no page.
    expect(urlParams().page).toBeUndefined();
  });

  it("switches between the value bets and the matches from the bottom bar", async () => {
    const fetchMock = stubFetch();
    render(<App />);
    await screen.findByText("PSG - OM");
    fireEvent.click(screen.getByRole("radio", { name: "Tennis" }));
    await waitFor(() => expect(urlParams().sport).toBe("tennis"));

    const nav = screen.getByRole("navigation", { name: "Main navigation" });
    fireEvent.click(within(nav).getByRole("radio", { name: "Value bets" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/value-bets?sort=value"));
    expect(screen.queryByRole("group", { name: "Sport" })).not.toBeInTheDocument();
    expect(await screen.findByRole("link", { name: "Every market of the match PSG - OM" })).toBeInTheDocument();

    // Back to the sport left.
    fireEvent.click(within(nav).getByRole("radio", { name: "Matches" }));
    await waitFor(() => expect(urlParams().sport).toBe("tennis"));
    expect(screen.getByRole("radio", { name: "Tennis" })).toBeChecked();
  });

  it("has no accessibility violation axe can find, the sheet open too", async () => {
    stubFetch();
    const { container } = render(<App />);
    await screen.findByText("PSG - OM");

    const run = async (root: Element) => {
      const results = await axe.run(root, { rules: { "color-contrast": { enabled: false } } });
      return results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(", ")}`);
    };
    expect(await run(container)).toEqual([]);

    fireEvent.click(screen.getByRole("button", { name: "Filters" }));
    expect(await run(screen.getByRole("dialog", { name: "Filters" }))).toEqual([]);
  });
});
