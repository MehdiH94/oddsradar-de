import { RawEvent } from "../types";
import { alignParticipantsToSeed, eventSimilarity, NAME_SIMILARITY_THRESHOLD } from "../matcher/match";
import { normalizeName } from "../matcher/normalize";
import { ExchangeMatch } from "./exchange";

// Our matches (the seed bookmaker's French names: "Pologne (U21)", "Paris FC
// F.") found among the exchange's (English: "Poland U21", "Paris FC (W)"),
// with the matcher's own similarity (src/matcher/match.ts). Names are brought
// to one language first, on this side only: the bookmakers' own matching is
// left as it is.

// French country names -> the English ones the exchange uses, after
// normalizeName. Longer names first, so "irlande du nord" isn't read as
// "irlande".
const COUNTRIES: [string, string][] = [
  ["afrique du sud", "south africa"], ["arabie saoudite", "saudi arabia"], ["bosnie herzegovine", "bosnia"],
  ["coree du nord", "north korea"], ["coree du sud", "south korea"], ["cote d ivoire", "ivory coast"],
  ["emirats arabes unis", "uae"], ["etats unis", "usa"], ["iles caimans", "cayman islands"],
  ["iles feroe", "faroe islands"], ["iles vierges americaines", "us virgin islands"],
  ["iles vierges britanniques", "british virgin islands"], ["iles vierges usa", "us virgin islands"],
  ["irlande du nord", "northern ireland"], ["macedoine du nord", "north macedonia"],
  ["nouvelle zelande", "new zealand"], ["pays bas", "netherlands"], ["pays de galles", "wales"],
  ["porto rico", "puerto rico"], ["rep tcheque", "czechia"], ["republique dominicaine", "dominican republic"],
  ["republique tcheque", "czechia"], ["czech republic", "czechia"], ["saint marin", "san marino"],
  ["trinite et tobago", "trinidad and tobago"],
  ["albanie", "albania"], ["algerie", "algeria"], ["allemagne", "germany"], ["andorre", "andorra"],
  ["angleterre", "england"], ["argentine", "argentina"], ["armenie", "armenia"], ["australie", "australia"],
  ["autriche", "austria"], ["azerbaidjan", "azerbaijan"], ["belgique", "belgium"], ["bielorussie", "belarus"],
  ["bolivie", "bolivia"], ["bosnie", "bosnia"], ["bresil", "brazil"], ["bulgarie", "bulgaria"],
  ["cameroun", "cameroon"], ["chili", "chile"], ["chine", "china"], ["chypre", "cyprus"], ["colombie", "colombia"],
  ["croatie", "croatia"], ["danemark", "denmark"], ["dominique", "dominica"], ["ecosse", "scotland"],
  ["egypte", "egypt"], ["equateur", "ecuador"], ["espagne", "spain"], ["estonie", "estonia"],
  ["finlande", "finland"], ["georgie", "georgia"], ["grece", "greece"], ["guinee", "guinea"],
  ["hongrie", "hungary"], ["inde", "india"], ["indonesie", "indonesia"], ["irak", "iraq"], ["irlande", "ireland"],
  ["islande", "iceland"], ["italie", "italy"], ["jamaique", "jamaica"], ["japon", "japan"], ["jordanie", "jordan"],
  ["kirghizistan", "kyrgyzstan"], ["lettonie", "latvia"], ["liban", "lebanon"], ["libye", "libya"],
  ["lituanie", "lithuania"], ["malte", "malta"], ["maroc", "morocco"], ["mexique", "mexico"],
  ["moldavie", "moldova"], ["norvege", "norway"], ["ouzbekistan", "uzbekistan"], ["perou", "peru"],
  ["pologne", "poland"], ["roumanie", "romania"], ["russie", "russia"], ["salvador", "el salvador"],
  ["serbie", "serbia"], ["slovaquie", "slovakia"], ["slovenie", "slovenia"], ["suede", "sweden"],
  ["suisse", "switzerland"], ["syrie", "syria"], ["tadjikistan", "tajikistan"], ["tchequie", "czechia"],
  ["thailande", "thailand"], ["tunisie", "tunisia"], ["turkiye", "turkey"], ["turquie", "turkey"],
];
const COUNTRY_PATTERNS = COUNTRIES.map(([french, english]) => [new RegExp(`\\b${french}\\b`), english] as const);

// A team's name in the words both sides share: the country in English, and a
// women's side marked "women" (Betclic "F.", the exchange "(W)") like the
// matcher's other markers of a club's other side.
export function referenceName(name: string): string {
  let words = normalizeName(name.replace(/-/g, " "));
  for (const [pattern, english] of COUNTRY_PATTERNS) words = words.replace(pattern, english);
  return words.replace(/ (f|w)$/, " women");
}

export interface ReferenceTarget {
  eventId: string;
  participants: string[];
  startTime: string;
}

export interface ReferenceMatch {
  match: ExchangeMatch;
  // The exchange's runner of each of our outcomes: our "1" is our first
  // participant, whichever side the exchange lists them on.
  selections: { "1": number; X: number; "2": number };
}

const asEvent = (sport: string, participants: readonly string[], startTime: string): RawEvent => ({
  sport,
  competition: "",
  startTime,
  participants: participants.map(referenceName),
  odds: [],
});

// One of the exchange's matches: its two sides, the home one first.
export interface ExchangeCandidate {
  participants: readonly string[];
  startTime: string;
}

// Our match of a sport among the exchange's: the most alike at the same
// start (the matcher's tolerance for the sport), if any is alike enough to be
// the same match, and whether its home side is our first participant.
export function placeOnExchange<T extends ExchangeCandidate>(
  sport: string,
  target: ReferenceTarget,
  candidates: readonly T[]
): { match: T; homeFirst: boolean } | null {
  if (target.participants.length !== 2) return null;
  const ours = asEvent(sport, target.participants, target.startTime);
  let best: { match: T; score: number } | null = null;
  for (const match of candidates) {
    if (match.participants.length !== 2) continue;
    const score = eventSimilarity(ours, asEvent(sport, match.participants, match.startTime));
    if (score >= NAME_SIMILARITY_THRESHOLD && (!best || score > best.score)) best = { match, score };
  }
  if (!best) return null;
  const [home, away] = asEvent(sport, best.match.participants, best.match.startTime).participants;
  const aligned = alignParticipantsToSeed([home, away], ours.participants);
  return { match: best.match, homeFirst: aligned[0] === home };
}

// Whether our match now lists its participants the other way round from
// `orientedFor`, the ones its place on the exchange was oriented on: its id
// is the same either way (src/matcher/match.ts, canonicalId), but its "1"
// and "2" swap. Seen 6/10/2026 on Norvège (U21) - Israël (U21), whose
// exchange prices of Israel stood for Norway's: a value bet and a surebet
// on Israel at every bookmaker that weren't.
export function listedTheOtherWay(orientedFor: readonly string[], participants: readonly string[]): boolean {
  if (orientedFor.length !== 2 || participants.length !== 2) return false;
  const aligned = alignParticipantsToSeed([...orientedFor], [...participants]);
  return aligned[0] === orientedFor[1] && aligned[1] === orientedFor[0];
}

// Our football match among the exchange's.
export function findOnExchange(target: ReferenceTarget, candidates: readonly ExchangeMatch[]): ReferenceMatch | null {
  const best = placeOnExchange("football", target, candidates);
  if (!best) return null;
  const { runners } = best.match;
  const { homeFirst } = best;
  return {
    match: best.match,
    selections: {
      "1": homeFirst ? runners.home : runners.away,
      X: runners.draw,
      "2": homeFirst ? runners.away : runners.home,
    },
  };
}

// Words too common to search a team by.
const UNSEARCHABLE = new Set([
  "women", "united", "city", "real", "sporting", "athletic", "club", "saint", "santa",
  "islands", "north", "northern", "south", "republic", "british",
]);

// What to search the exchange for to find a team: its longest telling word.
export function searchTerm(name: string): string | undefined {
  const words = referenceName(name)
    .split(" ")
    .filter((w) => w.length >= 3 && !UNSEARCHABLE.has(w) && !/^u\d+$/.test(w));
  return words.sort((a, b) => b.length - a.length)[0];
}
