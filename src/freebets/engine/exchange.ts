// A bookmaker's freebets converted against the exchange.
//
// The freebet is bet at the bookmaker on an outcome, at the price `back`. It is a stake not returned: a win pays
// the profit, (back - 1) per FB, and a loss costs nothing. The same outcome is laid on the exchange at the price
// `lay`, for a stake S. If the outcome wins the lay loses S (lay - 1) of the exchange's money, if it does not the
// lay wins S and the exchange keeps its commission k on that win. S is chosen so that both come to the same:
//     F (back - 1) - S (lay - 1)  =  S (1 - k)        so   S = F (back - 1) / (lay - k)
// and the guaranteed cash is S (1 - k) = F * rate, with
//     rate = (back - 1) (1 - k) / (lay - k).
// The money to put up on the exchange is the liability S (lay - 1), given back with the result. What the lay
// liquidity (the stake offered at that price) can take is `laySize`, which limits the freebets that one
// outcome converts to laySize (lay - k) / (back - 1): the rest of the freebets must go to other matches.
//
// A chain converts the freebets on a few matches (at most 3), each up to what its liquidity absorbs, best rate
// first, using only one outcome of a match. Choosing which outcomes is a small knapsack: this finds the best
// chain exactly (a greedy by rate is not: a high-rate outcome with a sliver of liquidity can take one of the
// three places from an outcome that would convert far more).

export interface ExchangeItem {
  // The outcome of a match to bet at the bookmaker and lay on the exchange.
  id: string;
  matchId: string;
  // The bookmaker's price on the outcome, and the exchange's lay price.
  back: number;
  lay: number;
  // The stake the exchange offers to lay at that price, in euros.
  laySize: number;
}

export interface ExchangeOptions {
  // The exchange's commission on a win, 0.03 for 3 %. Required: the caller passes the site's own constant.
  commission: number;
  // How many matches a chain may use, 1 to 3 (default 3).
  maxConversions?: number;
  // Outcomes whose liquidity is under this are left out (default 0).
  minLaySize?: number;
  // Outcomes whose rate is under this are left out (default 0).
  minRate?: number;
}

export interface ExchangeStep {
  id: string;
  matchId: string;
  // Cash per FB, the FB converted here, the cash it guarantees, the stake to lay, and the money to put up on
  // the exchange for it.
  rate: number;
  fb: number;
  cash: number;
  layStake: number;
  liability: number;
  // True when the liquidity stopped it, with freebets left over for the next step.
  limited: boolean;
}

export interface ExchangeResult {
  // Best rate first.
  steps: ExchangeStep[];
  // The FB converted, and the FB left (no liquidity to convert them against).
  converted: number;
  leftover: number;
  cash: number;
  liability: number;
  // Outcomes left out: a price that is not one, no liquidity, under the floors.
  ignored: number;
  // Branches of the search looked at (diagnostic).
  nodes: number;
}

export function exchangeRate(back: number, lay: number, commission: number): number {
  return ((back - 1) * (1 - commission)) / (lay - commission);
}

// The FB that `laySize` of liquidity at the price `lay` can take against a bet at `back`.
export function exchangeCapacity(back: number, lay: number, laySize: number, commission: number): number {
  return (laySize * (lay - commission)) / (back - 1);
}

const EPS = 1e-9;

export function convertAgainstExchange(items: readonly ExchangeItem[], fb: number, opts: ExchangeOptions): ExchangeResult {
  const { commission } = opts;
  const slots = opts.maxConversions ?? 3;
  if (!(commission >= 0 && commission < 1)) throw new RangeError("the exchange's commission is a fraction under 1");
  if (!Number.isInteger(slots) || slots < 1 || slots > 3) throw new RangeError("a chain has 1 to 3 conversions");
  if (!Number.isFinite(fb)) throw new RangeError("the freebets are not a finite number");
  const minLaySize = opts.minLaySize ?? 0;
  const minRate = opts.minRate ?? 0;

  // The outcomes that can be used, best rate first (ties by id, so that the answer never depends on the order).
  let ignored = 0;
  const usable: Array<{ item: ExchangeItem; rate: number; cap: number }> = [];
  for (const item of items) {
    const { back, lay, laySize } = item;
    const valid = Number.isFinite(back) && back > 1 && Number.isFinite(lay) && lay > 1 && lay > commission && Number.isFinite(laySize) && laySize > 0;
    const rate = valid ? exchangeRate(back, lay, commission) : 0;
    if (!valid || laySize < minLaySize || rate < minRate || !(rate > 0)) {
      ignored++;
      continue;
    }
    usable.push({ item, rate, cap: exchangeCapacity(back, lay, laySize, commission) });
  }
  usable.sort((x, y) => y.rate - x.rate || (x.item.id < y.item.id ? -1 : x.item.id > y.item.id ? 1 : 0));
  const n = usable.length;

  // For the outcomes i.. and k = 1 to 3 places: the most FB that k of them can take together (topCaps[k - 1][i]),
  // and the most cash that k of them can guarantee, each converting up to its capacity (topWorth[k - 1][i]).
  const topCaps = [1, 2, 3].map(() => new Float64Array(n + 1));
  const topWorth = [1, 2, 3].map(() => new Float64Array(n + 1));
  const bestCaps: number[] = [];
  const bestWorths: number[] = [];
  for (let i = n - 1; i >= 0; i--) {
    bestCaps.push(usable[i].cap);
    bestWorths.push(usable[i].cap * usable[i].rate);
    bestCaps.sort((x, y) => y - x);
    bestWorths.sort((x, y) => y - x);
    if (bestCaps.length > 3) bestCaps.pop();
    if (bestWorths.length > 3) bestWorths.pop();
    let caps = 0;
    let worth = 0;
    for (let k = 0; k < 3; k++) {
      caps += bestCaps[k] ?? 0;
      worth += bestWorths[k] ?? 0;
      topCaps[k][i] = caps;
      topWorth[k][i] = worth;
    }
  }

  // The search. Outcomes are taken in rate order, each up to its capacity or what is left: for a given set of
  // outcomes that is the best way to fill them. A branch is dropped as soon as nothing that could still be added
  // can beat the best chain: converting what is left at the next outcome's rate (the best any later one has) is
  // the most the rate allows, and the outcomes' own capacities are the most the liquidity allows.
  const valueOf = (indexes: readonly number[]) => {
    let left = fb;
    let value = 0;
    for (const i of indexes) {
      const take = Math.min(usable[i].cap, left);
      value += take * usable[i].rate;
      left -= take;
    }
    return value;
  };
  let bestValue = 0;
  let bestPicks: number[] = [];
  // A first chain to beat, the outcomes that could each guarantee the most: when the liquidity is the limit, it is
  // the best chain, and nothing else is looked at.
  const byWorth = usable.map((_, i) => i).sort((x, y) => usable[y].cap * usable[y].rate - usable[x].cap * usable[x].rate || x - y);
  const first: number[] = [];
  for (const i of byWorth) {
    if (first.length === slots) break;
    if (first.every((j) => usable[j].item.matchId !== usable[i].item.matchId)) first.push(i);
  }
  first.sort((x, y) => x - y);
  if (fb > EPS && valueOf(first) > EPS) {
    bestValue = valueOf(first);
    bestPicks = first;
  }
  const picks: number[] = [];
  const matches = new Set<string>();
  let nodes = 0;
  const search = (from: number, depth: number, left: number, value: number) => {
    nodes++;
    if (value > bestValue + EPS) {
      bestValue = value;
      bestPicks = picks.slice();
    }
    if (depth === slots || left <= EPS) return;
    const room = slots - depth;
    for (let i = from; i < n; i++) {
      const reach = Math.min(left, topCaps[room - 1][i]);
      const possible = Math.min(usable[i].rate * reach, topWorth[room - 1][i]);
      if (value + possible <= bestValue + EPS) break;
      if (matches.has(usable[i].item.matchId)) continue;
      const take = Math.min(usable[i].cap, left);
      picks.push(i);
      matches.add(usable[i].item.matchId);
      search(i + 1, depth + 1, left - take, value + take * usable[i].rate);
      matches.delete(usable[i].item.matchId);
      picks.pop();
    }
  };
  if (fb > EPS) search(0, 0, fb, 0);

  // The chain: the outcomes picked, filled in rate order.
  const steps: ExchangeStep[] = [];
  let left = fb;
  for (const index of bestPicks) {
    // An outcome picked after the freebets ran out converts nothing: it is not a step.
    if (left <= EPS) break;
    const { item, rate, cap } = usable[index];
    const converted = Math.min(cap, left);
    const layStake = (converted * (item.back - 1)) / (item.lay - commission);
    steps.push({
      id: item.id,
      matchId: item.matchId,
      rate,
      fb: converted,
      cash: converted * rate,
      layStake,
      liability: layStake * (item.lay - 1),
      limited: cap < left - EPS,
    });
    left -= converted;
  }
  const converted = steps.reduce((s, step) => s + step.fb, 0);
  return {
    steps,
    converted,
    leftover: Math.max(0, fb - converted),
    cash: steps.reduce((s, step) => s + step.cash, 0),
    liability: steps.reduce((s, step) => s + step.liability, 0),
    ignored,
    nodes,
  };
}
