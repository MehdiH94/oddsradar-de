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

const PSG_OM = match("psg-om", ["PSG", "OM"], { winamax: [1.5, 4.1, 6.2], betclic: [1.55, 4.0, 6.0] });

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
  bookmaker: "betclic",
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
    expect(screen.getByRole("combobox", { name: "Rechercher un match" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Tri :/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Bookmakers :/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    const open = screen.getByRole("button", { name: "Filtres" });
    expect(open).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(open);

    const sheet = screen.getByRole("dialog", { name: "Filtres" });
    expect(open).toHaveAttribute("aria-expanded", "true");
    expect(within(sheet).getByRole("radio", { name: "Meilleur TRJ" })).toBeChecked();
    expect(within(sheet).getByRole("checkbox", { name: "Winamax" })).toBeChecked();
    expect(within(sheet).getByRole("checkbox", { name: "Vbet" })).not.toBeChecked();
    expect(within(sheet).getByRole("radio", { name: "Avec marchés joueurs" })).not.toBeChecked();
  });

  it("applies a filter of the sheet at once, counts it on its button, and resets it", async () => {
    const fetchMock = stubFetch();
    render(<App />);
    await screen.findByText("PSG - OM");
    fireEvent.click(screen.getByRole("button", { name: "Filtres" }));
    const sheet = screen.getByRole("dialog", { name: "Filtres" });

    fireEvent.click(within(sheet).getByRole("radio", { name: "Date de début" }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/events?sport=football&sort=start&bookmakers=winamax%2Cbetclic%2Cunibet&kind=all&page=1&pageSize=20"
      )
    );
    expect(urlParams().sort).toBe("start");

    fireEvent.click(within(sheet).getByRole("button", { name: "Réinitialiser" }));
    expect(within(sheet).getByRole("radio", { name: "Meilleur TRJ" })).toBeChecked();
    expect(within(sheet).queryByRole("button", { name: "Réinitialiser" })).not.toBeInTheDocument();

    fireEvent.click(within(sheet).getByRole("checkbox", { name: "Vbet" }));
    fireEvent.click(within(sheet).getByRole("button", { name: "Voir les 50 résultats" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Filtres, 1 actif" })).toBeInTheDocument();
  });

  it("narrows to a competition from the sheet: the sport's, counted on the button, in the address, and reset", async () => {
    const fetchMock = stubFetch();
    render(<App />);
    await screen.findByText("PSG - OM");
    fireEvent.click(screen.getByRole("button", { name: "Filtres" }));
    const sheet = screen.getByRole("dialog", { name: "Filtres" });
    expect(within(sheet).getByRole("radio", { name: "Toutes les compétitions" })).toBeChecked();

    fireEvent.click(within(sheet).getByRole("radio", { name: "Ligue 1" }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/events?sport=football&sort=trj&bookmakers=winamax%2Cbetclic%2Cunibet&kind=all&competition=Ligue+1&page=1&pageSize=20"
      )
    );
    expect(urlParams().competition).toBe("Ligue 1");

    fireEvent.click(within(sheet).getByRole("button", { name: "Voir les 50 résultats" }));
    expect(screen.getByRole("button", { name: "Filtres, 1 actif" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Filtres, 1 actif" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Filtres" })).getByRole("button", { name: "Réinitialiser" }));
    await waitFor(() => expect(urlParams().competition).toBeUndefined());
  });

  it("lists football's competitions folded, the big leagues first, and searches them from the sheet", async () => {
    const fetchMock = stubFetch({
      competitions: ["Bundesliga", "Championship", "Coupe de France", "Eredivisie", "Ligue 1", "Ligue 2", "Premier League", "Serie A", "Super Lig"],
    });
    render(<App />);
    await screen.findByText("PSG - OM");
    fireEvent.click(screen.getByRole("button", { name: "Filtres" }));
    const sheet = screen.getByRole("dialog", { name: "Filtres" });
    const names = () =>
      within(sheet)
        .getAllByRole("radio")
        .filter((radio) => radio.getAttribute("name") === "sheet-competition")
        .map((radio) => radio.parentElement?.textContent);

    expect(names()).toEqual([
      "Toutes les compétitions",
      "Ligue 1",
      "Serie A",
      "Bundesliga",
      "Premier League",
      "Championship",
      "Coupe de France",
      "Eredivisie",
    ]);
    fireEvent.click(within(sheet).getByRole("button", { name: "Afficher les 9 compétitions" }));
    expect(names()).toHaveLength(10);

    fireEvent.change(within(sheet).getByRole("searchbox", { name: "Rechercher une compétition" }), { target: { value: "super" } });
    expect(names()).toEqual(["Super Lig"]);
    fireEvent.click(within(sheet).getByRole("radio", { name: "Super Lig" }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/events?sport=football&sort=trj&bookmakers=winamax%2Cbetclic%2Cunibet&kind=all&competition=Super+Lig&page=1&pageSize=20"
      )
    );
  });

  it("closes the sheet with Escape and gives the focus back to its button", async () => {
    stubFetch();
    render(<App />);
    await screen.findByText("PSG - OM");
    const open = screen.getByRole("button", { name: "Filtres" });
    open.focus();
    fireEvent.click(open);
    expect(screen.getByRole("dialog", { name: "Filtres" })).toHaveFocus();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(open).toHaveFocus();
  });

  it("shows each outcome's best price, and every bookmaker's on demand", async () => {
    stubFetch();
    render(<App />);
    await screen.findByText("PSG - OM");

    // Betclic's 1,55 is the best "1"; Winamax's 1,50 shows only once compared.
    expect(screen.getByText("PSG : 1,55 chez Betclic")).toBeInTheDocument();
    expect(screen.getByText("Match nul : 4,10 chez Winamax")).toBeInTheDocument();
    expect(screen.queryByText("1,50")).not.toBeInTheDocument();

    const compare = screen.getByRole("button", { name: /^Comparer les cotes de 2 bookmakers pour PSG - OM/ });
    expect(compare).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(compare);
    expect(compare).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("1,50").closest("[data-bookmaker]")).toHaveAttribute("data-bookmaker", "winamax");

    expect(screen.getByRole("link", { name: "+41 marchés pour PSG - OM" })).toHaveAttribute(
      "href",
      "?sport=football&sort=trj&match=psg-om"
    );
  });

  it("grows the list with « Voir plus » instead of turning pages", async () => {
    const fetchMock = stubFetch({ total: 50 });
    render(<App />);
    await screen.findByText("PSG - OM");

    expect(screen.queryByRole("navigation", { name: "Pagination" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Voir 20 matchs de plus" }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/events?sport=football&sort=trj&bookmakers=winamax%2Cbetclic%2Cunibet&kind=all&page=1&pageSize=40"
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

    const nav = screen.getByRole("navigation", { name: "Navigation principale" });
    fireEvent.click(within(nav).getByRole("radio", { name: "Value bets" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/value-bets?sort=value&bookmakers=winamax%2Cbetclic%2Cunibet"));
    expect(screen.queryByRole("group", { name: "Sport" })).not.toBeInTheDocument();
    expect(await screen.findByRole("link", { name: "Tous les marchés du match PSG - OM" })).toBeInTheDocument();

    // Back to the sport left.
    fireEvent.click(within(nav).getByRole("radio", { name: "Matchs" }));
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

    fireEvent.click(screen.getByRole("button", { name: "Filtres" }));
    expect(await run(screen.getByRole("dialog", { name: "Filtres" }))).toEqual([]);
  });
});
