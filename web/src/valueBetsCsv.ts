import { BOOKMAKER_BRANDING } from "./bookmakers";
import { closingValue, type TakenValueBet } from "./takenValueBets";

// "Meine Value Bets" as a CSV file, for the user's own bookkeeping, like
// "Meine Surebets"' (takenCsv.ts): one row per value bet, German style (";"
// between fields, decimal commas, a BOM so that Excel reads the umlauts),
// built in the browser from the list it already holds.

const HEADER = ["Anstoß", "Wette", "Anbieter", "Quote", "Vorteil (%)", "Einsatz (€)", "Erwartet (€)", "Schlusskurs", "Gegenüber Schlusskurs (%)"];

const TIME = new Intl.DateTimeFormat("de-DE", {
  timeZone: "Europe/Berlin",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

const decimal = (n: number | null | undefined, digits = 2) => (typeof n === "number" && Number.isFinite(n) ? n.toFixed(digits).replace(".", ",") : "");

function field(value: string): string {
  return /[;"\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function valueBetsCsv(list: readonly TakenValueBet[]): string {
  const rows: string[][] = [HEADER];
  for (const bet of list) {
    const start = Date.parse(bet.startTime);
    const stake = typeof bet.stake === "number" && bet.stake > 0 ? bet.stake : null;
    const clv = closingValue(bet);
    rows.push([
      Number.isFinite(start) ? TIME.format(new Date(start)) : "",
      bet.label,
      BOOKMAKER_BRANDING[bet.bookmaker]?.name ?? bet.bookmaker,
      decimal(bet.price),
      decimal(bet.edge * 100, 1),
      decimal(stake),
      stake === null ? "" : decimal(stake * bet.edge),
      decimal(bet.closing),
      clv === null ? "" : decimal(clv * 100, 1),
    ]);
  }
  return "﻿" + rows.map((row) => row.map(field).join(";")).join("\r\n") + "\r\n";
}

// Hands the file to the browser: "meine-value-bets-2026-11-05.csv".
export function downloadValueBetsCsv(list: readonly TakenValueBet[], now = new Date()): void {
  const blob = new Blob([valueBetsCsv(list)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `meine-value-bets-${now.toISOString().slice(0, 10)}.csv`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
