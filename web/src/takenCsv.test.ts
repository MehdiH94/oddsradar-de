import { describe, expect, it } from "vitest";
import { takenCsv } from "./takenCsv";
import type { TakenInfo } from "./takenSurebets";

const item = (over: Partial<TakenInfo>): TakenInfo => ({
  remind: false,
  eventId: "e",
  startTime: "2026-11-03T19:45:00Z",
  label: "Galatasaray - Fenerbahçe, Ergebnis: Fenerbahçe @ 20bet 3,50 / Lay Fenerbahçe @ Börse 3,20",
  remindedAt: null,
  payoutRate: 1.02,
  ...over,
});

describe("takenCsv", () => {
  it("writes one row per leg, German style, the result once on the first leg", () => {
    const csv = takenCsv([
      item({
        legs: [
          { market: "1X2", selection: "2", source: "twentybet", side: "back", price: 3.5, closing: 3.3 },
          { market: "1X2", selection: "2", source: "exchange", side: "lay", price: 3.2, closing: null },
        ],
        stakes: [100, 110],
      }),
    ]);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv.slice(1).split("\r\n")).toEqual([
      "Anstoß;Surebet;Seite;Ausgang;Anbieter;Quote;Schlusskurs;Einsatz (€);Gesichert (€)",
      "03.11.2026, 20:45;Galatasaray - Fenerbahçe, Ergebnis: Fenerbahçe @ 20bet 3,50 / Lay Fenerbahçe @ Börse 3,20;Back;2;20bet;3,50;3,30;100,00;6,70",
      "03.11.2026, 20:45;Galatasaray - Fenerbahçe, Ergebnis: Fenerbahçe @ 20bet 3,50 / Lay Fenerbahçe @ Börse 3,20;Lay;2;Börse;3,20;;110,00;",
      "",
    ]);
  });

  it("keeps a surebet without its legs as one row, and quotes a field holding the separator", () => {
    const csv = takenCsv([item({ label: 'A; "B"' })]);
    expect(csv.slice(1).split("\r\n")[1]).toBe('03.11.2026, 20:45;"A; ""B""";;;;;;;');
  });
});
