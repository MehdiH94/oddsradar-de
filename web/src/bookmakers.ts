import leovegasLogo from "./assets/bookmakers/leovegas.ico";
import merkurbetsLogo from "./assets/bookmakers/merkurbets.png";
import twentybetLogo from "./assets/bookmakers/twentybet.png";

// The fixed set of bookmakers this project scrapes (src/scraper/kambi.ts for
// LeoVegas.de, src/scraper/merkurbets.ts for Merkur Bets, src/scraper/twentybet.ts for 20bet). Unlike sports there is no
// /api/bookmakers endpoint -- they are hardcoded scrapers, so the frontend's
// list mirrors that directly rather than being derived from a fetched response.
// The order is the filter's, and everywhere the bookmakers are listed.
export const ALL_BOOKMAKERS = ["leovegas", "merkurbets", "twentybet"] as const;

// What the filter shows ticked when the URL doesn't say. Not "all": the API's
// own default (no `bookmakers` parameter) still is every bookmaker.
export const DEFAULT_BOOKMAKERS: readonly string[] = ["leovegas", "merkurbets", "twentybet"];

// Whether the selection is the default one. A selection is always in
// ALL_BOOKMAKERS' order (BookmakerMenu, readUrlFilters), so comparing in
// order is comparing as sets.
export function isDefaultBookmakers(selected: readonly string[]): boolean {
  return selected.length === DEFAULT_BOOKMAKERS.length && selected.every((b, i) => b === DEFAULT_BOOKMAKERS[i]);
}

// How the UI shows each bookmaker: its own site icon (LeoVegas.de's favicon, Merkur Bets's sun, 20bet's app icon), with the name as alt text and
// tooltip (BookmakerLogo). A bookmaker without an icon (yet) shows its name in
// its place.
export const BOOKMAKER_BRANDING: Record<string, { name: string; logo?: string } | undefined> = {
  leovegas: { name: "LeoVegas", logo: leovegasLogo },
  merkurbets: { name: "Merkur Bets", logo: merkurbetsLogo },
  twentybet: { name: "20bet", logo: twentybetLogo },
};

// Every bookmaker's name, for the texts that list them all: "LeoVegas, Merkur Bets and 20bet".
export const ALL_BOOKMAKER_NAMES = ALL_BOOKMAKERS.map((id) => BOOKMAKER_BRANDING[id]?.name ?? id);
export const ALL_BOOKMAKERS_SENTENCE =
  ALL_BOOKMAKER_NAMES.length === 1
    ? ALL_BOOKMAKER_NAMES[0]
    : `${ALL_BOOKMAKER_NAMES.slice(0, -1).join(", ")} and ${ALL_BOOKMAKER_NAMES[ALL_BOOKMAKER_NAMES.length - 1]}`;
