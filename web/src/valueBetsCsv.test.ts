import { describe, expect, it } from "vitest";
import { valueBetsCsv } from "./valueBetsCsv";
import type { TakenValueBet } from "./takenValueBets";

const bet = (over: Partial<TakenValueBet>): TakenValueBet => ({
  eventId: "e",
  startTime: "2026-11-03T19:45:00Z",
  label: "Galatasaray - Fenerbahçe, Ergebnis: Fenerbahçe",
  market: "1X2",
  selection: "2",
  bookmaker: "twentybet",
  price: 3.3,
  edge: 0.045,
  ...over,
});

describe("valueBetsCsv", () => {
  it("writes one row per value bet, German style", () => {
    const csv = valueBetsCsv([bet({ stake: 20, closing: 3 }), bet({ label: 'A; "B"', bookmaker: "leovegas" })]);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv.slice(1).split("\r\n")).toEqual([
      "Anstoß;Wette;Anbieter;Quote;Vorteil (%);Einsatz (€);Erwartet (€);Schlusskurs;Gegenüber Schlusskurs (%)",
      "03.11.2026, 20:45;Galatasaray - Fenerbahçe, Ergebnis: Fenerbahçe;20bet;3,30;4,5;20,00;0,90;3,00;10,0",
      '03.11.2026, 20:45;"A; ""B""";LeoVegas;3,30;4,5;;;;',
      "",
    ]);
  });
});
