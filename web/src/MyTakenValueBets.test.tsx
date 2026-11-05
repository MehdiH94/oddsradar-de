import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MyTakenValueBets } from "./MyTakenValueBets";
import type { TakenValueBet } from "./takenValueBets";

const NOW = new Date("2026-11-04T12:00:00Z");
const bet = (over: Partial<TakenValueBet>): TakenValueBet => ({
  eventId: "gala-fener",
  startTime: "2026-11-04T19:45:00Z",
  label: "Galatasaray - Fenerbahçe, Ergebnis: Fenerbahçe",
  market: "1X2",
  selection: "2",
  bookmaker: "twentybet",
  price: 3.5,
  edge: 0.045,
  ...over,
});

describe("MyTakenValueBets", () => {
  it("shows nothing without a taken value bet", () => {
    const { container } = render(<MyTakenValueBets taken={new Map()} now={NOW} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("lists them soonest first with their edge, and once played their closing price", () => {
    const taken = new Map([
      ["later", bet({})],
      ["played", bet({ startTime: "2026-11-04T10:00:00Z", label: "A - B, Ergebnis: A", price: 3.3, closing: 3, edge: 0.03 })],
    ]);
    render(<MyTakenValueBets taken={taken} matchHref={(id) => `/spiel/${id}`} now={NOW} />);
    expect(screen.getByText("Meine Value Bets (2)")).toBeInTheDocument();
    expect(screen.getByText(/^2 Value Bets · Ø Vorteil \+3,8.% · Ø \+10,0.% gegenüber dem Schlusskurs \(1\)$/)).toBeInTheDocument();
    const [played, later] = screen.getAllByRole("listitem");
    expect(within(played).getByText("A - B, Ergebnis: A @ 20bet 3,30")).toBeInTheDocument();
    expect(within(played).getByText("Gespielt")).toBeInTheDocument();
    expect(within(played).getByText(/^Schlusskurs 3,00 \(\+10,0.%\)$/)).toBeInTheDocument();
    expect(within(later).getByText(/^Vorteil \+4,5.%$/)).toBeInTheDocument();
    expect(within(later).getByRole("link", { name: "Spielseite" })).toHaveAttribute("href", "/spiel/gala-fener");
    expect(within(later).queryByText(/Schlusskurs/)).not.toBeInTheDocument();
  });

  it("writes down the stake placed when its field is left, and says what it is expected to win", () => {
    const onStake = vi.fn();
    render(<MyTakenValueBets taken={new Map([["k", bet({ stake: 20 })]])} onStake={onStake} now={NOW} />);
    expect(screen.getByText("erwartet +0,90 €")).toBeInTheDocument();
    expect(screen.getByText("Einsatz 20,00 € · erwartet +0,90 €")).toBeInTheDocument();
    const field = screen.getByRole("textbox", { name: "Einsatz bei 20bet (3,50) in Euro" });
    expect(field).toHaveValue("20");
    fireEvent.change(field, { target: { value: "25,5" } });
    fireEvent.blur(field);
    expect(onStake).toHaveBeenCalledWith("k", 25.5);
    // Nothing sent for a field that is not an amount.
    fireEvent.change(field, { target: { value: "abc" } });
    fireEvent.blur(field);
    expect(onStake).toHaveBeenCalledTimes(1);
  });

  it("says the month's total, the results the server already forgot included", () => {
    const results = { month: "2026-11", count: 4, staked: 200, expected: 8, clvSum: 0, clvStake: 0 };
    render(<MyTakenValueBets taken={new Map()} results={results} now={NOW} />);
    expect(screen.getByText("November: 4 Value Bets · 200,00 € Einsatz · erwartet +8,00 €")).toBeInTheDocument();
    expect(screen.getByText("Meine Value Bets (0)")).toBeInTheDocument();
  });
});
