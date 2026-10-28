import { describe, expect, it } from "vitest";
import { passesControl } from "./value";

describe("passesControl", () => {
  it("lets every price through without Pinnacle's prices (the exchange's fair odds)", () => {
    expect(passesControl(9, "1", undefined)).toBe(true);
  });

  it("asks a 99% payout of the price with Pinnacle's on the other outcomes, as PasBet does", () => {
    // PasBet's example: 2.15 against Pinnacle's 1.90 makes 100.86%.
    expect(passesControl(2.15, "1", { "1": 2.05, "2": 1.9 })).toBe(true);
    // Against 1.50, 2.60 makes 95.1%.
    expect(passesControl(2.6, "1", { "1": 2.05, "2": 1.5 })).toBe(false);
  });
});
