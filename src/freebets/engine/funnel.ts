// The best plans among many matches: the funnel.
//
// With M matches, every combo of three is far too many to solve (1,000 matches make 166 million). Each stage rules
// out more at a higher price, and the cheap ones only rule out what provably cannot win:
//   1. per match, O(M): the matches no bookmaker with freebets can pair with another are left out, and the
//      matches that others beat on both measures of a good match (S1: the TRJ, S2: how balanced) are cut;
//   2. per combo, O(1): the bound 1 / (prod S1 + prod S2) on its rate (src/freebets/engine/bounds.ts);
//   3. per combo, a few thousand operations and no allocation: the bound that counts the wallet's budgets;
//   4. the best bound first, a combo is looked at with a few rounds of column generation (often enough to prove it
//      cannot beat the best plan found) and only then solved (src/freebets/engine/combo.ts).
// Stages 2 to 4 lose nothing (bounds are majorants), up to the tolerance `epsilon` the caller accepts; the cut of
// stage 1 is the one heuristic, and the one that keeps the work bounded: its loss was measured (docs/freebets-calcul.md).
//
// The plans come out one after the other: the best combo, then the best one that has no match in common with it,
// then the best one with none in common with either, so that they are real alternatives.
import { cashBound, fillGains, flatten, FlatMatch, makeScratch, matchFeatures, paddingMatch, rateBound } from "./bounds";
import { solveColumns } from "./columnGeneration";
import { matchProblem, solveCombo } from "./combo";
import { MAX_CELLS, Match, Plan } from "./types";

// How many matches go on to the stages after the first, by size of combo: all of them for single bets, and
// otherwise the number that keeps a request around 100 ms (the loss of cash this costs is below 1 %).
export const DEFAULT_MAX_MATCHES: Record<1 | 2 | 3, number> = { 1: Infinity, 2: 200, 3: 50 };

// No more combos than this are bounded, whatever the caller asks: the matches are cut to fit.
export const MAX_COMBOS = 100_000;

export interface FunnelOptions {
  // How many matches in a combo.
  size: 1 | 2 | 3;
  // How many plans (default 3).
  plans?: number;
  // How many matches go past the first stage (default DEFAULT_MAX_MATCHES[size]).
  maxMatches?: number;
  // A plan may be this far (relatively) under the best it could have been (default 0.005; 0 is exact).
  epsilon?: number;
  // Plans under this rate (cash over freebets used) are not returned (default 0).
  minRate?: number;
  // No bet under this many FB (default 0.1).
  minStake?: number;
  // Stop looking after this long and return what was found, `partial` (default 1500).
  deadlineMs?: number;
  // The clock, in ms (default performance.now): a test passes its own.
  now?: () => number;
}

export interface FunnelStats {
  // Matches received, left out as unusable (a bad price, a market of neither 2 nor 3 outcomes, an id seen
  // before) and left out because fewer than two bookmakers with freebets price them (the rule needs two).
  matches: number;
  invalid: number;
  uncovered: number;
  // Matches kept after the first stage, and combos bounded.
  kept: number;
  combos: number;
  // Combos that passed the bounds, those looked at, dismissed by a few rounds of column generation, and solved.
  pool: number;
  looked: number;
  quick: number;
  solved: number;
  // Linear programs solved, plans that are not exact (see Plan.exact).
  lps: number;
  inexact: number;
  // True when the clock ran out: fewer or poorer plans than there could be.
  partial: boolean;
  ms: { prepare: number; bounds: number; select: number; total: number };
}

export interface FunnelResult {
  plans: Plan[];
  stats: FunnelStats;
}

interface Candidate {
  // Indexes into the kept matches; -1 where the combo has fewer matches.
  i: number;
  j: number;
  l: number;
  bound: number;
}

const combinations = (n: number, size: number) => (size === 1 ? n : size === 2 ? (n * (n - 1)) / 2 : (n * (n - 1) * (n - 2)) / 6);

// The matches with the fewest strict dominators on (s1, s2): lower is better on both.
function skyline(items: FlatMatch[], cap: number): FlatMatch[] {
  const dominators = items.map((a) => {
    let count = 0;
    for (const b of items) {
      const f = b.features;
      const g = a.features;
      if (b !== a && f.s1 <= g.s1 && f.s2 <= g.s2 && (f.s1 < g.s1 || f.s2 < g.s2)) count++;
    }
    return count;
  });
  return items
    .map((item, i) => ({ item, count: dominators[i] }))
    .sort((x, y) => x.count - y.count || x.item.features.s1 * x.item.features.s2 - y.item.features.s1 * y.item.features.s2)
    .slice(0, cap)
    .map((x) => x.item);
}

function enumerate(n: number, size: number, visit: (i: number, j: number, l: number) => void) {
  if (size === 1) {
    for (let i = 0; i < n; i++) visit(i, -1, -1);
  } else if (size === 2) {
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) visit(i, j, -1);
  } else {
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) for (let l = j + 1; l < n; l++) visit(i, j, l);
  }
}

// The best plans, at most `plans`, best first, with no match in common two by two.
export function topPlans(matches: readonly Match[], fb: readonly number[], opts: FunnelOptions): FunnelResult {
  const { size } = opts;
  if (size !== 1 && size !== 2 && size !== 3) throw new RangeError(`a combo has 1 to 3 matches, not ${String(size)}`);
  if (!fb.every(Number.isFinite)) throw new RangeError("a bookmaker's freebets are not a finite number");
  const now = opts.now ?? (() => performance.now());
  const wanted = opts.plans ?? 3;
  const epsilon = Math.max(0, opts.epsilon ?? 0.005);
  const minRate = opts.minRate ?? 0;
  const t0 = now();
  const deadline = t0 + (opts.deadlineMs ?? 1500);
  const stats: FunnelStats = {
    matches: matches.length,
    invalid: 0,
    uncovered: 0,
    kept: 0,
    combos: 0,
    pool: 0,
    looked: 0,
    quick: 0,
    solved: 0,
    lps: 0,
    inexact: 0,
    partial: false,
    ms: { prepare: 0, bounds: 0, select: 0, total: 0 },
  };
  const scratch = makeScratch(fb);
  const wallet = scratch.budgets.reduce((s, v) => s + v, 0);

  // 1. Per match.
  const seen = new Set<string>();
  let items: FlatMatch[] = [];
  for (const match of matches) {
    if (seen.has(match.id) || matchProblem(match, fb)) {
      stats.invalid++;
      continue;
    }
    seen.add(match.id);
    const features = matchFeatures(match, fb);
    if (!features || features.pricers < 2) {
      stats.uncovered++;
      continue;
    }
    items.push(flatten(match, features, scratch.budgets));
  }
  if (minRate > 0 && items.length > 0) {
    // Even paired with the best of the others, a match whose rate bound is under the floor cannot reach it.
    const others = size - 1;
    const least1 = items.reduce((m, x) => Math.min(m, x.features.s1), Infinity);
    const least2 = items.reduce((m, x) => Math.min(m, x.features.s2), Infinity);
    items = items.filter((x) => 1 / (x.features.s1 * least1 ** others + x.features.s2 * least2 ** others) >= minRate);
  }
  let cap = Math.min(opts.maxMatches ?? DEFAULT_MAX_MATCHES[size], items.length);
  while (cap > size && combinations(cap, size) > MAX_COMBOS) cap--;
  if (items.length > cap) items = skyline(items, cap);
  stats.kept = items.length;
  const t1 = now();
  stats.ms.prepare = t1 - t0;

  // 2 and 3. The bounds of every combo, best first. The bounding gets 60 % of the time at most, so that some is
  // left to solve what it found.
  const padding = paddingMatch(scratch.budgets);
  const at = (i: number) => (i >= 0 ? items[i] : padding);
  const pool: Candidate[] = [];
  const boundingEnds = t0 + 0.6 * (deadline - t0);
  let visited = 0;
  enumerate(items.length, size, (i, j, l) => {
    if (stats.partial) return;
    if ((visited++ & 1023) === 0 && now() > boundingEnds) {
      stats.partial = true;
      return;
    }
    stats.combos++;
    let p1 = items[i].features.s1;
    let p2 = items[i].features.s2;
    if (j >= 0) {
      p1 *= items[j].features.s1;
      p2 *= items[j].features.s2;
    }
    if (l >= 0) {
      p1 *= items[l].features.s1;
      p2 *= items[l].features.s2;
    }
    const rate = 1 / (p1 + p2);
    if (rate < minRate) return;
    const bound = Math.min(wallet * rate, cashBound(scratch, fillGains(scratch, items[i], at(j), at(l))));
    if (bound > 0) pool.push({ i, j, l, bound });
  });
  pool.sort((x, y) => y.bound - x.bound);
  stats.pool = pool.length;
  const t2 = now();
  stats.ms.bounds = t2 - t1;

  // 4. The selection. A combo given up on against a target is remembered with it, and looked at again only
  // against a lower one (the target falls as the plans before it are taken out).
  const known = new Map<string, { plan: Plan | null; givenUpAt: number }>();
  const solve = (c: Candidate, target: number): Plan | null => {
    const id = `${c.i},${c.j},${c.l}`;
    const seenBefore = known.get(id);
    if (seenBefore && (seenBefore.plan || target >= seenBefore.givenUpAt)) return seenBefore.plan;
    stats.looked++;
    // A few rounds of column generation often prove that the combo cannot beat the target.
    if (target > 0) {
      const cells = fillGains(scratch, items[c.i], at(c.j), at(c.l));
      const quick = solveColumns({ a: scratch.gains, stride: MAX_CELLS, bookmakers: scratch.B, cells, budgets: scratch.budgets }, { target });
      stats.quick++;
      if (!quick || quick.pruned) {
        known.set(id, { plan: null, givenUpAt: target });
        return null;
      }
    }
    const combo = [items[c.i].match, ...(c.j >= 0 ? [items[c.j].match] : []), ...(c.l >= 0 ? [items[c.l].match] : [])];
    const plan = solveCombo(combo, fb, { minStake: opts.minStake, target });
    stats.solved++;
    if (plan) stats.lps += plan.lps;
    // A plan under the floor is no plan, for any target.
    const kept = plan && plan.rate >= minRate ? plan : null;
    known.set(id, { plan: kept, givenUpAt: plan ? -Infinity : target });
    return kept;
  };

  const taken = new Set<string>();
  const usesTaken = (c: Candidate) => taken.has(items[c.i].match.id) || (c.j >= 0 && taken.has(items[c.j].match.id)) || (c.l >= 0 && taken.has(items[c.l].match.id));
  const plans: Plan[] = [];
  for (let stage = 0; stage < wanted; stage++) {
    // The best plan already solved that has no match in common with the plans taken.
    let incumbent: Plan | null = null;
    for (const { plan } of known.values()) {
      if (plan && !plan.matchIds.some((id) => taken.has(id)) && (!incumbent || plan.cash > incumbent.cash)) incumbent = plan;
    }
    for (const c of pool) {
      // Sorted by bound: nothing further can beat the incumbent by more than the tolerance.
      if (incumbent && c.bound <= incumbent.cash * (1 + epsilon)) break;
      if (usesTaken(c)) continue;
      if (now() > deadline) {
        stats.partial = true;
        break;
      }
      const plan = solve(c, incumbent ? incumbent.cash * (1 + epsilon) : -Infinity);
      if (plan && (!incumbent || plan.cash > incumbent.cash)) incumbent = plan;
    }
    if (!incumbent) break;
    plans.push(incumbent);
    incumbent.matchIds.forEach((id) => taken.add(id));
  }
  plans.sort((x, y) => y.cash - x.cash);
  stats.inexact = plans.filter((plan) => !plan.exact).length;
  const t3 = now();
  stats.ms.select = t3 - t2;
  stats.ms.total = t3 - t0;
  return { plans, stats };
}
