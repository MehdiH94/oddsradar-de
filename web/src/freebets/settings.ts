import { ALL_BOOKMAKERS } from "../bookmakers";
import type { BookmakerId, ConversionRequest } from "./freebetsApi";

// What the page converts, as the address keeps it (?mode=exchange&bookmaker=betclic&sports=football,tennis), so that
// a reload or a shared link shows the same view. Only what differs from the defaults is written.
export interface Settings {
  mode: "bookmakers" | "exchange";
  legs: 1 | 2 | 3;
  // The bookmaker whose freebets go against the exchange; null until one is chosen.
  bookmaker: BookmakerId | null;
  // The sports ticked; null, every sport.
  sports: string[] | null;
}

export const DEFAULT_SETTINGS: Settings = { mode: "bookmakers", legs: 1, bookmaker: null, sports: null };

export function readSettings(search: string): Settings {
  const params = new URLSearchParams(search);
  const legs = Number(params.get("legs"));
  const bookmaker = ALL_BOOKMAKERS.find((id) => id === params.get("bookmaker")) ?? null;
  const sports = params.get("sports");
  return {
    mode: params.get("mode") === "exchange" ? "exchange" : "bookmakers",
    legs: legs === 2 || legs === 3 ? legs : 1,
    bookmaker,
    sports: sports === null ? null : sports.split(",").filter(Boolean),
  };
}

// The query string of settings, without its "?" ("" when they are the defaults).
export function settingsQuery(settings: Settings): string {
  const params = new URLSearchParams();
  if (settings.mode === "exchange") params.set("mode", "exchange");
  if (settings.mode === "bookmakers" && settings.legs !== 1) params.set("legs", String(settings.legs));
  if (settings.mode === "exchange" && settings.bookmaker) params.set("bookmaker", settings.bookmaker);
  if (settings.sports) params.set("sports", settings.sports.join(","));
  return params.toString();
}

// The request these settings make for a wallet: none against the exchange until a bookmaker holding freebets is
// chosen. `holding` is the bookmakers where the account holds some.
export function requestOf(settings: Settings, holding: readonly BookmakerId[]): ConversionRequest | null {
  const sports = settings.sports ? { sports: settings.sports } : {};
  if (settings.mode === "bookmakers") return { mode: "bookmakers", legs: settings.legs, ...sports };
  const bookmaker = settings.bookmaker && holding.includes(settings.bookmaker) ? settings.bookmaker : holding[0];
  return bookmaker ? { mode: "exchange", bookmaker, ...sports } : null;
}
