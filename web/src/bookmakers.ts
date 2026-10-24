import leovegasLogo from "./assets/bookmakers/leovegas.ico";
import merkurbetsLogo from "./assets/bookmakers/merkurbets.png";
import twentybetLogo from "./assets/bookmakers/twentybet.png";
import admiralbetLogo from "./assets/bookmakers/admiralbet.png";
import betathomeLogo from "./assets/bookmakers/betathome.png";
import oddsetLogo from "./assets/bookmakers/oddset.png";
import betwayLogo from "./assets/bookmakers/betway.png";
import sportingbetLogo from "./assets/bookmakers/sportingbet.png";
import vbetLogo from "./assets/bookmakers/vbet.ico";
import winamaxdeLogo from "./assets/bookmakers/winamaxde.png";

// The fixed set of bookmakers this project scrapes (src/scraper/kambi.ts for
// LeoVegas.de, src/scraper/merkurbets.ts for Merkur Bets, src/scraper/twentybet.ts for 20bet, src/scraper/admiralbet.ts for Admiralbet, src/scraper/betathome.ts for bet-at-home, src/scraper/oddset.ts for ODDSET, src/scraper/betway.ts for Betway, src/scraper/sportingbet.ts for Sportingbet, src/scraper/vbet.ts for VBET, src/scraper/888sport.ts for 888sport, src/scraper/neobet.ts for neobet, src/scraper/oddsApi.ts for Tipico and Winamax.de). Unlike sports there is no
// /api/bookmakers endpoint -- they are hardcoded scrapers, so the frontend's
// list mirrors that directly rather than being derived from a fetched response.
// The order is the filter's, and everywhere the bookmakers are listed.
export const ALL_BOOKMAKERS = ["leovegas", "merkurbets", "twentybet", "admiralbet", "betathome", "oddset", "betway", "sportingbet", "vbet", "888sport", "neobet", "tipico", "winamaxde"] as const;

// What the filter shows ticked when the URL doesn't say. Not "all": the API's
// own default (no `bookmakers` parameter) still is every bookmaker.
export const DEFAULT_BOOKMAKERS: readonly string[] = [
  "leovegas",
  "merkurbets",
  "twentybet",
  "admiralbet",
  "betathome",
  "oddset",
  "betway",
  "sportingbet",
  "vbet",
  "888sport",
  "neobet",
  "tipico",
  "winamaxde",
];

// Whether the selection is the default one. A selection is always in
// ALL_BOOKMAKERS' order (BookmakerMenu, readUrlFilters), so comparing in
// order is comparing as sets.
export function isDefaultBookmakers(selected: readonly string[]): boolean {
  return selected.length === DEFAULT_BOOKMAKERS.length && selected.every((b, i) => b === DEFAULT_BOOKMAKERS[i]);
}

// How the UI shows each bookmaker: its own site icon (LeoVegas.de's favicon, Merkur Bets's sun, 20bet's app icon, Admiralbet's, bet-at-home's, ODDSET's, Betway's, Winamax's; Tipico's name alone), with the name as alt text and
// tooltip (BookmakerLogo). A bookmaker without an icon (yet) shows its name in
// its place.
// `unlicensed`: the bookmaker holds no German licence (GGL): said next to its
// name in the filter, as a fact, with no link to it.
// `stakeTax`: the German betting tax its prices are shown net of, as the
// scrapers take it off (src/scraper/, stakeTax.ts): 0 when it takes none;
// 0 too for Tipico and Winamax, which pay it themselves (src/scraper/oddsApi.ts).
// None given: not known, the price shown as read.
export const BOOKMAKER_BRANDING: Record<string, { name: string; logo?: string; unlicensed?: boolean; stakeTax?: number } | undefined> = {
  leovegas: { name: "LeoVegas", logo: leovegasLogo, stakeTax: 0.05 },
  merkurbets: { name: "Merkur Bets", logo: merkurbetsLogo, stakeTax: 0.05 },
  twentybet: { name: "20bet", logo: twentybetLogo, unlicensed: true, stakeTax: 0 },
  admiralbet: { name: "Admiralbet", logo: admiralbetLogo, stakeTax: 0.053 },
  betathome: { name: "bet-at-home", logo: betathomeLogo, stakeTax: 0.053 },
  oddset: { name: "ODDSET", logo: oddsetLogo, stakeTax: 0.053 },
  betway: { name: "Betway", logo: betwayLogo, stakeTax: 0.053 },
  sportingbet: { name: "Sportingbet", logo: sportingbetLogo, stakeTax: 0.05 },
  vbet: { name: "VBET", logo: vbetLogo, stakeTax: 0.05 },
  "888sport": { name: "888sport", stakeTax: 0.05 },
  neobet: { name: "neobet", stakeTax: 0.05 },
  tipico: { name: "Tipico", stakeTax: 0 },
  winamaxde: { name: "Winamax", logo: winamaxdeLogo, stakeTax: 0 },
};

// What a bookmaker's prices are net of, for the price's tooltip: "Quote nach
// Abzug von 5,3 % Wettsteuer".
export function stakeTaxNote(bookmaker: string): string {
  const tax = BOOKMAKER_BRANDING[bookmaker]?.stakeTax;
  if (tax === undefined) return "Quote wie angeboten, Wettsteuer nicht abgezogen";
  if (tax === 0) return "Quote ohne Wettsteuer";
  const percent = (Math.round(tax * 1000) / 10).toString().replace(".", ",");
  return `Quote nach Abzug von ${percent}\u00a0% Wettsteuer`;
}

// Every bookmaker's name, for the texts that list them all: "LeoVegas, Merkur Bets, 20bet, …, Tipico und Winamax".
export const ALL_BOOKMAKER_NAMES = ALL_BOOKMAKERS.map((id) => BOOKMAKER_BRANDING[id]?.name ?? id);
export const ALL_BOOKMAKERS_SENTENCE =
  ALL_BOOKMAKER_NAMES.length === 1
    ? ALL_BOOKMAKER_NAMES[0]
    : `${ALL_BOOKMAKER_NAMES.slice(0, -1).join(", ")} und ${ALL_BOOKMAKER_NAMES[ALL_BOOKMAKER_NAMES.length - 1]}`;
