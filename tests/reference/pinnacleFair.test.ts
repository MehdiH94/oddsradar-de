import { describe, expect, it } from "vitest";
import { controlPayout, marginProportionalFair, payoutOf } from "../../src/reference/pinnacleFair";

describe("PasBet's fair odds", () => {
  it("gives PasBet's own example: 2.05 and 1.90, a 98.61% payout, 2.0801 on the first", () => {
    expect(payoutOf([2.05, 1.9])).toBeCloseTo(0.986076, 6);
    const [first, second] = marginProportionalFair([2.05, 1.9])!;
    expect(first).toBeCloseTo(2.0801, 4);
    // The chances add up to 100%.
    expect(1 / first + 1 / second).toBeCloseTo(1, 12);
    // Its control payout: 2.15 against 1.90, 100.86%.
    expect(controlPayout(2.15, [1.9])).toBeCloseTo(1.008642, 6);
  });

  it("takes more of the margin off a longshot than off a favourite, the chances still adding up to 100%", () => {
    const prices = [1.5, 4.2, 7];
    const fair = marginProportionalFair(prices)!;
    expect(fair.reduce((sum, odds) => sum + 1 / odds, 0)).toBeCloseTo(1, 12);
    // Each fair price above its own, the longshot's raised the most.
    const raised = fair.map((odds, i) => odds / prices[i] - 1);
    expect(raised[0]).toBeGreaterThan(0);
    expect(raised[2]).toBeGreaterThan(raised[1]);
    expect(raised[1]).toBeGreaterThan(raised[0]);
  });

  it("leaves a market without margin as it is", () => {
    const fair = marginProportionalFair([2, 2])!;
    expect(fair[0]).toBeCloseTo(2, 12);
    expect(fair[1]).toBeCloseTo(2, 12);
  });

  it("gives none for a price that is not one, or a margin too large for the longshot", () => {
    expect(marginProportionalFair([1, 3])).toBeNull();
    expect(marginProportionalFair([2.1])).toBeNull();
    expect(marginProportionalFair([1.01, 1.01, 50])).toBeNull();
  });
});
