import { BOOKMAKER_BRANDING } from "./bookmakers";
import { lockedResult, type TakenInfo } from "./takenSurebets";

// "Meine Surebets" as a CSV file, for the user's own bookkeeping: one row per
// leg, German style (";" between fields, decimal commas, a BOM so that Excel
// reads the umlauts), built in the browser from the list it already holds.

const HEADER = ["Anstoß", "Surebet", "Seite", "Ausgang", "Anbieter", "Quote", "Schlusskurs", "Einsatz (€)", "Gesichert (€)"];

const TIME = new Intl.DateTimeFormat("de-DE", {
  timeZone: "Europe/Berlin",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

const decimal = (n: number | null | undefined, digits = 2) => (typeof n === "number" ? n.toFixed(digits).replace(".", ",") : "");

// A field quoted when it holds the separator, a quote or a line break.
function field(value: string): string {
  return /[;"\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function takenCsv(list: readonly TakenInfo[]): string {
  const rows: string[][] = [HEADER];
  for (const item of list) {
    const start = Date.parse(item.startTime);
    const kickOff = Number.isFinite(start) ? TIME.format(new Date(start)) : "";
    const locked = lockedResult(item.legs, item.stakes);
    const legs = item.legs ?? [];
    if (legs.length === 0) {
      rows.push([kickOff, item.label, "", "", "", "", "", "", ""]);
      continue;
    }
    legs.forEach((leg, i) => {
      rows.push([
        kickOff,
        item.label,
        leg.side === "lay" ? "Lay" : "Back",
        leg.selection,
        leg.source === "exchange" ? "Börse" : (BOOKMAKER_BRANDING[leg.source]?.name ?? leg.source),
        decimal(leg.price),
        decimal(leg.closing),
        decimal(item.stakes?.[i]),
        // The surebet's result once, on its first leg, so that a column sum adds up.
        i === 0 && locked ? decimal(locked.worst) : "",
      ]);
    });
  }
  return "﻿" + rows.map((row) => row.map(field).join(";")).join("\r\n") + "\r\n";
}

// Hands the file to the browser: "meine-surebets-2026-11-04.csv".
export function downloadTakenCsv(list: readonly TakenInfo[], now = new Date()): void {
  const blob = new Blob([takenCsv(list)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `meine-surebets-${now.toISOString().slice(0, 10)}.csv`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
