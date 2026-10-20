import { describe, expect, it } from "vitest";
import { dayHeading, formatEdge, formatPayoutRate, formatPercent, formatPrice, formatStartParts, formatStartTime } from "./format";

// Local times, as the viewer's clock reads them: Sunday 4 October 2026.
const NOW = new Date(2026, 9, 4, 12, 0);
const at = (day: number, hour: number, minute = 0) => new Date(2026, 9, day, hour, minute).toISOString();

describe("German number formats", () => {
  it("writes a price with a decimal comma and two decimals", () => {
    expect(formatPrice(2.15)).toBe("2,15");
    expect(formatPrice(3)).toBe("3,00");
    expect(formatPrice(1001)).toBe("1001,00");
  });

  it("writes an edge with its sign, a decimal comma and a no-break space before %", () => {
    expect(formatEdge(0.021)).toBe("+2,1 %");
    expect(formatEdge(-0.05)).toBe("−5,0 %");
  });

  it("writes a threshold as a whole percentage", () => {
    expect(formatPercent(0.05)).toBe("5 %");
    expect(formatPercent(0.01)).toBe("1 %");
  });

  it("writes a payout rate with one decimal, or a dash when there is none", () => {
    expect(formatPayoutRate(0.974)).toBe("97,4 %");
    expect(formatPayoutRate(1.019)).toBe("101,9 %");
    expect(formatPayoutRate(null)).toBe("-");
    expect(formatPayoutRate(undefined)).toBe("-");
  });
});

describe("German start times", () => {
  it("shows today's hour alone, tomorrow's after Morgen, the others' date", () => {
    expect(formatStartTime(at(4, 21), NOW)).toBe("21:00");
    expect(formatStartTime(at(5, 18, 30), NOW)).toBe("Morgen 18:30");
    expect(formatStartTime(at(10, 15), NOW)).toBe("Sa., 10.10., 15:00");
    expect(formatStartTime("not a date", NOW)).toBe("-");
  });

  it("splits a start for a two-line cell", () => {
    expect(formatStartParts(at(4, 21), NOW)).toEqual({ time: "21:00", day: "Heute" });
    expect(formatStartParts(at(5, 9), NOW)).toEqual({ time: "09:00", day: "Morgen" });
    expect(formatStartParts(at(12, 20, 45), NOW)).toEqual({ time: "20:45", day: "Mo., 12.10." });
    expect(formatStartParts("not a date", NOW)).toBeNull();
  });

  it("heads each day of matches", () => {
    expect(dayHeading(at(4, 21), NOW)?.label).toBe("Heute");
    expect(dayHeading(at(5, 21), NOW)?.label).toBe("Morgen");
    expect(dayHeading(at(10, 21), NOW)?.label).toBe("Samstag, 10. Oktober");
    expect(dayHeading(at(10, 9), NOW)?.key).toBe(dayHeading(at(10, 22), NOW)?.key);
  });
});
