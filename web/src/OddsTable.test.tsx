import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { OddsTable } from "./OddsTable";
import type { EventWithOdds } from "./types";

const events: EventWithOdds[] = [
  {
    id: "evt1",
    sport: "football",
    competition: "Ligue 1",
    startTime: "2026-09-21T19:00:00.000Z",
    participants: ["PSG", "OM"],
    byBookmaker: {
      winamax: {
        scrapedAt: "2026-09-20T10:00:00.000Z",
        odds: [
          { market: "1X2", selection: "1", price: 1.5 },
          { market: "1X2", selection: "X", price: 3.2 },
          { market: "1X2", selection: "2", price: 5.0 },
        ],
      },
      betclic: {
        scrapedAt: "2026-09-20T10:00:00.000Z",
        odds: [
          { market: "1X2", selection: "1", price: 1.65 },
          { market: "1X2", selection: "X", price: 3.1 },
          { market: "1X2", selection: "2", price: 4.8 },
        ],
      },
    },
  },
];

// The price chip showing `price` (e.g. "1,65"), with its bookmaker and best-price flag.
const chip = (price: string) => screen.getByText(price).closest("[data-bookmaker]")!;
const text = (el: Element | null) => (el?.textContent ?? "").replace(/\u00a0/g, " ");

describe("OddsTable", () => {
  // Start times read "21:00" today and "Demain 21:00" tomorrow: pin the
  // clock well before the fixtures' 21/09 so they show their full date.
  // Only Date is faked, not the timers React and Testing Library rely on.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-01T10:00:00.000Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders one row per event with participant names, competition and each bookmaker's price", () => {
    render(<OddsTable events={events} />);

    expect(screen.getByText("PSG - OM")).toBeInTheDocument();
    expect(screen.getByText("Ligue 1")).toBeInTheDocument();
    expect(screen.getByText("1,50")).toBeInTheDocument();
    expect(screen.getByText("1,65")).toBeInTheDocument();
  });

  it("highlights the best price of each outcome", () => {
    render(<OddsTable events={events} />);

    expect(chip("1,65")).toHaveAttribute("data-best");
    expect(chip("1,50")).not.toHaveAttribute("data-best");
    expect(chip("5,00")).toHaveAttribute("data-best");
  });

  it("renders odds for all three outcomes (1, N, 2), not just the first one", () => {
    render(<OddsTable events={events} />);

    // Draw ("N")
    expect(screen.getByText("3,20")).toBeInTheDocument();
    expect(screen.getByText("3,10")).toBeInTheDocument();
    // Away win ("2")
    expect(screen.getByText("5,00")).toBeInTheDocument();
    expect(screen.getByText("4,80")).toBeInTheDocument();
  });

  it("only renders prices for the given bookmakers", () => {
    const { container } = render(<OddsTable events={events} bookmakers={["winamax"]} />);

    expect(screen.getByText("1,50")).toBeInTheDocument();
    expect(screen.queryByText("1,65")).not.toBeInTheDocument();
    expect(container.querySelector('[data-bookmaker="betclic"]')).toBeNull();
  });

  it("shows the prices of the bookmakers that list the match only, each with its icon", () => {
    const withVbet: EventWithOdds = {
      ...events[0],
      byBookmaker: {
        ...events[0].byBookmaker,
        vbet: {
          scrapedAt: "2026-09-20T10:00:00.000Z",
          odds: [
            { market: "1X2", selection: "1", price: 1.7 },
            { market: "1X2", selection: "2", price: 4.9 },
          ],
        },
      },
    };
    const { container } = render(<OddsTable events={[withVbet]} />);

    const home = [...container.querySelectorAll('td[data-label="1"] [data-bookmaker]')].map((c) => c.getAttribute("data-bookmaker"));
    expect(home).toEqual(["winamax", "betclic", "vbet"]);
    // Vbet lists the match but not its draw: a dash; NetBet doesn't: nothing.
    expect(text(chip("1,70"))).toBe("Vbet : 1,70 (meilleure cote)");
    expect(container.querySelector('[data-bookmaker="netbet"]')).toBeNull();
    expect(container.querySelectorAll('td[data-label="N"] [data-bookmaker]')).toHaveLength(3);
  });

  it("marks each price with its bookmaker's icon, and reads out its name and whether it is the best", () => {
    render(<OddsTable events={events} />);

    expect(chip("1,50").querySelector("img")!.getAttribute("src")).toMatch(/winamax/);
    expect(text(chip("1,50"))).toBe("Winamax : 1,50");
    expect(text(chip("1,65"))).toBe("Betclic : 1,65 (meilleure cote)");
  });

  it("highlights every bookmaker offering the best price, and only them", () => {
    const tie: EventWithOdds = {
      ...events[0],
      byBookmaker: {
        winamax: { scrapedAt: "2026-09-20T10:00:00.000Z", odds: [{ market: "1X2", selection: "1", price: 1.72 }, { market: "1X2", selection: "X", price: 3.2 }] },
        betclic: { scrapedAt: "2026-09-20T10:00:00.000Z", odds: [{ market: "1X2", selection: "1", price: 1.72 }, { market: "1X2", selection: "X", price: 3.1 }] },
      },
    };
    render(<OddsTable events={[tie]} />);

    const tied = screen.getAllByText("1,72").map((price) => price.closest("[data-bookmaker]")!);
    expect(tied).toHaveLength(2);
    for (const cell of tied) expect(cell).toHaveAttribute("data-best");
    expect(chip("3,20")).toHaveAttribute("data-best");
    expect(chip("3,10")).not.toHaveAttribute("data-best");
  });

  it("highlights the best price among only the given bookmakers", () => {
    // betclic (1.65) is the real best price, but it's filtered out here, so
    // the sole remaining bookmaker's own price must be marked "best".
    render(<OddsTable events={events} bookmakers={["winamax"]} />);

    expect(chip("1,50")).toHaveAttribute("data-best");
  });

  it("renders just the start and match columns when no bookmaker is selected", () => {
    const { container } = render(<OddsTable events={events} bookmakers={[]} />);

    expect(screen.getAllByRole("columnheader").map((th) => th.textContent)).toEqual(["Début", "Match"]);
    expect(screen.getByText("PSG - OM")).toBeInTheDocument();
    expect(container.querySelector("[data-bookmaker]")).toBeNull();
  });

  describe("start time column", () => {
    const startCell = () => screen.getByText("PSG - OM").closest("tr")!.querySelector("td")!;
    const startParts = () => [...startCell().querySelectorAll("time > span")].map((span) => span.textContent);

    it("comes first and shows the kick-off hour and day in local time", () => {
      // 19:00 UTC is 21:00 in Paris (summer time), the zone vite.config.ts pins.
      render(<OddsTable events={events} />);

      expect(screen.getAllByRole("columnheader")[0].textContent).toBe("Début");
      expect(startParts()).toEqual(["21:00", "lun. 21/09"]);
      expect(startCell().querySelector("time")!.getAttribute("datetime")).toBe("2026-09-21T19:00:00.000Z");
    });

    it("stays when no bookmaker is selected", () => {
      render(<OddsTable events={events} bookmakers={[]} />);

      expect(startParts()).toEqual(["21:00", "lun. 21/09"]);
    });

    it("shows a dash instead of breaking the table on an unreadable date", () => {
      render(<OddsTable events={[{ ...events[0], startTime: "not a date" }]} />);

      expect(startCell().textContent).toBe("-");
    });

    describe("relative day", () => {
      // Paris times: the zone vite.config.ts pins, in summer time (UTC+2).
      const startAt = (now: string, startTime: string) => {
        vi.setSystemTime(new Date(now));
        render(<OddsTable events={[{ ...events[0], startTime }]} />);
        return startParts();
      };

      it("says Aujourd'hui for a match today", () => {
        // Now 10:00, kick-off 21:00 the same day.
        expect(startAt("2026-09-21T08:00:00.000Z", "2026-09-21T19:00:00.000Z")).toEqual(["21:00", "Aujourd'hui"]);
      });

      it("says Demain for a match tomorrow", () => {
        expect(startAt("2026-09-21T08:00:00.000Z", "2026-09-22T19:00:00.000Z")).toEqual(["21:00", "Demain"]);
      });

      it("shows the date from the day after tomorrow on", () => {
        expect(startAt("2026-09-21T08:00:00.000Z", "2026-09-23T19:00:00.000Z")).toEqual(["21:00", "mer. 23/09"]);
      });

      it("counts days in local time, not UTC", () => {
        // Now 23:30 on the 21st, kick-off 00:30 on the 22nd: the same day in
        // UTC (21:30 and 22:30), but tomorrow in Paris.
        expect(startAt("2026-09-21T21:30:00.000Z", "2026-09-21T22:30:00.000Z")).toEqual(["00:30", "Demain"]);
      });

      it("treats the small hours as today once past midnight", () => {
        // Now 01:00 on the 22nd in Paris, still 23:00 on the 21st in UTC.
        expect(startAt("2026-09-21T23:00:00.000Z", "2026-09-22T19:00:00.000Z")).toEqual(["21:00", "Aujourd'hui"]);
      });
    });
  });

  describe("sorted by kick-off", () => {
    const at = (id: string, startTime: string, participants: string[]): EventWithOdds => ({ ...events[0], id, startTime, participants });

    it("opens each day with a heading, and shows the hour only", () => {
      vi.setSystemTime(new Date("2026-09-21T08:00:00.000Z"));
      render(
        <OddsTable
          groupByDay
          events={[
            at("a", "2026-09-21T17:00:00.000Z", ["A", "B"]),
            at("b", "2026-09-21T19:00:00.000Z", ["C", "D"]),
            at("c", "2026-09-22T19:00:00.000Z", ["E", "F"]),
            at("d", "2026-09-26T13:00:00.000Z", ["G", "H"]),
          ]}
        />
      );

      const rows = screen.getAllByRole("row").slice(1);
      expect(rows.map((row) => text(row.querySelector("th") ?? row.querySelector("td")))).toEqual([
        "Aujourd'hui",
        "19:00",
        "21:00",
        "Demain",
        "21:00",
        "Samedi 26 septembre",
        "15:00",
      ]);
    });

    it("has no day headings when sorted by TRJ", () => {
      render(<OddsTable events={events} />);

      expect(screen.getAllByRole("row")).toHaveLength(2);
    });
  });

  describe("TRJ column", () => {
    const trjCell = () => screen.getByText("PSG - OM").closest("tr")!.querySelectorAll("td")[2];

    it("comes right after the match name and shows the TRJ reported by the API", () => {
      render(<OddsTable events={[{ ...events[0], payoutRate: 0.8943 }]} />);

      const headers = screen.getAllByRole("columnheader").map((th) => th.textContent);
      expect(headers.slice(0, 3)).toEqual(["Début", "Match", "TRJ (taux de retour au joueur)"]);
      expect(text(trjCell())).toBe("89,4 %");
    });

    it("rates the TRJ, up to a surebet from 100 %", () => {
      const tierOf = (payoutRate: number | null) => {
        const { unmount } = render(<OddsTable events={[{ ...events[0], payoutRate }]} />);
        const tier = trjCell().querySelector("[data-tier]")!.getAttribute("data-tier");
        const label = text(trjCell());
        unmount();
        return [tier, label];
      };

      expect(tierOf(0.874)).toEqual(["low", "87,4 %"]);
      expect(tierOf(0.921)).toEqual(["mid", "92,1 %"]);
      expect(tierOf(0.962)).toEqual(["high", "96,2 %"]);
      expect(tierOf(1.013)).toEqual(["sure", "101,3 %Surebet"]);
      expect(tierOf(null)).toEqual(["none", "-"]);
    });

    it("shows a dash when the match has no TRJ", () => {
      render(<OddsTable events={events} />);
      expect(text(trjCell())).toBe("-");
    });

    it("is left out with the odds columns when no bookmaker is selected", () => {
      render(<OddsTable events={events} bookmakers={[]} />);

      expect(screen.queryByText("TRJ")).not.toBeInTheDocument();
    });
  });

  describe("draw column", () => {
    const twoWay = (id: string, participants: string[], prices: [number, number]): EventWithOdds => ({
      id,
      sport: "tennis",
      competition: "",
      startTime: "2026-09-21T19:00:00.000Z",
      participants,
      byBookmaker: {
        winamax: {
          scrapedAt: "2026-09-20T10:00:00.000Z",
          odds: [
            { market: "Vainqueur du match", selection: "1", price: prices[0] },
            { market: "Vainqueur du match", selection: "2", price: prices[1] },
          ],
        },
      },
    });
    const outcomeHeaders = () => screen.getAllByRole("columnheader").slice(3).map((th) => th.textContent);

    it("leaves out the N column when no match in the table can end in a draw", () => {
      render(<OddsTable events={[twoWay("t1", ["Sinner", "Alcaraz"], [1.8, 2.05])]} />);

      expect(outcomeHeaders()).toEqual(["1", "2"]);
      expect(screen.getByText("1,80")).toBeInTheDocument();
      expect(screen.getByText("2,05")).toBeInTheDocument();
      // Start + Match + TRJ + 2 outcomes.
      expect(screen.getAllByRole("cell")).toHaveLength(5);
    });

    it("keeps the N column for a sport with draws", () => {
      render(<OddsTable events={events} />);

      expect(outcomeHeaders()).toEqual(["1", "N", "2"]);
    });

    // Unibet's list gives a basketball match's result in regular time, a 1X2
    // with a draw at 12, where the others give the winner, overtime included.
    const basketball: EventWithOdds = {
      id: "b1",
      sport: "basketball",
      competition: "Euroligue",
      startTime: "2026-09-21T19:00:00.000Z",
      participants: ["Barcelone", "Zalgiris"],
      byBookmaker: {
        unibet: {
          scrapedAt: "2026-09-20T10:00:00.000Z",
          odds: [
            { market: "1X2", selection: "1", price: 1.77 },
            { market: "1X2", selection: "X", price: 12 },
            { market: "1X2", selection: "2", price: 2.05 },
          ],
        },
        vbet: {
          scrapedAt: "2026-09-20T10:00:00.000Z",
          odds: [
            { market: "Vainqueur du match", selection: "1", price: 1.6 },
            { market: "Vainqueur du match", selection: "2", price: 1.81 },
          ],
        },
        winamax: {
          scrapedAt: "2026-09-20T10:00:00.000Z",
          odds: [
            { market: "Vainqueur du match", selection: "1", price: 1.72 },
            { market: "Vainqueur du match", selection: "2", price: 1.98 },
          ],
        },
      },
    };

    it("compares the market most bookmakers list, not the first bookmaker's", () => {
      render(<OddsTable events={[basketball]} />);

      expect(outcomeHeaders()).toEqual(["1", "2"]);
      expect(screen.getByText("1,72")).toBeInTheDocument();
      expect(screen.getByText("1,98")).toBeInTheDocument();
      expect(screen.queryByText("12,00")).not.toBeInTheDocument();
      expect(screen.queryByText("1,77")).not.toBeInTheDocument();
    });

    it("keeps the N column when only some matches of the table have a draw, with dashes on the others", () => {
      render(<OddsTable events={[...events, twoWay("t1", ["Sinner", "Alcaraz"], [1.8, 2.05])]} />);

      expect(outcomeHeaders()).toContain("N");
      const tennisRow = screen.getByText("Sinner - Alcaraz").closest("tr")!;
      const outcomes = [...tennisRow.querySelectorAll("td[data-label]")].map((td) =>
        [...td.querySelectorAll("[data-bookmaker]")].map(
          (price) => [...price.querySelectorAll(":scope > span")].find((span) => !span.classList.contains("visually-hidden"))?.textContent
        )
      );
      // Winamax only, which lists this match (not Betclic), per outcome.
      expect(outcomes).toEqual([["1,80"], ["-"], ["2,05"]]);
    });

    it("keeps the N column when the only draw prices come from an unticked bookmaker", () => {
      const betclicOnly: EventWithOdds = { ...events[0], byBookmaker: { betclic: events[0].byBookmaker.betclic } };
      render(<OddsTable events={[betclicOnly]} bookmakers={["winamax"]} />);

      expect(outcomeHeaders()).toContain("N");
    });
  });

  describe("with the reference's fair odds", () => {
    // Betclic's 1,65 on PSG is 6,5 % above the fair 1,55; Winamax's 3,20 on
    // the draw only 0,6 % above 3,18, under the 1 % of a value bet.
    const referenced: EventWithOdds[] = [
      {
        ...events[0],
        reference: { market: "1X2", fair: { "1": 1.55, X: 3.18, "2": 5.5 }, matched: 4200, scrapedAt: "2026-09-20T10:00:00.000Z" },
      },
    ];
    const fairLines = (container: HTMLElement) => [...container.querySelectorAll('[title^="Cote juste"]')];

    it("shows each outcome's fair odds under its prices", () => {
      const { container } = render(<OddsTable events={referenced} />);
      const lines = fairLines(container);
      expect(lines.map((line) => line.querySelector("[class*=price]")?.textContent)).toEqual(["1,55", "3,18", "5,50"]);
      expect(text(lines[0])).toContain("Cote juste : 1,55");
    });

    it("marks the value bets, and writes the best one's edge under the prices", () => {
      const { container } = render(<OddsTable events={referenced} />);
      expect(chip("1,65")).toHaveAttribute("data-value", "true");
      expect(text(chip("1,65"))).toContain("(value bet : +6,5 % sur la cote juste)");
      expect(chip("1,50")).not.toHaveAttribute("data-value");
      expect(chip("3,20")).not.toHaveAttribute("data-value");
      const [one, draw] = fairLines(container);
      expect(text(one)).toContain("+6,5 %");
      expect(text(draw)).not.toContain("%");
    });

    it("only counts the ticked bookmakers' value bets", () => {
      const { container } = render(<OddsTable events={referenced} bookmakers={["winamax"]} />);
      expect(container.querySelector("[data-value]")).toBeNull();
      expect(text(fairLines(container)[0])).not.toContain("%");
    });

    it("shows a tennis winner's the same way, and none on another main market", () => {
      const main = (market: string, odds: { selection: string; price: number }[]) => ({
        scrapedAt: "2026-09-20T10:00:00.000Z",
        odds: odds.map((o) => ({ market, ...o })),
      });
      const tennis: EventWithOdds = {
        ...referenced[0],
        sport: "tennis",
        byBookmaker: { winamax: main("Vainqueur du match", [{ selection: "1", price: 1.7 }, { selection: "2", price: 2.1 }]) },
        reference: { market: "Vainqueur du match", fair: { "1": 1.6, "2": 2.5 }, matched: 1200, scrapedAt: "2026-09-20T10:00:00.000Z" },
      };
      const { container } = render(<OddsTable events={[tennis]} />);
      expect(fairLines(container).map((line) => line.querySelector("[class*=price]")?.textContent)).toEqual(["1,60", "2,50"]);
      // Winamax's 1.70 is 6.2% above the fair 1.60.
      expect(container.querySelector("[data-value]")).toHaveTextContent("1,70");

      const other: EventWithOdds = {
        ...tennis,
        byBookmaker: { winamax: main("Marché à 2 issues", [{ selection: "1", price: 1.7 }, { selection: "2", price: 2.1 }]) },
      };
      const { container: none } = render(<OddsTable events={[other]} />);
      expect(fairLines(none)).toEqual([]);

      // A winner's prices (overtime included) under a 1X2's fair odds.
      const hockey: EventWithOdds = { ...tennis, reference: { ...tennis.reference!, market: "1X2" } };
      const { container: hockeyRow } = render(<OddsTable events={[hockey]} />);
      expect(fairLines(hockeyRow)).toEqual([]);
      expect(hockeyRow.querySelector("[data-value]")).toBeNull();
    });

    it("shows none for a match the reference doesn't price", () => {
      const { container } = render(<OddsTable events={events} />);
      expect(fairLines(container)).toEqual([]);
      expect(container.querySelector("[data-value]")).toBeNull();
    });
  });

  it("links a match with more markets to its page from its name and from \"+N marchés\"", () => {
    const onOpenMatch = vi.fn();
    const more = { ...events[0], id: "more", marketCount: 12 };
    render(<OddsTable events={[more]} matchHref={(id) => `?match=${id}`} onOpenMatch={onOpenMatch} />);

    const [name, extra] = screen.getAllByRole("link");
    expect(name).toHaveAccessibleName("PSG - OM");
    expect(name).toHaveAttribute("href", "?match=more");
    expect(extra).toHaveAccessibleName("+11 marchés pour PSG - OM");
    expect(extra).toHaveAttribute("href", "?match=more");
    extra.click();
    expect(onOpenMatch).toHaveBeenCalledWith("more");
  });

  it("links the name of a match to its page even with nothing but its main market, and without \"+N marchés\"", () => {
    const onOpenMatch = vi.fn();
    const only = { ...events[0], id: "only", participants: ["Lens", "Lille"], marketCount: 1 };
    render(<OddsTable events={[only]} matchHref={(id) => `?match=${id}`} onOpenMatch={onOpenMatch} />);

    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAccessibleName("Lens - Lille");
    expect(links[0]).toHaveAttribute("href", "?match=only");
    fireEvent.click(links[0]);
    expect(onOpenMatch).toHaveBeenCalledWith("only");
    // A new tab keeps the link's own way.
    fireEvent.click(links[0], { ctrlKey: true });
    expect(onOpenMatch).toHaveBeenCalledTimes(1);
  });

  it("keeps the name plain text where there is no page to lead to", () => {
    render(<OddsTable events={events} />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
