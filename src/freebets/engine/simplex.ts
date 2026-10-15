// Dense primal simplex for: maximise c.x subject to A x <= b, x >= 0, with b >= 0.
//
// Every right-hand side is >= 0, so the slack basis (x = 0) is already feasible: no phase 1. The rule is
// Dantzig's (the most negative reduced cost) for speed; after a streak of degenerate pivots (the payoff
// constraints "gain of each cell >= G" have a zero right-hand side, so there are many), Bland's rule takes
// over until the objective moves again, which cannot cycle. It is used to turn the column generation's mixed
// solution into a vertex (src/freebets/engine/combo.ts) and, in the tests, as the reference for it.

export interface SimplexResult {
  status: "optimal" | "unbounded" | "iteration_limit";
  value: number;
  x: Float64Array;
  pivots: number;
}

const EPS = 1e-9;
// Degenerate pivots in a row before Bland's rule takes over.
const STALL_LIMIT = 30;

// A is row-major (m rows of n values).
export function maximize(
  n: number,
  m: number,
  c: ArrayLike<number>,
  A: ArrayLike<number>,
  b: ArrayLike<number>,
  maxPivots = 5000
): SimplexResult {
  for (let i = 0; i < m; i++) if (!(b[i] >= 0)) throw new RangeError("simplex: a right-hand side is negative");
  const W = n + m + 1;
  const T = new Float64Array((m + 1) * W);
  const basis = new Int32Array(m);
  for (let i = 0; i < m; i++) {
    const row = i * W;
    for (let j = 0; j < n; j++) T[row + j] = A[i * n + j];
    T[row + n + i] = 1;
    T[row + W - 1] = b[i];
    basis[i] = n + i;
  }
  const obj = m * W;
  for (let j = 0; j < n; j++) T[obj + j] = -c[j];

  const nz = new Int32Array(W);
  let pivots = 0;
  let stall = 0;
  while (pivots < maxPivots) {
    // Entering column.
    let e = -1;
    if (stall > STALL_LIMIT) {
      for (let j = 0; j < n + m; j++) {
        if (T[obj + j] < -EPS) {
          e = j;
          break;
        }
      }
    } else {
      let most = -EPS;
      for (let j = 0; j < n + m; j++) {
        if (T[obj + j] < most) {
          most = T[obj + j];
          e = j;
        }
      }
    }
    if (e < 0) break;

    // Leaving row: the smallest ratio, ties to the smallest basic variable (Bland).
    let r = -1;
    let best = Infinity;
    for (let i = 0; i < m; i++) {
      const a = T[i * W + e];
      if (a > EPS) {
        const ratio = T[i * W + W - 1] / a;
        if (ratio < best - 1e-12 || (Math.abs(ratio - best) <= 1e-12 && r >= 0 && basis[i] < basis[r])) {
          best = ratio;
          r = i;
        }
      }
    }
    if (r < 0) return { status: "unbounded", value: Infinity, x: new Float64Array(n), pivots };

    // Pivot on (r, e). The pivot row is sparse: only its non-zero columns are updated.
    const pr = r * W;
    const inv = 1 / T[pr + e];
    let count = 0;
    for (let j = 0; j < W; j++) {
      const v = T[pr + j];
      if (v !== 0) {
        T[pr + j] = v * inv;
        nz[count++] = j;
      }
    }
    T[pr + e] = 1;
    for (let i = 0; i <= m; i++) {
      if (i === r) continue;
      const row = i * W;
      const f = T[row + e];
      if (f === 0) continue;
      for (let q = 0; q < count; q++) {
        const j = nz[q];
        T[row + j] -= f * T[pr + j];
      }
      T[row + e] = 0;
    }
    basis[r] = e;
    pivots++;
    if (best < 1e-12) stall++;
    else stall = 0;
  }

  const x = new Float64Array(n);
  for (let i = 0; i < m; i++) if (basis[i] < n) x[basis[i]] = Math.max(0, T[i * W + W - 1]);
  return { status: pivots >= maxPivots ? "iteration_limit" : "optimal", value: T[obj + W - 1], x, pivots };
}
