import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { GroupedOddsTables } from "./GroupedOddsTables";
import type { EventWithOdds } from "./types";

const events: EventWithOdds[] = [
  {
    id: "1",
    sport: "tennis",
    competition: "ATP",
    startTime: "2026-09-23T16:45:00.000Z",
    participants: ["Nadal", "Alcaraz"],
    byBookmaker: {},
  },
  {
    id: "2",
    sport: "football",
    competition: "Ligue 1",
    startTime: "2026-09-23T16:45:00.000Z",
    participants: ["PSG", "OM"],
    byBookmaker: {},
  },
];

describe("GroupedOddsTables", () => {
  it("renders one heading per sport, named and pictured for people, in alphabetical order", () => {
    render(<GroupedOddsTables events={events} />);

    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual(["⚽ Football", "🎾 Tennis"]);
    // The emoji is decoration: the section is named "Football".
    expect(screen.getByRole("region", { name: "Football" })).toBeInTheDocument();
  });

  it("renders each event's participants under its sport's section", () => {
    render(<GroupedOddsTables events={events} />);

    expect(screen.getByText("PSG - OM")).toBeInTheDocument();
    expect(screen.getByText("Nadal - Alcaraz")).toBeInTheDocument();
  });

  it("forwards the bookmakers filter down to every sport's table", () => {
    const eventsWithOdds: EventWithOdds[] = [
      {
        id: "1",
        sport: "football",
        competition: "Ligue 1",
        startTime: "2026-09-23T16:45:00.000Z",
        participants: ["PSG", "OM"],
        byBookmaker: {
          leovegas: { scrapedAt: "2026-09-20T10:00:00.000Z", odds: [{ market: "1X2", selection: "1", price: 1.5 }] },
          betway: { scrapedAt: "2026-09-20T10:00:00.000Z", odds: [{ market: "1X2", selection: "1", price: 1.65 }] },
        },
      },
    ];

    render(<GroupedOddsTables events={eventsWithOdds} bookmakers={["leovegas"]} />);

    expect(screen.getByText("1.50")).toBeInTheDocument();
    expect(screen.queryByText("1.65")).not.toBeInTheDocument();
  });

  it("shows a sport's matches in the table and its winner-among-N markets as cards", () => {
    const at = "2026-09-23T16:45:00.000Z";
    render(
      <GroupedOddsTables
        events={[
          {
            id: "gp",
            sport: "formule 1",
            competition: "",
            startTime: at,
            participants: ["GP de Bahreïn"],
            byBookmaker: {
              leovegas: {
                scrapedAt: at,
                odds: [
                  { market: "Vainqueur", selection: "Antonelli", price: 2.25 },
                  { market: "Vainqueur", selection: "Russell", price: 4.25 },
                ],
              },
            },
          },
          {
            id: "duel",
            sport: "formule 1",
            competition: "",
            startTime: at,
            participants: ["Verstappen", "Norris"],
            byBookmaker: {},
          },
        ]}
      />
    );

    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual(["🏎️ Formula 1"]);
    expect(screen.getByText("Verstappen - Norris")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 3, name: "GP de Bahreïn" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Contender" })).toBeInTheDocument();
    expect(screen.getByText("Antonelli")).toBeInTheDocument();
    // The race is a card, not a row of the match table.
    expect(screen.getByText("Verstappen - Norris").closest("table")).not.toBe(screen.getByText("Antonelli").closest("table"));
  });

  it("heads each day's matches when asked to group them by day", () => {
    const { rerender } = render(<GroupedOddsTables events={events} />);
    expect(screen.queryByRole("columnheader", { name: /September/ })).not.toBeInTheDocument();

    rerender(<GroupedOddsTables events={events} groupByDay />);
    expect(screen.getAllByRole("columnheader", { name: /September/ }).length).toBeGreaterThan(0);
  });
});
