import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { ValueBetsTable } from "./ValueBetsTable";
import type { ValueBet } from "./types";

const bet = (overrides: Partial<ValueBet>): ValueBet => ({
  eventId: "psg-om",
  sport: "football",
  competition: "Ligue 1",
  startTime: "2099-01-01T20:00:00.000Z",
  participants: ["PSG", "OM"],
  marketCount: 42,
  market: "1X2",
  marketLabel: "Spielergebnis (1X2)",
  selection: "1",
  label: "PSG",
  bookmaker: "merkurbets",
  price: 1.56,
  basis: "fair",
  fair: 1.5,
  edge: 0.04,
  matched: 4200,
  ...overrides,
});

describe("ValueBetsTable", () => {
  it("shows one row per bet: kick-off, match, outcome, price, fair odds and edge", () => {
    render(
      <ValueBetsTable
        bets={[
          bet({}),
          bet({ selection: "X", label: "Unentschieden", bookmaker: "leovegas", price: 4.4, fair: 4.2, edge: 4.4 / 4.2 - 1 }),
        ]}
      />
    );
    expect(screen.getByRole("heading", { level: 2, name: "Value Bets" })).toBeInTheDocument();
    expect(screen.getAllByRole("columnheader").map((th) => th.textContent)).toEqual([
      "Anstoß",
      "Spiel",
      "Wette",
      "Quote",
      "Fair (faire Quote)",
      "Vorteil gegenüber der fairen Quote",
    ]);
    const [first, second] = screen.getAllByRole("row").slice(1);
    const cells = within(first).getAllByRole("cell");
    expect(cells[0].querySelector("time")).toHaveAttribute("dateTime", "2099-01-01T20:00:00.000Z");
    expect(cells[1]).toHaveTextContent("⚽ PSG - OMLigue 1");
    expect(cells[2]).toHaveTextContent("PSGSpielergebnis (1X2)");
    expect(cells[3].querySelector('[data-bookmaker="merkurbets"]')).toHaveAttribute("data-value", "true");
    expect(cells[3]).toHaveTextContent("Merkur Bets: 1,56 (Value Bet: +4,0 % über der fairen Quote)");
    expect(cells[4]).toHaveTextContent("1,50");
    expect(cells[5]).toHaveTextContent("+4,0 %");
    expect(within(second).getAllByRole("cell")[2]).toHaveTextContent("Unentschieden");
    expect(within(second).getAllByRole("cell")[3]).toHaveTextContent("LeoVegas: 4,40");
  });

  it("links each bet to its match's every market, opened in place on a plain click", () => {
    const onOpenMatch = vi.fn();
    render(
      <ValueBetsTable
        bets={[bet({}), bet({ eventId: "lens-lille", participants: ["Lens", "Lille"], marketCount: 1 })]}
        matchHref={(id) => `?match=${id}`}
        onOpenMatch={onOpenMatch}
      />
    );

    const link = screen.getByRole("link", { name: "+41 Märkte für PSG - OM" });
    expect(link).toHaveAttribute("href", "?match=psg-om");
    fireEvent.click(link);
    expect(onOpenMatch).toHaveBeenCalledWith("psg-om");
    // A new tab keeps the link's own way.
    fireEvent.click(link, { ctrlKey: true });
    expect(onOpenMatch).toHaveBeenCalledTimes(1);
    // Nothing more than its 1X2: its title leads to the page, with no "+N markets".
    expect(screen.getAllByRole("link").map((a) => a.textContent)).toEqual(["PSG - OM", "+41 Märkte", "Lens - Lille"]);
  });

  it("names the sport of each row by its icon, and leads the match's title to its page", () => {
    const onOpenMatch = vi.fn();
    render(
      <ValueBetsTable
        bets={[bet({})]}
        matchHref={(id) => `?match=${id}`}
        onOpenMatch={onOpenMatch}
        sportHref={(sport, q) => `?sport=${sport}&q=${q}`}
      />
    );
    expect(screen.getByRole("img", { name: "Fußball" })).toBeInTheDocument();
    const title = screen.getByRole("link", { name: "PSG - OM" });
    expect(title).toHaveAttribute("href", "?match=psg-om");
    fireEvent.click(title);
    expect(onOpenMatch).toHaveBeenCalledWith("psg-om");
  });

  it("leads a bet on a match with no other market to the match's page all the same", () => {
    const onOpenMatch = vi.fn();
    render(
      <ValueBetsTable
        bets={[bet({ eventId: "lens-lille", participants: ["Lens", "Lille"], marketCount: 1 })]}
        matchHref={(id) => `?match=${id}`}
        onOpenMatch={onOpenMatch}
        sportHref={(sport, q) => `?sport=${sport}&q=${q}`}
      />
    );
    const title = screen.getByRole("link", { name: "Lens - Lille" });
    expect(title).toHaveAttribute("href", "?match=lens-lille");
    fireEvent.click(title);
    expect(onOpenMatch).toHaveBeenCalledWith("lens-lille");
    // No "+N markets" next to it.
    expect(screen.getAllByRole("link")).toHaveLength(1);
  });

  it("shows a player's bet with its market, a row per market", () => {
    render(
      <ValueBetsTable
        bets={[
          bet({ market: "anytime_scorer", marketLabel: "Torschütze (jederzeit)", selection: "Mbappé", label: "Mbappé", price: 2.3, fair: 2 }),
          // The same player scoring twice, at the same bookmaker: a row of its own.
          bet({
            market: "scorer_goals|2",
            marketLabel: "Erzielt mindestens 2 Tore",
            selection: "Mbappé",
            label: "Mbappé",
            price: 7,
            fair: 6.5,
            edge: 7 / 6.5 - 1,
          }),
        ]}
      />
    );
    const [scorer, twice] = screen.getAllByRole("row").slice(1).map((row) => within(row).getAllByRole("cell"));
    expect(scorer[2]).toHaveTextContent("MbappéTorschütze (jederzeit)");
    expect(scorer[4]).toHaveTextContent("2,00");
    expect(twice[2]).toHaveTextContent("MbappéErzielt mindestens 2 Tore");
    expect(twice[5]).toHaveTextContent("+7,7 %");
  });

  it("weighs a loosely priced player against the exchange's lay, and an unpriced one against the other bookmaker", () => {
    render(
      <ValueBetsTable
        bets={[
          bet({ market: "anytime_scorer", marketLabel: "Torschütze (jederzeit)", selection: "Doué", label: "Doué", bookmaker: "leovegas", price: 2.8, basis: "lay", fair: 2.6, edge: 2.8 / 2.6 - 1 }),
          bet({
            market: "first_scorer",
            marketLabel: "Premier buteur",
            selection: "Lepaul",
            label: "Lepaul",
            bookmaker: "leovegas",
            price: 13,
            basis: "bookmaker",
            fair: 9,
            referenceBookmaker: "merkurbets",
            edge: 13 / 9 - 1,
          }),
        ]}
      />
    );
    const [lay, suspect] = screen.getAllByRole("row").slice(1).map((row) => within(row).getAllByRole("cell"));
    expect(lay[2]).toHaveTextContent(/^DouéTorschütze \(jederzeit\)$/);
    expect(lay[4]).toHaveTextContent("≤ höchstens 2,60");
    expect(lay[4]).toHaveAttribute("title", expect.stringMatching(/^Faire Quote höchstens: die Lay-Quote an/));
    expect(lay[3]).toHaveTextContent("(Value Bet: +7,7 % über der fairen Quote)");

    expect(suspect[2]).toHaveTextContent("LepaulPremier buteur · verdächtige Quote");
    expect(suspect[3]).toHaveTextContent("LeoVegas: 13,00 (verdächtige Quote: +44,4 % über dem anderen Buchmacher)");
    expect(suspect[4]).toHaveTextContent("9,00 bei Merkur Bets");
    expect(suspect[4]).toHaveAttribute("title", expect.stringMatching(/wird dieser Spieler nicht gehandelt; die Quote bei Merkur Bets$/));
    expect(suspect[5]).toHaveTextContent("+44,4 %");
  });
});
