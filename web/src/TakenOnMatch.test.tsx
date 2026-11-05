import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { TakenOnMatch } from "./TakenOnMatch";
import type { TakenInfo } from "./takenSurebets";
import type { TakenValueBet } from "./takenValueBets";

const surebet = (eventId: string): TakenInfo => ({
  remind: false,
  eventId,
  startTime: "2026-11-05T19:45:00Z",
  label: "Galatasaray - Fenerbahçe, Ergebnis: Galatasaray @ 20bet 2,10 / Fenerbahçe @ LeoVegas 2,05",
  remindedAt: null,
  payoutRate: 1.024,
  legs: [
    { market: "1X2", selection: "1", source: "twentybet", side: "back", price: 2.1 },
    { market: "1X2", selection: "2", source: "leovegas", side: "back", price: 2.05 },
  ],
  stakes: [50, 52],
});

const valueBet = (eventId: string): TakenValueBet => ({
  eventId,
  startTime: "2026-11-05T19:45:00Z",
  label: "Galatasaray - Fenerbahçe, Ergebnis: Unentschieden",
  market: "1X2",
  selection: "X",
  bookmaker: "merkurbets",
  price: 3.6,
  edge: 0.05,
});

describe("TakenOnMatch", () => {
  it("lists what the account took on this match only", () => {
    render(
      <TakenOnMatch
        eventId="gala-fener"
        surebets={new Map([["s1", surebet("gala-fener")], ["s2", surebet("other")]])}
        valueBets={new Map([["v1", valueBet("gala-fener")], ["v2", valueBet("other")]])}
      />
    );
    expect(screen.getByRole("heading", { name: "Schon genommen" })).toBeInTheDocument();
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent(/^Surebet Galatasaray - Fenerbahçe, Ergebnis: .* · \+2,4.% · 2,40 € auf 100 € · Gesichert: \+3,00 € bei 102,00 € Einsatz$/);
    expect(items[1]).toHaveTextContent(/^Value Bet Galatasaray - Fenerbahçe, Ergebnis: Unentschieden @ Merkur Bets 3,60 · Vorteil \+5,0.%$/);
  });

  it("shows nothing when nothing was taken on it", () => {
    const { container } = render(<TakenOnMatch eventId="gala-fener" surebets={new Map([["s2", surebet("other")]])} />);
    expect(container).toBeEmptyDOMElement();
  });
});
