import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
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
});
