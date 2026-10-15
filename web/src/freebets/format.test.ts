import { describe, expect, it } from "vitest";
import { amountText, formatEuro, formatFb, formatRate, MAX_FREEBET, parseAmount, readAt } from "./format";

describe("the amounts' formats", () => {
  it("writes freebets, euros and rates the French way, a figure and its unit held together", () => {
    expect(formatFb(14.1)).toBe("14,10");
    expect(formatFb(0)).toBe("0,00");
    expect(formatEuro(10.67)).toBe("10,67 €");
    expect(formatRate(0.7558)).toBe("75,6 %");
    expect(formatEuro(1234.5)).toBe("1234,50 €");
  });

  it("writes the time a price was read at, and a dash for none", () => {
    expect(readAt("2026-10-14T07:12:00.000Z")).toMatch(/^\d\d:\d\d$/);
    expect(readAt("")).toBe("—");
    expect(readAt("not a date")).toBe("—");
  });
});

describe("what a field holds", () => {
  it.each([
    ["12", 12],
    ["12,5", 12.5],
    ["12.5", 12.5],
    ["  7 ", 7],
    ["1 000", 1000],
    ["0,125", 0.13],
    [".5", 0.5],
    ["5.", 5],
    ["", 0],
    ["   ", 0],
    [String(MAX_FREEBET), MAX_FREEBET],
  ])("reads %j as %s FB", (text, amount) => {
    expect(parseAmount(text)).toBe(amount);
  });

  it.each(["abc", "-3", "1,2,3", "1e3", ".", "12 FB", String(MAX_FREEBET + 1), "99999999999"])("refuses %j", (text) => {
    expect(parseAmount(text)).toBeNull();
  });

  it("writes an amount back as a field shows it: a comma, nothing for none", () => {
    expect(amountText(12.5)).toBe("12,5");
    expect(amountText(30)).toBe("30");
    expect(amountText(undefined)).toBe("");
    expect(amountText(0)).toBe("");
  });
});
