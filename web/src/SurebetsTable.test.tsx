import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { SurebetsTable } from "./SurebetsTable";
import type { Surebet } from "./types";

const surebet = (overrides: Partial<Surebet>): Surebet => ({
  eventId: "dmh",
  sport: "tennis",
  competition: "Pékin ATP",
  startTime: "2099-01-01T07:00:00.000Z",
  participants: ["Alex De Minaur", "Hubert Hurkacz"],
  marketCount: 70,
  market: "player_aces@2|9.5",
  marketLabel: "Aces réussis par Hubert Hurkacz (9.5 aces)",
  kind: "bookmakers",
  payoutRate: 1 / (1 / 2 + 1 / 2.2),
  profit: 100 * (1 / (1 / 2 + 1 / 2.2) - 1),
  toVerify: false,
  thin: false,
  legs: [
    { selection: "over", label: "Über 9,5", source: "merkurbets", side: "back", price: 2, stake: 52.38 },
    { selection: "under", label: "Unter 9,5", source: "leovegas", side: "back", price: 2.2, stake: 47.62 },
  ],
  ...overrides,
});

describe("SurebetsTable", () => {
  it("shows one row per surebet: kick-off, match and market, each bet for €100, the TRJ and the profit", () => {
    render(<SurebetsTable surebets={[surebet({})]} />);
    expect(screen.getByRole("heading", { level: 2, name: "Surebets" })).toBeInTheDocument();
    expect(screen.getAllByRole("columnheader").map((th) => th.textContent)).toEqual([
      "Anstoß",
      "Spiel",
      "Wetten für 100\u00a0€",
      "Auszahlung",
    ]);
    const cells = within(screen.getAllByRole("row")[1]).getAllByRole("cell");
    expect(cells[0].querySelector("time")).toHaveAttribute("dateTime", "2099-01-01T07:00:00.000Z");
    expect(cells[1]).toHaveTextContent("🎾 Alex De Minaur - Hubert HurkaczAces réussis par Hubert Hurkacz (9.5 aces)");
    expect(within(cells[2]).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "Über 9,5Merkur Bets2,00Einsatz 52,38\u00a0€",
      "Unter 9,5LeoVegas2,20Einsatz 47,62\u00a0€",
    ]);
    expect(cells[3]).toHaveTextContent("104,8 %+4,76 €");
    expect(cells[3]).not.toHaveTextContent("zu prüfen");
  });

  it("links each bookmaker's bet to the match's page there, in a new tab; none for the exchange or without a link", () => {
    render(
      <SurebetsTable
        surebets={[
          surebet({}),
          surebet({
            eventId: "psg",
            participants: ["PSG", "OM"],
            market: "anytime_scorer",
            kind: "lay",
            legs: [
              {
                selection: "Dembélé",
                label: "Dembélé",
                source: "betway",
                side: "back",
                price: 2.5,
                stake: 100,
                url: "https://betway.de/de/de/sports/event/17260272",
              },
              { selection: "Dembélé", label: "Dembélé", source: "exchange", side: "lay", price: 2.3, stake: 109.65, liability: 142.54 },
            ],
          }),
          surebet({
            eventId: "lal",
            legs: [
              {
                selection: "over",
                label: "Über 9,5",
                source: "leovegas",
                side: "back",
                price: 2,
                stake: 52.38,
                url: "https://www.leovegas.de/de-de/sportwetten#event/1028036087",
              },
              { selection: "under", label: "Unter 9,5", source: "twentybet", side: "back", price: 2.2, stake: 47.62 },
            ],
          }),
        ]}
      />
    );
    const [, first, lay, mixed] = screen.getAllByRole("row");
    expect(within(first).queryByRole("link", { name: /prüfen$/ })).not.toBeInTheDocument();

    const [back, layLeg] = within(lay).getAllByRole("listitem");
    const betway = within(back).getByRole("link", { name: "Bei Betway prüfen" });
    expect(betway).toHaveTextContent("Seite prüfen");
    expect(betway).toHaveAttribute("href", "https://betway.de/de/de/sports/event/17260272");
    expect(betway).toHaveAttribute("target", "_blank");
    expect(betway).toHaveAttribute("rel", "noopener noreferrer");
    expect(within(layLeg).queryByRole("link")).not.toBeInTheDocument();

    const [leovegas, twentybet] = within(mixed).getAllByRole("listitem");
    expect(within(leovegas).getByRole("link", { name: "Bei LeoVegas prüfen" })).toHaveAttribute(
      "href",
      "https://www.leovegas.de/de-de/sportwetten#event/1028036087"
    );
    expect(within(twentybet).queryByRole("link")).not.toBeInTheDocument();
  });

  it("reads a lay on the exchange, with what it risks, and marks a TRJ over 110% to be checked", () => {
    render(
      <SurebetsTable
        surebets={[
          surebet({
            eventId: "psg",
            participants: ["PSG", "OM"],
            market: "anytime_scorer",
            marketLabel: "Torschütze (jederzeit)",
            kind: "lay",
            payoutRate: 1.12,
            profit: 12,
            toVerify: true,
            legs: [
              { selection: "Dembélé", label: "Dembélé", source: "merkurbets", side: "back", price: 2.5, stake: 100 },
              { selection: "Dembélé", label: "Dembélé", source: "exchange", side: "lay", price: 2.3, stake: 109.65, liability: 142.54 },
            ],
          }),
        ]}
      />
    );
    const cells = within(screen.getAllByRole("row")[1]).getAllByRole("cell");
    expect(within(cells[2]).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "DembéléMerkur Bets2,50Einsatz 100,00\u00a0€",
      "Lay DembéléBörse2,30Einsatz 109,65\u00a0€ (Haftung 142,54\u00a0€)",
    ]);
    expect(cells[3]).toHaveTextContent("112,0 %+12,00 €zu prüfen");
    expect(cells[3]).toHaveAttribute("title", expect.stringContaining("an der Börse gelayt"));
  });

  it("says how little a lay offers when the exchange has under €20 on it", () => {
    render(
      <SurebetsTable
        surebets={[
          surebet({
            eventId: "kos-aut",
            participants: ["Kosovo F.", "Autriche F."],
            market: "correct_score",
            marketLabel: "Genaues Ergebnis",
            kind: "lay",
            payoutRate: 1.14,
            profit: 14,
            thin: true,
            legs: [
              { selection: "2-2", label: "2:2", source: "unibet", side: "back", price: 100, stake: 100 },
              { selection: "2-2", label: "2:2", source: "exchange", side: "lay", price: 85, stake: 117.55, liability: 9874.2, size: 4.5 },
            ],
          }),
        ]}
      />
    );
    const cells = within(screen.getAllByRole("row")[1]).getAllByRole("cell");
    expect(within(cells[2]).getAllByRole("listitem")[1]).toHaveTextContent("nur 4,50 € zum Layen");
    expect(cells[3]).toHaveTextContent("114,0 %+14,00 €geringe Liquidität");
    expect(cells[3]).not.toHaveTextContent("zu prüfen");
  });

  it("links a match to its every market", () => {
    const onOpenMatch = vi.fn();
    render(<SurebetsTable surebets={[surebet({})]} matchHref={(id) => `?match=${id}`} onOpenMatch={onOpenMatch} />);
    const link = screen.getByRole("link", { name: "+69 Märkte für Alex De Minaur - Hubert Hurkacz" });
    expect(link).toHaveAttribute("href", "?match=dmh");
    fireEvent.click(link);
    expect(onOpenMatch).toHaveBeenCalledWith("dmh");
  });

  it("names the sport of each row by its icon, and leads the match's title to its page", () => {
    const onOpenMatch = vi.fn();
    render(
      <SurebetsTable
        surebets={[surebet({})]}
        matchHref={(id) => `?match=${id}`}
        onOpenMatch={onOpenMatch}
        sportHref={(sport, q) => `?sport=${sport}&q=${q}`}
      />
    );
    expect(screen.getByRole("img", { name: "Tennis" })).toBeInTheDocument();
    const title = screen.getByRole("link", { name: "Alex De Minaur - Hubert Hurkacz" });
    expect(title).toHaveAttribute("href", "?match=dmh");
    fireEvent.click(title);
    expect(onOpenMatch).toHaveBeenCalledWith("dmh");
  });

  it("leads an event with nothing but its winner market, a race's, to its page all the same", () => {
    const race = "Femmes - Classement Général Relais 2026/2027";
    render(
      <SurebetsTable
        surebets={[
          surebet({
            eventId: "relais",
            sport: "ski de fond",
            participants: [race],
            marketCount: 1,
            market: "Vainqueur",
            marketLabel: "Vainqueur",
          }),
        ]}
        matchHref={(id) => `?match=${id}`}
        onOpenMatch={vi.fn()}
        sportHref={(sport, q) => `?sport=${sport}&q=${q}`}
      />
    );
    expect(screen.getByRole("img", { name: "Skilanglauf" })).toHaveTextContent("🎿");
    expect(screen.getByRole("link", { name: race })).toHaveAttribute("href", "?match=relais");
    // Nothing more than its winner: no "+N markets".
    expect(screen.getAllByRole("link")).toHaveLength(1);
  });
});
