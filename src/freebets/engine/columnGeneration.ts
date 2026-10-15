// The linear program of one combo, solved exactly by column generation.
//
// The program: stake x_bj FB at bookmaker b on cell j (a cell is one combination of outcomes of the combo's
// matches), so that every cell pays at least G whatever happens, without spending more than the budget F_b of
// any bookmaker, and as large a G as possible:
//     maximise G   subject to   sum_b a_bj x_bj >= G  (every cell j),   sum_j x_bj <= F_b  (every bookmaker b)
// where a_bj is the gain of one FB staked at b on j if j wins (the combined odds minus 1).
//
// At the optimum every bookmaker spends its whole budget and every cell pays exactly G, so the program is: buy
// G of gain on each cell, from whichever bookmaker, without breaking any budget. A "pattern" gives each cell to
// one bookmaker; run at weight w it pays w to every cell and costs w * W_b FB at bookmaker b, with W_b the sum
// of 1/a_bj over the cells it holds. So
//     maximise  sum_t w_t   subject to   sum_t w_t W_b(pattern t) <= F_b   (every bookmaker b)
// has one row per bookmaker (11 on 14/10/2026) where the program above has one per cell and per bookmaker (up to 38).
// There are too many patterns to list, but the dual prices of this small program say which one to add: the best
// pattern for prices lambda_b (what one FB at b is worth) gives each cell to the bookmaker with the lowest
// lambda_b / a_bj. The small program is solved by a revised simplex that keeps the inverse of its basis and
// takes in one pattern per round; when no pattern is worth taking in, the solution is optimal.
//
// Every round also gives a proven upper bound (the prices scaled so that no pattern costs less than 1 are a
// dual solution), which lets a caller drop a combo as soon as it provably cannot beat what it already has.

export interface ColumnsProblem {
  // a[b * stride + j]: the gain of one FB staked at bookmaker b on cell j when j wins; 0 when b cannot carry it.
  a: ArrayLike<number>;
  stride: number;
  bookmakers: number;
  cells: number;
  // The budget of each bookmaker, in FB. One with nothing to spend is ignored.
  budgets: ArrayLike<number>;
  // allowed[b][j] false forbids bookmaker b on cell j.
  allowed?: boolean[][] | null;
}

export interface ColumnsOptions {
  // Stop as soon as the upper bound is at most this: the program cannot beat it.
  target?: number;
  // The gain under which no pattern is worth taking in (the optimum is then reached to about this relative gap).
  tolerance?: number;
}

export interface ColumnsResult {
  // The G of the patterns taken in so far: a feasible solution, the optimum once converged.
  value: number;
  // A proven upper bound on the optimum, equal to value once converged.
  bound: number;
  // The stakes, x[b][j], in FB.
  x: Float64Array[];
  rounds: number;
  // True when the optimum was reached (False when stopped by `target` or by the rounds' limit).
  converged: boolean;
  // True when stopped because the bound fell to `target`.
  pruned: boolean;
}

const MAX_ROUNDS = 400;
const EPS = 1e-10;

// null when there is nothing to solve: a cell no bookmaker can carry (nothing can be guaranteed), or no
// bookmaker with a budget.
export function solveColumns(problem: ColumnsProblem, opts: ColumnsOptions = {}): ColumnsResult | null {
  const { a, stride, bookmakers: B, cells: J, budgets, allowed = null } = problem;
  const tolerance = opts.tolerance ?? 1e-9;
  const target = opts.target ?? -Infinity;

  // The bookmakers that can carry something are the rows of the small program.
  const rows: number[] = [];
  for (let b = 0; b < B; b++) {
    if (!(budgets[b] > 0)) continue;
    for (let j = 0; j < J; j++) {
      if (a[b * stride + j] > 0 && (!allowed || allowed[b][j])) {
        rows.push(b);
        break;
      }
    }
  }
  const R = rows.length;
  if (R === 0) return null;
  const rowOf = new Int32Array(B).fill(-1);
  rows.forEach((b, i) => (rowOf[b] = i));
  // Who can carry each cell, flattened: cell j is carried by the bookmakers at positions first[j] to first[j + 1] - 1,
  // in the order of the rows, with their row and their gain.
  const first = new Int32Array(J + 1);
  const carrier = new Int32Array(R * J);
  const carrierRow = new Int32Array(R * J);
  const carrierGain = new Float64Array(R * J);
  let carriers = 0;
  for (let j = 0; j < J; j++) {
    first[j] = carriers;
    for (const b of rows) {
      if (a[b * stride + j] > 0 && (!allowed || allowed[b][j])) {
        carrier[carriers] = b;
        carrierRow[carriers] = rowOf[b];
        carrierGain[carriers] = a[b * stride + j];
        carriers++;
      }
    }
    // A cell no bookmaker can carry: nothing can be guaranteed.
    if (carriers === first[j]) return null;
  }
  first[J] = carriers;

  // The patterns taken in so far (cell -> bookmaker). The basis holds slack variables (0..R-1) and patterns
  // (R + their index); binv is the inverse of the basis matrix and xB the values of the basic variables.
  const patterns: Int32Array[] = [];
  const basis = Array.from({ length: R }, (_, i) => i);
  const binv = new Float64Array(R * R);
  for (let i = 0; i < R; i++) binv[i * R + i] = 1;
  const budget = Float64Array.from(rows.map((b) => budgets[b]));
  const xB = Float64Array.from(budget);
  const cB = new Float64Array(R); // 1 for a pattern, 0 for a slack
  const price = new Float64Array(R); // the dual prices of the basis: what one more FB at each bookmaker is worth
  const positive = new Float64Array(R);
  const alpha = new Float64Array(R);

  // The pattern that is cheapest at the prices lam: each cell goes to the bookmaker with the lowest price per
  // unit of gain (a price can be zero or negative while the basis is not optimal). `w[row]` is the FB it costs at
  // that bookmaker per unit of weight, and `pattern[j]` the bookmaker the cell goes to when it is asked for.
  const w = new Float64Array(R);
  const choice = new Int32Array(J);
  const cheapest = (lam: Float64Array, pattern: Int32Array | null) => {
    w.fill(0);
    for (let j = 0; j < J; j++) {
      let best = -1;
      let bestPrice = Infinity;
      let bestGain = 0;
      for (let c = first[j]; c < first[j + 1]; c++) {
        const gain = carrierGain[c];
        const perGain = lam[carrierRow[c]] / gain;
        // A tie goes to the larger gain.
        if (perGain < bestPrice - 1e-15 || (Math.abs(perGain - bestPrice) <= 1e-15 && gain > bestGain)) {
          best = c;
          bestPrice = perGain;
          bestGain = gain;
        }
      }
      if (pattern) pattern[j] = carrier[best];
      w[carrierRow[best]] += 1 / bestGain;
    }
  };
  const costOf = (lam: Float64Array) => {
    let cost = 0;
    for (let i = 0; i < R; i++) cost += lam[i] * w[i];
    return cost;
  };

  // A proven upper bound: positive prices, divided by the cost of the cheapest pattern at those prices (so that
  // no pattern costs less than 1), are a dual solution; its value bounds the optimum.
  let bound = Infinity;
  const tighten = (lam: Float64Array) => {
    cheapest(lam, null);
    const cost = costOf(lam);
    if (cost <= 0) return;
    let worth = 0;
    for (let i = 0; i < R; i++) worth += lam[i] * budget[i];
    bound = Math.min(bound, worth / cost);
  };

  let pruned = false;
  let converged = false;
  let rounds = 0;
  for (; rounds < MAX_ROUNDS; rounds++) {
    // The prices of the current basis: price = cB binv (zero for the first, all-slack basis).
    for (let k = 0; k < R; k++) {
      let v = 0;
      for (let i = 0; i < R; i++) v += cB[i] * binv[i * R + k];
      price[k] = v;
    }
    // The bound is only worth its cost to a caller that has a target to fall under.
    if (target > -Infinity) {
      if (rounds === 0) {
        // Nothing is known yet: equal prices already give a bound (every cell to its best bookmaker).
        positive.fill(1);
        tighten(positive);
      } else {
        for (let k = 0; k < R; k++) positive[k] = Math.max(price[k], 0);
        tighten(positive);
      }
      if (bound <= target) {
        pruned = true;
        break;
      }
    }

    // What would improve the solution: a pattern that costs less than 1 at these prices, or a bookmaker whose
    // price is negative (staking less there would pay).
    cheapest(price, choice);
    const patternGain = 1 - costOf(price);
    let slack = -1;
    let slackGain = 0;
    for (let i = 0; i < R; i++) {
      if (-price[i] > slackGain) {
        slackGain = -price[i];
        slack = i;
      }
    }
    if (patternGain <= tolerance && slackGain <= tolerance) {
      converged = true;
      break;
    }

    // The entering column and its image in the current basis: alpha = binv * column.
    const takeSlack = slackGain > patternGain;
    for (let i = 0; i < R; i++) {
      if (takeSlack) {
        alpha[i] = binv[i * R + slack];
      } else {
        let v = 0;
        for (let k = 0; k < R; k++) v += binv[i * R + k] * w[k];
        alpha[i] = v;
      }
    }
    // The ratio test picks the variable that leaves.
    let leaving = -1;
    let smallest = Infinity;
    for (let i = 0; i < R; i++) {
      if (alpha[i] > EPS) {
        const ratio = xB[i] / alpha[i];
        if (ratio < smallest - 1e-12) {
          smallest = ratio;
          leaving = i;
        }
      }
    }
    // Cannot happen: every bookmaker's budget is finite.
    if (leaving < 0) return null;
    const pivot = alpha[leaving];
    for (let k = 0; k < R; k++) binv[leaving * R + k] /= pivot;
    xB[leaving] /= pivot;
    for (let i = 0; i < R; i++) {
      if (i === leaving) continue;
      const f = alpha[i];
      if (f === 0) continue;
      for (let k = 0; k < R; k++) binv[i * R + k] -= f * binv[leaving * R + k];
      xB[i] -= f * xB[leaving];
      if (xB[i] < 0 && xB[i] > -1e-12) xB[i] = 0;
    }
    if (takeSlack) {
      basis[leaving] = slack;
      cB[leaving] = 0;
    } else {
      patterns.push(choice.slice());
      basis[leaving] = R + patterns.length - 1;
      cB[leaving] = 1;
    }
  }

  if (bound === Infinity) {
    for (let k = 0; k < R; k++) positive[k] = Math.max(price[k], 0);
    tighten(positive);
  }

  // The stakes: a pattern at weight w buys w of gain on every cell, from the bookmaker it gave the cell to.
  const x = Array.from({ length: B }, () => new Float64Array(J));
  let value = 0;
  for (let i = 0; i < R; i++) {
    if (basis[i] < R) continue;
    const weight = xB[i];
    const pattern = patterns[basis[i] - R];
    value += weight;
    for (let j = 0; j < J; j++) {
      const b = pattern[j];
      x[b][j] += weight / a[b * stride + j];
    }
  }
  return { value, bound: Math.max(bound, value), x, rounds, converged, pruned };
}
