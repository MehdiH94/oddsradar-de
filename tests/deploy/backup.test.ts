import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

// deploy/backup-db.sh, run from a temporary "checkout" as the backup units
// run it from /opt/coteradar. The sqlite3 command line tool is replaced by a
// stand-in on PATH made of node:sqlite (the tool is not installed everywhere
// the tests run): `.backup 'file'` is a VACUUM INTO, any other argument is a
// query whose first column is printed.
const SCRIPT = resolve(__dirname, "../../deploy/backup-db.sh");
const FAKE_SQLITE3 = `#!/usr/bin/env node
const { DatabaseSync } = require("node:sqlite");
const [file, command] = process.argv.slice(2);
const db = new DatabaseSync(file);
const backup = /^\\.backup '(.*)'$/.exec(command);
if (backup) db.exec("VACUUM INTO '" + backup[1] + "'");
else for (const row of db.prepare(command).all()) console.log(Object.values(row)[0]);
`;

describe("deploy/backup-db.sh", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "coteradar-backup-"));
    mkdirSync(join(dir, "bin"));
    mkdirSync(join(dir, "data"));
    writeFileSync(join(dir, "bin", "sqlite3"), FAKE_SQLITE3);
    chmodSync(join(dir, "bin", "sqlite3"), 0o755);
    const db = new DatabaseSync(join(dir, "data", "auth.sqlite"));
    db.exec("CREATE TABLE users (email TEXT); INSERT INTO users VALUES ('a@example.com')");
    db.close();
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const backup = (...args: string[]) =>
    spawnSync("bash", [SCRIPT, ...args], { cwd: dir, encoding: "utf8", env: { ...process.env, PATH: `${join(dir, "bin")}:${process.env.PATH}` } });
  const copies = () => (existsSync(join(dir, "backups")) ? readdirSync(join(dir, "backups")).sort() : []);
  const age = (file: string, days: number) => {
    const t = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    utimesSync(join(dir, "backups", file), t, t);
  };

  it("makes a checked copy that holds the data", () => {
    const run = backup("data/auth.sqlite", "auth", "30");

    expect(run.status, run.stderr).toBe(0);
    const [file, ...others] = copies();
    expect(others).toEqual([]);
    expect(file).toMatch(/^auth-\d{4}-\d{2}-\d{2}-\d{4}\.sqlite$/);
    const copy = new DatabaseSync(join(dir, "backups", file));
    expect(copy.prepare("SELECT email FROM users").all()).toEqual([{ email: "a@example.com" }]);
    copy.close();
  });

  it("removes the copies older than the days kept, and only those of that name", () => {
    mkdirSync(join(dir, "backups"));
    for (const f of ["auth-2026-01-01-0000.sqlite", "auth-2026-09-30-0000.sqlite", "odds-2026-01-01-0000.sqlite"]) {
      writeFileSync(join(dir, "backups", f), "x");
    }
    age("auth-2026-01-01-0000.sqlite", 40);
    age("auth-2026-09-30-0000.sqlite", 5);
    age("odds-2026-01-01-0000.sqlite", 40);

    const run = backup("data/auth.sqlite", "auth", "30");

    expect(run.status, run.stderr).toBe(0);
    const left = copies();
    expect(left).not.toContain("auth-2026-01-01-0000.sqlite");
    expect(left).toContain("auth-2026-09-30-0000.sqlite");
    expect(left).toContain("odds-2026-01-01-0000.sqlite");
    expect(left.filter((f) => f.startsWith("auth-"))).toHaveLength(2);
  });

  it("fails on a copy that is not intact, keeps it aside and keeps the older copies", () => {
    mkdirSync(join(dir, "backups"));
    writeFileSync(join(dir, "backups", "auth-2026-01-01-0000.sqlite"), "x");
    age("auth-2026-01-01-0000.sqlite", 40);
    // The stand-in reports a damaged copy for any integrity check.
    writeFileSync(join(dir, "bin", "sqlite3"), FAKE_SQLITE3.replace('else for', 'else if (command.startsWith("PRAGMA integrity_check")) console.log("*** in database main ***"); else for'));

    const run = backup("data/auth.sqlite", "auth", "30");

    expect(run.status).toBe(1);
    expect(run.stderr).toContain("failed its integrity check");
    const left = copies();
    expect(left.some((f) => f.endsWith(".sqlite.corrupt"))).toBe(true);
    expect(left).toContain("auth-2026-01-01-0000.sqlite");
  });

  it("refuses a missing database or odd arguments", () => {
    expect(backup("data/missing.sqlite", "auth", "30").status).toBe(1);
    expect(backup("data/auth.sqlite", "../auth", "30").status).toBe(1);
    expect(backup("data/auth.sqlite", "auth", "many").status).toBe(1);
    expect(backup("data/auth.sqlite").status).not.toBe(0);
    expect(copies()).toEqual([]);
  });
});
