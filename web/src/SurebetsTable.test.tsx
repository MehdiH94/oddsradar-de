import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within, waitFor } from "@testing-library/react";
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
      "Über 9,5Merkur Bets2,00Einsatz 52,38\u00a0€keine BörsenquoteZur Website",
      "Unter 9,5LeoVegas2,20Einsatz 47,62\u00a0€keine BörsenquoteZur Website",
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
    // 20bet's match address can't be built: its site, said as such.
    const site = within(twentybet).getByRole("link", { name: "Website von 20bet öffnen" });
    expect(site).toHaveTextContent("Zur Website");
    expect(site).toHaveAttribute("href", "https://20bet.com/de");
    expect(site).toHaveAttribute("target", "_blank");
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
      "DembéléMerkur Bets2,50Einsatz 100,00\u00a0€keine BörsenquoteZur Website",
      "Lay DembéléBörse2,30Einsatz 109,65\u00a0€ (Haftung 142,54\u00a0€)",
    ]);
    expect(cells[3]).toHaveTextContent("112,0 %+12,00 €zu prüfen");
    expect(cells[3]).toHaveAttribute("title", expect.stringContaining("an der Börse gelayt"));
  });

  it("marks a suspect: the row, \"verdächtig\" by its TRJ, the other sources' price on its leg only", () => {
    const leg = { selection: "over", label: "Über 9,5", source: "merkurbets", side: "back" as const, price: 2, stake: 52.38 };
    render(<SurebetsTable surebets={[surebet({ toVerify: true, suspect: { leg, others: 1.45 } }), surebet({ eventId: "real" })]} />);
    const [suspect, real] = screen.getAllByRole("row").slice(1);
    expect(suspect).toHaveAttribute("data-suspect", "true");
    expect(real).not.toHaveAttribute("data-suspect");
    const cells = within(suspect).getAllByRole("cell");
    expect(within(cells[2]).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "Über 9,5Merkur Bets2,00Einsatz 52,38\u00a0€ · ⚠️ andere Quellen 1,45: Quote prüfenkeine BörsenquoteZur Website",
      "Unter 9,5LeoVegas2,20Einsatz 47,62\u00a0€keine BörsenquoteZur Website",
    ]);
    // "verdächtig" says more than "zu prüfen": one of them only.
    expect(cells[3]).toHaveTextContent("⚠️ verdächtig");
    expect(cells[3]).not.toHaveTextContent("zu prüfen");
    expect(within(cells[3]).getByText("⚠️ verdächtig")).toHaveAttribute("title", expect.stringMatching(/Vor dem Wetten beim Buchmacher prüfen$/));
    expect(within(real).getAllByRole("cell")[3]).not.toHaveTextContent("verdächtig");
  });

  it("gives each bookmaker's bet the exchange's prices of its outcome, the reference market", () => {
    render(
      <SurebetsTable
        surebets={[
          surebet({
            legs: [
              { selection: "over", label: "Über 9,5", source: "merkurbets", side: "back", price: 2, stake: 52.38, exchange: { back: 1.9, backSize: 312.4, lay: 1.95, laySize: 80 } },
              { selection: "under", label: "Unter 9,5", source: "leovegas", side: "back", price: 2.2, stake: 47.62, exchange: { lay: 2.1 } },
            ],
          }),
        ]}
      />
    );
    const [over, under] = within(screen.getAllByRole("row")[1]).getAllByRole("listitem");
    expect(within(over).getByText(/^Börse:/)).toHaveTextContent("Börse: Back 1,90 (312 €) · Lay 1,95 (80 €)");
    expect(within(under).getByText(/^Börse:/)).toHaveTextContent("Börse: Back - · Lay 2,10");
  });

  it("says how long ago each leg's price was read, and flags one read over 10 minutes before the newest", () => {
    vi.useFakeTimers({ now: new Date("2026-10-25T12:00:00.000Z"), toFake: ["Date"] });
    try {
      render(
        <SurebetsTable
          surebets={[
            surebet({
              legs: [
                { selection: "over", label: "Über 9,5", source: "merkurbets", side: "back", price: 2, stake: 52.38, readAt: "2026-10-25T11:59:40.000Z" },
                { selection: "under", label: "Unter 9,5", source: "twentybet", side: "back", price: 2.2, stake: 47.62, readAt: "2026-10-25T11:46:00.000Z" },
              ],
            }),
            surebet({ eventId: "fresh", legs: [{ selection: "over", label: "Über 9,5", source: "merkurbets", side: "back", price: 2, stake: 52.38, readAt: "2026-10-25T10:00:00.000Z" }] }),
          ]}
        />
      );
      const [first, second] = screen.getAllByRole("row").slice(1);
      const [over, under] = within(first).getAllByRole("listitem");
      expect(over).toHaveTextContent("· gerade eben");
      expect(over).not.toHaveTextContent("älter");
      expect(under).toHaveTextContent("· vor 14 Min. · älter");
      // A leg alone is never older than itself.
      expect(within(second).getByRole("listitem")).toHaveTextContent("· vor 2 Std.");
      expect(within(second).getByRole("listitem")).not.toHaveTextContent("älter");
    } finally {
      vi.useRealTimers();
    }
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
    fireEvent.click(screen.getByRole("checkbox", { name: /Auch dünne Lays zeigen \(1\)/ }));
    const cells = within(screen.getAllByRole("row")[1]).getAllByRole("cell");
    expect(within(cells[2]).getAllByRole("listitem")[1]).toHaveTextContent("nur 4,50 € zum Layen");
    expect(cells[3]).toHaveTextContent("114,0 %+14,00 €geringe Liquidität");
    expect(cells[3]).not.toHaveTextContent("zu prüfen");
  });

  it("hides the thin lays unless asked for, and remembers the choice in the browser", () => {
    localStorage.removeItem("oddsblitzer.showThinLays");
    const thin = surebet({ eventId: "thin", thin: true });
    const { unmount } = render(<SurebetsTable surebets={[surebet({}), thin]} />);
    expect(screen.getAllByRole("row")).toHaveLength(2);
    const toggle = screen.getByRole("checkbox", { name: "Auch dünne Lays zeigen (1): unter 20\u00a0€ zum Layen" });
    expect(toggle).not.toBeChecked();
    fireEvent.click(toggle);
    expect(screen.getAllByRole("row")).toHaveLength(3);
    expect(localStorage.getItem("oddsblitzer.showThinLays")).toBe("1");
    unmount();

    render(<SurebetsTable surebets={[surebet({}), thin]} />);
    expect(screen.getByRole("checkbox", { name: /Auch dünne Lays zeigen/ })).toBeChecked();
    expect(screen.getAllByRole("row")).toHaveLength(3);
    fireEvent.click(screen.getByRole("checkbox", { name: /Auch dünne Lays zeigen/ }));
    expect(localStorage.getItem("oddsblitzer.showThinLays")).toBeNull();
  });

  it("says so when every surebet is a thin lay, and offers no switch without one", () => {
    localStorage.removeItem("oddsblitzer.showThinLays");
    const { unmount } = render(<SurebetsTable surebets={[surebet({ thin: true })]} />);
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getByText("Gerade nur Surebets mit dünnen Lays, ausgeblendet.")).toBeInTheDocument();
    unmount();
    render(<SurebetsTable surebets={[surebet({})]} />);
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
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
    // Nothing more than its winner: no "+N markets" (the other links are the
    // bookmakers' sites).
    expect(screen.getAllByRole("link").filter((a) => a.getAttribute("target") !== "_blank")).toHaveLength(1);
  });

  describe("taken surebets", () => {
    const withLay = surebet({
      eventId: "gala-fener",
      kind: "lay",
      legs: [
        { selection: "2", label: "Fenerbahçe", source: "twentybet", side: "back", price: 3.32, stake: 50 },
        { selection: "2", label: "Fenerbahçe", source: "exchange", side: "lay", price: 3.2, stake: 52, liability: 114.4 },
      ],
    });
    const LAY_KEY = "gala-fener:player_aces@2|9.5:2@twentybet:back|2@exchange:lay";

    // The server: the account's list, then 204 to every change.
    function server(taken: { key: string; remind: boolean }[] = []) {
      const calls: { method: string; body: unknown }[] = [];
      const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
        if (!init?.method) return new Response(JSON.stringify({ taken }), { status: 200 });
        calls.push({ method: init.method, body: JSON.parse(String(init.body)) });
        return new Response(null, { status: 204 });
      });
      vi.stubGlobal("fetch", fetchMock);
      return calls;
    }

    it("marks a surebet taken: greyed, last, saved with the account, its exchange bet's reminder asked for", async () => {
      const calls = server();
      render(<SurebetsTable surebets={[withLay, surebet({})]} />);
      // The surebet between bookmakers first: it goes last.
      const [layRow, plainRow] = screen.getAllByRole("row").slice(1);
      fireEvent.click(within(plainRow).getByRole("button", { name: "Genommen: Alex De Minaur - Hubert Hurkacz" }));
      expect(screen.getAllByRole("row")[2]).toBe(plainRow);
      // Then the one with a bet at the exchange.
      fireEvent.click(within(layRow).getByRole("button", { name: /^Genommen/ }));

      await waitFor(() => expect(calls).toHaveLength(2));
      expect(calls[1]).toEqual({
        method: "PUT",
        body: {
          key: LAY_KEY,
          eventId: "gala-fener",
          startTime: "2099-01-01T07:00:00.000Z",
          label: "Alex De Minaur - Hubert Hurkacz, Aces réussis par Hubert Hurkacz (9.5 aces): Fenerbahçe @ 20bet 3,32 / Lay Fenerbahçe @ Börse 3,20",
          remind: true,
          // Its payout as taken, kept with it.
          payoutRate: withLay.payoutRate,
        },
      });
      expect(calls[0].body).toMatchObject({ remind: false });
      const rows = screen.getAllByRole("row").slice(1);
      expect(rows.every((row) => row.hasAttribute("data-taken"))).toBe(true);
      expect(within(layRow).getByRole("button", { name: /^Genommen/ })).toHaveAttribute("aria-pressed", "true");
      expect(within(layRow).getByRole("button", { name: /^Genommen/ })).toHaveTextContent("✓ Genommen");
      // The reminder, for the surebet with an exchange bet only.
      expect(within(layRow).getByRole("checkbox", { name: /Erinnerung 1\s*Std\. vorher/ })).toBeChecked();
      expect(within(plainRow).queryByRole("checkbox")).not.toBeInTheDocument();
    });

    it("shows what the account took, last, and lets it change its mind", async () => {
      const calls = server([{ key: LAY_KEY, remind: true }]);
      render(<SurebetsTable surebets={[withLay, surebet({})]} />);
      await waitFor(() => expect(screen.getAllByRole("row")[2]).toHaveAttribute("data-taken"));
      const taken = screen.getAllByRole("row")[2];
      expect(taken).toHaveAttribute("data-kind", "lay");

      fireEvent.click(within(taken).getByRole("checkbox", { name: /Erinnerung/ }));
      await waitFor(() => expect(calls).toHaveLength(1));
      expect(calls[0]).toMatchObject({ method: "PUT", body: { key: LAY_KEY, remind: false } });

      fireEvent.click(within(taken).getByRole("button", { name: /^Genommen/ }));
      await waitFor(() => expect(calls).toHaveLength(2));
      expect(calls[1]).toEqual({ method: "DELETE", body: { key: LAY_KEY } });
      expect(screen.getAllByRole("row").slice(1).some((row) => row.hasAttribute("data-taken"))).toBe(false);
    });

    it("takes the mark back when the server refuses it", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async (_url: string, init?: RequestInit) =>
          init?.method ? new Response(null, { status: 400 }) : new Response(JSON.stringify({ taken: [] }), { status: 200 })
        )
      );
      render(<SurebetsTable surebets={[surebet({})]} />);
      const button = screen.getByRole("button", { name: /^Genommen/ });
      fireEvent.click(button);
      expect(button).toHaveAttribute("aria-pressed", "true");
      await waitFor(() => expect(button).toHaveAttribute("aria-pressed", "false"));
    });
  });
});
