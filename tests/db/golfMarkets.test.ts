import { describe, it, expect, beforeEach } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { openDb } from "../../src/db/client";
import { saveMarketOdds, upsertCanonicalEvents } from "../../src/db/repository";
import { getEventDetail } from "../../src/db/eventDetail";
import { getSurebets, netBack } from "../../src/db/surebets";
import { savePlayerOdds } from "../../src/db/playerReference";
import { CanonicalEvent, RawOdds } from "../../src/types";

const hoursFromNow = (h: number) => new Date(Date.now() + h * 3600e3).toISOString();
const now = () => new Date().toISOString();
const priced = (market: string, prices: Record<string, number>): RawOdds[] =>
  Object.entries(prices).map(([selection, price]) => ({ market, selection, price }));

// A tournament of four players, whose Top 2 two bookmakers price: each one's
// chances add up to 212% (two winners, plus its margin), the best prices of
// both to 191%: 2 / 1.909 = 104.8%.
const winner = (a: number, b: number, c: number, d: number) => priced("Vainqueur", { A: a, B: b, C: c, D: d });
const tournament: CanonicalEvent = {
  id: "open",
  sport: "golf",
  competition: "Open",
  startTime: hoursFromNow(48),
  participants: ["Open d'Espagne 2026"],
  byBookmaker: { winamax: winner(2.5, 3.5, 4.5, 7), betclic: winner(2.6, 3.4, 4.6, 6.8) },
};

describe("a golf tournament's markets of several winners", () => {
  let db: DatabaseSync;
  const save = (winamax: RawOdds[], betclic: RawOdds[]) =>
    saveMarketOdds(
      db,
      [
        { eventId: "open", bookmakerId: "winamax", odds: winamax },
        { eventId: "open", bookmakerId: "betclic", odds: betclic },
      ],
      now()
    );
  const top2 = (a: number, b: number, c: number, d: number) => priced("golf_top|2", { A: a, B: b, C: c, D: d });

  beforeEach(() => {
    db = openDb(":memory:");
    upsertCanonicalEvents(db, [tournament]);
  });

  describe("on its page", () => {
    it("lists the winner, then the Top N and the leader of a round, in sections of their own", () => {
      save(
        [...top2(2, 1.4, 2.2, 2.2), ...priced("golf_round_leader|1", { A: 6, B: 8, C: 12, D: 20 })],
        [...top2(1.4, 2, 2.2, 2.2), ...priced("golf_top|5", { A: 1.2, B: 1.3, C: 1.5, D: 1.6 })]
      );
      const detail = getEventDetail(db, "open")!;

      expect(detail.sections.map((s) => [s.key, s.markets.map((m) => m.label)])).toEqual([
        ["g_winner", ["Sieger (Turnier)"]],
        ["g_top", ["In den Top 2", "In den Top 5"]],
        ["g_round", ["Führender nach Runde 1"]],
      ]);
    });

    it("lists the players favourite first, by price", () => {
      save(top2(2, 1.4, 2.2, 2.2), top2(1.4, 2, 2.2, 2.2));
      const detail = getEventDetail(db, "open")!;
      const outcomes = (key: string) => detail.sections.flatMap((s) => s.markets).find((m) => m.key === key)!.lines[0].outcomes;

      // The best price of each, lowest first, ties by name.
      expect(outcomes("golf_top|2").map((o) => o.label)).toEqual(["A", "B", "C", "D"]);
      expect(outcomes("Vainqueur").map((o) => o.label)).toEqual(["A", "B", "C", "D"]);
      expect(outcomes("golf_top|2")[0]).toMatchObject({ key: "A", prices: { winamax: 2, betclic: 1.4 }, best: ["winamax"] });
    });

    it("gives a market of N winners the rate of its best prices over N, not over one", () => {
      save(top2(2, 1.4, 2.2, 2.2), top2(1.4, 2, 2.2, 2.2));
      const detail = getEventDetail(db, "open")!;
      const line = detail.sections.flatMap((s) => s.markets).find((m) => m.key === "golf_top|2")!.lines[0];

      expect(line.payoutRate).toBeCloseTo(2 / (1 / 2 + 1 / 2 + 1 / 2.2 + 1 / 2.2), 10);
      // The winner's: one case.
      const win = detail.sections.flatMap((s) => s.markets).find((m) => m.key === "Vainqueur")!.lines[0];
      expect(win.payoutRate).toBeCloseTo(1 / (1 / 2.6 + 1 / 3.5 + 1 / 4.6 + 1 / 7), 10);
      expect(detail.surebetCount).toBe(1);
    });

    it("gives none to a market no bookmaker prices the whole field of", () => {
      // Each prices 2 of 4: the sum of its chances is 1, under its 2 winners.
      save(
        [{ market: "golf_top|2", selection: "A", price: 1.4 }, { market: "golf_top|2", selection: "B", price: 1.4 }],
        [{ market: "golf_top|2", selection: "C", price: 2.2 }, { market: "golf_top|2", selection: "D", price: 2.2 }]
      );
      const line = getEventDetail(db, "open")!.sections.flatMap((s) => s.markets).find((m) => m.key === "golf_top|2")!.lines[0];

      expect(line.payoutRate).toBeNull();
    });
  });

  describe("as surebets", () => {
    it("finds one among the best prices of a Top N, always to be checked: bookmakers share a dead heat differently", () => {
      save(top2(2, 1.4, 2.2, 2.2), top2(1.4, 2, 2.2, 2.2));
      const [surebet] = getSurebets(db).filter((s) => s.market === "golf_top|2");

      expect(surebet).toMatchObject({ kind: "bookmakers", marketLabel: "In den Top 2", toVerify: true });
      expect(surebet.payoutRate).toBeCloseTo(2 / (1 / 2 + 1 / 2 + 1 / 2.2 + 1 / 2.2), 10);
      // Each player's best price, the stakes in proportion to its inverse (C and
      // D are 2.20 at both bookmakers).
      expect(surebet.legs.map((l) => [l.selection, l.price])).toEqual([["A", 2], ["B", 2], ["C", 2.2], ["D", 2.2]]);
      expect(surebet.legs.slice(0, 2).map((l) => l.source)).toEqual(["winamax", "betclic"]);
    });

    it("backs the players of a Top N where the exchange pays more, those it has 20 EUR on", () => {
      // Each bookmaker's Top 2 adds up to 209%: no surebet on its own.
      save(top2(1.7, 1.7, 2.2, 2.2), top2(1.7, 1.7, 2.2, 2.2));
      expect(getSurebets(db).filter((s) => s.market === "golf_top|2")).toEqual([]);
      const listed = (player: string, back: number, backSize: number) => ({
        runner: player,
        player,
        back,
        lay: back + 0.1,
        backSize,
        laySize: 30,
        fair: null,
      });
      // A and B at 2.00 with 30 EUR (1.98 net); C and D at 2.40 with 5 EUR, too little.
      savePlayerOdds(db, "open", "golf_top|2", [listed("A", 2, 30), listed("B", 2, 30), listed("C", 2.4, 5), listed("D", 2.4, 5)], 9000, now());

      const surebet = getSurebets(db).find((s) => s.market === "golf_top|2" && s.kind === "exchange")!;
      const rate = 2 / (1 / netBack(2) + 1 / netBack(2) + 1 / 2.2 + 1 / 2.2);
      expect(surebet.payoutRate).toBeCloseTo(rate, 10);
      expect(surebet.toVerify).toBe(true);
      expect(surebet.legs.filter((l) => l.source === "exchange").map((l) => l.selection).sort()).toEqual(["A", "B"]);
    });

    it("finds none when the best prices of a Top N still add up to more than its winners", () => {
      save(top2(1.4, 1.4, 2.2, 2.2), top2(1.4, 1.4, 2.2, 2.2));
      expect(getSurebets(db).filter((s) => s.market === "golf_top|2")).toEqual([]);
    });
  });
});
