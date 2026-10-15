import { maximize } from "../../../src/freebets/engine/simplex";
import { solveCombo } from "../../../src/freebets/engine/combo";
import { ComboOptions, Match, Plan } from "../../../src/freebets/engine/types";

// --- seeded random markets -------------------------------------------------------------------------------------

export function rng(seed: number) {
  let s = seed >>> 0;
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const normal = () => {
    const u = Math.max(next(), 1e-12);
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * next());
  };
  return {
    next,
    normal,
    range: (a: number, b: number) => a + (b - a) * next(),
    int: (a: number, b: number) => a + Math.floor(next() * (b - a + 1)),
  };
}

export type Rng = ReturnType<typeof rng>;

// The chances of a match: a 1X2 or a winner, mostly balanced, sometimes lopsided (a heavy favourite).
function chances(r: Rng, outcomes: 2 | 3): number[] {
  const lopsided = r.next() < 0.4;
  if (outcomes === 3) {
    const draw = r.range(0.2, 0.32);
    const home = lopsided ? r.range(0.08, 0.78 - draw) : r.range(0.28, 0.46);
    const away = 1 - draw - home;
    return r.next() < 0.5 ? [home, draw, away] : [away, draw, home];
  }
  const p = lopsided ? r.range(0.06, 0.94) : r.range(0.35, 0.65);
  return [p, 1 - p];
}

// M matches priced by the bookmakers with the given margins (1.04 = 4 % overround), each with its own noise on
// every price; a bookmaker prices a match with the probability `coverage`.
export function genMatches(M: number, margins: readonly number[], seed: number, opts: { share2way?: number; coverage?: number } = {}): Match[] {
  const r = rng(seed);
  const share2 = opts.share2way ?? 0.3;
  const coverage = opts.coverage ?? 0.85;
  const matches: Match[] = [];
  for (let m = 0; m < M; m++) {
    const outcomes = r.next() < share2 ? 2 : 3;
    const p = chances(r, outcomes);
    const odds = margins.map((margin) => {
      if (r.next() > coverage) return null;
      const overround = margin + r.normal() * 0.008;
      return p.map((pk) => Math.max(1.01, Math.round((1 / (pk * overround * (1 + r.normal() * 0.025))) * 100) / 100));
    });
    matches.push({ id: `m${m}`, outcomes, odds });
  }
  return matches;
}

export function marginsFor(B: number, seed: number): number[] {
  const r = rng(seed ^ 0x9e3779b9);
  return Array.from({ length: B }, () => r.range(1.035, 1.075));
}

export function genWallet(B: number, seed: number, lopsided = false): number[] {
  const r = rng(seed ^ 0x85ebca6b);
  return Array.from({ length: B }, () => (lopsided ? Math.round(r.next() ** 3 * 150 + 3) : Math.round(r.range(10, 60))));
}

// --- the references the engine is checked against ------------------------------------------------------------

// Every combination of outcomes, the last match varying fastest.
export function cellsOf(matches: readonly Match[]): number[][] {
  let cells: number[][] = [[]];
  for (const match of matches) cells = cells.flatMap((cell) => Array.from({ length: match.outcomes }, (_, k) => [...cell, k]));
  return cells;
}

// What bookmaker b pays on a cell for one unit staked, stake included; null when it cannot bet it (it does not
// price every match, or holds no freebets).
export function priceOf(matches: readonly Match[], fb: readonly number[], b: number, cell: readonly number[]): number | null {
  if (!(fb[b] > 0)) return null;
  let price = 1;
  for (let i = 0; i < matches.length; i++) {
    const odds = matches[i].odds[b];
    if (!odds) return null;
    price *= odds[cell[i]];
  }
  return price;
}

// The gain of one FB at b on cell j when j wins (price - 1), 0 where b cannot bet it: a[b * J + j].
export function gainsOf(matches: readonly Match[], fb: readonly number[]): { a: Float64Array; B: number; J: number } {
  const cells = cellsOf(matches);
  const B = fb.length;
  const J = cells.length;
  const a = new Float64Array(B * J);
  for (let b = 0; b < B; b++) {
    for (let j = 0; j < J; j++) {
      const price = priceOf(matches, fb, b, cells[j]);
      if (price !== null) a[b * J + j] = price - 1;
    }
  }
  return { a, B, J };
}

// The program of one combo (maximise G so that every cell pays G and no budget is broken) on all its variables,
// by the dense simplex. `allowed[b][j]` false forbids a bet. This is built here, not by the engine, so that it is
// a second opinion.
export function denseValue(a: ArrayLike<number>, B: number, J: number, budgets: ArrayLike<number>, allowed: boolean[][] | null = null): number {
  const vars: Array<[number, number]> = [];
  for (let b = 0; b < B; b++) {
    if (!(budgets[b] > 0)) continue;
    for (let j = 0; j < J; j++) if (a[b * J + j] > 0 && (!allowed || allowed[b][j])) vars.push([b, j]);
  }
  if (vars.length === 0) return 0;
  const books = [...new Set(vars.map(([b]) => b))];
  const n = 1 + vars.length;
  const m = J + books.length;
  const c = new Float64Array(n);
  c[0] = 1;
  const A = new Float64Array(m * n);
  const rhs = new Float64Array(m);
  for (let j = 0; j < J; j++) A[j * n] = 1;
  vars.forEach(([b, j], v) => {
    A[j * n + 1 + v] = -a[b * J + j];
    A[(J + books.indexOf(b)) * n + 1 + v] = 1;
  });
  books.forEach((b, i) => (rhs[J + i] = budgets[b]));
  const res = maximize(n, m, c, A, rhs);
  return res.status === "optimal" ? res.value : 0;
}

// The optimum of a combo's program with some (bookmaker, cell) bets forbidden.
export function denseLpValue(matches: readonly Match[], fb: readonly number[], banned: ReadonlyArray<readonly [number, number]> = []): number {
  const { a, B, J } = gainsOf(matches, fb);
  const allowed = Array.from({ length: B }, () => new Array<boolean>(J).fill(true));
  for (const [b, j] of banned) allowed[b][j] = false;
  return denseValue(a, B, J, fb, allowed);
}

// The best value under the rule "no bookmaker holds every cell", by trying every way to obey it: each
// bookmaker with something to bet gets one cell where it is forbidden (the rule holds exactly then).
export function coverageOracle(matches: readonly Match[], fb: readonly number[]): number {
  const { a, J } = gainsOf(matches, fb);
  const carriers = fb.map((_, b) => b).filter((b) => fb[b] > 0 && Array.from({ length: J }, (_, j) => a[b * J + j]).some((v) => v > 0));
  let best = 0;
  const banned: Array<[number, number]> = [];
  const visit = (k: number) => {
    if (k === carriers.length) {
      best = Math.max(best, denseLpValue(matches, fb, banned));
      return;
    }
    for (let j = 0; j < J; j++) {
      banned.push([carriers[k], j]);
      visit(k + 1);
      banned.pop();
    }
  };
  visit(0);
  return best;
}

// What each cell pays if it wins, recomputed from the bets and the matches' prices alone.
export function payoffsOf(plan: Plan, matches: readonly Match[], fb: readonly number[]): number[] {
  const cells = cellsOf(matches);
  const payoff = new Array<number>(cells.length).fill(0);
  for (const bet of plan.bets) {
    const price = priceOf(matches, fb, bet.b, cells[bet.cellIndex]);
    if (price === null) throw new Error("a bet is placed where it cannot be");
    payoff[bet.cellIndex] += bet.stake * (price - 1);
  }
  return payoff;
}

// --- the exhaustive search the funnel is checked against ---------------------------------------------------------

// The best plans with no match in common, taken best first (the order the funnel promises).
export function disjointTop(plans: readonly Plan[], k: number): Plan[] {
  const sorted = [...plans].sort((x, y) => y.cash - x.cash);
  const out: Plan[] = [];
  const taken = new Set<string>();
  for (const plan of sorted) {
    if (plan.matchIds.some((id) => taken.has(id))) continue;
    out.push(plan);
    plan.matchIds.forEach((id) => taken.add(id));
    if (out.length === k) break;
  }
  return out;
}

// Every combo of `size` matches solved, then the best disjoint ones.
export function exhaustiveTop(matches: readonly Match[], fb: readonly number[], size: 1 | 2 | 3, k = 3, opts: ComboOptions = {}): Plan[] {
  const plans: Plan[] = [];
  const n = matches.length;
  const add = (...picked: Match[]) => {
    const plan = solveCombo(picked, fb, opts);
    if (plan) plans.push(plan);
  };
  if (size === 1) for (let i = 0; i < n; i++) add(matches[i]);
  else if (size === 2) for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) add(matches[i], matches[j]);
  else for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) for (let l = j + 1; l < n; l++) add(matches[i], matches[j], matches[l]);
  return disjointTop(plans, k);
}
