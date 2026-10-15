import { describe, it, expect } from "vitest";
import { f1Entries, f1Kind, parseF1Search } from "../../src/reference/f1";
import { golfPrices, placeGolfTournament } from "../../src/reference/golf";
import { parsePriceFrames } from "../../src/reference/exchange";

const runner = (selectionId: number, runnerName: string) => ({ selectionId, runnerName });
const event = (over: Record<string, unknown>) => ({
  id: "1.1",
  name: "Singapore Grand Prix 2026",
  openDate: Date.parse("2026-10-11T12:00:00Z"),
  inPlay: false,
  topMarkets: [
    { marketId: "1.100", description: { marketType: "WINNER" }, runners: [runner(1, "Max Verstappen"), runner(2, "Lando Norris")] },
  ],
  ...over,
});

describe("parseF1Search", () => {
  it("keeps the races with a winner market and drops the rest", () => {
    const body = {
      content: [
        event({}),
        event({ id: "1.2", name: "Monaco Grand Prix", inPlay: true }),
        event({ id: "1.3", name: "Premier League" }),
        event({ id: "1.4", name: "Italian Grand Prix", topMarkets: [{ marketId: "1.9", description: { marketType: "PODIUM_FINISH" }, runners: [runner(1, "A"), runner(2, "B")] }] }),
        event({ id: "1.7", name: "Singapore Grand Prix Qualifying", topMarkets: [{ marketId: "1.70", marketName: "Winner", description: { marketType: "WINNER" }, runners: [runner(1, "A"), runner(2, "B")] }] }),
      ],
    };
    const races = parseF1Search(body);
    expect(races.map((r) => [r.eventId, r.kind])).toEqual([["1.1", "race"], ["1.7", "qualifying"]]);
    expect(races[0].marketId).toBe("1.100");
    expect(Object.values(races[0].runners)).toEqual(["Max Verstappen", "Lando Norris"]);
  });

  it("tolerates a malformed body", () => {
    expect(parseF1Search(null)).toEqual([]);
    expect(parseF1Search({ content: 3 })).toEqual([]);
  });
});

describe("a race's fair odds", () => {
  it("places the race under our title and prices its drivers", () => {
    const [race] = parseF1Search({ content: [event({})] });
    const placed = placeGolfTournament(
      { participants: ["Grand Prix de Singapour"], startTime: "2026-10-11T13:00:00.000Z", competitors: ["Max Verstappen", "Lando Norris"], sport: "formule 1" },
      [race]
    );
    expect(placed?.eventId).toBe("1.1");
    const market = parsePriceFrames([
      {
        id: "1.100",
        rc: [
          { id: 1, atb: [[2.0, 500]], atl: [[2.04, 500]] },
          { id: 2, atb: [[2.0, 500]], atl: [[2.04, 500]] },
        ],
        tv: 1000,
      },
    ]).get("1.100");
    const rows = golfPrices(race, ["Max Verstappen", "Lando Norris"], market);
    expect(rows.map((r) => r.selection)).toEqual(["Max Verstappen", "Lando Norris"]);
    expect(rows.every((r) => r.fair !== undefined)).toBe(true);
  });
});

describe("sprint and Sunday race", () => {
  it("tells an F1 event's kind from its title", () => {
    for (const t of ["GP SIngapour - Sprint", "Grand Prix de Singapour 2026 - Sprint", "Singapore Grand Prix Sprint Race"]) expect(f1Kind(t)).toBe("sprint");
    for (const t of ["Grand Prix de Singapour 2026 - Course", "Singapore Grand Prix", "GP SIngapour - Course"]) expect(f1Kind(t)).toBe("race");
    for (const t of ["GP SIngapour - Qualification", "Singapore Grand Prix 2026 - Qualification", "GP de Bahreïn - Qualif.", "Pole Position", "Overall Qualifying Winner | Singapore Grand Prix"])
      expect(f1Kind(t)).toBe("qualifying");
    for (const t of ["GP SIngapour - Sprint Qualif", "Singapore Grand Prix 2026 - Sprint Qualifying", "Sprint Qualifying Winner | Singapore Grand Prix"])
      expect(f1Kind(t)).toBe("sprint qualifying");
    for (const t of ["Championnat du monde pilotes 2026", "F1 Drivers Championship 2026"]) expect(f1Kind(t)).toBe("season");
  });

  it("gives a sprint and a race their own exchange event, whatever the order", async () => {
    const drivers = [runner(1, "Max Verstappen"), runner(2, "Lando Norris")];
    const market = (marketId: string) => [{ marketId, description: { marketType: "WINNER" }, runners: drivers }];
    const sprint = event({ id: "1.5", name: "Singapore Grand Prix Sprint Race", openDate: Date.parse("2026-10-10T09:00:00Z"), topMarkets: market("1.500") });
    const race = event({ id: "1.6", name: "Singapore Grand Prix", openDate: Date.parse("2026-10-11T12:00:00Z"), topMarkets: market("1.600") });
    const ours = { competitors: ["Max Verstappen", "Lando Norris"], sport: "formule 1" };
    const pick = (content: unknown[], title: string, startTime: string) => {
      const races = parseF1Search({ content }).filter((r) => r.kind === f1Kind(title));
      return placeGolfTournament({ ...ours, participants: [title], startTime }, races)?.eventId;
    };
    for (const content of [[sprint, race], [race, sprint]]) {
      expect(pick(content, "Grand Prix de Singapour 2026 - Sprint", "2026-10-10T10:00:00.000Z")).toBe("1.5");
      expect(pick(content, "Grand Prix de Singapour 2026 - Course", "2026-10-11T13:00:00.000Z")).toBe("1.6");
    }
    // No sprint listed: the race is never taken for it.
    expect(pick([race], "Grand Prix de Singapour 2026 - Sprint", "2026-10-10T10:00:00.000Z")).toBeUndefined();
  });
});

describe("qualifying", () => {
  it("reads the Overall Qualifying Winner among an event's markets", () => {
    const drivers = [runner(1, "Max Verstappen"), runner(2, "Lando Norris")];
    const entries = f1Entries({ id: "1.1", name: "Singapore Grand Prix", startTime: "2026-10-11T12:00:00.000Z" }, [
      { marketId: "1.10", marketName: "Winner", description: { marketType: "WINNER" }, runners: drivers },
      { marketId: "1.11", marketName: "Overall Qualifying Winner", description: { marketType: "OTHER" }, runners: drivers },
      { marketId: "1.12", marketName: "Sprint Qualifying Winner", description: { marketType: "OTHER" }, runners: drivers },
      { marketId: "1.13", marketName: "Podium Finish", description: { marketType: "PODIUM_FINISH" }, runners: drivers },
    ]);
    expect(entries.map((e) => [e.marketId, e.kind])).toEqual([["1.10", "race"], ["1.11", "qualifying"], ["1.12", "sprint qualifying"]]);
  });
});
