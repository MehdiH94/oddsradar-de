// The sports whose matches have players' markets (scorers, assisters, a
// basketball match's best scorer...), which the markets menu can keep a list
// to: football's and basketball's. Tennis's every market is read too
// (src/markets/catalog.ts), but its players are the match's two.
const SPORTS_WITH_MARKETS = new Set(["football", "basketball"]);

export const hasMarkets = (sport: string) => SPORTS_WITH_MARKETS.has(sport);

// The sports the reference prices (src/reference/run.ts, tennisRun.ts, and
// sports.ts's EXCHANGE_SPORTS, which a backend test keeps in step with this
// list): their main market (a 1X2, a winner) has fair odds, so their matches
// can be sorted by value.
const SPORTS_WITH_REFERENCE = new Set([
  "football",
  "tennis",
  "basketball",
  "baseball",
  "football américain",
  "hockey sur glace",
  "rugby à xv",
  "mma",
]);

export const hasReference = (sport: string) => SPORTS_WITH_REFERENCE.has(sport);

// Not a sport: the category listing every value bet (ValueBetsTable), first
// among the sports' tabs and in their place in the URL (?sport=value-bets).
export const VALUE_BETS = "value-bets";

// How the UI names and pictures each sport. The API's sport keys are the
// lowercased Winamax names (src/scraper/canonical.ts): "hockey sur glace",
// "rugby à xv"... Displayed as-is they read like typos.

const LABELS: Record<string, string> = {
  "rugby à xv": "Rugby à XV",
  "rugby à xiii": "Rugby à XIII",
  mma: "MMA",
  [VALUE_BETS]: "Value bets",
};

const EMOJIS: Record<string, string> = {
  football: "⚽",
  tennis: "🎾",
  basketball: "🏀",
  "hockey sur glace": "🏒",
  baseball: "⚾",
  biathlon: "🎯",
  boxe: "🥊",
  cyclisme: "🚴",
  "football américain": "🏈",
  "football australien": "🏉",
  "formule 1": "🏎️",
  handball: "🤾",
  golf: "⛳",
  "rugby à xv": "🏉",
  "rugby à xiii": "🏉",
  snooker: "🎱",
  "volley-ball": "🏐",
  "ski alpin": "⛷️",
  "ski de fond": "🎿",
  "saut à ski": "🎿",
  moto: "🏍️",
  mma: "🥋",
  automobile: "🏁",
  badminton: "🏸",
  "tennis de table": "🏓",
  judo: "🥋",
  [VALUE_BETS]: "💎",
};

export function sportLabel(sport: string): string {
  return LABELS[sport] ?? sport.charAt(0).toUpperCase() + sport.slice(1);
}

// A sport the table above doesn't know yet (a new one scraped tomorrow) still
// gets an icon.
export function sportEmoji(sport: string): string {
  return EMOJIS[sport] ?? "🏅";
}
