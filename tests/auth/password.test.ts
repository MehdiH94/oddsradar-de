import { describe, expect, it } from "vitest";
import { hashPassword, needsRehash, passwordProblem, verifyPassword } from "../../src/auth/password";
import { TEST_COST } from "./helpers";

describe("password hashing", () => {
  it("verifies the right password and only it, with a different salt each time", async () => {
    const a = await hashPassword("a long enough secret", TEST_COST);
    const b = await hashPassword("a long enough secret", TEST_COST);
    expect(a).not.toEqual(b);
    expect(await verifyPassword("a long enough secret", a)).toBe(true);
    expect(await verifyPassword("a long enough secreT", a)).toBe(false);
  });

  it("refuses a malformed or oversized stored hash instead of throwing", async () => {
    expect(await verifyPassword("x", "")).toBe(false);
    expect(await verifyPassword("x", "bcrypt$1$2$3$4$5")).toBe(false);
    expect(await verifyPassword("x", "scrypt$" + "9".repeat(600))).toBe(false);
  });

  it("asks for a new hash when the cost changed", async () => {
    const old = await hashPassword("a long enough secret", TEST_COST);
    expect(needsRehash(old, TEST_COST)).toBe(false);
    expect(needsRehash(old, { ...TEST_COST, N: TEST_COST.N * 2 })).toBe(true);
    expect(needsRehash("garbage")).toBe(true);
  });
});

describe("passwordProblem", () => {
  it("wants 12 to 128 characters and nothing about their kind", () => {
    expect(passwordProblem("short")).toMatch(/12/);
    expect(passwordProblem("x".repeat(129))).toMatch(/128/);
    expect(passwordProblem("only lowercase words here")).toBeNull();
  });

  it("refuses the obvious: common, repeated, or the email itself", () => {
    expect(passwordProblem("password1234")).toMatch(/zu leicht/);
    for (const german of ["Passwort1234", "qwertzuiop12", "Bayernmünchen", "oddsblitzer2026", "schalke04schalke"]) {
      expect(passwordProblem(german)).toMatch(/zu leicht/);
    }
    expect(passwordProblem("schalke04wintermantel")).toBeNull();
    expect(passwordProblem("aaaaaaaaaaaaaa")).toMatch(/zu leicht/);
    expect(passwordProblem("adalovelace2026!", "adalovelace@example.com")).toMatch(/zu leicht/);
  });
});
