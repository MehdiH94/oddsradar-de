import { ALL_BOOKMAKER_IDS } from "../alerts/gems";
import { FreebetMarket } from "../db/freebets";
import { mainOutcomeLabel } from "../db/marketGrid";
import { EXCHANGE_COMMISSION } from "../db/surebets";
import { BookmakerId } from "../scraper/canonical";
import { ExchangeItem, ExchangeResult } from "./engine/exchange";
import { Match, Plan } from "./engine/types";
import { ComputePool } from "./pool";
import { Wallet } from "./wallet";

// The Freebets page's calculations, around the engine (src/freebets/engine/):
// what to ask it for a wallet and the matches on offer, and what to tell the
// page of its answer. The engine knows a bookmaker by its place in
// ALL_BOOKMAKER_IDS, and a match by its id.

export type ConversionRequest =
  // The three best ways to convert the whole wallet between bookmakers, with bets (1) or combos of 2 or 3 matches.
  | { mode: "bookmakers"; legs: 1 | 2 | 3; sports?: string[] }
  // One bookmaker's freebets against the exchange.
  | { mode: "exchange"; bookmaker: BookmakerId; sports?: string[] };

const MAX_SPORTS = 30;
const MAX_SPORT_LENGTH = 40;

// A request from a query string, or the French message for the client that sent
// a wrong one. `sports` is a comma-separated list: absent, every sport; present
// and empty, none.
export function parseRequest(query: Record<string, unknown>): ConversionRequest | { error: string } {
  const sports = parseSports(query.sports);
  if (sports === null) return { error: "Invalid list of sports." };
  const withSports = sports === undefined ? {} : { sports };
  if (query.mode === "bookmakers") {
    const legs = query.legs === undefined ? 1 : Number(query.legs);
    if (legs !== 1 && legs !== 2 && legs !== 3) return { error: "An accumulator has 1, 2 or 3 matches." };
    return { mode: "bookmakers", legs, ...withSports };
  }
  if (query.mode === "exchange") {
    const bookmaker = ALL_BOOKMAKER_IDS.find((id) => id === query.bookmaker);
    if (!bookmaker) return { error: "Unknown bookmaker." };
    return { mode: "exchange", bookmaker, ...withSports };
  }
  return { error: "Unknown conversion mode." };
}

function parseSports(value: unknown): string[] | undefined | null {
  if (value === undefined) return undefined;
  if (typeof value !== "string") return null;
  const sports = [...new Set(value.split(",").filter(Boolean))].sort();
  if (sports.length > MAX_SPORTS || sports.some((sport) => sport.length > MAX_SPORT_LENGTH)) return null;
  return sports;
}

// --- what is asked of the engine ---------------------------------------------------------------------------

const indexOf = (bookmaker: BookmakerId) => ALL_BOOKMAKER_IDS.indexOf(bookmaker);

// The FB of each bookmaker, by index: 0 where the account holds none.
export function freebetsByIndex(wallet: Wallet): number[] {
  return ALL_BOOKMAKER_IDS.map((id) => wallet[id] ?? 0);
}

// The bookmakers where the account holds freebets, in the site's order.
export function holdingBookmakers(wallet: Wallet): BookmakerId[] {
  return ALL_BOOKMAKER_IDS.filter((id) => (wallet[id] ?? 0) > 0);
}

// The matches that two of the bookmakers holding freebets price, as the engine takes them.
export function engineMatches(markets: readonly FreebetMarket[], fb: readonly number[]): Match[] {
  const matches: Match[] = [];
  for (const market of markets) {
    const odds = ALL_BOOKMAKER_IDS.map((id, b) => (fb[b] > 0 ? (market.prices[id] ?? null) : null));
    if (odds.filter((prices) => prices !== null).length < 2) continue;
    matches.push({ id: market.eventId, outcomes: market.outcomes.length as 2 | 3, odds });
  }
  return matches;
}

// The outcomes the bookmaker can convert against the exchange: each with its
// price there and the lay price and money on the exchange.
export function exchangeItems(markets: readonly FreebetMarket[], bookmaker: BookmakerId): ExchangeItem[] {
  const items: ExchangeItem[] = [];
  for (const market of markets) {
    const prices = market.prices[bookmaker];
    if (!prices) continue;
    market.outcomes.forEach((outcome, i) => {
      const lay = market.exchange[outcome];
      if (lay) items.push({ id: `${market.eventId}|${outcome}`, matchId: market.eventId, back: prices[i], lay: lay.lay, laySize: lay.laySize });
    });
  }
  return items;
}

// The sports the page offers for a mode: those with a match it could use,
// whatever sports are ticked.
export function eligibleSports(markets: readonly FreebetMarket[], request: ConversionRequest, holding: readonly BookmakerId[]): string[] {
  const sports = new Set<string>();
  for (const market of markets) {
    if (request.mode === "exchange") {
      if (market.prices[request.bookmaker] && Object.keys(market.exchange).length > 0) sports.add(market.sport);
    } else {
      // An account with no freebets yet still sees which sports can be converted.
      const among = holding.length > 0 ? holding : ALL_BOOKMAKER_IDS;
      if (among.filter((id) => market.prices[id]).length >= 2) sports.add(market.sport);
    }
  }
  return [...sports].sort();
}

// --- what is told to the page ----------------------------------------------------------------------------

const cents = (value: number) => Math.round(value * 100) / 100;

export interface OutcomeView {
  key: string;
  label: string;
}

export interface MatchView {
  eventId: string;
  sport: string;
  competition: string;
  startTime: string;
  participants: string[];
  market: string;
  outcomes: OutcomeView[];
  // The prices of the bookmakers holding freebets, in the order of `outcomes`.
  prices: Partial<Record<BookmakerId, number[]>>;
}

export interface BetView {
  // The outcome taken in each match of the combo.
  outcomes: string[];
  label: string;
  // The combined price, the stake in FB, and the gain if it comes out (the stake is not returned).
  odds: number;
  stake: number;
  gain: number;
}

export interface PlanView {
  rank: number;
  // The cash guaranteed, whatever happens, and the freebets it takes (all in euros / FB); `rate` is their ratio.
  cash: number;
  used: number;
  rate: number;
  // The freebets of the whole wallet that this plan does not use.
  left: number;
  // False when the search was cut short: a better plan may exist.
  exact: boolean;
  // The oldest price the bets rest on.
  oddsAt: string;
  matches: MatchView[];
  bookmakers: Array<{ bookmaker: BookmakerId; fb: number; used: number; bets: BetView[] }>;
}

const outcomeViews = (market: FreebetMarket): OutcomeView[] =>
  market.outcomes.map((key) => ({ key, label: mainOutcomeLabel(key, market.participants) }));

function matchView(market: FreebetMarket, holding: readonly BookmakerId[]): MatchView {
  const prices: MatchView["prices"] = {};
  for (const id of holding) if (market.prices[id]) prices[id] = market.prices[id];
  return {
    eventId: market.eventId,
    sport: market.sport,
    competition: market.competition,
    startTime: market.startTime,
    participants: market.participants,
    market: market.market,
    outcomes: outcomeViews(market),
    prices,
  };
}

export function planViews(plans: readonly Plan[], markets: ReadonlyMap<string, FreebetMarket>, wallet: Wallet): PlanView[] {
  const holding = holdingBookmakers(wallet);
  const total = holding.reduce((sum, id) => sum + wallet[id]!, 0);
  return plans.map((plan, i) => {
    // The plan's matches, in the order its bets name their outcomes.
    const inPlan = plan.matchIds.map((id) => markets.get(id)!);
    const labels = inPlan.map(outcomeViews);
    const bookmakers = holding
      .map((bookmaker) => {
        const b = indexOf(bookmaker);
        const bets: BetView[] = plan.bets
          .filter((bet) => bet.b === b)
          .map((bet) => {
            const names = bet.cell.map((k, m) => labels[m][k].label);
            return { outcomes: names, label: names.join(" + "), odds: bet.odds, stake: bet.stake, gain: cents(bet.stake * (bet.odds - 1)) };
          });
        return { bookmaker, fb: wallet[bookmaker]!, used: cents(bets.reduce((sum, bet) => sum + bet.stake, 0)), bets };
      })
      .filter((entry) => entry.bets.length > 0);
    // The oldest price any of the bets rests on.
    const readAt = plan.bets.flatMap((bet) => inPlan.map((market) => market.scrapedAt[ALL_BOOKMAKER_IDS[bet.b]]).filter((at): at is string => at !== undefined)).sort();
    return {
      rank: i + 1,
      cash: cents(plan.cash),
      used: cents(plan.used),
      rate: Math.round(plan.rate * 10_000) / 10_000,
      left: cents(total - plan.used),
      exact: plan.exact,
      oddsAt: readAt[0] ?? "",
      matches: inPlan.map((market) => matchView(market, holding)),
      bookmakers,
    };
  });
}

export interface StepView {
  rank: number;
  eventId: string;
  sport: string;
  competition: string;
  startTime: string;
  participants: string[];
  market: string;
  selection: string;
  label: string;
  // The bookmaker's price on it (the bet in freebets) and the exchange's lay price with the money offered at it.
  back: number;
  lay: number;
  laySize: number;
  // The freebets converted here, the stake to lay (in euros), the cash left whatever happens, its ratio to the
  // freebets, and what the lay puts up on the exchange (given back after the match).
  fb: number;
  layStake: number;
  cash: number;
  rate: number;
  liability: number;
  // What is left if the outcome comes out, and if it does not (the same, to the cent).
  ifWins: { gain: number; pays: number; net: number };
  ifLoses: { net: number };
  // The exchange's money stopped it: freebets are left for the next step.
  limited: boolean;
  oddsAt: string;
}

export interface ChainView {
  converted: number;
  leftover: number;
  cash: number;
  liability: number;
  steps: StepView[];
}

// The chain of steps as the page shows it, on whole cents: the freebets and the lay
// of each step are rounded as they will be placed, and the cash is what is left in
// the worse case once they are.
export function chainView(result: ExchangeResult, items: ReadonlyMap<string, ExchangeItem>, markets: ReadonlyMap<string, FreebetMarket>, bookmaker: BookmakerId, fb: number): ChainView {
  const k = EXCHANGE_COMMISSION;
  // Whole cents of freebets that sum to what was converted, never above the wallet.
  const wanted = Math.min(Math.round(result.converted * 100), Math.floor(fb * 100 + 1e-6));
  const stepCents = result.steps.map((step) => Math.round(step.fb * 100));
  const drift = wanted - stepCents.reduce((sum, c) => sum + c, 0);
  if (stepCents.length > 0) stepCents[stepCents.length - 1] += drift;

  const steps = result.steps.map((step, i): StepView => {
    const item = items.get(step.id)!;
    const market = markets.get(step.matchId)!;
    const outcome = item.id.slice(item.id.indexOf("|") + 1);
    const converted = stepCents[i] / 100;
    const layStake = Math.min(cents((converted * (item.back - 1)) / (item.lay - k)), Math.floor(item.laySize * 100) / 100);
    const liability = cents(layStake * (item.lay - 1));
    const gain = cents(converted * (item.back - 1));
    const wins = cents(gain - liability);
    const loses = cents(layStake * (1 - k));
    const cash = Math.floor(Math.min(wins, loses) * 100 + 1e-6) / 100;
    return {
      rank: i + 1,
      eventId: market.eventId,
      sport: market.sport,
      competition: market.competition,
      startTime: market.startTime,
      participants: market.participants,
      market: market.market,
      selection: outcome,
      label: mainOutcomeLabel(outcome, market.participants),
      back: item.back,
      lay: item.lay,
      laySize: item.laySize,
      fb: converted,
      layStake,
      cash,
      rate: converted > 0 ? Math.round((cash / converted) * 10_000) / 10_000 : 0,
      liability,
      ifWins: { gain, pays: liability, net: wins },
      ifLoses: { net: loses },
      limited: step.limited,
      oddsAt: market.scrapedAt[bookmaker] ?? market.startTime,
    };
  });
  const converted = cents(steps.reduce((sum, step) => sum + step.fb, 0));
  return {
    converted,
    leftover: cents(fb - converted),
    cash: cents(steps.reduce((sum, step) => sum + step.cash, 0)),
    liability: cents(steps.reduce((sum, step) => sum + step.liability, 0)),
    steps,
  };
}

// --- the answers ---------------------------------------------------------------------------------------------

export interface BookmakersAnswer {
  mode: "bookmakers";
  legs: 1 | 2 | 3;
  // The bookmakers where the account holds freebets, and the total.
  bookmakers: BookmakerId[];
  total: number;
  eligibleSports: string[];
  // Up to three, best cash first, with no match in common. Empty with a reason.
  plans: PlanView[];
  reason: "empty_wallet" | "single_bookmaker" | "no_match" | "no_plan" | null;
  // The search ran out of time: a better plan may exist.
  partial: boolean;
  computedAt: string;
}

export interface ExchangeAnswer {
  mode: "exchange";
  bookmaker: BookmakerId;
  // The freebets held there.
  fb: number;
  // The exchange's commission on a win (0.03: 3 %), which the page says.
  commission: number;
  eligibleSports: string[];
  chain: ChainView | null;
  reason: "no_freebets" | "no_match" | "no_plan" | null;
  computedAt: string;
}

export type ConversionAnswer = BookmakersAnswer | ExchangeAnswer;

export interface ConversionsService {
  compute(wallet: Wallet, request: ConversionRequest): Promise<ConversionAnswer>;
}

export interface ConversionsServiceOptions {
  // The matches on offer: read from the database, and kept by the caller as long as it likes.
  markets: () => FreebetMarket[];
  pool: ComputePool;
  now?: () => Date;
}

export function createConversionsService({ markets: loadMarkets, pool, now = () => new Date() }: ConversionsServiceOptions): ConversionsService {
  return {
    async compute(wallet, request) {
      const all = loadMarkets();
      const holding = holdingBookmakers(wallet);
      const eligible = eligibleSports(all, request, holding);
      const ticked = request.sports === undefined ? all : all.filter((market) => request.sports!.includes(market.sport));

      if (request.mode === "bookmakers") {
        const total = cents(holding.reduce((sum, id) => sum + wallet[id]!, 0));
        const answer = { mode: "bookmakers" as const, legs: request.legs, bookmakers: holding, total, eligibleSports: eligible, plans: [], partial: false, computedAt: now().toISOString() };
        if (holding.length === 0) return { ...answer, reason: "empty_wallet" };
        if (holding.length < 2) return { ...answer, reason: "single_bookmaker" };
        const fb = freebetsByIndex(wallet);
        const matches = engineMatches(ticked, fb);
        if (matches.length === 0) return { ...answer, reason: "no_match" };
        const done = await pool.run({ kind: "combos", matches, fb, size: request.legs });
        if (done.kind !== "combos") throw new Error("the pool answered another kind of job");
        const byId = new Map(ticked.map((market) => [market.eventId, market]));
        const plans = planViews(done.plans, byId, wallet);
        return { ...answer, plans, partial: done.stats.partial, reason: plans.length === 0 ? "no_plan" : null };
      }

      const fb = wallet[request.bookmaker] ?? 0;
      const answer = { mode: "exchange" as const, bookmaker: request.bookmaker, fb, commission: EXCHANGE_COMMISSION, eligibleSports: eligible, chain: null, computedAt: now().toISOString() };
      if (!(fb > 0)) return { ...answer, reason: "no_freebets" };
      const items = exchangeItems(ticked, request.bookmaker);
      if (items.length === 0) return { ...answer, reason: "no_match" };
      const done = await pool.run({ kind: "exchange", items, fb, commission: EXCHANGE_COMMISSION });
      if (done.kind !== "exchange") throw new Error("the pool answered another kind of job");
      if (done.result.steps.length === 0) return { ...answer, reason: "no_plan" };
      const chain = chainView(done.result, new Map(items.map((item) => [item.id, item])), new Map(ticked.map((market) => [market.eventId, market])), request.bookmaker, fb);
      return { ...answer, chain, reason: null };
    },
  };
}
