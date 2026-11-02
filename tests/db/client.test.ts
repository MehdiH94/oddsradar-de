import { describe, it, expect, afterEach } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { BUSY_TIMEOUT_MS, openDb } from "../../src/db/client";
import { openAuthDb } from "../../src/auth/db";

// Another process takes the write lock on a new database, says so, holds it
// for `holdMs`, then commits: what the web process does to the worker when a
// deploy restarts both at once.
function holdWriteLock(path: string, holdMs: number): Promise<ChildProcess> {
  const script = `
    const { DatabaseSync } = require("node:sqlite");
    const db = new DatabaseSync(process.argv[1]);
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("BEGIN IMMEDIATE");
    console.log("locked");
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Number(process.argv[2]));
    db.exec("COMMIT");
  `;
  const child = spawn(process.execPath, ["-e", script, path, String(holdMs)]);
  return new Promise((resolve, reject) => {
    child.stdout.once("data", () => resolve(child));
    child.once("error", reject);
    child.once("exit", (code) => reject(new Error(`lock holder exited early (${code})`)));
  });
}

describe("openDb", () => {
  let dir: string | undefined;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("waits for another process's lock instead of failing at startup", async () => {
    dir = mkdtempSync(join(tmpdir(), "coteradar-db-"));
    const path = join(dir, "coteradar.sqlite");
    const holder = await holdWriteLock(path, 300);

    const db = openDb(path);

    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all();
    expect(tables.map((t) => t.name)).toContain("events");
    db.close();
    holder.kill();
  });

  it("adds the columns a database made by an older version lacks", () => {
    dir = mkdtempSync(join(tmpdir(), "coteradar-db-"));
    const path = join(dir, "coteradar.sqlite");
    // The players' tables as first deployed (2 October 2026).
    const old = openDb(path);
    old.exec("DROP TABLE reference_player_stats; DROP TABLE reference_player_cycles;");
    old.exec(`CREATE TABLE reference_player_stats (event_id TEXT NOT NULL, market TEXT NOT NULL, runner TEXT NOT NULL,
      player TEXT, reads INTEGER NOT NULL, priced INTEGER NOT NULL, loose INTEGER NOT NULL, spread INTEGER NOT NULL,
      strict INTEGER NOT NULL, best_spread REAL, best_size REAL, matched REAL NOT NULL, first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL, first_strict_at TEXT, last_strict_at TEXT, PRIMARY KEY (event_id, market, runner))`);
    old.exec(`CREATE TABLE reference_player_cycles (at TEXT PRIMARY KEY, matches INTEGER NOT NULL, markets INTEGER NOT NULL,
      runners INTEGER NOT NULL, priced INTEGER NOT NULL, loose INTEGER NOT NULL, spread INTEGER NOT NULL,
      strict INTEGER NOT NULL, players INTEGER NOT NULL, value_bets INTEGER NOT NULL, strict_value_bets INTEGER NOT NULL)`);
    old.exec("INSERT INTO reference_player_cycles VALUES ('2026-10-02T07:00:00.000Z', 9, 24, 894, 210, 1, 0, 0, 814, 0, 0)");
    old.close();

    const db = openDb(path);
    const columns = (table: string) => (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
    expect(columns("reference_player_stats")).toContain("shown");
    expect(columns("reference_player_cycles")).toEqual(expect.arrayContaining(["shown", "lay_bets", "suspects"]));
    // Its rows kept, the new columns at 0.
    expect(db.prepare("SELECT runners, shown, lay_bets, suspects FROM reference_player_cycles").get()).toEqual({
      runners: 894,
      shown: 0,
      lay_bets: 0,
      suspects: 0,
    });
    // Opening it again changes nothing.
    db.close();
    expect(() => openDb(path).close()).not.toThrow();
  });
});

const pragma = (db: ReturnType<typeof openDb>, name: string) => Object.values(db.prepare(`PRAGMA ${name}`).get() as object)[0];

describe("openDb's settings", () => {
  it("syncs the disk at checkpoints for the odds, and at every commit for the accounts", () => {
    const odds = openDb(":memory:");
    const auth = openAuthDb(":memory:");
    // 1 is NORMAL, 2 is FULL.
    expect(pragma(odds, "synchronous")).toBe(1);
    expect(pragma(auth, "synchronous")).toBe(2);
  });
});

describe("event_market_odds", () => {
  it("is read by seeking a match's key, for some of its markets or for its list of markets", () => {
    const db = openDb(":memory:");
    const plan = (sql: string) =>
      (db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all() as { detail: string }[]).map((r) => r.detail).join(" ");
    expect(plan("SELECT bookmaker_id, price FROM event_market_odds WHERE event_id = 'e' AND market IN ('m') AND scraped_at >= 'x'")).toContain(
      "USING PRIMARY KEY (event_id=? AND market=?)"
    );
    expect(plan("SELECT DISTINCT event_id, market FROM event_market_odds WHERE event_id IN ('e') AND scraped_at >= 'x'")).toContain(
      "USING PRIMARY KEY (event_id=?)"
    );
    expect(plan("DELETE FROM event_market_odds WHERE event_id = 'e' AND bookmaker_id = 'b'")).toContain("USING PRIMARY KEY (event_id=?)");
  });

  it("is a single structure, without a second index", () => {
    const db = openDb(":memory:");
    const sql = (db.prepare("SELECT sql FROM sqlite_master WHERE name = 'event_market_odds'").get() as { sql: string }).sql;
    expect(sql).toContain("WITHOUT ROWID");
    const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'event_market_odds'").all();
    expect(indexes).toEqual([]);
  });
});

describe("the odds database's migrations", () => {
  let dir: string | undefined;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  // The database as the versions before the migrations made it: event_market_odds
  // with a row id, its unique key and an index on (event_id, market, scraped_at).
  function makeOldDb(path: string): void {
    const db = openDb(path);
    db.exec("DROP TABLE event_market_odds");
    db.exec(`CREATE TABLE event_market_odds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id TEXT NOT NULL REFERENCES events(id),
      bookmaker_id TEXT NOT NULL REFERENCES bookmakers(id),
      market TEXT NOT NULL,
      selection TEXT NOT NULL,
      price REAL NOT NULL,
      scraped_at TEXT NOT NULL,
      UNIQUE(event_id, bookmaker_id, market, selection))`);
    db.exec("CREATE INDEX event_market_odds_by_market ON event_market_odds(event_id, market, scraped_at)");
    db.exec("INSERT INTO bookmakers VALUES ('winamax', 'winamax'), ('betclic', 'betclic')");
    db.exec("INSERT INTO events VALUES ('e1', 'football', 'Ligue 1', '2026-10-20T18:00:00.000Z', '[\"PSG\",\"OM\"]')");
    db.exec(`INSERT INTO event_market_odds (event_id, bookmaker_id, market, selection, price, scraped_at) VALUES
      ('e1', 'winamax', 'btts', 'yes', 1.8, '2026-10-12T10:00:00.000Z'),
      ('e1', 'winamax', 'btts', 'no', 2.0, '2026-10-12T10:00:00.000Z'),
      ('e1', 'betclic', 'btts', 'yes', 1.85, '2026-10-12T10:05:00.000Z')`);
    db.exec("PRAGMA user_version = 0");
    db.close();
  }

  const odds = (db: ReturnType<typeof openDb>) =>
    db
      .prepare("SELECT event_id AS eventId, bookmaker_id AS bookmaker, market, selection, price, scraped_at AS scrapedAt FROM event_market_odds ORDER BY bookmaker_id, selection")
      .all();

  it("moves a database made before them to the one-structure table, keeping its prices", () => {
    dir = mkdtempSync(join(tmpdir(), "coteradar-db-"));
    const path = join(dir, "coteradar.sqlite");
    makeOldDb(path);

    const db = openDb(path);

    expect(odds(db)).toEqual([
      { eventId: "e1", bookmaker: "betclic", market: "btts", selection: "yes", price: 1.85, scrapedAt: "2026-10-12T10:05:00.000Z" },
      { eventId: "e1", bookmaker: "winamax", market: "btts", selection: "no", price: 2, scrapedAt: "2026-10-12T10:00:00.000Z" },
      { eventId: "e1", bookmaker: "winamax", market: "btts", selection: "yes", price: 1.8, scrapedAt: "2026-10-12T10:00:00.000Z" },
    ]);
    const names = (db.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'event_market_odds%'").all() as { name: string }[]).map((r) => r.name);
    expect(names).toEqual(["event_market_odds"]);
    const sql = (db.prepare("SELECT sql FROM sqlite_master WHERE name = 'event_market_odds'").get() as { sql: string }).sql;
    expect(sql).toContain("WITHOUT ROWID");
    expect(pragma(db, "user_version")).toBe(2);
    // The same upsert as the odds' writers keeps working on the new key.
    db.prepare(
      `INSERT INTO event_market_odds (event_id, bookmaker_id, market, selection, price, scraped_at)
       VALUES ('e1', 'winamax', 'btts', 'yes', 1.9, 'later')
       ON CONFLICT(event_id, bookmaker_id, market, selection) DO UPDATE SET price = excluded.price, scraped_at = excluded.scraped_at`
    ).run();
    expect(odds(db).filter((o) => o.bookmaker === "winamax" && o.selection === "yes")).toEqual([
      { eventId: "e1", bookmaker: "winamax", market: "btts", selection: "yes", price: 1.9, scrapedAt: "later" },
    ]);
    db.close();
  });

  it("is done once: opening the database again changes nothing", () => {
    dir = mkdtempSync(join(tmpdir(), "coteradar-db-"));
    const path = join(dir, "coteradar.sqlite");
    makeOldDb(path);
    openDb(path).close();

    const db = openDb(path);

    expect(odds(db)).toHaveLength(3);
    expect(pragma(db, "user_version")).toBe(2);
    db.close();
  });

  it("makes a new database at the latest version", () => {
    dir = mkdtempSync(join(tmpdir(), "coteradar-db-"));
    const db = openDb(join(dir, "coteradar.sqlite"));

    expect(pragma(db, "user_version")).toBe(2);
    expect(odds(db)).toEqual([]);
    // Each market price keeps its last move (src/db/repository.ts, saveMarketOdds).
    const columns = (db.prepare("PRAGMA table_info(event_market_odds)").all() as { name: string }[]).map((c) => c.name);
    expect(columns).toEqual(expect.arrayContaining(["prev_price", "moved_at"]));
    db.close();
  });

  it("waits for the process that holds the write lock instead of failing", async () => {
    dir = mkdtempSync(join(tmpdir(), "coteradar-db-"));
    const path = join(dir, "coteradar.sqlite");
    makeOldDb(path);
    // The migration waits for the lock like a statement does, only for longer
    // (MIGRATION_BUSY_TIMEOUT_MS), and is made once it is let go.
    const holder = await holdWriteLock(path, 300);

    const db = openDb(path);

    expect(pragma(db, "user_version")).toBe(2);
    expect(odds(db)).toHaveLength(3);
    // The wait for a statement is back to its usual length once migrated.
    expect(pragma(db, "busy_timeout")).toBe(BUSY_TIMEOUT_MS);
    db.close();
    holder.kill();
  });

  it("leaves a database as it was when a migration fails", () => {
    dir = mkdtempSync(join(tmpdir(), "coteradar-db-"));
    const path = join(dir, "coteradar.sqlite");
    makeOldDb(path);
    // A price for a match that does not exist (written with the foreign keys
    // off): the copy into the new table breaks its reference to events.
    const broken = new DatabaseSync(path);
    broken.exec("PRAGMA foreign_keys = OFF");
    broken.exec("INSERT INTO event_market_odds (event_id, bookmaker_id, market, selection, price, scraped_at) VALUES ('ghost', 'winamax', 'btts', 'yes', 1.5, 'x')");
    broken.close();

    expect(() => openDb(path)).toThrow();

    const check = new DatabaseSync(path);
    expect((check.prepare("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(0);
    expect((check.prepare("SELECT COUNT(*) AS n FROM event_market_odds").get() as { n: number }).n).toBe(4);
    expect(check.prepare("SELECT 1 FROM sqlite_master WHERE name = 'event_market_odds_old'").get()).toBeUndefined();
    check.close();
  });
});
