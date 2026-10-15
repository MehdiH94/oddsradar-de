import { ExchangeItem, ExchangeResult } from "./engine/exchange";
import { FunnelStats } from "./engine/funnel";
import { Match, Plan } from "./engine/types";

// What the engine is asked, and what it answers: plain data, so that it crosses
// to a worker thread (and back) as it is. The bookmakers are only indexes here
// (src/freebets/engine/types.ts): the caller keeps the names.
export type ComputeJob =
  // The three best combos of `size` matches for a wallet (fb[b]: the FB of bookmaker b).
  | { kind: "combos"; matches: Match[]; fb: number[]; size: 1 | 2 | 3 }
  // The best chain of conversions of one bookmaker's `fb` against the exchange.
  | { kind: "exchange"; items: ExchangeItem[]; fb: number; commission: number };

export type ComputeResult =
  | { kind: "combos"; plans: Plan[]; stats: FunnelStats }
  | { kind: "exchange"; result: ExchangeResult };
