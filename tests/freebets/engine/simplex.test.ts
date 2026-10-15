import { describe, expect, it } from "vitest";
import { maximize } from "../../../src/freebets/engine/simplex";

const solve = (c: number[], rows: number[][], b: number[], maxPivots?: number) =>
  maximize(c.length, rows.length, c, rows.flat(), b, maxPivots);

describe("maximize", () => {
  it("solves a textbook program", () => {
    // Wyndor Glass: maximise 3x + 5y with x <= 4, 2y <= 12, 3x + 2y <= 18. The optimum is x = 2, y = 6.
    const res = solve([3, 5], [[1, 0], [0, 2], [3, 2]], [4, 12, 18]);
    expect(res.status).toBe("optimal");
    expect(res.value).toBeCloseTo(36, 9);
    expect(Array.from(res.x)).toEqual([expect.closeTo(2, 9), expect.closeTo(6, 9)]);
  });

  it("is at zero when nothing is worth taking", () => {
    const res = solve([-1, -2], [[1, 1]], [5]);
    expect(res.status).toBe("optimal");
    expect(res.value).toBe(0);
    expect(Array.from(res.x)).toEqual([0, 0]);
  });

  it("ends on the degenerate program that makes the textbook rule cycle (Beale's)", () => {
    // maximise 0.75a - 20b + 0.5c - 6d with
    //   0.25a - 8b - c + 9d <= 0,   0.5a - 12b - 0.5c + 3d <= 0,   c <= 1.
    // Both first rows have a zero right-hand side. The optimum is a = 1, c = 1: 1.25.
    const res = solve([0.75, -20, 0.5, -6], [[0.25, -8, -1, 9], [0.5, -12, -0.5, 3], [0, 0, 1, 0]], [0, 0, 1]);
    expect(res.status).toBe("optimal");
    expect(res.value).toBeCloseTo(1.25, 9);
    expect(Array.from(res.x)).toEqual([expect.closeTo(1, 9), 0, expect.closeTo(1, 9), 0]);
  });

  it("detects a program that is not bounded", () => {
    // maximise x + y with x - y <= 1: y can grow for ever.
    const res = solve([1, 1], [[1, -1]], [1]);
    expect(res.status).toBe("unbounded");
  });

  it("says so when it stops at the pivot limit", () => {
    const res = solve([3, 5], [[1, 0], [0, 2], [3, 2]], [4, 12, 18], 1);
    expect(res.status).toBe("iteration_limit");
  });

  it("refuses a negative right-hand side: the slack basis would not be feasible", () => {
    expect(() => solve([1], [[1]], [-1])).toThrow(RangeError);
  });
});
