import { describe, expect, it } from "vitest";
import { solveColumns } from "../../../src/freebets/engine/columnGeneration";
import { Match } from "../../../src/freebets/engine/types";
import { Rng, denseValue, gainsOf, rng } from "./helpers";

// A random program: 1 to 3 matches priced by 2 to 6 bookmakers (10 for the extreme ones, with prices up to 40 and
// wallets that are very uneven or tiny).
function randomProgram(r: Rng, extreme: boolean) {
  const size = r.int(1, 3);
  const B = r.int(2, extreme ? 10 : 6);
  const top = extreme ? [4, 9, 40][r.int(0, 2)] : 9;
  const matches: Match[] = Array.from({ length: size }, (_, i) => {
    const outcomes = r.next() < 0.6 ? 3 : 2;
    const odds = Array.from({ length: B }, () => (r.next() < 0.1 ? null : Array.from({ length: outcomes }, () => Math.round(r.range(1.05, top) * 100) / 100)));
    return { id: `m${i}`, outcomes, odds } as Match;
  });
  const mode = extreme ? r.int(0, 2) : 0;
  const fb = Array.from({ length: B }, (_, b) => (mode === 0 ? r.range(5, 60) : mode === 1 ? (b === 0 ? r.range(100, 1000) : r.range(0.5, 20)) : r.range(0.01, 3)));
  const { a, J } = gainsOf(matches, fb);
  return { a, B, J, fb };
}

const problem = ({ a, B, J, fb }: ReturnType<typeof randomProgram>, allowed: boolean[][] | null = null) => ({
  a,
  stride: J,
  bookmakers: B,
  cells: J,
  budgets: fb,
  allowed,
});

const relativeGap = (x: number, y: number) => Math.abs(x - y) / Math.max(1, Math.abs(y));

describe("solveColumns", () => {
  it("finds the same optimum as the simplex on every variable, 300 ordinary programs and 100 extreme ones", () => {
    const r = rng(2024);
    let solved = 0;
    for (let t = 0; t < 400; t++) {
      const program = randomProgram(r, t >= 300);
      const expected = denseValue(program.a, program.B, program.J, program.fb);
      const res = solveColumns(problem(program));
      if (expected === 0) {
        // Nothing can be guaranteed (a cell nobody can bet): nothing to solve.
        expect(res === null || res.value < 1e-9).toBe(true);
        continue;
      }
      solved++;
      expect(res).not.toBeNull();
      expect(res!.converged).toBe(true);
      expect(relativeGap(res!.value, expected)).toBeLessThan(1e-9);
    }
    expect(solved).toBeGreaterThan(300);
  });

  it("gives stakes that are a feasible solution: every cell pays the value, no budget is broken", () => {
    const r = rng(7);
    for (let t = 0; t < 100; t++) {
      const program = randomProgram(r, t % 2 === 1);
      const res = solveColumns(problem(program));
      if (!res) continue;
      for (let b = 0; b < program.B; b++) {
        const spent = res.x[b].reduce((s, v) => s + v, 0);
        expect(spent).toBeLessThanOrEqual(program.fb[b] + 1e-7);
        for (let j = 0; j < program.J; j++) if (program.a[b * program.J + j] === 0) expect(res.x[b][j]).toBe(0);
      }
      for (let j = 0; j < program.J; j++) {
        let paid = 0;
        for (let b = 0; b < program.B; b++) paid += program.a[b * program.J + j] * res.x[b][j];
        expect(paid).toBeGreaterThanOrEqual(res.value - 1e-6 * Math.max(1, res.value));
      }
    }
  });

  it("honours the bets it is told to leave out", () => {
    const r = rng(99);
    let compared = 0;
    for (let t = 0; t < 150; t++) {
      const program = randomProgram(r, t % 3 === 0);
      const allowed = Array.from({ length: program.B }, () => Array.from({ length: program.J }, () => r.next() > 0.2));
      const expected = denseValue(program.a, program.B, program.J, program.fb, allowed);
      const res = solveColumns(problem(program, allowed));
      if (expected === 0) {
        expect(res === null || res.value < 1e-9).toBe(true);
        continue;
      }
      compared++;
      expect(relativeGap(res!.value, expected)).toBeLessThan(1e-9);
      for (let b = 0; b < program.B; b++) for (let j = 0; j < program.J; j++) if (!allowed[b][j]) expect(res!.x[b][j]).toBe(0);
    }
    expect(compared).toBeGreaterThan(80);
  });

  it("converges tightly: the last pattern worth taking in can be worth less than 1e-7 of the optimum", () => {
    // Found by a run of 100 000 programs: with a tolerance of 1e-7 it stopped 3e-8 short here.
    const a = [367.795, 1411.5748, 47.8925, 186.2702, 131.8519, 511.6562, 93.77619999999999, 364.7276, 63.1818, 117.1788, 84.0884, 155.6744, 0, 0, 0, 0, 119.7488, 236.3632, 243.3773, 479.3872];
    const budgets = [2.688422178302426, 1.6128389582340608, 1.6482705498090946, 2.30205981742125, 0.06573319942923263];
    const allowed = [[true, true, true, true], [false, true, true, true], [true, true, true, true], [true, true, true, true], [true, true, true, true]];
    const expected = denseValue(a, 5, 4, budgets, allowed);
    const res = solveColumns({ a, stride: 4, bookmakers: 5, cells: 4, budgets, allowed })!;
    expect(res.converged).toBe(true);
    expect(relativeGap(res.value, expected)).toBeLessThan(1e-9);
  });

  it("has nothing to solve when a cell cannot be bet by anyone, or when nobody has anything to spend", () => {
    // Two matches: bookmaker 0 prices only the first, bookmaker 1 only the second: no bookmaker prices both.
    const matches: Match[] = [
      { id: "a", outcomes: 3, odds: [[2, 3, 4], null] },
      { id: "b", outcomes: 2, odds: [null, [1.9, 2.1]] },
    ];
    const { a, B, J } = gainsOf(matches, [10, 10]);
    expect(solveColumns({ a, stride: J, bookmakers: B, cells: J, budgets: [10, 10] })).toBeNull();

    const single: Match[] = [{ id: "a", outcomes: 2, odds: [[1.9, 2.1], [2, 2]] }];
    const g = gainsOf(single, [10, 10]);
    expect(solveColumns({ a: g.a, stride: g.J, bookmakers: g.B, cells: g.J, budgets: [0, 0] })).toBeNull();
    // A cell forbidden to everyone.
    expect(solveColumns({ a: g.a, stride: g.J, bookmakers: g.B, cells: g.J, budgets: [10, 10], allowed: [[false, true], [false, true]] })).toBeNull();
  });

  it("ignores a bookmaker with no budget, even one with the best prices", () => {
    const matches: Match[] = [{ id: "a", outcomes: 2, odds: [[9, 9], [2, 2], [2.1, 1.95]] }];
    const full = gainsOf(matches, [100, 20, 20]);
    const res = solveColumns({ a: full.a, stride: full.J, bookmakers: full.B, cells: full.J, budgets: [0, 20, 20] })!;
    expect(res.x[0].every((v) => v === 0)).toBe(true);
    const without = gainsOf(matches, [0, 20, 20]);
    expect(relativeGap(res.value, denseValue(without.a, without.B, without.J, [0, 20, 20]))).toBeLessThan(1e-9);
  });

  describe("the bound and the target", () => {
    it("keeps the value under the optimum and the bound over it, however early it stops", () => {
      const r = rng(31);
      for (let t = 0; t < 150; t++) {
        const program = randomProgram(r, t % 2 === 1);
        const expected = denseValue(program.a, program.B, program.J, program.fb);
        if (expected === 0) continue;
        for (const factor of [0.5, 0.9, 1.05, 1.3, 3]) {
          const res = solveColumns(problem(program), { target: expected * factor });
          if (!res) continue;
          expect(res.value).toBeLessThanOrEqual(expected * (1 + 1e-9));
          expect(res.bound).toBeGreaterThanOrEqual(expected * (1 - 1e-9));
          expect(res.pruned || res.converged).toBe(true);
        }
      }
    });

    it("gives up on a combo only when it provably cannot beat the target, and never gives up on one that can", () => {
      const r = rng(32);
      let pruned = 0;
      for (let t = 0; t < 150; t++) {
        const program = randomProgram(r, false);
        const expected = denseValue(program.a, program.B, program.J, program.fb);
        if (expected === 0) continue;
        // A target under the optimum can be beaten: the program runs to its optimum.
        const beatable = solveColumns(problem(program), { target: expected * 0.99 })!;
        expect(beatable.pruned).toBe(false);
        expect(relativeGap(beatable.value, expected)).toBeLessThan(1e-9);
        // A target over it cannot be: it may stop early, and then says so.
        const hopeless = solveColumns(problem(program), { target: expected * 1.2 })!;
        if (hopeless.pruned) pruned++;
        expect(hopeless.pruned || relativeGap(hopeless.value, expected) < 1e-9).toBe(true);
      }
      // It does stop early, which is what makes the funnel cheap.
      expect(pruned).toBeGreaterThan(30);
    });
  });
});
