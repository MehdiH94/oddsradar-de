import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The engine runs in a worker thread: it must not reach for the database, Express or any other part of the app.
// It may import its own files and Node's built-in modules, nothing else.
describe("the freebets engine", () => {
  const dir = join(__dirname, "../../../src/freebets/engine");
  const files = readdirSync(dir).filter((file) => file.endsWith(".ts"));

  it("has its files", () => {
    expect(files).toEqual(expect.arrayContaining(["types.ts", "simplex.ts", "columnGeneration.ts", "combo.ts", "bounds.ts", "funnel.ts", "exchange.ts"]));
  });

  it.each(files)("%s imports only the engine's own files and Node's modules", (file) => {
    const source = readFileSync(join(dir, file), "utf8");
    const specifiers = [...source.matchAll(/^\s*(?:import|export)\b[^;]*?\bfrom\s+["']([^"']+)["']/gms)].map((m) => m[1]);
    for (const specifier of specifiers) {
      const own = /^\.\/[A-Za-z0-9_]+$/.test(specifier);
      const builtin = specifier.startsWith("node:");
      expect(own || builtin, `${file} imports "${specifier}"`).toBe(true);
    }
    // No dynamic import or require either.
    expect(source).not.toMatch(/\brequire\(|\bimport\(/);
  });
});
