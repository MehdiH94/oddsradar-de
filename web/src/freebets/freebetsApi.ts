import { announceUnauthorized } from "../auth/session";

// The ids the server knows (BookmakerId in src/scraper/canonical.ts), the ones
// it reads now (ALL_BOOKMAKERS) among them.
export type BookmakerId =
  | "leovegas"
  | "merkurbets"
  | "twentybet"
  | "admiralbet"
  | "betathome"
  | "oddset"
  | "tipico"
  | "winamaxde"
  | "winamax"
  | "betclic";

// The freebets an account holds, by bookmaker, in FB (1 FB is 1 euro): a bookmaker
// where it holds nothing is absent (src/freebets/wallet.ts).
export type Wallet = Partial<Record<BookmakerId, number>>;

// --- what src/freebets/conversions.ts answers ------------------------------------------------------------------

export interface MatchView {
  eventId: string;
  sport: string;
  competition: string;
  startTime: string;
  participants: string[];
  market: string;
  outcomes: Array<{ key: string; label: string }>;
  // The prices of the bookmakers where the account holds freebets, in the order of `outcomes`.
  prices: Partial<Record<BookmakerId, number[]>>;
}

export interface BetView {
  outcomes: string[];
  label: string;
  odds: number;
  stake: number;
  gain: number;
}

export interface PlanView {
  rank: number;
  cash: number;
  used: number;
  rate: number;
  left: number;
  exact: boolean;
  oddsAt: string;
  matches: MatchView[];
  bookmakers: Array<{ bookmaker: BookmakerId; fb: number; used: number; bets: BetView[] }>;
}

export interface BookmakersAnswer {
  mode: "bookmakers";
  legs: 1 | 2 | 3;
  bookmakers: BookmakerId[];
  total: number;
  eligibleSports: string[];
  plans: PlanView[];
  reason: "empty_wallet" | "single_bookmaker" | "no_match" | "no_plan" | null;
  partial: boolean;
  computedAt: string;
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
  back: number;
  lay: number;
  laySize: number;
  fb: number;
  layStake: number;
  cash: number;
  rate: number;
  liability: number;
  ifWins: { gain: number; pays: number; net: number };
  ifLoses: { net: number };
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

export interface ExchangeAnswer {
  mode: "exchange";
  bookmaker: BookmakerId;
  fb: number;
  // The exchange's commission on a win (0.03).
  commission: number;
  eligibleSports: string[];
  chain: ChainView | null;
  reason: "no_freebets" | "no_match" | "no_plan" | null;
  computedAt: string;
}

export type ConversionAnswer = BookmakersAnswer | ExchangeAnswer;

export type ConversionRequest =
  | { mode: "bookmakers"; legs: 1 | 2 | 3; sports?: string[] }
  | { mode: "exchange"; bookmaker: BookmakerId; sports?: string[] };

// --- the calls ---------------------------------------------------------------------------------------------------

// An answer that is not a success, with the server's message (in French, fit to show).
export class FreebetsError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (err) {
    // A request the page itself gave up on (a newer one replaced it) is not a failure to report.
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new FreebetsError("Could not connect. Check your network and try again.", 0);
  }
  if (res.status === 401) announceUnauthorized();
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new FreebetsError(data.message ?? "Something went wrong. Try again in a moment.", res.status);
  return data as T;
}

export const fetchWallet = () => call<{ wallet: Wallet }>("/api/freebets/wallet").then((r) => r.wallet);

// Replaces the whole wallet; the answer is what the server kept (cents rounded).
export const saveWallet = (wallet: Wallet) =>
  call<{ wallet: Wallet }>("/api/freebets/wallet", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ wallet }),
  }).then((r) => r.wallet);

export function conversionsUrl(request: ConversionRequest): string {
  const params = new URLSearchParams({ mode: request.mode });
  if (request.mode === "bookmakers") params.set("legs", String(request.legs));
  else params.set("bookmaker", request.bookmaker);
  // Present and empty means no sport at all; absent, every sport.
  if (request.sports) params.set("sports", request.sports.join(","));
  return `/api/freebets/conversions?${params}`;
}

export const fetchConversions = (request: ConversionRequest, signal?: AbortSignal) =>
  call<ConversionAnswer>(conversionsUrl(request), { signal });
