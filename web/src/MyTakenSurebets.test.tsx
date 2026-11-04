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
    expect(screen.getByText(/^3 Surebets · Ø \+2,4.% · 2,40 € erwartet bei 100 € je Surebet$/)).toBeInTheDocument();
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

  it("shows each back's closing price once the match was played, not before", () => {
    const legs = [
      { market: "1X2", selection: "2", source: "twentybet", side: "back" as const, price: 3.32, closing: 3 },
      { market: "1X2", selection: "2", source: "exchange", side: "lay" as const, price: 3.2, closing: 3.52 },
    ];
    const taken = new Map([
      ["past", info({ eventId: "past", startTime: "2026-10-30T18:00:00.000Z", legs })],
      ["soon", info({ legs: legs.map((l) => ({ ...l, closing: undefined })) })],
    ]);
    render(<MyTakenSurebets taken={taken} now={NOW} />);
    const [past, soon] = screen.getAllByRole("listitem");
    expect(within(past).getByText(/^Schlusskurs bei 20bet 3,00 \(\+10,7.%\)$/)).toBeInTheDocument();
    expect(within(soon).queryByText(/Schlusskurs/)).not.toBeInTheDocument();
    // The exchange's lay too, and their average over the played ones only.
    expect(within(past).getByText(/^Schlusskurs Lay an der Börse 3,52 \(\+10,0.%\)$/)).toBeInTheDocument();
    expect(screen.getByText(/^Ø \+10,3.% gegenüber dem Schlusskurs \(2 Wetten\)$/)).toBeInTheDocument();
  });

  it("writes down the stakes placed on a surebet of backs when a field is left, and says what they lock in", () => {
    const onStakes = vi.fn();
    const legs = [
      { market: "1X2", selection: "1", source: "twentybet", side: "back" as const, price: 2.1 },
      { market: "1X2", selection: "2", source: "leovegas", side: "back" as const, price: 2.05 },
    ];
    const taken = new Map([["k", info({ legs, stakes: [50, 52] })]]);
    render(<MyTakenSurebets taken={taken} onStakes={onStakes} now={NOW} />);
    expect(screen.getByText("Gesichert: +3,00 € bei 102,00 € Einsatz")).toBeInTheDocument();
    const twenty = screen.getByRole("textbox", { name: "Einsatz bei 20bet (2,10) in Euro" });
    expect(twenty).toHaveValue("50");
    fireEvent.change(twenty, { target: { value: "55,5" } });
    fireEvent.blur(twenty);
    expect(onStakes).toHaveBeenCalledWith("k", [55.5, 52]);
    // Nothing sent for a field that is not an amount, nor without a change.
    fireEvent.change(twenty, { target: { value: "abc" } });
    fireEvent.blur(twenty);
    expect(onStakes).toHaveBeenCalledTimes(1);
  });

  it("writes down a lay's stake too, shows its liability and what the pair locks in", () => {
    const onStakes = vi.fn();
    const legs = [
      { market: "1X2", selection: "2", source: "twentybet", side: "back" as const, price: 3.5 },
      { market: "1X2", selection: "2", source: "exchange", side: "lay" as const, price: 3.2 },
    ];
    render(<MyTakenSurebets taken={new Map([["k", info({ legs, stakes: [100, 110] })]])} onStakes={onStakes} now={NOW} />);
    expect(screen.getByText("Gesichert: +6,70 € bei 100,00 € Einsatz und 242,00 € Haftung")).toBeInTheDocument();
    expect(screen.getByText("Haftung 242,00 €")).toBeInTheDocument();
    const lay = screen.getByRole("textbox", { name: "Lay-Einsatz an der Börse (3,20) in Euro" });
    fireEvent.change(lay, { target: { value: "112" } });
    fireEvent.blur(lay);
    expect(onStakes).toHaveBeenCalledWith("k", [100, 112]);
  });

  it("fills each leg's stake from a total, as the surebets list splits it", () => {
    const onStakes = vi.fn();
    const legs = [
      { market: "1X2", selection: "1", source: "twentybet", side: "back" as const, price: 2.1 },
      { market: "1X2", selection: "2", source: "leovegas", side: "back" as const, price: 2.05 },
    ];
    render(<MyTakenSurebets taken={new Map([["k", info({ legs })]])} onStakes={onStakes} now={NOW} />);
    const split = screen.getByRole("button", { name: "Aufteilen" });
    expect(split).toBeDisabled();
    fireEvent.change(screen.getByRole("textbox", { name: "Gesamteinsatz in Euro, auf die Wetten aufzuteilen" }), { target: { value: "100" } });
    fireEvent.click(split);
    expect(onStakes).toHaveBeenCalledWith("k", [49, 51]);
    expect(screen.getByRole("textbox", { name: "Einsatz bei 20bet (2,10) in Euro" })).toHaveValue("49");
    expect(screen.getByRole("textbox", { name: "Einsatz bei LeoVegas (2,05) in Euro" })).toHaveValue("51");
  });

  it("says the month's total, the results the server already forgot included", () => {
    const results = { month: "2026-11", profit: 12.4, count: 4 };
    const { unmount } = render(<MyTakenSurebets taken={new Map()} results={results} now={new Date("2026-11-04T07:00:00Z")} />);
    expect(screen.getByText("November: +12,40 € gesichert aus 4 Surebets")).toBeInTheDocument();
    unmount();
    // Another month's results alone show nothing.
    const { container } = render(<MyTakenSurebets taken={new Map()} results={{ ...results, month: "2026-10" }} now={new Date("2026-11-04T07:00:00Z")} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("offers no stakes without onStakes", () => {
    const legs = [{ market: "1X2", selection: "2", source: "twentybet", side: "back" as const, price: 3.32 }];
    render(<MyTakenSurebets taken={new Map([["k", info({ legs })]])} now={NOW} />);
    expect(screen.queryByText("Meine Einsätze")).not.toBeInTheDocument();
  });
});
