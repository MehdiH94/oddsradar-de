import betclicLogo from "./assets/bookmakers/betclic.png";
import betssonLogo from "./assets/bookmakers/betsson.png";
import netbetLogo from "./assets/bookmakers/netbet.ico";
import pmuLogo from "./assets/bookmakers/pmu.png";
import unibetLogo from "./assets/bookmakers/unibet.ico";
import vbetLogo from "./assets/bookmakers/vbet.ico";
import winamaxLogo from "./assets/bookmakers/winamax.png";

// The icons of the bookmakers added since, found by their file name: drop
// `<id>.png` (or .ico, .svg, .webp, .jpg) in assets/bookmakers/ and the
// bookmaker shows it, no import to write. `npm run icons` fetches them
// (scripts/fetch-bookmaker-icons.mjs).
const droppedIcons = import.meta.glob<string>("./assets/bookmakers/*.{png,ico,svg,webp,jpg}", {
  eager: true,
  query: "?url",
  import: "default",
});
const droppedIcon = (id: string): string | undefined =>
  Object.entries(droppedIcons).find(([path]) => path.split("/").pop()?.replace(/\.[^.]+$/, "") === id)?.[1];

// The fixed set of bookmakers this project scrapes (src/scraper/winamax.ts,
// betclic.ts, vbet.ts for Vbet, CircusBet and DAZN Bet, sportnco.ts for NetBet and Genybet, unibet.ts, betsson.ts, pmu.ts, betby.ts for Betify). Unlike sports there is no
// /api/bookmakers endpoint -- they are hardcoded scrapers, so the frontend's
// list mirrors that directly rather than being derived from a fetched response.
// The order is the filter's, and everywhere the bookmakers are listed.
export const ALL_BOOKMAKERS = ["winamax", "betclic", "unibet", "pmu", "netbet", "genybet", "vbet", "circusbet", "daznbet", "betsson", "betify"] as const;

// What the filter shows ticked when the URL doesn't say. Not "all": the API's
// own default (no `bookmakers` parameter) still is every bookmaker.
export const DEFAULT_BOOKMAKERS: readonly string[] = ["winamax", "betclic", "unibet"];

// Whether the selection is the default one. A selection is always in
// ALL_BOOKMAKERS' order (BookmakerMenu, readUrlFilters), so comparing in
// order is comparing as sets.
export function isDefaultBookmakers(selected: readonly string[]): boolean {
  return selected.length === DEFAULT_BOOKMAKERS.length && selected.every((b, i) => b === DEFAULT_BOOKMAKERS[i]);
}

// How the UI shows each bookmaker: its own site icon (winamax.fr's
// apple-touch-icon, the others' favicons, Betsson's scaled down to 128 px, PMU's from its site's declared icon), with the name as alt text and
// tooltip (BookmakerLogo). A bookmaker without an icon (yet) shows its name in
// its place.
export const BOOKMAKER_BRANDING: Record<string, { name: string; logo?: string } | undefined> = {
  winamax: { name: "Winamax", logo: winamaxLogo },
  betclic: { name: "Betclic", logo: betclicLogo },
  unibet: { name: "Unibet", logo: unibetLogo },
  pmu: { name: "PMU", logo: pmuLogo },
  netbet: { name: "NetBet", logo: netbetLogo },
  genybet: { name: "Genybet", logo: droppedIcon("genybet") },
  vbet: { name: "Vbet", logo: vbetLogo },
  circusbet: { name: "CircusBet", logo: droppedIcon("circusbet") },
  daznbet: { name: "DAZN Bet", logo: droppedIcon("daznbet") },
  betsson: { name: "Betsson", logo: betssonLogo },
  betify: { name: "Betify", logo: droppedIcon("betify") },
};

// Every bookmaker's name, for the texts that list them all: "Winamax, Betclic,
// Unibet, PMU, NetBet, Genybet, Vbet, CircusBet, DAZN Bet, Betsson et Betify".
export const ALL_BOOKMAKER_NAMES = ALL_BOOKMAKERS.map((id) => BOOKMAKER_BRANDING[id]?.name ?? id);
export const ALL_BOOKMAKERS_SENTENCE = `${ALL_BOOKMAKER_NAMES.slice(0, -1).join(", ")} et ${ALL_BOOKMAKER_NAMES[ALL_BOOKMAKER_NAMES.length - 1]}`;
