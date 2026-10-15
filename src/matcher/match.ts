import { distance } from "fastest-levenshtein";
import { createHash } from "node:crypto";
import { RawEvent, RawOdds, CanonicalEvent, EventSource } from "../types";
import { COMPETITION_WINNER_SPORTS, MARKET_OUTRIGHT } from "../scraper/canonical";
import { foldGermanDigraphs, normalizeName } from "./normalize";

export const NAME_SIMILARITY_THRESHOLD = 0.75;
const START_TIME_TOLERANCE_MS = 10 * 60 * 1000;

// The bookmakers' times for one match can be a quarter of an hour apart (real
// production cases, 9/10/2026: Winamax's NHL, a Mexican league match) or an hour
// (Vbet's German cup matches of the 27th of October). Up to this, names as near
// as the loose sports' below are enough. Measured on a day's matches, no two of
// one bookmaker's came this close with near-identical names; four hours apart,
// two clubs did ("Atlético San Luis" and "Santos Laguna" for "Atlético
// Mineiro" and "Santos").
const SHIFTED_START_TIME_TOLERANCE_MS = 60 * 60 * 1000;

// Sports whose start times the two bookmakers give hours apart: a fight is
// timed by the card or by the bout, a tennis match by a guess at the order of
// play. Real production cases (2026-09-28): Betclic 04:10 / Winamax 05:00 for
// the same tennis match, 02:00 / 12:00 for the same fight. The same two
// opponents never meet twice in 12 hours, so near-identical names are enough
// there -- but only near-identical: a shared surname (0.75) is not.
const LOOSE_START_TIME_SPORTS = new Set(["tennis", "boxe", "mma"]);
const LOOSE_START_TIME_TOLERANCE_MS = 12 * 60 * 60 * 1000;
const LOOSE_START_TIME_MIN_SIMILARITY = 0.9;

// Winner-among-N markets (a race, a golf tournament) are dated by when betting
// closes, up to 28 hours apart between the bookmakers for the same one (real
// production case, US Open 2027: Betclic 20/06 20:00, Winamax 22/06 00:00).
// Season standings dated months apart (Betclic by the first race, Winamax by
// the last) stay apart.
const OUTRIGHT_START_TIME_TOLERANCE_MS = 48 * 60 * 60 * 1000;
// A multi-day event one bookmaker dates by its start and the other by its
// end: Betclic "Rallye d'Italie" (04/10 18:00) is Winamax "WRC - Rallye
// d'Italie 2026" (01/10 07:00), 83 hours apart (2026-09-29). Past the
// tolerance above, two markets can still pair within this one, but only when
// one's title words are all in the other's (sameEventTitle).
const OUTRIGHT_SAME_TITLE_TOLERANCE_MS = 5 * 24 * 60 * 60 * 1000;
// A season or a tour dated by its first day at one bookmaker and by its last
// at another (7/10/2026): the MotoGP championship is the 22nd of November at
// Winamax and Betclic, the 29th at Unibet; the Tour de France 2027 the 4th of
// July at Unibet, the 25th and 26th at Betclic and Winamax. Titles that give
// the same event once the year and the words around it are gone (eventCore)
// pair within this one.
const OUTRIGHT_SAME_EVENT_TOLERANCE_MS = 30 * 24 * 60 * 60 * 1000;
// Share of the shorter competitor list both markets have in common. Titles
// can't pair them: Betclic "GP de Bahreïn" / Winamax "Grand Prix de Bahreïn
// 2026 - Course" score 0.39, while the men's and women's ski standings score
// 0.69 against each other. Their competitors tell them apart at once.
const OUTRIGHT_MIN_SHARED_COMPETITORS = 0.5;

function levenshteinRatio(a: string, b: string): number {
  return 1 - distance(a, b) / Math.max(a.length, b.length, 1);
}

function nameSimilarity(a: string, b: string): number {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  // "München" / "Muenchen": the better of the names as written and with the
  // German digraphs folded.
  return Math.max(levenshteinRatio(na, nb), levenshteinRatio(foldGermanDigraphs(na), foldGermanDigraphs(nb)));
}

// Words bookmakers add to or drop from a club's name at will: club-type and
// legal-form abbreviations, plus French/Spanish/English connectors. Real
// production cases: Betclic "BC Dubai - Barcelone" vs Winamax "Dubai - FC
// Barcelone" scored 0.69 on a whole-name comparison, under
// NAME_SIMILARITY_THRESHOLD, so the match was listed twice, once per bookmaker.
// None of these words tells two teams apart on its own.
const IGNORED_NAME_WORDS = new Set([
  "ac", "afc", "as", "bc", "bk", "ca", "cb", "cd", "cf", "club", "ec", "ehc", "ev", "fc", "fk", "hc", "hk", "kk",
  "rk", "sc", "sk", "sv", "us",
  "de", "del", "des", "du", "la", "le", "les", "the",
]);

// Words marking a club's other side (women's, reserve or youth team). A name
// is never treated as a shortened form of one that adds such a word.
const TEAM_VARIANT_WORD = /^(women|womens|fem|femmes?|feminines?|dames|ladies|reserves?|res|youth|jeunes|espoirs|jong|primavera|ii|iii|u\d+|sub\d+)$/;

// Cities one bookmaker writes in French and the other in the local language.
// Swapped word for word before any comparison, so each pair also covers every
// club carrying the city ("Aris Thessalonique" / "Aris Thessaloniki"). The
// first ones are real production cases (2026-09-28, e.g. Winamax "Atalanta
// Bergame - Venise" for Betclic "Atalanta - Venezia"); the others are the
// usual French names of cities with clubs in European competitions.
const CITY_ALIASES = new Map([
  ["anvers", "antwerp"], ["bergame", "bergamo"], ["groningue", "groningen"], ["louvain", "leuven"],
  ["malines", "mechelen"], ["naples", "napoli"], ["pise", "pisa"], ["salonique", "thessaloniki"],
  ["thessalonique", "thessaloniki"], ["venise", "venezia"], ["vicence", "vicenza"],
  ["athenes", "athens"], ["bale", "basel"], ["belgrade", "beograd"], ["bruges", "brugge"],
  ["bucarest", "bucuresti"], ["cologne", "koln"], ["copenhague", "kobenhavn"], ["famagouste", "famagusta"],
  ["gand", "gent"], ["hambourg", "hamburg"], ["lisbonne", "lisboa"], ["mayence", "mainz"],
  ["moscou", "moscow"], ["munich", "munchen"], ["nicosie", "nicosia"], ["prague", "praha"],
  ["salzbourg", "salzburg"], ["seville", "sevilla"], ["varsovie", "warszawa"], ["vienne", "wien"],
  ["brunswick", "braunschweig"],
]);

// Hyphens become spaces first: normalizeName drops them, gluing
// "Fribourg-Gottéron" into one word that "Fribourg" would never be part of.
function coreWords(name: string): string[] {
  const words = normalizeName(name.replace(/-/g, " "))
    .split(" ")
    .filter(Boolean)
    .map((w) => CITY_ALIASES.get(w) ?? w);
  const core = words.filter((w) => !IGNORED_NAME_WORDS.has(w));
  // Folded once the words the matcher lists are looked up: "Köln" and "Koeln"
  // are one word.
  return (core.length > 0 ? core : words).map(foldGermanDigraphs);
}

// Names bookmakers give the same team that no spelling rule can pair: an
// acronym, a nickname, a sponsor's name, a translation. One line per team;
// each name is compared by its core words (coreWords), so club prefixes,
// accents and the city aliases above need no extra spelling. Every pair is a
// real production case (2026-09-28; the rugby clubs' 2026-10-07: Unibet's
// "Toulouse" for the "Stade Toulousain" of the others; Betsson's "Fotbal Club
// FCSB" and "FC Riga FS", 2026-10-08; the football, basketball, handball and
// hockey clubs of 2026-10-09: renamed clubs, sponsors, translations; PMU's
// "PSG", "Wolves" and the like, 2026-10-11), Betclic's name first.
const TEAM_ALIASES = [
  ["USA", "États-Unis"],
  ["QPR", "Queens Park Rangers"],
  ["Amed Sportif Faaliyetler", "Amedspor"],
  ["AZ", "AZ Alkmaar"],
  ["Steaua", "FCSB", "Steaua Bucarest", "Fotbal Club FCSB"],
  ["Rigas Futbola Skola", "FC Riga FS"],
  ["Oud-Heverlee Leuven", "O-H Louvain", "OH Leuven"],
  ["SBV Excelsior", "Excelsior Rotterdam", "Excelsior"],
  ["Volos NPS", "NFC Volos", "Volos"],
  ["Sint-Truidense VV", "Saint-Trond", "Sint-Truiden", "STVV"],
  ["Kuopio PS", "KuPS"],
  ["Western Sydney", "WS Wanderers", "Western Sydney Wanderers"],
  ["Bertram Derthona", "Tortona Basket", "Derthona Basket", "Tortona", "Derthona"],
  ["Lyon-Villeurbanne", "ASVEL", "LDLC ASVEL"],
  ["Tenerife", "CB Canarias", "La Laguna Tenerife"],
  ["U-Banca Transilvania", "U-BT Cluj-Napoca", "U-BT Cluj"],
  ["EC VSV", "EC Villacher SV", "VSV"],
  ["HC Eurofarm Rabotnik", "RK Eurofarm Pelister"],
  ["Naturhouse La Rioja", "Logroño La Rioja"],
  ["UBB", "Bordeaux-Bègles", "Union Bordeaux-Bègles", "Bordeaux"],
  ["LOU Rugby", "Lyon OU", "LOU", "Lyon"],
  ["Stade Niçois", "Nice"],
  ["Stade Aurillacois", "Aurillac"],
  ["Section Paloise", "Pau"],
  ["RC Toulonnais", "Toulon"],
  ["Stade Toulousain", "Toulouse"],
  ["Aviron Bayonnais", "Bayonne"],
  ["Stade Rochelais", "La Rochelle"],
  ["AVS Futebol SAD", "AVS Vila das Aves"],
  ["Sepsi OSK Sfantu Gheorghe", "ACS Sepsi"],
  ["Jalgpallikool Tammeka", "Tammeka Tartu"],
  ["UTA Arad", "ACS UTA Batrana Doamna"],
  ["Ironi Kiryat Shmona", "Hapoel Kiryat Shmona", "Hapoel Kiryat"],
  ["Qingdao West Coast", "Qingdao Youth Island"],
  ["Dalian Zhixing", "Dalian Yingbo"],
  ["FC Arges", "Argesul Pitesti"],
  ["FC Rapid 1923", "Rapid Bucarest"],
  ["Fos-sur-Mer", "Fos Provence Basket"],
  ["Chalon/Saône", "Elan Chalon"],
  ["Rio Natura Monbus Obradoiro", "Obradoiro CAB"],
  ["Lleida Basquet", "Força Lleida"],
  ["Baskonia Vitoria", "Saski Baskonia"],
  ["Abc Cantu", "Pallacanestro Cantù"],
  ["Generazione Vincente Cuore Napoli", "Napoli Basket"],
  ["Sporting CP", "Sporting Clube Portugal"],
  ["Ferencvaros Budapest", "Ferencvarosi TC"],
  ["Vienne Capitals", "Vienna Capitals"],
  ["Paris SG", "PSG"],
  ["Étoile Rouge Belgrade", "Crvena Zvezda"],
  ["Laval", "Stade Lavallois"],
  ["Majorque", "Mallorca"],
  ["Wolverhampton", "Wolves"],
  ["La Gantoise", "KAA Gent"],
];

// Core name -> index of its team in TEAM_ALIASES.
const TEAM_OF_ALIAS = new Map<string, number>();
TEAM_ALIASES.forEach((names, team) => {
  for (const name of names) {
    const key = coreWords(name).join(" ");
    // Fails at load, and so in every test run, rather than silently pairing
    // two different teams.
    if ((TEAM_OF_ALIAS.get(key) ?? team) !== team) throw new Error(`TEAM_ALIASES lists "${name}" under two teams`);
    TEAM_OF_ALIAS.set(key, team);
  }
});

function isTeamAlias(a: string[], b: string[]): boolean {
  const team = TEAM_OF_ALIAS.get(a.join(" "));
  return team !== undefined && team === TEAM_OF_ALIAS.get(b.join(" "));
}

// A bookmaker sometimes shortens a club's name by dropping its city or a
// qualifier -- real production case: Winamax "Club Olimpia" for Betclic
// "Olimpia Asuncion" (0.19 on a whole-name comparison). Every word of the
// shorter name must be one of the longer name's words, and the dropped words
// can't be single letters or team-variant words, so "Arsenal" never pairs with
// "Arsenal Women" or "Arsenal F" this way.
function isShortenedName(short: string[], long: string[]): boolean {
  if (short.length === 0 || short.length >= long.length) return false;
  if (short.join("").length < 3) return false;
  const dropped = [...long];
  for (const word of short) {
    const i = dropped.indexOf(word);
    if (i === -1) return false;
    dropped.splice(i, 1);
  }
  return dropped.every((w) => w.length >= 2 && !TEAM_VARIANT_WORD.test(w));
}

// The same words in another order: real production case, Betclic "Shi Han" for
// Winamax "Han Shi" (a family name first or last).
const sameWords = (a: string[], b: string[]) => [...a].sort().join(" ") === [...b].sort().join(" ");

// A word cut short with a full stop, the others identical: real production
// case, Unibet "West. Sydney" for Betclic "Western Sydney". Needs a stop and two
// letters, so "K." for a first name stays isInitialLastNameMatch's business.
function isAbbreviatedName(a: string, b: string): boolean {
  const wordsA = a.split(/\s+/).filter(Boolean);
  const wordsB = b.split(/\s+/).filter(Boolean);
  if (wordsA.length !== wordsB.length) return false;
  let abbreviated = false;
  for (let i = 0; i < wordsA.length; i++) {
    const [x, y] = [normalizeName(wordsA[i]), normalizeName(wordsB[i])];
    if (x === y) continue;
    const [cut, full] = wordsA[i].endsWith(".") ? [x, y] : wordsB[i].endsWith(".") ? [y, x] : ["", ""];
    if (cut.length < 2 || !full.startsWith(cut)) return false;
    abbreviated = true;
  }
  return abbreviated;
}

// The same club under another spelling, without dropping a word: what a pairing
// of participants should prefer over a name that merely contains the other.
function isSameClubSpelling(a: string, b: string): boolean {
  const coreA = coreWords(a);
  const coreB = coreWords(b);
  return sameWords(coreA, coreB) || isTeamAlias(coreA, coreB) || isAbbreviatedName(a, b);
}

function isSameClubName(a: string, b: string): boolean {
  const coreA = coreWords(a);
  const coreB = coreWords(b);
  return isSameClubSpelling(a, b) || isShortenedName(coreA, coreB) || isShortenedName(coreB, coreA);
}

// Words too common in club names to show, on their own, that two names are
// the same club ("Deportivo Maldonado" / "Deportivo Capiata").
const GENERIC_CLUB_WORDS = new Set([
  "athletic", "atletico", "basket", "basketball", "calcio", "city", "deportivo", "dinamo", "dynamo",
  "independiente", "olympique", "racing", "real", "saint", "santa", "sport", "sporting", "stade", "union",
  "united", "universidad", "university",
]);

// Credit for two names that only share a distinctive word -- real production
// cases: Betclic "Efes Istanbul" vs Winamax "Anadolu Efes", "Aquila Basket
// Trentino" vs "Trento". Half credit is on purpose: averaged over a match's
// two participants it only reaches NAME_SIMILARITY_THRESHOLD when the other
// participant is the same club (a score of 1). A team doesn't play two matches
// at once, so the same club, sport and kick-off already pin the match down;
// the shared word only has to rule out a completely different opponent.
const SHARED_WORD_SCORE = 0.5;

// Exact, or a close spelling of a long enough word ("Trento" / "Trentino").
function sharesDistinctiveWord(a: string[], b: string[]): boolean {
  const distinctive = (words: string[]) =>
    words.filter((w) => w.length >= 4 && !GENERIC_CLUB_WORDS.has(w) && !TEAM_VARIANT_WORD.test(w));
  const wordsB = distinctive(b);
  return distinctive(a).some((wa) =>
    wordsB.some(
      (wb) =>
        wa === wb || (Math.min(wa.length, wb.length) >= 5 && levenshteinRatio(wa, wb) >= NAME_SIMILARITY_THRESHOLD)
    )
  );
}

// Unibet writes a team in 14 characters at most (of the 130 or so team names of
// its listing on 9/10/2026 none is longer, 23 have exactly 14), and shortens a
// longer name by a word cut with a full stop ("Hap.Tel Aviv" for "Hapoel
// Tel-Aviv", "Lokomo.Sofia"), words run together ("Newell OldBoys"), a
// club-type word dropped ("Uni.Craiova" for "CS Universitatea Craiova"), or a
// word or the end of the name cut ("Universit Cluj", "Gimnasia Y Esg" for
// "Gimnasia y Esgrima Mendoza"). Only the width tells it from another spelling,
// so a short name is read as a cut of a long one only when it fits: 14
// characters at most against a name of 15 or more. Vbet does the same
// ("FC Nomme Unite").
const SHORT_NAME_WIDTH = 14;

// What a cut name is worth against the whole one. Its words all stand, the last
// one whole ("Hap.Tel Aviv"): only that club's, COMPRESSED_NAME_SCORE. Its end
// is lost ("Gimnasia Y Esg" is Mendoza's or La Plata's, "Independiente" is four
// clubs'): CUT_NAME_SCORE, under NAME_SIMILARITY_THRESHOLD, so that two of them
// in one match are not enough and the other participant has to be certain --
// two simultaneous matches of sister clubs can't be taken for one. Both are
// under 1: a name written the same way always wins the pairing.
const COMPRESSED_NAME_SCORE = 0.95;
const CUT_NAME_SCORE = 0.7;

// The words a long name may start or end with that its cut form leaves out:
// the club-type words above and the other short ones found at the start (and
// "SAD", "TC", "VV" at the end) of the long names of the 9/10/2026 listings.
const CLUB_PREFIX_WORDS = new Set([...IGNORED_NAME_WORDS, "acs", "bm", "cda", "cs", "csm", "fsc", "kf", "ks", "mks", "nk", "tsv", "vk"]);
const CLUB_SUFFIX_WORDS = new Set([...IGNORED_NAME_WORDS, "sad", "tc", "vv"]);

// A word a cut never takes off a name: a letter ("F", "B", "C"), or one that
// marks a club's other side. "Real Sociedad" is not a cut of "Real Sociedad B".
const isQualifierWord = (word: string): boolean =>
  word.length <= 1 || TEAM_VARIANT_WORD.test(word) || word === "iv" || /^(?:fem|wom|dam|reserv|youth)/.test(word);

// The pieces of a cut name: its words, split at a space, a hyphen or a full
// stop ("Hap.PetachTikv" is "hap", stopped, then "petachtikv").
function namePieces(name: string): { letters: string; stopped: boolean }[] {
  const pieces: { letters: string; stopped: boolean }[] = [];
  for (const chunk of name.replace(/-/g, " ").split(/\s+/).filter(Boolean)) {
    const parts = chunk.split(".");
    parts.forEach((part, i) => {
      const letters = normalizeName(part);
      if (letters) pieces.push({ letters, stopped: i < parts.length - 1 });
    });
  }
  return pieces;
}

// What a name of 14 characters at most is worth as the cut form of a longer
// one: 0 when it can't be, else COMPRESSED_NAME_SCORE or CUT_NAME_SCORE. Its
// pieces take the words of the long name one after the other, none left out
// between them: a piece is one or several words run together, or the start of
// a word (with a full stop, two letters at least; without, five, or three for
// the last piece of a name that reaches the width). A letter alone matches too
// many clubs ("Deportivo P." is Pasto's or Pereira's) and is left to the
// aliases. A club-type word may be missing from the start of the long name and
// the end of it may be lost if the width was reached, unless a word that marks
// another side goes with it. At least one piece is a whole word, or ten
// letters stand: two cut pieces of a few letters are not a name.
function compressedNameScore(short: string, full: string): number {
  const width = short.trim().length;
  if (width > SHORT_NAME_WIDTH || full.trim().length <= SHORT_NAME_WIDTH) return 0;
  const pieces = namePieces(short);
  const allWords = normalizeName(full.replace(/-/g, " ")).split(" ").filter(Boolean);
  if (pieces.length < 2 || allWords.length < 2) return 0;

  const place = (words: string[], p: number, w: number, whole: number, letters: number, lastWhole: boolean): number => {
    if (p === pieces.length) {
      if (whole === 0 && letters < 10) return 0;
      const lost = words.slice(w);
      if (lost.every((word) => CLUB_SUFFIX_WORDS.has(word))) return lastWhole ? COMPRESSED_NAME_SCORE : CUT_NAME_SCORE;
      return width >= SHORT_NAME_WIDTH - 1 && !lost.some(isQualifierWord) ? CUT_NAME_SCORE : 0;
    }
    const { letters: piece, stopped } = pieces[p];
    const last = p === pieces.length - 1;
    let run = "";
    for (let k = w; k < words.length; k++) {
      run += words[k];
      if (run === piece) {
        const score = place(words, p + 1, k + 1, whole + 1, letters + piece.length, true);
        if (score > 0) return score;
      } else if (run.startsWith(piece)) {
        const cut = piece.length - (run.length - words[k].length);
        const allowed = stopped ? cut >= 2 : last ? cut >= 3 && width >= SHORT_NAME_WIDTH - 1 : cut >= 5;
        return allowed ? place(words, p + 1, k + 1, whole, letters + piece.length, false) : 0;
      } else if (!piece.startsWith(run)) {
        return 0;
      }
    }
    return 0;
  };

  let best = place(allWords, 0, 0, 0, 0, false);
  for (let s = 1; best < COMPRESSED_NAME_SCORE && s < allWords.length - 1 && CLUB_PREFIX_WORDS.has(allWords[s - 1]); s++) {
    best = Math.max(best, place(allWords.slice(s), 0, 0, 0, 0, false));
  }
  return best;
}

// How alike two bookmakers' names for a participant are, from 0 to 1.
function participantNameSimilarity(a: string, b: string): number {
  if (
    isSameClubName(a, b) ||
    isInitialsOfName(a, b) ||
    isInitialsOfName(b, a) ||
    isCityCodeOfName(a, b) ||
    isCityCodeOfName(b, a)
  ) {
    return 1;
  }
  const coreA = coreWords(a);
  const coreB = coreWords(b);
  const similarity = Math.max(
    nameSimilarity(a, b),
    levenshteinRatio(coreA.join(" "), coreB.join(" ")),
    doublesSimilarity(a, b),
    compressedNameScore(a, b),
    compressedNameScore(b, a)
  );
  return sharesDistinctiveWord(coreA, coreB) ? Math.max(similarity, SHARED_WORD_SCORE) : similarity;
}

// Whether two spellings of a match's two sides list them in the same order
// ("Groningen" first in both, not in one of them last), which decides what
// "1" and "2" stand for in the odds saved next to them. Other sizes of
// participants (a title, for an outright) have no sides to swap.
export function keepsSidesOrder(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  if (a.length !== 2) return true;
  const straight = participantNameSimilarity(a[0], b[0]) + participantNameSimilarity(a[1], b[1]);
  const swapped = participantNameSimilarity(a[0], b[1]) + participantNameSimilarity(a[1], b[0]);
  return straight > swapped;
}

function permutations<T>(items: T[]): T[][] {
  if (items.length <= 1) return [items];
  const result: T[][] = [];
  for (let i = 0; i < items.length; i++) {
    const rest = [...items.slice(0, i), ...items.slice(i + 1)];
    for (const perm of permutations(rest)) {
      result.push([items[i], ...perm]);
    }
  }
  return result;
}

function participantsSimilarity(a: string[], b: string[]): number {
  if (a.length !== b.length) return 0;
  let best = 0;
  for (const order of permutations(b)) {
    const scores = a.map((name, i) => participantNameSimilarity(name, order[i]));
    const avg = scores.reduce((sum, s) => sum + s, 0) / scores.length;
    if (avg > best) best = avg;
  }
  return best;
}

// A winner-among-N market's only participant is its title (validateRawEvent).
const isOutright = (event: RawEvent) => event.participants.length === 1;

function competitorsOf(event: RawEvent): string[] {
  return [...new Set(event.odds.filter((o) => o.market === MARKET_OUTRIGHT).map((o) => o.selection))];
}

// The words of a name with the umlauts and the double a the bookmakers spell
// their own way (6/10/2026): Winamax's "Aaberg, Ludvig" is "Ludvig Åberg",
// "Jäger" is "Jaeger" and "Moeller" is "Møller" at the others.
function foldedWords(name: string): string[] {
  return normalizeName(name.replace(/-/g, " "))
    .replace(/aa|ae/g, "a")
    .replace(/oe/g, "o")
    .replace(/ue/g, "u")
    .split(" ")
    .filter(Boolean);
}

// A bookmaker's draw ("Match Nul", "Égalité", "N", "Egalité") in an outright
// with two sides, the Ryder Cup: every one's the same row.
const isDrawLabel = (name: string): boolean => DRAW_LABELS.has(normalizeName(name));

const GENERATIONAL_SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv"]);

// "M.Kecmanovic", "JM.Cerundolo", "M-W.Lee": initials run into the surname, as
// Unibet writes them. Its scraper spaces them apart for the winners of a race or
// a tournament, but leaves a match's names as they are: "Sp.Luqueno" is a club.
const INITIALS_RUN_INTO_SURNAME = /^([A-Za-z]{1,2}(?:-[A-Za-z])?)\.(?=\S)/;

// A name's words, hyphens as spaces and initials apart, without a "Jr" at its
// end, and an initial written after the surname ("Siniakova K", Betclic's
// doubles) written before it.
function personWords(name: string): string[] {
  const words = normalizeName(name.replace(INITIALS_RUN_INTO_SURNAME, "$1. ").replace(/-/g, " "))
    .split(" ")
    .filter(Boolean);
  const named = GENERATIONAL_SUFFIXES.has(words[words.length - 1]) ? words.slice(0, -1) : words;
  return named.length >= 2 && named[named.length - 1].length === 1 ? [named[named.length - 1], ...named.slice(0, -1)] : named;
}

// The same letters in another order, two of them swapped: "lindblad" for
// "lindbald".
const isSwap = (a: string, b: string): boolean =>
  distance(a, b) === 2 && [...a].sort().join("") === [...b].sort().join("");

// One surname is the other, or starts it, or is it run together: Unibet's
// "S.Mendoza" for "Sergio Mendoza Cordova" (a second surname dropped), "C.Mbilli
// Asso" for "Christian Mbilli" (one added), "P.CarrenoBusta" for "Pablo
// Carreno-Busta" (a hyphen lost), and the letters of a surname of 6 or more
// swapped: "lindblad" for "lindbald".
function isSameSurname(surname: string[], other: string[]): boolean {
  const shared = Math.min(surname.length, other.length);
  return (
    surname.slice(0, shared).join(" ") === other.slice(0, shared).join(" ") ||
    surname.join("") === other.join("") ||
    (surname.length === 1 && other.length === 1 && surname[0].length >= 6 && isSwap(surname[0], other[0]))
  );
}

// A person one bookmaker abbreviates to his initials, the other writes out.
// Real production cases: Singapore Grand Prix, 7/10/2026, Unibet's "AK.
// Antonelli" (Andrea Kimi) is "Kimi Antonelli", "C. Sainz Jr" is "Carlos Sainz",
// "A. Lindblad" is Winamax's and Betclic's "Arvid Lindbald"; and the tennis
// matches, boxing bouts and MMA fights of 9/10/2026, each listed twice for
// Unibet's "M.Kecmanovic" against "Miomir Kecmanovic". The initials are those
// of the given names, two of them at most, and one must start one of the
// written-out name's given names ("U.Carabelli" is "Camilo Ugo Carabelli"): its
// words before the surname, which may itself be several words, so every split
// of the name is tried.
function isInitialsOfName(abbreviated: string, full: string): boolean {
  const [short, long] = [personWords(abbreviated), personWords(full)];
  if (short.length < 2 || long.length < 2 || short[0].length > 2) return false;
  // The initials end at the first longer word: "A. De Minaur" has two, "C.
  // Mbilli Asso" one.
  const firstLonger = short.findIndex((w, i) => i > 0 && w.length > 2);
  const split = firstLonger === -1 ? short.length - 1 : firstLonger;
  const initials = short.slice(0, split).join("");
  const surname = short.slice(split);
  for (let i = 1; i < long.length; i++) {
    if (long.slice(0, i).some((w) => initials.includes(w[0])) && isSameSurname(surname, long.slice(i))) return true;
  }
  return false;
}

// An American team Unibet writes as a code of its city and its nickname (real
// production cases, 9/10/2026, over the NBA, NFL, NHL, AHL and MLB): "OKC
// Thunder" is "Oklahoma City Thunder", "JAX Jaguars" "Jacksonville Jaguars",
// "VEG GKnights" "Vegas Golden Knights", "CHI Wh.Sox" "Chicago White Sox". The
// code is 2 to 4 letters starting like the city, which is all of it that is
// sure: "JAX" and "CLR" skip letters, "OKC" takes one of the second word. The
// nickname ends with the full name's last word, run together or cut short
// before it ("GKnights", "TBlazers"); or, for a one-word nickname, starts with
// its first letter and ends with its end ("TWolves" for "Timberwolves",
// "ThBirds" for "Thunderbirds"); or is that word cut at the width ("Roadrunner"
// for "Roadrunners"). Two teams of one city, or of one code, tell apart by that
// last word: of the 15 148 pairs of a code and a name of the NBA, NFL, NHL, AHL
// and MLB teams on 9/10/2026, 102 match and no code fits two names.
function isCityCodeOfName(coded: string, full: string): boolean {
  const [code, ...words] = normalizeName(coded).split(" ").filter(Boolean);
  const long = normalizeName(full.replace(/-/g, " ")).split(" ").filter(Boolean);
  if (!code || words.length === 0 || long.length < 2 || !/^[a-z]{2,4}$/.test(code)) return false;
  const nickname = words.join("");
  const last = long[long.length - 1];
  if (code[0] !== long[0][0] || last.length < 3) return false;
  return (
    nickname.endsWith(last) ||
    (nickname[0] === last[0] && commonSuffixLength(nickname, last) >= 5) ||
    (coded.trim().length >= SHORT_NAME_WIDTH - 1 && last.startsWith(nickname) && nickname.length >= 6)
  );
}

function commonSuffixLength(a: string, b: string): number {
  let length = 0;
  while (length < a.length && length < b.length && a[a.length - 1 - length] === b[b.length - 1 - length]) length++;
  return length;
}

// A surname cut short, alone: Unibet cuts the names of a doubles team to 14
// letters in all, so "Siniakov/Zhang" is "Katerina Siniakova / Shuai Zhang" and
// "Hunt/Mladenov" is "Storm Hunter / Kristina Mladenovic". Four letters at least.
function isCutSurname(cut: string, full: string): boolean {
  const [word, ...others] = personWords(cut);
  const surname = personWords(full).pop();
  return word !== undefined && others.length === 0 && word.length >= 4 && surname !== undefined && surname.startsWith(word);
}

const isSamePlayer = (a: string, b: string): boolean =>
  isSameClubName(a, b) || isInitialsOfName(a, b) || isInitialsOfName(b, a) || isCutSurname(a, b) || isCutSurname(b, a);

// How alike two doubles teams are, from 0 to 1, 0 when one isn't a doubles
// team: "K.Siniakova / S.Zhang" (Winamax, NetBet), "Siniakova K / Zhang S"
// (Betclic), "Katerina Siniakova/Shuai Zhang" (Vbet), whichever way round the
// two players are. Real production cases, 9/10/2026: each of those matches was
// listed once per spelling.
function doublesSimilarity(a: string, b: string): number {
  const [teamA, teamB] = [a, b].map((name) => name.split("/").map((player) => player.trim()));
  if (teamA.length !== 2 || teamB.length !== 2 || [...teamA, ...teamB].some((player) => player === "")) return 0;
  const score = (x: string, y: string) => (isSamePlayer(x, y) ? 1 : nameSimilarity(x, y));
  return Math.max(
    (score(teamA[0], teamB[0]) + score(teamA[1], teamB[1])) / 2,
    (score(teamA[0], teamB[1]) + score(teamA[1], teamB[0])) / 2
  );
}

function isSameCompetitor(a: string, b: string): boolean {
  return (
    isSameClubName(a, b) ||
    isInitialLastNameMatch(a, b) ||
    isInitialLastNameMatch(b, a) ||
    isInitialsOfName(a, b) ||
    isInitialsOfName(b, a) ||
    sameWords(foldedWords(a), foldedWords(b)) ||
    (isDrawLabel(a) && isDrawLabel(b)) ||
    nameSimilarity(a, b) >= NAME_SIMILARITY_THRESHOLD
  );
}

// Each of `own` competitors -> the `seed` competitor of the same name, each
// seed competitor taken at most once. Identical spellings go first, so a
// close namesake can't take a competitor's exact counterpart.
export function alignCompetitors(own: string[], seed: string[]): Map<string, string> {
  const pairs = new Map<string, string>();
  const taken = new Set<string>();
  for (const name of own) {
    if (seed.includes(name)) {
      pairs.set(name, name);
      taken.add(name);
    }
  }
  for (const name of own) {
    if (pairs.has(name)) continue;
    const match = seed.find((candidate) => !taken.has(candidate) && isSameCompetitor(name, candidate));
    if (match !== undefined) {
      pairs.set(name, match);
      taken.add(match);
    }
  }
  return pairs;
}

// The words naming an event, without its year or season ("2026", "2026/27")
// and one-letter abbreviations ("H." for men).
function titleWords(title: string): string[] {
  return coreWords(title).filter((w) => w.length > 1 && !/^\d+$/.test(w));
}

// One title's words all in the other's: "Rallye d'Italie" in "WRC - Rallye
// d'Italie 2026".
function sameEventTitle(a: string, b: string): boolean {
  const [shorter, longer] = [titleWords(a), titleWords(b)].sort((x, y) => x.length - y.length);
  const words = new Set(longer);
  return shorter.length > 0 && shorter.every((w) => words.has(w));
}

// Words a title carries around the event's name, from one bookmaker to the
// next: "Moto GP - Championnat du Monde 2026", "Championnat du Monde MotoGP
// 2026" and "Moto GP Saison 2026" are all the MotoGP championship.
const EVENT_TITLE_FILLER = new Set([
  "championnat", "championship", "ch", "saison", "competition", "monde", "du", "de", "des", "la", "le", "les",
]);

// What a title names, whichever way a bookmaker writes it: its words without
// the year and the filler above, run together ("Moto GP" is "MotoGP", "Moto 2"
// is "Moto2", "Formule 2" is "F2"). Men and women ("Hommes", "H.", "(F)") stay
// in it. Empty when nothing is left ("Championnat du Monde 2026").
function eventCore(title: string): string {
  const words = normalizeName(title.replace(/[-./]/g, " "))
    .split(" ")
    .filter((w) => w && !/^\d{4,6}$/.test(w) && !EVENT_TITLE_FILLER.has(w));
  return words.join(" ").replace(/\bformule (\d)\b/g, "f$1").replace(/ /g, "");
}

// The golf tournaments the bookmakers title and date each their own way, by
// the title's words once its year and punctuation are gone (6/10/2026): the
// Masters is "US Masters", "The Masters" or "Master d'Augusta", the PGA
// Championship "USPGA Championship" ("PGA USPGA Championship" on the
// exchange), the Open d'Espagne Winamax's "DP World Tour 2026 - Open de
// Espana" and the exchange's "DPW Tour Open de Espana 2026". Two titles of a tournament are the same event
// on any date within GOLF_SAME_TOURNAMENT_TOLERANCE_MS; two of different ones
// never are, whatever their players: the majors share most of their field.
const GOLF_TOURNAMENTS: ReadonlyArray<[key: string, title: RegExp]> = [
  ["masters", /^((us|the) )?masters( tournament)?$|^masters? d ?augusta$/],
  ["pga championship", /^(pga )?((us ?|the )?pga) championship$/],
  ["women's pga championship", /^(kpmg )?womens pga championship$/],
  ["us open", /^(pga )?(the )?us open$/],
  ["us women's open", /^(the )?us womens open$/],
  ["open championship", /^(the )?open( championship)?$/],
  ["open d'espagne", /^((dp world|dpw|pga) tour )?open (d ?espagne|de espana|de espagne|of spain)$/],
  ["ryder cup", /^(the )?ryder cup$/],
  ["solheim cup", /^(the )?solheim cup$/],
];
// A tournament dated by its first round at one bookmaker and by its last at
// another: the Masters is the 8th of April at Vbet and NetBet, the 15th at
// Betclic and Winamax; the exchange puts the 2027 PGA Championship on the 13th
// of May, 11 days before Betclic. Next year's is 12 months away.
const GOLF_SAME_TOURNAMENT_TOLERANCE_MS = 14 * 24 * 60 * 60 * 1000;

function golfTournamentKey(event: RawEvent): string | null {
  if (event.sport !== "golf") return null;
  const words = normalizeName(event.participants[0].replace(/-/g, " "))
    .replace(/\b\d{4}\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return GOLF_TOURNAMENTS.find(([, title]) => title.test(words))?.[0] ?? null;
}

// How a title writes the men's, the women's or the mixed event: "Hommes",
// "H.", "(H)", "Messieurs" / "Femmes", "F.", "(F)", "Dames" / "Mixte".
const SEX_WORDS: ReadonlyMap<string, string> = new Map([
  ...["h", "hommes", "homme", "messieurs", "men", "mens", "atp"].map((w): [string, string] => [w, "men"]),
  ...["f", "femmes", "femme", "dames", "women", "womens", "wta"].map((w): [string, string] => [w, "women"]),
  ...["mixte", "mixed"].map((w): [string, string] => [w, "mixed"]),
]);

// The sex a title names, null when it names none or several.
function sexOf(title: string): string | null {
  const sexes = new Set(
    normalizeName(title.replace(/[-./]/g, " "))
      .split(" ")
      .flatMap((w) => SEX_WORDS.get(w) ?? [])
  );
  return sexes.size === 1 ? [...sexes][0] : null;
}

// The biathlon's World Cup has a standings for each discipline beside the overall one,
// all of the same biathletes at the same date. How a title writes a discipline:
// "Sprint", "Relais" / "Relay", "Poursuite" / "Pursuit", "Individuel" / "Individual",
// "Mass Start" / "Départ groupé".
const BIATHLON_DISCIPLINES: ReadonlyArray<[key: string, words: RegExp]> = [
  ["sprint", /\bsprint\b/],
  ["relay", /\b(relais|relay)\b/],
  ["pursuit", /\b(poursuite|pursuit)\b/],
  ["individual", /\b(individuel|individual)\b/],
  ["mass start", /\b(mass start|depart groupe)\b/],
];

// The discipline a biathlon title names, "overall" when it names none: Betify's "World
// Cup Overall" is the overall standings, not the sprint's that Betclic and Vbet date the
// same (15/10/2026).
function biathlonDiscipline(title: string): string {
  const words = normalizeName(title.replace(/[-./]/g, " "));
  return BIATHLON_DISCIPLINES.find(([, pattern]) => pattern.test(words))?.[0] ?? "overall";
}

// Whether a biathlon title is a season standings (the World Cup's overall or a
// discipline's), not a race: "Classement général", "Général", "Overall", or,
// as NetBet writes them (15/10/2026), the World Cup's name and a season with no
// distance or venue: "Coupe du Monde - Sprint Hommes 2026/2027", "Coupe du Monde
// (F) 2026/2027". A race names its distance ("10 km Sprint Otepää H").
function isBiathlonStandings(title: string): boolean {
  const words = normalizeName(title.replace(/[-./]/g, " "));
  if (/\b(classement|general|overall)\b/.test(words)) return true;
  return /\b(coupe du monde|world cup)\b/.test(words) && competitionTitle(title).year !== null && !/\d\s*km\b/i.test(title);
}

// The sex of a biathlon title: the words of sexOf, else the relay's distance.
// Vbet's relays only name theirs by the legs, "4 x 7,5km" for the men's and
// "4 x 6 km" for the women's (15/10/2026).
function biathlonSexOf(title: string): string | null {
  const named = sexOf(title);
  if (named !== null) return named;
  if (/\b4\s*x\s*7[.,]5\s*km/i.test(title)) return "men";
  if (/\b4\s*x\s*6\s*km/i.test(title)) return "women";
  return null;
}

// A season standings is dated by no one the same way (15/10/2026): the first
// race at Betclic and Vbet, the relay's weekend at Betclic, the season's end
// (March) at Winamax, Unibet, PMU and NetBet, months apart. Its discipline, its
// sex, its season and its contenders tell it, not the date.
function biathlonStandingsSimilarity(a: RawEvent, b: RawEvent, timeDiff: number): number {
  const [titleA, titleB] = [a.participants[0], b.participants[0]];
  const [yearA, yearB] = [competitionTitle(titleA).year, competitionTitle(titleB).year];
  if (yearA !== null && yearB !== null && yearA !== yearB) return 0;
  if ((yearA === null || yearB === null) && timeDiff > COMPETITION_UNKNOWN_SEASON_TOLERANCE_MS) return 0;
  const competitorsA = competitorsOf(a);
  const competitorsB = competitorsOf(b);
  const shorter = Math.min(competitorsA.length, competitorsB.length);
  if (shorter === 0) return 0;
  const shared = alignCompetitors(competitorsB, competitorsA).size / shorter;
  if (shared < OUTRIGHT_MIN_SHARED_COMPETITORS) return 0;
  return NAME_SIMILARITY_THRESHOLD + (1 - NAME_SIMILARITY_THRESHOLD) * (0.8 * shared + 0.2 * nameSimilarity(titleA, titleB));
}

function outrightSimilarity(a: RawEvent, b: RawEvent, timeDiff: number): number {
  const [keyA, keyB] = [golfTournamentKey(a), golfTournamentKey(b)];
  if (keyA !== null && keyB !== null && keyA !== keyB) return 0;
  const biathlon = a.sport === "biathlon";
  if (biathlon && biathlonDiscipline(a.participants[0]) !== biathlonDiscipline(b.participants[0])) return 0;
  // The men's and the women's of a sport whose competitors are nations (the
  // biathlon relays, 7/10/2026) are the same list at the same date: only
  // their titles tell them apart.
  const sexOfTitle = biathlon ? biathlonSexOf : sexOf;
  const [sexA, sexB] = [sexOfTitle(a.participants[0]), sexOfTitle(b.participants[0])];
  if (sexA !== null && sexB !== null && sexA !== sexB) return 0;
  // A race is never a standings, nor the reverse: the same biathletes at dates
  // a few days apart.
  if (biathlon && isBiathlonStandings(a.participants[0]) !== isBiathlonStandings(b.participants[0])) return 0;
  if (biathlon && isBiathlonStandings(a.participants[0])) return biathlonStandingsSimilarity(a, b, timeDiff);
  const sameTournament = keyA !== null && keyA === keyB;
  const coreA = eventCore(a.participants[0]);
  const sameEvent = coreA !== "" && coreA === eventCore(b.participants[0]);
  const tolerance = sameTournament
    ? GOLF_SAME_TOURNAMENT_TOLERANCE_MS
    : sameEvent
      ? OUTRIGHT_SAME_EVENT_TOLERANCE_MS
      : OUTRIGHT_SAME_TITLE_TOLERANCE_MS;
  if (timeDiff > tolerance) return 0;
  if (
    timeDiff > OUTRIGHT_START_TIME_TOLERANCE_MS &&
    !sameTournament &&
    !sameEvent &&
    !sameEventTitle(a.participants[0], b.participants[0])
  ) {
    return 0;
  }
  const competitorsA = competitorsOf(a);
  const competitorsB = competitorsOf(b);
  const shorter = Math.min(competitorsA.length, competitorsB.length);
  if (shorter === 0) return 0;
  const shared = alignCompetitors(competitorsB, competitorsA).size / shorter;
  if (shared < OUTRIGHT_MIN_SHARED_COMPETITORS) return 0;
  // Above the pairing threshold, ranked by shared competitors first, then by
  // title and closeness in time: an F1 sprint and its race share every driver
  // a day apart.
  const title = nameSimilarity(a.participants[0], b.participants[0]);
  const closeness = Math.max(0, 1 - timeDiff / OUTRIGHT_START_TIME_TOLERANCE_MS);
  return NAME_SIMILARITY_THRESHOLD + (1 - NAME_SIMILARITY_THRESHOLD) * (0.6 * shared + 0.2 * title + 0.2 * closeness);
}

// The winner of a competition of a sport with head-to-heads (Ligue 1, Roland-
// Garros, the NBA): an outright like a race's, but dated by no one the same way.
// Real dates, 9/10/2026: Vbet puts "Ligue 1 2026/2027" on its next matchday (the
// 9th), Roland-Garros on its first day and Wimbledon on its last; Unibet, NetBet
// and Winamax put a season on its end. So the date tells nothing here: the
// title does (its words, its number, its season), the contenders confirm.
const isCompetitionWinner = (event: RawEvent) => isOutright(event) && COMPETITION_WINNER_SPORTS.has(event.sport);

// Words a competition's title carries for no one in particular: the ones above
// and the market's own ("Winner", "Vainqueur").
const COMPETITION_FILLER = new Set([
  ...EVENT_TITLE_FILLER,
  "outright", "winner", "vainqueur", "champion", "tournoi", "tournament", "uefa",
]);

// The English and the French of the words that differ in the titles of the same
// competitions ("UEFA Europa League" is Unibet's, "Ligue Europa" Vbet's, 9 to
// 14/10/2026).
const COMPETITION_WORDS = new Map([["league", "ligue"], ["euroleague", "euroligue"], ["cup", "coupe"]]);

// What a competition's title names: the words that tell it from another one
// ("ligue"), its numbers ("1" of Ligue 1, "2" of the Bundesliga 2), and the year
// its season starts ("2026/2027", "2026/27" and "2026" are 2026). Men and women
// are told apart by sexOf.
function competitionTitle(title: string): { words: Set<string>; numbers: Set<string>; year: number | null } {
  const tokens = normalizeName(title.replace(/[-./]/g, " ")).split(" ").filter(Boolean);
  const words = new Set<string>();
  const numbers = new Set<string>();
  let year: number | null = null;
  tokens.forEach((token, i) => {
    const next = tokens[i + 1] ?? "";
    if (/^\d{4}$/.test(token)) {
      year ??= Number(token);
    } else if (/^\d{2}$/.test(token) && /^\d{4}$/.test(tokens[i - 1] ?? "")) {
      // The second year of a season written "2026/27".
    } else if (/^\d{2}$/.test(token) && /^\d{2}$/.test(next) && Number(next) === Number(token) + 1) {
      // A season written "26/27": it starts in 2026.
      year ??= 2000 + Number(token);
    } else if (/^\d{2}$/.test(token) && /^\d{2}$/.test(tokens[i - 1] ?? "") && Number(token) === Number(tokens[i - 1]) + 1) {
      // Its second year.
    } else if (/^\d+$/.test(token)) {
      numbers.add(token);
    } else if (token.length > 1 && !COMPETITION_FILLER.has(token) && !SEX_WORDS.has(token)) {
      words.add(COMPETITION_WORDS.get(token) ?? token);
    }
  });
  return { words, numbers, year };
}

// The same competition in the same season: one title's words are all in the
// other's (a sponsor's name added: "Ligue 1" and "Ligue 1 McDonald's®"), with the
// same numbers (not Ligue 1 and Ligue 2, nor the Bundesliga and the Bundesliga 2).
// Several competitions can still share a title ("Premier League" is English, Welsh,
// Russian, Armenian...): their contenders tell them apart.
function sameCompetition(a: string, b: string): { same: boolean; exact: boolean; seasonKnown: boolean } {
  const [x, y] = [competitionTitle(a), competitionTitle(b)];
  const seasonKnown = x.year !== null && y.year !== null;
  const no = { same: false, exact: false, seasonKnown };
  if (seasonKnown && x.year !== y.year) return no;
  if (x.numbers.size !== y.numbers.size || [...x.numbers].some((n) => !y.numbers.has(n))) return no;
  const [shorter, longer] = x.words.size <= y.words.size ? [x.words, y.words] : [y.words, x.words];
  const same = shorter.size > 0 && [...shorter].every((w) => longer.has(w));
  return { same, exact: same && shorter.size === longer.size, seasonKnown };
}

// Without a season in both titles, the dates must at least be a year apart at most
// (Roland-Garros 2027 is not the 2028 one).
const COMPETITION_UNKNOWN_SEASON_TOLERANCE_MS = 366 * 24 * 60 * 60 * 1000;

function competitionSimilarity(a: RawEvent, b: RawEvent, timeDiff: number): number {
  const [titleA, titleB] = [a.participants[0], b.participants[0]];
  // Unmarked is the men's: "Ligue 1" is not "Ligue 1 (F)", nor "Open d'Australie
  // (H)" the women's.
  if ((sexOf(titleA) ?? "men") !== (sexOf(titleB) ?? "men")) return 0;
  const { same, exact, seasonKnown } = sameCompetition(titleA, titleB);
  if (!same || (!seasonKnown && timeDiff > COMPETITION_UNKNOWN_SEASON_TOLERANCE_MS)) return 0;
  const competitorsA = competitorsOf(a);
  const competitorsB = competitorsOf(b);
  const shorter = Math.min(competitorsA.length, competitorsB.length);
  if (shorter === 0) return 0;
  // A title with words more than the other's ("Ligue 1 McDonald's®" for "Ligue 1")
  // is a sponsor's name, or a part of the competition (a conference, a league of
  // two): the parts have a part of the field. More than half of it, at least.
  if (!exact && shorter * 2 <= Math.max(competitorsA.length, competitorsB.length)) return 0;
  const shared = alignCompetitors(competitorsB, competitorsA).size / shorter;
  if (shared < OUTRIGHT_MIN_SHARED_COMPETITORS) return 0;
  return NAME_SIMILARITY_THRESHOLD + (1 - NAME_SIMILARITY_THRESHOLD) * (0.8 * shared + 0.2 * nameSimilarity(titleA, titleB));
}

// Renames each competitor after the seed bookmaker's spelling, so the
// dashboard lines both bookmakers' prices up on one row. One the seed doesn't
// list keeps its own name, and its own row.
function alignOutrightOdds(odds: RawOdds[], seed: RawEvent): RawOdds[] {
  const names = alignCompetitors([...new Set(odds.map((o) => o.selection))], competitorsOf(seed));
  return odds.map((o) => ({ ...o, selection: names.get(o.selection) ?? o.selection }));
}

// 0 when the two can't be the same event, else how alike their participants are.
export function eventSimilarity(a: RawEvent, b: RawEvent): number {
  if (a.sport !== b.sport) return 0;
  const timeDiff = Math.abs(new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
  if (isOutright(a) || isOutright(b)) {
    if (!isOutright(a) || !isOutright(b)) return 0;
    return isCompetitionWinner(a) ? competitionSimilarity(a, b, timeDiff) : outrightSimilarity(a, b, timeDiff);
  }
  if (timeDiff <= START_TIME_TOLERANCE_MS) return participantsSimilarity(a.participants, b.participants);
  const tolerance = LOOSE_START_TIME_SPORTS.has(a.sport) ? LOOSE_START_TIME_TOLERANCE_MS : SHIFTED_START_TIME_TOLERANCE_MS;
  if (timeDiff > tolerance) return 0;
  const similarity = participantsSimilarity(a.participants, b.participants);
  return similarity >= LOOSE_START_TIME_MIN_SIMILARITY ? similarity : 0;
}

function canonicalId(event: RawEvent): string {
  const key = `${event.sport}:${event.startTime}:${event.participants.map(normalizeName).sort().join("-")}`;
  return createHash("sha1").update(key).digest("hex").slice(0, 16);
}

// Bookmakers spell the same outcome differently (Winamax: "Match nul", Betclic:
// "Nul"; Winamax: "Spaeri", Betclic: "FC Spaeri"). Storing raw selection strings
// verbatim means the frontend's exact-string comparison (bestOdds.ts, OddsTable.tsx)
// can never find a cross-bookmaker match for the same real outcome -- the whole
// comparison table silently degrades to showing one bookmaker's price with a dash
// next to it. This was found post-implementation by running real captured fixtures
// through the real pipeline; the spec requires aligning equivalent markets/outcomes
// across bookmakers, and this closes that gap by normalizing each outcome to "1"
// (first participant wins), "X" (draw), or "2" (second participant wins) before
// it's ever stored. The raw label is discarded -- only the canonical key is kept,
// since neither the DB schema nor the frontend currently needs the original text.
// ("n" is Unibet's own draw label in its "1 N 2" market.)
const DRAW_LABELS = new Set(["nul", "match nul", "egalite", "draw", "x", "n"]);

// A bookmaker sometimes abbreviates a participant's name to just its first
// word (e.g. Winamax: "Seattle" for the full participant name "Seattle
// Sounders") -- real production case, and well under NAME_SIMILARITY_THRESHOLD
// on a whole-string Levenshtein comparison (0.4375), so nameSimilarity alone
// can't canonicalize it.
function isWordPrefixMatch(rawSelection: string, participant: string): boolean {
  const a = normalizeName(rawSelection);
  const b = normalizeName(participant);
  if (!a || !b) return false;
  return b.startsWith(a + " ") || a.startsWith(b + " ");
}

// A bookmaker sometimes abbreviates a person's name to "Initial. Lastname"
// (e.g. Winamax tennis: "K. Quevedo" for "Kaitlin Quevedo") -- also real
// production data, also under NAME_SIMILARITY_THRESHOLD (~0.625). Only the
// last token is compared as the "lastname", a simplification that doesn't
// handle multi-word surnames (e.g. "Del Potro") specially.
function isInitialLastNameMatch(rawSelection: string, participant: string): boolean {
  const selTokens = normalizeName(rawSelection).split(" ").filter(Boolean);
  const partTokens = normalizeName(participant).split(" ").filter(Boolean);
  if (selTokens.length < 2 || partTokens.length < 2) return false;

  const selFirst = selTokens[0];
  const selLast = selTokens[selTokens.length - 1];
  const partFirst = partTokens[0];
  const partLast = partTokens[partTokens.length - 1];

  return selFirst.length === 1 && selFirst === partFirst[0] && selLast === partLast;
}

function canonicalizeSelection(rawSelection: string, ownParticipants: string[]): string {
  if (DRAW_LABELS.has(normalizeName(rawSelection))) return "X";

  if (ownParticipants.length === 2) {
    const [a, b] = ownParticipants;
    // A label spelt exactly like a participant is that participant, whatever the
    // other one's name contains: Unibet's "Sydney FC" is also a shortened form
    // of the away side's "West. Sydney".
    const label = normalizeName(rawSelection);
    if (label === normalizeName(a) && label !== normalizeName(b)) return "1";
    if (label === normalizeName(b) && label !== normalizeName(a)) return "2";
    // isSameClubName: real production case, Winamax labels outcomes with the
    // bare club name ("Kladno", "Tigers") while its participants carry the
    // prefix or the rest ("HC Kladno", "SCL Tigers").
    const structuralMatchA =
      isWordPrefixMatch(rawSelection, a) || isInitialLastNameMatch(rawSelection, a) || isSameClubName(rawSelection, a);
    const structuralMatchB =
      isWordPrefixMatch(rawSelection, b) || isInitialLastNameMatch(rawSelection, b) || isSameClubName(rawSelection, b);
    // Only trust a structural heuristic when it singles out exactly one
    // participant -- e.g. "Real" is a word-prefix of both "Real Madrid" and
    // "Real Sociedad", and picking either would be a wrong "best odds" signal,
    // worse than leaving the outcome uncanonicalized.
    if (structuralMatchA && !structuralMatchB) return "1";
    if (structuralMatchB && !structuralMatchA) return "2";

    const simFirst = nameSimilarity(rawSelection, a);
    const simSecond = nameSimilarity(rawSelection, b);
    if (simFirst >= NAME_SIMILARITY_THRESHOLD && simFirst >= simSecond) return "1";
    if (simSecond >= NAME_SIMILARITY_THRESHOLD) return "2";
  }

  // Doesn't match a participant name or a known draw label -- not a head-to-head
  // outcome this function knows how to canonicalize (e.g. a future over/under or
  // handicap market). Keep the raw label rather than guessing.
  return rawSelection;
}

// Reorders a bookmaker's OWN participant spellings so that position i lines up
// with the accumulator seed's participant at position i.
//
// Why this exists: a selection label must be resolved against the spellings used
// by the bookmaker that produced it, not against the seed bookmaker's spellings.
// Verified against the real committed fixtures: for the one match present in both,
// the seed (Betclic) spells the home side "FC Spaeri" while Winamax spells it
// "Spaeri" -- nameSimilarity is only 0.667, under NAME_SIMILARITY_THRESHOLD, so
// resolving Winamax's "Spaeri" selection against the seed's participants falls
// through to the raw label and the cross-bookmaker comparison stays broken for
// that outcome. Resolving it against Winamax's own participants scores 1.0.
//
// But "1"/"2" are defined by the CANONICAL event's participant order (which is the
// seed's -- see the returned CanonicalEvent below, and the frontend which renders
// `participants.join(" - ")`), and matchEvents deliberately merges events whose
// bookmakers list participants in opposite order. So resolving against a
// bookmaker's own list is only sound after reordering that list onto the seed's,
// which is what this does -- using the same permutation/similarity search that
// participantsSimilarity already uses to decide the two events matched at all.
export function alignParticipantsToSeed(own: string[], seed: string[]): string[] {
  if (own.length !== seed.length) return own;

  // Equal scores are common: "Sydney" is a shortened form of "Sydney FC" and of
  // "West. Sydney" alike, so both pairings of those two score 1. The one that
  // pairs more names by spelling (not by one containing the other) is the real
  // one, wherever the bookmaker lists them.
  let best = own;
  let bestScore = -1;
  let bestSpellings = -1;
  for (const order of permutations(own)) {
    const avg = seed.reduce((sum, name, i) => sum + participantNameSimilarity(name, order[i]), 0) / seed.length;
    const spellings = seed.filter((name, i) => isSameClubSpelling(name, order[i])).length;
    if (avg > bestScore + 1e-9 || (avg > bestScore - 1e-9 && spellings > bestSpellings)) {
      bestScore = Math.max(avg, bestScore);
      bestSpellings = spellings;
      best = order;
    }
  }
  return best;
}

function canonicalizeOdds(odds: RawOdds[], ownParticipants: string[], seedParticipants: string[]): RawOdds[] {
  const aligned = alignParticipantsToSeed(ownParticipants, seedParticipants);
  return odds.map((o) => ({ ...o, selection: canonicalizeSelection(o.selection, aligned) }));
}

interface Accumulator {
  seed: RawEvent;
  byBookmaker: Record<string, RawOdds[]>;
  sources: Record<string, EventSource>;
  // A competition's winner is dated by the latest of its bookmakers' dates (the
  // season's end, not the next matchday nor the season's start): it is listed
  // until then, whichever of them leaves it out.
  latestStart?: number;
}

// Where a bookmaker lists the event, for the markets cycle to ask it for the
// rest of its markets (src/scraper/marketsRun.ts).
function addSource(sources: Record<string, EventSource>, bookmakerId: string, event: RawEvent): void {
  if (event.sourceId) sources[bookmakerId] = { sourceId: event.sourceId, participants: event.participants };
}

// The bookmakers whose spelling of an event (its id, its names) is kept, in
// this order: LeoVegas.de's English names first (Kambi's, which ease the
// matching with the exchange), then Merkur Bets's and 20bet's (English too); Betclic and Winamax, whose
// real captures many tests still read, keep their order between them. The
// others seed only the events none of them lists.
const SEED_BOOKMAKERS = ["leovegas", "merkurbets", "twentybet", "betclic", "winamax"];
const seedRank = (id: string) => (SEED_BOOKMAKERS.includes(id) ? SEED_BOOKMAKERS.indexOf(id) : SEED_BOOKMAKERS.length);
// The same order, for whatever else keeps one bookmaker's spelling (the players'
// names of the markets cycle, src/scraper/marketsRun.ts).
export const bySeedOrder = (a: string, b: string): number => seedRank(a) - seedRank(b) || a.localeCompare(b);

export function matchEvents(eventsByBookmaker: Record<string, RawEvent[]>): CanonicalEvent[] {
  const accumulators: Accumulator[] = [];

  const bookmakerIds = Object.keys(eventsByBookmaker).sort(bySeedOrder);
  for (const bookmakerId of bookmakerIds) {
    const events = eventsByBookmaker[bookmakerId];

    // Pairs this bookmaker's events with those collected from the previous
    // bookmakers, best-scoring pairs first and each side at most once. Taking
    // the first match above the threshold instead, as before, could let an
    // event claim a near-namesake (a club's reserve side playing at the same
    // time) ahead of its real counterpart, and let a second event of the same
    // bookmaker overwrite the first one's odds.
    const candidates: { eventIndex: number; accumulator: Accumulator; score: number }[] = [];
    events.forEach((rawEvent, eventIndex) => {
      for (const accumulator of accumulators) {
        const score = eventSimilarity(accumulator.seed, rawEvent);
        if (score >= NAME_SIMILARITY_THRESHOLD) candidates.push({ eventIndex, accumulator, score });
      }
    });
    // Array.prototype.sort is stable, so equal scores keep input order and the
    // result stays deterministic.
    candidates.sort((x, y) => y.score - x.score);

    const pairedEvents = new Set<number>();
    for (const { eventIndex, accumulator } of candidates) {
      if (pairedEvents.has(eventIndex) || accumulator.byBookmaker[bookmakerId]) continue;
      pairedEvents.add(eventIndex);
      const rawEvent = events[eventIndex];
      accumulator.byBookmaker[bookmakerId] = isOutright(rawEvent)
        ? alignOutrightOdds(rawEvent.odds, accumulator.seed)
        : canonicalizeOdds(rawEvent.odds, rawEvent.participants, accumulator.seed.participants);
      addSource(accumulator.sources, bookmakerId, rawEvent);
      if (isCompetitionWinner(rawEvent)) {
        accumulator.latestStart = Math.max(
          accumulator.latestStart ?? Date.parse(accumulator.seed.startTime),
          Date.parse(rawEvent.startTime)
        );
      }
    }

    events.forEach((rawEvent, eventIndex) => {
      if (pairedEvents.has(eventIndex)) return;
      const sources: Record<string, EventSource> = {};
      addSource(sources, bookmakerId, rawEvent);
      accumulators.push({
        seed: rawEvent,
        byBookmaker: {
          [bookmakerId]: isOutright(rawEvent)
            ? rawEvent.odds
            : canonicalizeOdds(rawEvent.odds, rawEvent.participants, rawEvent.participants),
        },
        sources,
      });
    });
  }

  return accumulators.map((acc) => ({
    id: canonicalId(acc.seed),
    sport: acc.seed.sport,
    competition: acc.seed.competition,
    startTime: acc.latestStart === undefined ? acc.seed.startTime : new Date(acc.latestStart).toISOString(),
    participants: acc.seed.participants,
    byBookmaker: acc.byBookmaker,
    sources: acc.sources,
  }));
}
