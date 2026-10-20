import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { OutrightTable } from "./OutrightTable";
import type { EventWithOdds, RawOdds } from "./types";

const at = "2026-09-20T10:00:00.000Z";
const prices = (byCompetitor: Record<string, number>): RawOdds[] =>
  Object.entries(byCompetitor).map(([selection, price]) => ({ market: "Vainqueur", selection, price }));

// LeoVegas lists the whole field, Merkur Bets its 3 favourites (as live, 2026-09-29).
const field = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`Rider ${i + 1}`, 3 + i * 5]));
const race: EventWithOdds = {
  id: "tdf",
  sport: "cyclisme",
  competition: "",
  startTime: "2027-07-25T16:00:00.000Z",
  participants: ["Tour de France 2027"],
  payoutRate: 0.874,
  byBookmaker: {
    merkurbets: { scrapedAt: at, odds: prices({ "Rider 1": 3.5, "Rider 2": 7, "Rider 3": 12 }) },
    leovegas: { scrapedAt: at, odds: prices(field) },
  },
};

// What a cell shows, without the text only screen readers get.
const visibleText = (el: Element) => {
  const copy = el.cloneNode(true) as Element;
  copy.querySelectorAll(".visually-hidden").forEach((hidden) => hidden.remove());
  return copy.textContent;
};
const bodyRows = () =>
  within(screen.getAllByRole("rowgroup")[1])
    .getAllByRole("row")
    .map((row) => Array.from(row.querySelectorAll("td")).map(visibleText));
const chip = (price: string) => screen.getByText(price).closest("[data-bookmaker]")!;

describe("OutrightTable", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-01T10:00:00.000Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("heads the card with the title, the date and the TRJ", () => {
    render(<OutrightTable events={[race]} />);

    const card = screen.getByRole("article", { name: "Tour de France 2027" });
    const header = card.querySelector("header")!.textContent!.replace(/\u00a0/g, " ");
    expect(header).toContain("Tour de France 2027");
    expect(header).toContain("So., 25.07., 18:00");
    expect(header).toContain("87,4 %");
    expect(screen.getByRole("columnheader", { name: "Teilnehmer" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "LeoVegas" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Merkur Bets" })).toBeInTheDocument();
  });

  it("lists the 10 favourites first, ranked, then unfolds and folds the rest", () => {
    render(<OutrightTable events={[race]} />);

    // Favourite first: the lowest best price. Columns: LeoVegas, then Merkur Bets.
    expect(bodyRows().slice(0, 3)).toEqual([
      ["1", "Rider 1", "3,00", "3,50"],
      ["2", "Rider 2", "8,00", "7,00"],
      ["3", "Rider 3", "13,00", "12,00"],
    ]);
    expect(bodyRows()).toHaveLength(10);

    fireEvent.click(screen.getByRole("button", { name: "Die anderen 2 anzeigen" }));
    expect(bodyRows()).toHaveLength(12);
    expect(bodyRows()[11]).toEqual(["12", "Rider 12", "58,00", "-"]);

    fireEvent.click(screen.getByRole("button", { name: "Weniger anzeigen" }));
    expect(bodyRows()).toHaveLength(10);
  });

  it("highlights each competitor's best price", () => {
    render(<OutrightTable events={[race]} />);

    expect(chip("3,50")).toHaveAttribute("data-best");
    expect(chip("3,00")).not.toHaveAttribute("data-best");
    expect(chip("8,00")).toHaveAttribute("data-best");
    // Priced by LeoVegas alone: nothing to compare, nothing highlighted.
    expect(chip("18,00")).not.toHaveAttribute("data-best");
  });

  it("highlights both bookmakers when they offer the same best price", () => {
    const tie: EventWithOdds = {
      ...race,
      byBookmaker: {
        merkurbets: { scrapedAt: at, odds: prices({ "Rider 1": 3.5, "Rider 2": 7 }) },
        leovegas: { scrapedAt: at, odds: prices({ "Rider 1": 3.5, "Rider 2": 6 }) },
      },
    };
    render(<OutrightTable events={[tie]} />);

    const tied = screen.getAllByText("3,50").map((price) => price.closest("[data-bookmaker]")!);
    expect(tied).toHaveLength(2);
    for (const cell of tied) expect(cell).toHaveAttribute("data-best");
    expect(chip("6,00")).not.toHaveAttribute("data-best");
  });

  it("shows only the ticked bookmakers, and the competitors they price", () => {
    render(<OutrightTable events={[race]} bookmakers={["merkurbets"]} />);

    expect(screen.queryByRole("img", { name: "LeoVegas" })).not.toBeInTheDocument();
    expect(bodyRows()).toEqual([
      ["1", "Rider 1", "3,50"],
      ["2", "Rider 2", "7,00"],
      ["3", "Rider 3", "12,00"],
    ]);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  describe("a big field", () => {
    const peloton: EventWithOdds = {
      ...race,
      byBookmaker: {
        leovegas: {
          scrapedAt: at,
          odds: prices(Object.fromEntries(Array.from({ length: 40 }, (_, i) => [i === 33 ? "Kévin Vauquelin" : `Rider ${i + 1}`, 3 + i]))),
        },
      },
    };

    it("offers to find a competitor by name, beyond the 10 favourites", () => {
      render(<OutrightTable events={[peloton]} />);
      const find = screen.getByRole("searchbox", { name: "Teilnehmer von Tour de France 2027 suchen" });

      fireEvent.change(find, { target: { value: "vauq" } });

      // Only LeoVegas prices this race: no column of dashes for Merkur Bets.
      expect(bodyRows()).toEqual([["34", "Kévin Vauquelin", "36,00"]]);
      expect(screen.queryByRole("button", { name: /Die anderen \d+ anzeigen/ })).not.toBeInTheDocument();

      // Every competitor found shows, not just the first 10.
      fireEvent.change(find, { target: { value: "rider" } });
      expect(bodyRows()).toHaveLength(39);

      fireEvent.change(find, { target: { value: "nobody" } });
      expect(screen.getByText("Kein Teilnehmer gefunden.")).toBeInTheDocument();
    });

    it("is the only one to get that field", () => {
      render(<OutrightTable events={[race]} />);

      expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
    });
  });
  // A golf tournament the week it is played: the exchange's fair odds for the
  // players whose prices are tight enough (6/10/2026, Baycurrent Classic).
  describe("with the reference's fair odds", () => {
    const golf: EventWithOdds = {
      id: "bay",
      sport: "golf",
      competition: "Baycurrent Classic",
      startTime: "2026-10-10T20:30:00.000Z",
      participants: ["Baycurrent Classic 2026"],
      payoutRate: 0.7,
      byBookmaker: {
        leovegas: { scrapedAt: at, odds: prices({ "Xander Schauffele": 9.5, "Collin Morikawa": 15, "Adam Scott": 25 }) },
        merkurbets: { scrapedAt: at, odds: prices({ "Xander Schauffele": 10, "Collin Morikawa": 15.5, "Adam Scott": 24 }) },
      },
      reference: {
        market: "Vainqueur",
        fair: { "Xander Schauffele": 9.8, "Collin Morikawa": 14.2 },
        matched: 44105,
        scrapedAt: at,
        minEdge: 0.05,
      },
    };
    const row = (name: string) => screen.getByText(name).closest("tr")!;

    it("shows a player's fair odds under his name, and none for a player the exchange prices too loosely", () => {
      render(<OutrightTable events={[golf]} />);

      expect(visibleText(row("Xander Schauffele"))).toContain("Fair 9,80");
      expect(visibleText(row("Collin Morikawa"))).toContain("Fair 14,20");
      expect(visibleText(row("Adam Scott"))).not.toContain("Fair");
    });

    it("frames a price 5% or more above the fair odds as a value bet, with the best edge, and no other", () => {
      render(<OutrightTable events={[golf]} />);

      // Morikawa: LeoVegas 15 is 5,6 % above 14.2, Merkur Bets 15.5 is 9,2 %.
      expect(within(row("Collin Morikawa")).getByText("15,00").closest("[data-bookmaker]")).toHaveAttribute("data-value", "true");
      expect(within(row("Collin Morikawa")).getByText("15,50").closest("[data-bookmaker]")).toHaveAttribute("data-value", "true");
      expect(visibleText(row("Collin Morikawa")).replace(/\u00a0/g, " ")).toContain("+9,2 %");
      // Schauffele: Merkur Bets 10 is only 2% above 9.8, under the 5% a golf winner needs.
      expect(within(row("Xander Schauffele")).getByText("10,00").closest("[data-bookmaker]")).not.toHaveAttribute("data-value");
      expect(within(row("Adam Scott")).getByText("24,00").closest("[data-bookmaker]")).not.toHaveAttribute("data-value");
    });

    it("compares a race to no fair odds when the reference prices another market", () => {
      render(<OutrightTable events={[{ ...golf, reference: { ...golf.reference!, market: "1X2" } }]} />);

      expect(document.body.textContent).not.toContain("Fair");
    });
  });
  describe("the way to a tournament's other markets", () => {
    const withMarkets: EventWithOdds = { ...race, id: "open", marketCount: 5 };
    const href = (id: string) => `?match=${id}`;

    it("links the card to the tournament's page when it has other markets", () => {
      render(<OutrightTable events={[withMarkets]} matchHref={href} />);

      const link = screen.getByRole("link", { name: "+4 Märkte für Tour de France 2027" });
      expect(link).toHaveAttribute("href", "?match=open");
      expect(link).toHaveTextContent("+4 Märkte");
    });

    it("opens it in the page, not a new one, for a plain click", () => {
      const onOpenMatch = vi.fn();
      render(<OutrightTable events={[withMarkets]} matchHref={href} onOpenMatch={onOpenMatch} />);

      fireEvent.click(screen.getByRole("link", { name: /Märkte für/ }));
      expect(onOpenMatch).toHaveBeenCalledWith("open");
      fireEvent.click(screen.getByRole("link", { name: /Märkte für/ }), { ctrlKey: true });
      expect(onOpenMatch).toHaveBeenCalledTimes(1);
    });

    it("leads the title of every race to its page, with no \"+N markets\" for the winner market only", () => {
      const onOpenMatch = vi.fn();
      render(<OutrightTable events={[{ ...race, id: "winner", marketCount: 1 }]} matchHref={href} onOpenMatch={onOpenMatch} />);

      const links = screen.getAllByRole("link");
      expect(links).toHaveLength(1);
      expect(links[0]).toHaveAccessibleName("Tour de France 2027");
      expect(links[0]).toHaveAttribute("href", "?match=winner");
      fireEvent.click(links[0]);
      expect(onOpenMatch).toHaveBeenCalledWith("winner");
      fireEvent.click(links[0], { ctrlKey: true });
      expect(onOpenMatch).toHaveBeenCalledTimes(1);
    });

    it("keeps the title plain text where there is no page to lead to", () => {
      render(<OutrightTable events={[withMarkets]} />);

      expect(screen.queryByRole("link")).not.toBeInTheDocument();
    });
  });
});
