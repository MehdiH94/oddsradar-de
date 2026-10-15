// One combo (1 to 3 matches) converted with a wallet of freebets: the exact linear program, the rule that no
// bookmaker holds every cell, the minimum stake, and the rounding to the cent.
//
// A combo has one cell per combination of outcomes of its matches (3 x 3 x 2 = 18 for two football matches and
// a tennis one). A bookmaker can bet a cell only if it prices every match of the combo, at the product of its
// prices; only the bookmakers with freebets can bet at all. Guaranteeing G on every cell (src/freebets/engine/
// columnGeneration.ts) is not enough: the rule is that no bookmaker may hold every cell of the combo (a
// bookmaker that sees all the outcomes of a bet covered in its own book closes the account), so that at least
// two bookmakers are needed.
import { maximize } from "./simplex";
import { solveColumns } from "./columnGeneration";
import { Bet, ComboOptions, MAX_MATCHES_PER_COMBO, MAX_ODDS, MIN_CASH, Match, Plan } from "./types";

// Why a match cannot be used, or null when it can. Only the bookmakers with freebets count: the others' prices
// are never read.
export function matchProblem(match: Match, fb: readonly number[]): string | null {
  if (match.outcomes !== 2 && match.outcomes !== 3) return "its market has neither 2 nor 3 outcomes";
  for (let b = 0; b < fb.length; b++) {
    if (!(fb[b] > 0)) continue;
    const odds = match.odds[b];
    if (odds == null) continue;
    if (odds.length !== match.outcomes) return `bookmaker ${b} prices ${odds.length} outcomes of ${match.outcomes}`;
    for (const price of odds) {
      if (!(Number.isFinite(price) && price > 1 && price <= MAX_ODDS)) return `bookmaker ${b} has the price ${price}`;
    }
  }
  return null;
}

// The cells: every combination of outcomes, the last match varying fastest.
function makeCells(matches: readonly Match[]): number[][] {
  let cells: number[][] = [[]];
  for (const match of matches) {
    cells = cells.flatMap((cell) => Array.from({ length: match.outcomes }, (_, k) => [...cell, k]));
  }
  return cells;
}

interface Problem {
  B: number;
  J: number;
  fb: readonly number[];
  // C[b][j]: the combined price of bookmaker b on cell j; 0 when it cannot bet it (it does not price every
  // match, or has no freebets).
  C: Float64Array[];
  // a[b * J + j]: what one FB at b gains on j when j wins (C - 1), 0 where C is 0.
  a: Float64Array;
  minStake: number;
  maxLps: number;
  coverage: boolean;
  lps: number;
  // Something was cut short, so that a better plan may exist.
  inexact: boolean;
}

// A solution: the guaranteed gain and the stakes x[b][j], in FB. `vertex` says the dense simplex gave it (a vertex
// has at most one bet more than there are cells and bookmakers), where the column generation mixes assignments.
interface Solution {
  value: number;
  x: Float64Array[];
  vertex?: boolean;
}

// A stake the bookmaker would refuse: more than nothing and less than the minimum.
const isSliver = (p: Problem, x: number) => x > 1e-9 && x < p.minStake - 1e-9;
const hasSliver = (p: Problem, sol: Solution) => sol.x.some((row) => row.some((x) => isSliver(p, x)));

// A search for a solution without slivers is not worth it when forbidding them costs under this (relative): about
// a cent on a hundred.
const WORTH = 1e-4;
// Linear programs one such search may solve (the solution is then inexact).
const SLIVER_NODES = 30;

function problemOf(matches: readonly Match[], cells: number[][], fb: readonly number[], opts: Required<Omit<ComboOptions, "target">>): Problem {
  const B = fb.length;
  const J = cells.length;
  const C = fb.map(() => new Float64Array(J));
  const a = new Float64Array(B * J);
  for (let b = 0; b < B; b++) {
    if (!(fb[b] > 0)) continue;
    const prices = matches.map((match) => match.odds[b] ?? null);
    if (prices.some((p) => p === null)) continue;
    for (let j = 0; j < J; j++) {
      let c = 1;
      for (let i = 0; i < matches.length; i++) c *= prices[i]![cells[j][i]];
      C[b][j] = c;
      a[b * J + j] = c - 1;
    }
  }
  return { B, J, fb, C, a, minStake: opts.minStake, maxLps: opts.maxLps, coverage: opts.coverage, lps: 0, inexact: false };
}

// The program with the bets in `allowed`; null when it cannot beat `target`.
function solveLp(p: Problem, allowed: boolean[][], target = -Infinity): Solution | null {
  p.lps++;
  const res = solveColumns({ a: p.a, stride: p.J, bookmakers: p.B, cells: p.J, budgets: p.fb, allowed }, { target });
  if (!res || res.pruned) return null;
  if (!res.converged) p.inexact = true;
  return { value: res.value, x: res.x };
}

// The same program by the dense simplex on all its variables: it returns a vertex, where the column generation
// mixes several assignments. A bet in `forced` is placed at the minimum stake or more: the program is written on
// what each of them has above the minimum, which moves the minimum onto the right-hand sides (they stay positive,
// as the simplex needs) and leaves the bet free to be any stake from there.
function solveDense(p: Problem, allowed: boolean[][], forced?: boolean[][]): Solution | null {
  const vars: Array<[number, number]> = [];
  for (let b = 0; b < p.B; b++) {
    if (!(p.fb[b] > 0)) continue;
    for (let j = 0; j < p.J; j++) if (p.a[b * p.J + j] > 0 && allowed[b][j]) vars.push([b, j]);
  }
  if (vars.length === 0) return null;
  const books = [...new Set(vars.map(([b]) => b))];
  const n = 1 + vars.length; // G, then the stakes
  const m = p.J + books.length; // a gain per cell, a budget per bookmaker
  const c = new Float64Array(n);
  c[0] = 1;
  const A = new Float64Array(m * n);
  const rhs = new Float64Array(m);
  for (let j = 0; j < p.J; j++) A[j * n] = 1; // G - gain <= 0
  vars.forEach(([b, j], v) => {
    A[j * n + 1 + v] = -p.a[b * p.J + j];
    A[(p.J + books.indexOf(b)) * n + 1 + v] = 1;
  });
  books.forEach((b, i) => (rhs[p.J + i] = p.fb[b]));
  if (forced) {
    for (const [b, j] of vars) {
      if (!forced[b][j]) continue;
      rhs[j] += p.a[b * p.J + j] * p.minStake;
      rhs[p.J + books.indexOf(b)] -= p.minStake;
    }
    // A bookmaker cannot place more minimum stakes than it has freebets for.
    for (let i = p.J; i < m; i++) {
      if (rhs[i] < -1e-9) return null;
      rhs[i] = Math.max(0, rhs[i]);
    }
  }
  p.lps++;
  const res = maximize(n, m, c, A, rhs);
  if (res.status !== "optimal") return null;
  const x = Array.from({ length: p.B }, () => new Float64Array(p.J));
  vars.forEach(([b, j], v) => (x[b][j] = res.x[1 + v] + (forced?.[b][j] ? p.minStake : 0)));
  return { value: res.x[0], x, vertex: true };
}

// The program, then the stakes under the minimum are forbidden and it is solved again (a few rounds: a
// forbidden stake can move a sliver to another bookmaker). Null when forbidding them left a cell that no
// bookmaker could bet, or when slivers remain after the last round.
function banSlivers(p: Problem, allowed: boolean[][], first: Solution, target: number): Solution | null {
  const local = allowed.map((row) => row.slice());
  let sol: Solution | null = first;
  for (let round = 0; round < 6 && sol; round++) {
    let sliver = false;
    for (let b = 0; b < p.B; b++) {
      for (let j = 0; j < p.J; j++) {
        if (isSliver(p, sol.x[b][j])) {
          local[b][j] = false;
          sliver = true;
        }
      }
    }
    if (!sliver) return sol;
    sol = solveLp(p, local, target);
  }
  return sol && !hasSliver(p, sol) ? sol : null;
}

// The slivers of a solution, the biggest first.
function slivers(p: Problem, sol: Solution): Array<[number, number, number]> {
  const list: Array<[number, number, number]> = [];
  for (let b = 0; b < p.B; b++) {
    for (let j = 0; j < p.J; j++) if (isSliver(p, sol.x[b][j])) list.push([b, j, sol.x[b][j]]);
  }
  return list.sort((u, v) => v[2] - u[2]);
}

// A first solution without slivers, quickly: every sliver of the vertex is forced up to the minimum (as many as
// the bookmaker has freebets for, the biggest first) or else forbidden, and the program is solved again, for a few
// rounds. Null when a round leaves nothing.
function forceSlivers(p: Problem, allowed: boolean[][], root: Solution): Solution | null {
  const local = allowed.map((row) => row.slice());
  const forced = allowed.map((row) => row.map(() => false));
  let sol: Solution | null = root;
  for (let round = 0; round < 40 && sol; round++) {
    const list = slivers(p, sol);
    if (list.length === 0) return sol;
    const room = p.fb.map((f, b) => Math.floor(Math.max(f, 0) / p.minStake + 1e-9) - forced[b].filter(Boolean).length);
    for (const [b, j] of list) {
      if (room[b] > 0) {
        forced[b][j] = true;
        room[b]--;
      } else {
        local[b][j] = false;
      }
    }
    sol = solveDense(p, local, forced);
  }
  return sol && !hasSliver(p, sol) ? sol : null;
}

// Forbidding the slivers can lose a lot when the wallet is small (a cell whose only bets were slivers is left
// bare): a bet is then better forced up to the minimum. A first solution comes from forcing every sliver of the
// vertex up, then the slivers are branched on one at a time, the biggest first (the cheapest to force), each forced
// up to the minimum and then forbidden, with the program solved again by the dense simplex, which takes the bets
// forced. A branch that cannot beat the best solution by more than WORTH is dropped. Returns the best solution
// without a sliver (`best` when nothing beats it), or null.
function branchSlivers(p: Problem, allowed: boolean[][], best: Solution | null, target: number): Solution | null {
  const local = allowed.map((row) => row.slice());
  const forced = allowed.map((row) => row.map(() => false));
  let nodes = 0;
  const bar = () => Math.max(target, best ? best.value : -Infinity, 1e-9) * (1 + WORTH);
  const dive = (sol: Solution) => {
    let sliver: [number, number] | null = null;
    for (const [b, j] of slivers(p, sol)) {
      if (!forced[b][j]) {
        sliver = [b, j];
        break;
      }
    }
    if (!sliver) {
      if (!best || sol.value > best.value) best = sol;
      return;
    }
    const [b, j] = sliver;
    for (const force of [true, false]) {
      if (nodes >= SLIVER_NODES) {
        p.inexact = true;
        return;
      }
      nodes++;
      if (force) forced[b][j] = true;
      else local[b][j] = false;
      const child = solveDense(p, local, forced);
      if (child && child.value > bar()) dive(child);
      if (force) forced[b][j] = false;
      else local[b][j] = true;
    }
  };
  nodes++;
  const root = solveDense(p, local, forced);
  if (!root || root.value <= bar()) return best;
  const first = forceSlivers(p, allowed, root);
  if (first && (!best || first.value > best.value)) best = first;
  if (root.value > bar()) dive(root);
  return best;
}

// The best solution in which every bet is at the minimum stake or more. The program as it stands, then (when it
// has slivers) the slivers forbidden, which is enough nearly always; the search above only when that costs more
// than WORTH. If it finds nothing, the program with its slivers (planOf leaves them out).
function solveWithMinStake(p: Problem, allowed: boolean[][], target = -Infinity): Solution | null {
  const root = solveLp(p, allowed, target);
  if (!root || !hasSliver(p, root)) return root;
  const banned = banSlivers(p, allowed, root, target);
  if (banned && banned.value >= root.value * (1 - WORTH)) return banned;
  return branchSlivers(p, allowed, banned, target) ?? root;
}

// A bookmaker that holds every cell, or -1. A cell is held from the smallest stake that is still a bet once
// rounded to the cent and checked against the minimum.
function holdsEverything(p: Problem, sol: Solution): number {
  const held = Math.max(p.minStake - 0.005, 1e-7);
  for (let b = 0; b < p.B; b++) {
    let cells = 0;
    for (let j = 0; j < p.J; j++) if (sol.x[b][j] >= held) cells++;
    if (cells === p.J) return b;
  }
  return -1;
}

// The best solution that obeys the coverage rule and beats `incumbent`, or null.
//
// "Bookmaker b does not hold every cell" means "b has no bet on at least one cell". When the solution breaks
// the rule at b, every way out is a cell where b is forbidden: each is tried, the one with the smallest stake
// first (the cheapest to give up), and a branch can never be worth more than its parent's program. A branch can
// break the rule at another bookmaker, which branches in turn: at most one level per bookmaker.
function withCoverage(p: Problem, allowed: boolean[][], depth: number, incumbent: number): Solution | null {
  if (p.lps > p.maxLps) {
    p.inexact = true;
    return null;
  }
  const sol = solveWithMinStake(p, allowed, incumbent + 1e-9);
  if (!sol || sol.value <= incumbent + 1e-9) return null;
  if (!p.coverage) return sol;
  const b = holdsEverything(p, sol);
  if (b < 0) return sol;
  if (depth >= p.B) return null;
  const cheapestFirst = Array.from({ length: p.J }, (_, j) => j).sort((i, j) => sol.x[b][i] - sol.x[b][j]);
  let best: Solution | null = null;
  let bar = incumbent;
  for (const j of cheapestFirst) {
    allowed[b][j] = false;
    const child = withCoverage(p, allowed, depth + 1, bar);
    allowed[b][j] = true;
    if (child && child.value > bar) {
      best = child;
      bar = child.value;
    }
    if (best && best.value >= sol.value - 1e-9) break; // as good as the parent: nothing better exists
  }
  return best;
}

// The column generation mixes several assignments, so a cell can be shared by many bookmakers and a stake can
// be a sliver. The same program solved by the simplex on the bets the solution kept returns a vertex (at most
// one extra bet per bookmaker); slivers under the minimum are forbidden until none is left. Null when that
// vertex cannot be reached. (The rule is checked again on the final bets, see solveCombo.)
function sliverFreeVertex(p: Problem, sol: Solution): Solution | null {
  const support = Array.from({ length: p.B }, (_, b) => Array.from({ length: p.J }, (_, j) => sol.x[b][j] > 1e-9));
  for (let round = 0; round < 25; round++) {
    const vertex = solveDense(p, support);
    if (!vertex) return null;
    let sliver = false;
    for (let b = 0; b < p.B; b++) {
      for (let j = 0; j < p.J; j++) {
        if (isSliver(p, vertex.x[b][j])) {
          support[b][j] = false;
          sliver = true;
        }
      }
    }
    if (!sliver) return vertex;
  }
  return null;
}

// The stakes on whole cents. A cent on a three-match bet moves a cell by several FB, so how the program's stakes are
// rounded decides how much of the guarantee is kept. They are rounded to the nearest cent, then moves of one cent
// raise the cell that guarantees the least: with a cent the bookmaker has left in its budget, or taken from another
// of its bets that can spare it. A move leaves every bet at the minimum stake or more and adds none (so the
// coverage rule is as the program left it).
function roundedStakes(p: Problem, sol: Solution): number[][] {
  const minCents = Math.max(Math.round(p.minStake * 100), 1);
  const cents = sol.x.map((row) => Array.from(row, (v) => Math.round(v * 100)));
  // A bookmaker over its budget (a stake rounded up) gives the excess back on its largest stake; the cents it has
  // left are `left`.
  const left = p.fb.map((f, b) => {
    const budget = f > 0 ? Math.floor(f * 100 + 1e-6) : 0;
    let spent = cents[b].reduce((s, v) => s + v, 0);
    while (spent > budget) {
      let largest = 0;
      for (let j = 1; j < p.J; j++) if (cents[b][j] > cents[b][largest]) largest = j;
      cents[b][largest]--;
      spent--;
    }
    return budget - spent;
  });
  const gain = new Float64Array(p.J);
  for (let b = 0; b < p.B; b++) for (let j = 0; j < p.J; j++) gain[j] += (cents[b][j] * p.a[b * p.J + j]) / 100;
  // Every move raises the smallest gain, so the loop ends; the cap is only a guard.
  for (let guard = 0; guard < 200; guard++) {
    let low = 0;
    for (let j = 1; j < p.J; j++) if (gain[j] < gain[low]) low = j;
    let move: { b: number; from: number; score: number } | null = null;
    for (let b = 0; b < p.B; b++) {
      if (cents[b][low] < minCents) continue;
      const up = gain[low] + p.a[b * p.J + low] / 100;
      if (left[b] > 0) {
        if (!move || up > move.score) move = { b, from: -1, score: up };
        continue;
      }
      for (let j = 0; j < p.J; j++) {
        if (j === low || cents[b][j] - 1 < minCents) continue;
        const score = Math.min(up, gain[j] - p.a[b * p.J + j] / 100);
        if (score > gain[low] + 1e-12 && (!move || score > move.score)) move = { b, from: j, score };
      }
    }
    if (!move) break;
    cents[move.b][low]++;
    gain[low] += p.a[move.b * p.J + low] / 100;
    if (move.from >= 0) {
      cents[move.b][move.from]--;
      gain[move.from] -= p.a[move.b * p.J + move.from] / 100;
    } else {
      left[move.b]--;
    }
  }
  return cents;
}

// The plan the stakes give, on whole cents: what the user will place, and what it guarantees.
function planOf(p: Problem, matches: readonly Match[], cells: number[][], sol: Solution): { plan: Plan; dropped: boolean } {
  const cents = roundedStakes(p, sol);
  // A bet under the minimum cannot be placed: left out, and the gain recomputed without it.
  const minCents = Math.round(p.minStake * 100);
  let dropped = false;
  for (let b = 0; b < p.B; b++) {
    for (let j = 0; j < p.J; j++) {
      if (cents[b][j] > 0 && cents[b][j] < minCents) {
        cents[b][j] = 0;
        dropped = true;
      }
    }
  }
  const bets: Bet[] = [];
  const payoff = new Array<number>(p.J).fill(0);
  const usedBy = new Array<number>(p.B).fill(0);
  for (let b = 0; b < p.B; b++) {
    for (let j = 0; j < p.J; j++) {
      const stake = cents[b][j] / 100;
      if (stake <= 0) continue;
      bets.push({ b, cellIndex: j, cell: cells[j], odds: p.C[b][j], stake });
      payoff[j] += stake * (p.C[b][j] - 1);
      usedBy[b] += stake;
    }
  }
  const cash = Math.min(...payoff);
  const used = usedBy.reduce((s, v) => s + v, 0);
  const plan: Plan = {
    matchIds: matches.map((match) => match.id),
    cash,
    used,
    rate: used > 0 ? cash / used : 0,
    bets,
    payoff,
    usedBy,
    value: sol.value,
    exact: true,
    lps: p.lps,
  };
  return { plan, dropped };
}

// Whether some bookmaker has a bet on every cell of the plan: the one thing the user has ruled out. solveCombo
// enforces the rule on the stakes of the program, then checks it here on the bets that will really be placed
// (rounded to the cent, slivers left out). Not once in thousands of random combos has this check turned a plan
// down; it is there so that a future change to the steps above can never let a plan that breaks the rule out.
export function holdsEveryCell(plan: Plan, cells: number): boolean {
  const held = new Map<number, Set<number>>();
  for (const bet of plan.bets) {
    if (!held.has(bet.b)) held.set(bet.b, new Set());
    held.get(bet.b)!.add(bet.cellIndex);
  }
  return [...held.values()].some((set) => set.size === cells);
}

// The best plan that converts the wallet `fb` (the FB of each bookmaker, by index) on this combo, or null when
// none can guarantee anything: a cell no bookmaker can bet, a single bookmaker able to bet them all, a wallet
// too small for the minimum stake, or (with `target`) a combo that provably cannot beat what the caller has.
export function solveCombo(matches: readonly Match[], fb: readonly number[], opts: ComboOptions = {}): Plan | null {
  if (matches.length < 1 || matches.length > MAX_MATCHES_PER_COMBO) {
    throw new RangeError(`a combo has 1 to ${MAX_MATCHES_PER_COMBO} matches, not ${matches.length}`);
  }
  if (!fb.every(Number.isFinite)) throw new RangeError("a bookmaker's freebets are not a finite number");
  for (const match of matches) {
    const problem = matchProblem(match, fb);
    if (problem) throw new RangeError(`the match ${match.id} cannot be used: ${problem}`);
  }
  // An option left undefined is the default, not a value.
  const given = Object.fromEntries(Object.entries(opts).filter(([, value]) => value !== undefined)) as ComboOptions;
  const settings = { minStake: 0.1, maxLps: 400, coverage: true, ...given };
  const cells = makeCells(matches);
  const p = problemOf(matches, cells, fb, settings);
  const allowed = Array.from({ length: p.B }, () => new Array<boolean>(p.J).fill(true));
  const first = withCoverage(p, allowed, 0, Math.max(1e-9, given.target ?? -Infinity));
  if (!first) return null;

  // The vertex (fewer bets) and the first solution as it stands: the vertex, unless the first gives the user
  // clearly more once rounded (forbidding the slivers can cost something).
  const candidates: Solution[] = [];
  const vertex = first.vertex ? null : sliverFreeVertex(p, first);
  if (vertex) candidates.push(vertex);
  candidates.push(first);
  let best: Plan | null = null;
  for (const candidate of candidates) {
    const { plan, dropped } = planOf(p, matches, cells, candidate);
    // The rule was enforced on the stakes before the rounding: checked again on the bets themselves.
    if (p.coverage && holdsEveryCell(plan, p.J)) continue;
    plan.exact = !p.inexact && !dropped;
    if (!best || plan.cash > best.cash * 1.0005) best = plan;
  }
  if (!best) return null;
  best.lps = p.lps;
  return best.cash >= MIN_CASH ? best : null;
}
