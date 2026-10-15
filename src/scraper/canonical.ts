// Cross-bookmaker vocabulary. Each bookmaker's API names markets and sports in
// its own words (Winamax: market "Résultat", sport "Football"; Betclic: market
// "Résultat du match (t. rég)", sport slug "football"). Everything downstream
// compares these strings exactly -- src/matcher/match.ts's sameEvent requires
// `sport === sport`, and the frontend (web/src/bestOdds.ts, OddsTable.tsx)
// requires `market === market` -- so every scraper must map its raw values
// onto the shared keys below before an event leaves it. Emitting either API's
// raw text verbatim silently breaks cross-bookmaker comparison: one side's
// price renders, the other shows "-".

// --- markets -----------------------------------------------------------------
//
// Derived from the market's outcome count rather than from either API's market
// title, exactly as the pre-migration DOM scrapers' shared deriveMarketName()
// did (their listing pages carried no market text at all). Keeping "1X2" as
// the 3-way key also means rows written by those older scrapers share the
// same UNIQUE(event_id, bookmaker_id, market, selection) key and get
// overwritten in place by fresh API data rather than lingering beside it.
//
// Verified against real captures: Winamax's main bet is a 3-way "Résultat"
// for football and ice hockey, and a 2-way "Vainqueur" for tennis and
// volleyball; Betclic's main market in the committed football capture is
// 3-way for all 40 matches.
export const MARKET_1X2 = "1X2";
// Winamax's pre-migration label for a 2-way main market (Betclic's old DOM
// scraper used "Double Chance", which is a different real-world market).
export const MARKET_MATCH_WINNER = "Vainqueur du match";

// The main bet of a sport without head-to-heads -- a race, a ski event, a golf
// tournament: which of N competitors wins. One selection per competitor, and
// the event's only "participant" is its title (see validateRawEvent).
export const MARKET_OUTRIGHT = "Vainqueur";

// The sports whose main bet is a winner among N rather than a head-to-head, by
// canonical key. Only theirs are kept: the tournament-winner markets of the
// other sports (who wins Ligue 1, Roland-Garros...) stay out.
export const OUTRIGHT_SPORTS: ReadonlySet<string> = new Set([
  "cyclisme",
  "formule 1",
  "golf",
  "ski alpin",
  "ski de fond",
  "saut à ski",
  "biathlon",
  "moto",
  "judo",
  // Betclic splits it per series (see ./betclic.ts).
  "automobile",
]);

// The sports with head-to-heads, whose competition's winner (who wins Ligue 1,
// Roland-Garros, the NBA...) is read too, as an outright of its own: one
// participant, its title, and one selection per contender. Not their main bet,
// which stays the match's result: these events are kept apart from the matches
// (src/db/competition.ts) and only compared, bookmaker against bookmaker.
export const COMPETITION_WINNER_SPORTS: ReadonlySet<string> = new Set([
  "football",
  "tennis",
  "basketball",
  "hockey sur glace",
  "baseball",
  "football américain",
  "football australien",
  "rugby à xv",
  "rugby à xiii",
  "handball",
  "volley-ball",
  "mma",
  "boxe",
  "snooker",
  "badminton",
  "tennis de table",
]);

// Whether a sport has events with one participant and a winner among N: the
// main bet of a race, or a competition's winner.
export const hasOutrights = (sport: string): boolean => OUTRIGHT_SPORTS.has(sport) || COMPETITION_WINNER_SPORTS.has(sport);

// The titles of the other bets on a competition, which are not its winner: the
// top scorer, the Top 4, the relegated, a division's or a conference's winner
// ("NBA 2026/2027. Vainqueur de la division"), a group's, the regular season's,
// the field without its favourite, a bookmaker's "Marchés supplémentaires"
// (real titles, Vbet and Betsson, 9 to 14/10/2026). Not the leagues that carry
// the word in their name ("Primera Division", "First Division", "UEFA Conference
// League"), nor the French rugby's "TOP 14" for a Top 4. A part of a competition
// has the contenders of a part of the field ("NBA Cup 2026 - Conférence Ouest",
// "MLB - American League", "NFL - Conférence AFC"), which the matcher would
// pair with the whole one's: the parts are named here. Matched on the title
// without its accents.
const NOT_A_COMPETITION_WINNER =
  /\b(?:top\s*(?!14\b)\d+|buteur|scorer|meilleur|best\b|mvp\b|rookie|assist|passeur|relegat|relegu|descente|promot|promu|montee|de la division|division winner|de la conference|conference winner|(?:eastern|western|east|west|est|ouest)\b.{0,15}conference|conference\b.{0,15}\b(?:eastern|western|east|west|est|ouest|afc|nfc)\b|\b(?:afc|nfc)\b|american league|national league|atlantique|atlantic division|pacifique|pacific division|groupe?s?\b|poule\b|without|sans\b|special|supplementaire|additional|extras?\b|regular season|saison reguliere|wooden spoon|points\b|wins\b|victoires\b|buts\b|goals\b|total\b|exact|position|classement|ranking|finish|rank\b|reach|atteindre|finalist|finaliste|semi|demi|quarter|quart|round\b)/;

// Whether the title of an event with one participant, in a sport with
// head-to-heads, names a competition's winner market and not another bet on it.
export function isCompetitionWinnerTitle(title: string): boolean {
  const plain = title.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  return !NOT_A_COMPETITION_WINNER.test(plain);
}

// Whether a head-to-head's main market, by the bookmaker's own title, is the
// match's result or winner: "Résultat", "Vainqueur", "Résultat du match (tps
// rég.)", "Vainqueur du combat"... The market key above comes from its
// outcome count alone, so anything else a bookmaker puts first must be left
// out: Winamax did on lopsided matches (4/10/2026) with "Écart de points
// (handicap)" ("Montpellier -28.5" / "RC Toulon +28.5") and "Nombre de buts"
// ("Plus de 4,5" / "Moins de 4,5"), whose 2 outcomes would read as a winner's,
// the handicap's even as the teams'. A winner refunded on a draw ("Vainqueur
// (remboursé si match nul)") is not the winner either: its draw is no loss.
export function isResultMarketTitle(title: string): boolean {
  return /^\s*(r[ée]sultat|vainqueur)(?![a-z])/i.test(title) && !/rembours|handicap|[ée]cart/i.test(title);
}

export function canonicalMarketName(outcomeCount: number): string {
  if (outcomeCount === 3) return MARKET_1X2;
  if (outcomeCount === 2) return MARKET_MATCH_WINNER;
  // Not a head-to-head main market this project knows how to compare (a
  // many-runner outright, say). Label it by shape so it can never collide
  // with -- and be mis-compared against -- a real 1X2 or match-winner market.
  return `Marché à ${outcomeCount} issue${outcomeCount > 1 ? "s" : ""}`;
}

// --- sports ------------------------------------------------------------------

export type BookmakerId =
  | "winamax"
  | "betclic"
  | "vbet"
  | "circusbet"
  | "daznbet"
  | "netbet"
  | "genybet"
  | "unibet"
  | "betsson"
  | "pmu"
  | "betify";

// The canonical key is the lowercased Winamax display name: the dashboard is in
// French and renders the sport string as-is (section headings, the sport
// <select>), and it is what Winamax already emitted before this mapping
// existed, so its stored values are unchanged.
//
// Only pairs verified on real data are listed. Winamax names: the real sport
// catalog embedded in a live Winamax capture (committed as
// tests/scraper/fixtures/winamax-sports-catalog.json). Betclic slugs:
// BETCLIC_SPORT_SLUGS in ./betclic.ts -- every one has a Winamax counterpart
// below. Betclic splits Winamax's "Automobile" per series, hence a list.
// Vbet's sport aliases: its live sports list (5/10/2026), for the head-to-head
// sports it is read for (./vbet.ts). SportNCo's sport pages, NetBet's
// (its live sports list, 5/10/2026, ./sportnco.ts). Unibet's names, from a full
// capture of its upcoming-matches feed (./unibet.ts) and its sports menu
// (7/10/2026), are matched case-insensitively. A name that is the canonical
// key itself ("Football", "Tennis"...) works unlisted, with a warning; the ones
// listed are those that differ from it ("Foot américain", "Volley Ball",
// "UFC/MMA", "Rugby") and the sports without head-to-heads it is read for.
// Betsson's names are those of its sports menu (boNavigationList 1355/top,
// 8/10/2026), the way ./betsson.ts asks for a sport: its events call a few of
// them otherwise ("American Football" for "Foot US", "MotoGp" for "Moto"). Of
// the sports without head-to-heads, only those of its menu with a code of their
// own are listed: golf and cycling had no event on 8/10/2026, and the skiing and
// biathlon nodes were empty (code "0"), so the ones read are Formula 1 and
// MotoGP's, the others waiting for their season.
// Betify's names are those of the sports its prematch feed lists (Betby's,
// 14/10/2026, ./betby.ts), in French, a few of them in
// lower case ("tennis", "badminton", "baseball"): the lookup ignores the case.
// PMU's names are those of its sports list (group.json of the offering API its
// sports site reads, 11/10/2026, ./pmu.ts), French display names that mostly
// are the canonical key; "Ski Alpin" and "Biathlon" are not in that list but
// under its "Sports d'hiver", and are the names of the events' own path.
const VERIFIED_SPORTS: ReadonlyArray<{
  canonical: string;
  winamax: string;
  betclic: string | string[];
  vbet?: string | string[];
  sportnco?: string;
  unibet?: string | string[];
  betsson?: string | string[];
  pmu?: string | string[];
  betify?: string | string[];
}> = [
  {
    canonical: "football",
    winamax: "Football",
    betclic: "football",
    vbet: "Soccer",
    sportnco: "/football",
    betsson: "Football",
    pmu: "Football",
    betify: "Football",
  },
  {
    canonical: "tennis",
    winamax: "Tennis",
    betclic: "tennis",
    vbet: "Tennis",
    sportnco: "/tennis",
    betsson: "Tennis",
    pmu: "Tennis",
    betify: "tennis",
  },
  {
    canonical: "basketball",
    winamax: "Basketball",
    betclic: "basketball",
    vbet: "Basketball",
    sportnco: "/basketball",
    unibet: "Basketball",
    betsson: "Basketball",
    pmu: "Basketball",
    betify: "Basketball",
  },
  {
    canonical: "hockey sur glace",
    winamax: "Hockey sur glace",
    betclic: "ice_hockey",
    vbet: "IceHockey",
    sportnco: "/hockey-glace",
    betsson: "Hockey sur glace",
    pmu: "Hockey sur glace",
    betify: "Hockey sur glace",
  },
  {
    canonical: "baseball",
    winamax: "Baseball",
    betclic: "baseball",
    vbet: "Baseball",
    sportnco: "/baseball",
    betsson: "Baseball",
    pmu: "Baseball",
    betify: "baseball",
  },
  {
    canonical: "biathlon",
    winamax: "Biathlon",
    betclic: "biathlon",
    vbet: "Biathlon",
    sportnco: "/biathlon",
    unibet: "Biathlon",
    pmu: "Biathlon",
    betify: "Biathlon",
  },
  {
    canonical: "boxe",
    winamax: "Boxe",
    betclic: "boxing",
    vbet: "Boxing",
    sportnco: "/boxe",
    betsson: "Boxe",
    pmu: "Boxe",
    betify: "Boxe",
  },
  {
    canonical: "cyclisme",
    winamax: "Cyclisme",
    betclic: "cycling",
    vbet: "Cycling",
    sportnco: "/cyclisme",
    unibet: "Cyclisme",
    betsson: "Cyclisme",
    pmu: "Cyclisme",
    betify: "Cyclisme",
  },
  {
    canonical: "football américain",
    winamax: "Football américain",
    betclic: "american_football",
    vbet: "AmericanFootball",
    sportnco: "/foot-us",
    unibet: "Foot américain",
    betsson: "Foot US",
    pmu: "Football américain",
    betify: "Football américain",
  },
  {
    canonical: "football australien",
    winamax: "Football australien",
    betclic: "australian_rules",
    betsson: "Football Australien",
    pmu: "Football australien",
    betify: "Football Australien",
  },
  {
    canonical: "formule 1",
    winamax: "Formule 1",
    betclic: "formula_1",
    // NetBet's Formula 1 is a section of its /sport-automobile page, not a page.
    sportnco: "/formule-1",
    unibet: "Formule 1",
    betsson: "Formule 1",
    pmu: "Formule 1",
    betify: "Formule 1",
  },
  {
    canonical: "handball",
    winamax: "Handball",
    betclic: "handball",
    vbet: "Handball",
    sportnco: "/handball",
    betsson: "Handball",
    pmu: "Handball",
    betify: "Handball",
  },
  {
    canonical: "golf",
    winamax: "Golf",
    betclic: "golf",
    vbet: "Golf",
    sportnco: "/golf",
    unibet: "Golf",
    betsson: "Golf",
    pmu: "Golf",
    betify: "Golf",
  },
  {
    canonical: "rugby à xv",
    winamax: "Rugby à XV",
    betclic: "rugby_union",
    vbet: "RugbyUnion",
    sportnco: "/rugby",
    unibet: "Rugby",
    betsson: "Rugby à XV",
    pmu: "Rugby à XV",
    betify: "Rugby à XV",
  },
  {
    canonical: "rugby à xiii",
    winamax: "Rugby à XIII",
    betclic: "rugby_league",
    vbet: "RugbyLeague",
    sportnco: "/rugby-a-xiii",
    betsson: "Rugby à XIII",
    pmu: "Rugby à XIII",
    betify: "Rugby à 13",
  },
  {
    canonical: "snooker",
    winamax: "Snooker",
    betclic: "snooker",
    vbet: "Snooker",
    sportnco: "/snooker",
    betsson: "Snooker",
    pmu: "Snooker",
    betify: "Snooker",
  },
  {
    canonical: "volley-ball",
    winamax: "Volley-ball",
    betclic: "volleyball",
    vbet: "Volleyball",
    sportnco: "/volleyball",
    unibet: "Volley Ball",
    betsson: "Volley-ball",
    pmu: "Volley-ball",
    betify: "Volley-ball",
  },
  {
    canonical: "ski alpin",
    winamax: "Ski alpin",
    betclic: "alpine_skiing",
    sportnco: "/ski-alpin",
    unibet: "Ski Alpin",
    pmu: "Ski Alpin",
    betify: "Ski alpin",
  },
  {
    canonical: "ski de fond",
    winamax: "Ski de fond",
    betclic: "cross_country_skiing",
    unibet: "Ski de Fond",
    betify: "Cross-country",
  },
  { canonical: "saut à ski", winamax: "Saut à ski", betclic: "ski_jumping", betify: "Saut à ski" },
  {
    canonical: "moto",
    winamax: "Moto",
    betclic: "motorcycling",
    sportnco: "/moto",
    unibet: "Moto",
    betsson: "Moto",
    betify: "course de motos",
  },
  {
    canonical: "mma",
    winamax: "MMA",
    betclic: "martial_arts",
    vbet: "Mma",
    sportnco: "/mma",
    unibet: "UFC/MMA",
    betsson: "MMA",
    pmu: "UFC/MMA",
    betify: "Arts martiaux mixtes",
  },
  {
    canonical: "automobile",
    winamax: "Automobile",
    betclic: ["rally", "nascar", "formula_2"],
    vbet: ["Nascar", "AutoRacing"],
    // NetBet's page of the F1, the F2 and Nascar alike.
    sportnco: "/sport-automobile",
    unibet: ["Nascar", "Formule 2"],
    betify: ["Nascar", "Formule 2", "course de voitures de tourisme"],
  },
  // Badminton and table tennis: Winamax's ids 31 and 20, which its catalog
  // fixture predates (8/10/2026); doubles are listed with the singles.
  {
    canonical: "badminton",
    winamax: "Badminton",
    betclic: "badminton",
    vbet: "Badminton",
    sportnco: "/badminton",
    unibet: "Badminton",
    betsson: "Badminton",
    betify: "badminton",
  },
  {
    canonical: "tennis de table",
    winamax: "Tennis de table",
    betclic: "table_tennis",
    vbet: "TableTennis",
    sportnco: "/tennis-de-table",
    unibet: "Tennis de Table",
    betsson: "Tennis de table",
    betify: "Tennis de table",
  },
  // Judo has no head-to-head here: only its championships' winners.
  { canonical: "judo", winamax: "Judo", betclic: "judo", unibet: "Judo" },
];

// The sports only Betify's feed lists of those it reads, under the lower case of
// its own French name, which is what the other bookmakers' unlisted sports get
// (canonicalSport): chess, padel, darts, floorball, cricket... The e-sports and
// the virtual sports are not sports this compares.
const BETIFY_ONLY_SPORTS: readonly string[] = [
  "Echecs",
  "Tennis de padel",
  "Fléchettes",
  "Floorball",
  "cricket",
  "Basket-ball à trois",
  "squash",
  "water-polo",
  "futsal",
  "Natation",
  "sumo",
  "Kabaddi",
];

function lookupKey(raw: string): string {
  return raw.trim().toLowerCase();
}

const canonicalByName = (names: (s: (typeof VERIFIED_SPORTS)[number]) => string | string[] | undefined) =>
  new Map(
    VERIFIED_SPORTS.flatMap((s) => [names(s) ?? []].flat().map((name): [string, string] => [lookupKey(name), s.canonical]))
  );

const CANONICAL_BY_BOOKMAKER: Record<BookmakerId, Map<string, string>> = {
  winamax: canonicalByName((s) => s.winamax),
  betclic: canonicalByName((s) => s.betclic),
  vbet: canonicalByName((s) => s.vbet),
  // CircusBet and DAZN Bet are on Vbet's Swarm server: the same sport aliases.
  circusbet: canonicalByName((s) => s.vbet),
  daznbet: canonicalByName((s) => s.vbet),
  netbet: canonicalByName((s) => s.sportnco),
  // Genybet is on NetBet's platform: the same pages.
  genybet: canonicalByName((s) => s.sportnco),
  unibet: canonicalByName((s) => s.unibet),
  betsson: canonicalByName((s) => s.betsson),
  pmu: canonicalByName((s) => s.pmu),
  betify: new Map([
    ...canonicalByName((s) => s.betify),
    ...BETIFY_ONLY_SPORTS.map((name): [string, string] => [lookupKey(name), lookupKey(name)]),
  ]),
};

// The sports a bookmaker is read for, by its own names (./vbet.ts,
// ./sportnco.ts, ./betsson.ts, ./pmu.ts, ./betby.ts).
export function verifiedSportNames(bookmaker: "vbet" | "sportnco" | "betsson" | "pmu" | "betify"): string[] {
  const names = VERIFIED_SPORTS.flatMap((s) => s[bookmaker] ?? []);
  return bookmaker === "betify" ? [...names, ...BETIFY_ONLY_SPORTS] : names;
}

const warnedUnmappedSports = new Set<string>();

export function canonicalSport(bookmaker: BookmakerId, raw: string): string {
  const key = lookupKey(raw);
  const canonical = CANONICAL_BY_BOOKMAKER[bookmaker].get(key);
  if (canonical !== undefined) return canonical;

  // Unmapped: keep this bookmaker's own value rather than dropping its events.
  // They still display and store fine; they just cannot cross-match another
  // bookmaker until a verified pair is added above. Warn once per value per
  // process -- the worker re-fetches every POLL_INTERVAL_MINUTES, and
  // repeating the same line adds nothing.
  const warnKey = `${bookmaker}:${key}`;
  if (!warnedUnmappedSports.has(warnKey)) {
    warnedUnmappedSports.add(warnKey);
    console.warn(
      `[scraper:${bookmaker}] no cross-bookmaker mapping for sport "${raw}", storing it as "${key}" ` +
        `(it will not match other bookmakers' events until added to src/scraper/canonical.ts)`
    );
  }
  return key;
}
