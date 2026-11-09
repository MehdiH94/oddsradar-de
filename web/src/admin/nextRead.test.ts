import { describe, expect, it } from "vitest";
import { nextReadLabel } from "./nextRead";

describe("nextReadLabel", () => {
  it("says in minutes or hours when the next read is due", () => {
    const now = Date.parse("2026-11-09T07:00:00Z");
    expect(nextReadLabel("2026-11-09T16:00:00Z", now)).toBe("next read in about 9 h");
    expect(nextReadLabel("2026-11-09T07:40:00Z", now)).toBe("next read in about 40 min");
    expect(nextReadLabel("2026-11-09T06:00:00Z", now)).toBe("next read due now");
  });
});
