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
    { selection: "over", label: "Plus de 9.5", source: "winamax", side: "back", price: 2, stake: 52.38 },
    { selection: "under", label: "Moins de 9.5", source: "leovegas", side: "back", price: 2.2, stake: 47.62 },
  ],
  ...overrides,
});

describe("SurebetsTable", () => {
  it("shows one row per surebet: kick-off, match and market, each bet for €100, the TRJ and the profit", () => {
    render(<SurebetsTable surebets={[surebet({})]} />);
    expect(screen.getByRole("heading", { level: 2, name: "Surebets" })).toBeInTheDocument();
    expect(screen.getAllByRole("columnheader").map((th) => th.textContent)).toEqual([
      "Kick-off",
      "Match",
      "Bets for €100",
      "Payout",
    ]);
    const cells = within(screen.getAllByRole("row")[1]).getAllByRole("cell");
    expect(cells[0].querySelector("time")).toHaveAttribute("dateTime", "2099-01-01T07:00:00.000Z");
    expect(cells[1]).toHaveTextContent("🎾 Alex De Minaur - Hubert HurkaczAces réussis par Hubert Hurkacz (9.5 aces)");
    expect(within(cells[2]).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "Plus de 9.5Winamax2.00stake €52.38",
      "Moins de 9.5LeoVegas2.20stake €47.62",
    ]);
    expect(cells[3]).toHaveTextContent("104.8%+€4.76");
    expect(cells[3]).not.toHaveTextContent("to verify");
  });

  it("reads a lay on the exchange, with what it risks, and marks a TRJ over 110% to be checked", () => {
    render(
      <SurebetsTable
        surebets={[
          surebet({
            eventId: "psg",
            participants: ["PSG", "OM"],
            market: "anytime_scorer",
            marketLabel: "Buteur",
            kind: "lay",
            payoutRate: 1.12,
            profit: 12,
            toVerify: true,
            legs: [
              { selection: "Dembélé", label: "Dembélé", source: "winamax", side: "back", price: 2.5, stake: 100 },
              { selection: "Dembélé", label: "Dembélé", source: "exchange", side: "lay", price: 2.3, stake: 109.65, liability: 142.54 },
            ],
          }),
        ]}
      />
    );
    const cells = within(screen.getAllByRole("row")[1]).getAllByRole("cell");
    expect(within(cells[2]).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "DembéléWinamax2.50stake €100.00",
      "Lay DembéléExchange2.30stake €109.65 (liability €142.54)",
    ]);
    expect(cells[3]).toHaveTextContent("112.0%+€12.00to verify");
    expect(cells[3]).toHaveAttribute("title", expect.stringContaining("laid on the exchange"));
  });

  it("says how little a lay offers when the exchange has under €20 on it", () => {
    render(
      <SurebetsTable
        surebets={[
          surebet({
            eventId: "kos-aut",
            participants: ["Kosovo F.", "Autriche F."],
            market: "correct_score",
            marketLabel: "Score exact",
            kind: "lay",
            payoutRate: 1.14,
            profit: 14,
            thin: true,
            legs: [
              { selection: "2-2", label: "2 - 2", source: "unibet", side: "back", price: 100, stake: 100 },
              { selection: "2-2", label: "2 - 2", source: "exchange", side: "lay", price: 85, stake: 117.55, liability: 9874.2, size: 4.5 },
            ],
          }),
        ]}
      />
    );
    const cells = within(screen.getAllByRole("row")[1]).getAllByRole("cell");
    expect(within(cells[2]).getAllByRole("listitem")[1]).toHaveTextContent("only €4.50 to lay");
    expect(cells[3]).toHaveTextContent("114.0%+€14.00limited liquidity");
    expect(cells[3]).not.toHaveTextContent("to verify");
  });

  it("links a match to its every market", () => {
    const onOpenMatch = vi.fn();
    render(<SurebetsTable surebets={[surebet({})]} matchHref={(id) => `?match=${id}`} onOpenMatch={onOpenMatch} />);
    const link = screen.getByRole("link", { name: "+69 markets for Alex De Minaur - Hubert Hurkacz" });
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
    expect(screen.getByRole("img", { name: "Cross-country skiing" })).toHaveTextContent("🎿");
    expect(screen.getByRole("link", { name: race })).toHaveAttribute("href", "?match=relais");
    // Nothing more than its winner: no "+N markets".
    expect(screen.getAllByRole("link")).toHaveLength(1);
  });
});
