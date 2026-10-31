import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MyTakenSurebets } from "./MyTakenSurebets";
import type { TakenInfo } from "./takenSurebets";

const NOW = new Date("2026-10-31T12:00:00Z");
const info = (over: Partial<TakenInfo>): TakenInfo => ({
  remind: false,
  eventId: "gala-fener",
  startTime: "2026-10-31T18:00:00.000Z",
  label: "Galatasaray - Fenerbahçe, Ergebnis: Fenerbahçe @ 20bet 3,32 / Lay Fenerbahçe @ Börse 3,20",
  remindedAt: null,
  payoutRate: null,
  ...over,
});

describe("MyTakenSurebets", () => {
  it("shows nothing while no surebet is taken", () => {
    const { container } = render(<MyTakenSurebets taken={new Map()} now={NOW} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("lists the taken surebets, soonest first, with their kick-off, reminder and match page", () => {
    const onOpenMatch = vi.fn();
    const taken = new Map([
      ["late", info({ eventId: "late", label: "Bayern - Dortmund, Ergebnis: …", startTime: "2026-11-01T17:30:00.000Z", remind: true })],
      ["soon", info({ remind: true, remindedAt: "2026-10-31T11:00:00.000Z", payoutRate: 1.024 })],
      ["past", info({ eventId: "past", label: "Ajax - PSV, Ergebnis: …", startTime: "2026-10-30T18:00:00.000Z" })],
    ]);
    render(<MyTakenSurebets taken={taken} matchHref={(id) => `/odds?match=${id}`} onOpenMatch={onOpenMatch} now={NOW} />);
    expect(screen.getByText("Meine Surebets (3)")).toBeInTheDocument();
    const items = screen.getAllByRole("listitem");
    expect(items.map((li) => li.querySelector("p")?.textContent)).toEqual([
      "Ajax - PSV, Ergebnis: …",
      "Galatasaray - Fenerbahçe, Ergebnis: Fenerbahçe @ 20bet 3,32 / Lay Fenerbahçe @ Börse 3,20",
      "Bayern - Dortmund, Ergebnis: …",
    ]);
    // Played: greyed, no match page any more.
    expect(items[0]).toHaveAttribute("data-started", "true");
    expect(within(items[0]).getByText("Gespielt")).toBeInTheDocument();
    expect(within(items[0]).queryByRole("link")).not.toBeInTheDocument();
    expect(within(items[1]).getByText("Erinnerung gesendet")).toBeInTheDocument();
    expect(within(items[1]).getByText(/^\+2,4.% · 2,40 € auf 100 €$/)).toBeInTheDocument();
    // One taken before its payout was kept shows none.
    expect(within(items[2]).queryByText(/auf 100 €/)).not.toBeInTheDocument();
    expect(within(items[2]).getByText("Erinnerung 1 Std. vorher")).toBeInTheDocument();
    expect(within(items[2]).getByText(/^Anstoß /)).toBeInTheDocument();

    const link = within(items[1]).getByRole("link", { name: "Spielseite" });
    expect(link).toHaveAttribute("href", "/odds?match=gala-fener");
    fireEvent.click(link);
    expect(onOpenMatch).toHaveBeenCalledWith("gala-fener");
  });
});
