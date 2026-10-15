import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS bookmakers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  sport TEXT NOT NULL,
  competition TEXT NOT NULL,
  start_time TEXT NOT NULL,
  participants TEXT NOT NULL
);

-- The listing reads the matches not started yet, soonest first. Events are
-- never deleted, so the table only grows.
CREATE INDEX IF NOT EXISTS events_by_start ON events(start_time);

CREATE TABLE IF NOT EXISTS event_bookmaker_odds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL REFERENCES events(id),
  bookmaker_id TEXT NOT NULL REFERENCES bookmakers(id),
  market TEXT NOT NULL,
  selection TEXT NOT NULL,
  price REAL NOT NULL,
  scraped_at TEXT NOT NULL,
  UNIQUE(event_id, bookmaker_id, market, selection)
);

-- Those of its markets whose bookmakers' best prices pay above 100%, found as
-- they are saved: the surebets (src/db/surebets.ts) read these markets'
-- prices only, not the million others'.
CREATE TABLE IF NOT EXISTS surebet_markets (
  event_id TEXT NOT NULL REFERENCES events(id),
  market TEXT NOT NULL,
  PRIMARY KEY (event_id, market)
);

-- Where each bookmaker lists an event: its own id there, and its own spelling
-- and order of the participants. The markets cycle (src/scraper/marketsRun.ts)
-- asks the bookmaker for the event's other markets by that id, and reads
-- which of their outcomes is which team from that order.
CREATE TABLE IF NOT EXISTS event_sources (
  event_id TEXT NOT NULL REFERENCES events(id),
  bookmaker_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  participants TEXT NOT NULL,
  seen_at TEXT NOT NULL,
  PRIMARY KEY (event_id, bookmaker_id)
);

-- The reference (src/reference/): an exchange's fair odds for a match's 1X2,
-- shown next to the bookmakers' prices but never one of them -- no best
-- price, no TRJ, never an event of its own. Where the exchange lists the
-- match: its Match Odds market, and which of its runners is "1", "X" and "2"
-- (JSON), found once by the reference cycle's search.
CREATE TABLE IF NOT EXISTS reference_sources (
  event_id TEXT PRIMARY KEY REFERENCES events(id),
  exchange_event_id TEXT NOT NULL,
  market_id TEXT NOT NULL,
  selections TEXT NOT NULL,
  participants TEXT,
  seen_at TEXT NOT NULL
);

-- Per outcome: the fair odds (the exchange's mid prices without their
-- margin), the best back and lay they come from, and the market's matched
-- volume.
CREATE TABLE IF NOT EXISTS reference_odds (
  event_id TEXT NOT NULL REFERENCES events(id),
  selection TEXT NOT NULL,
  fair REAL NOT NULL,
  back REAL NOT NULL,
  lay REAL NOT NULL,
  matched REAL NOT NULL,
  scraped_at TEXT NOT NULL,
  PRIMARY KEY (event_id, selection)
);

-- The reference for the main tours' tennis matches (src/reference/tennis.ts,
-- tennisRun.ts): where the exchange lists each one, whether it names the
-- players the other way round, and its markets there (JSON, TennisMarkets),
-- listed again every half hour.
CREATE TABLE IF NOT EXISTS reference_tennis_sources (
  event_id TEXT PRIMARY KEY REFERENCES events(id),
  exchange_event_id TEXT NOT NULL,
  reversed INTEGER NOT NULL,
  participants TEXT,
  markets TEXT,
  listed_at TEXT,
  seen_at TEXT NOT NULL
);

-- Their latest prices, by our market key ("total_games|22.5") and outcome,
-- with the fair odds of the markets reliable enough
-- (src/reference/tennis.ts, tennisPrices).
CREATE TABLE IF NOT EXISTS reference_markets (
  event_id TEXT NOT NULL REFERENCES events(id),
  market TEXT NOT NULL,
  selection TEXT NOT NULL,
  fair REAL,
  back REAL,
  lay REAL,
  back_size REAL,
  lay_size REAL,
  matched REAL NOT NULL,
  scraped_at TEXT NOT NULL,
  PRIMARY KEY (event_id, market, selection)
);

-- The exchange's players' markets of a match (src/reference/players.ts), by
-- our market key ("anytime_scorer"...): its market there, and its runners
-- (JSON, selection id -> the exchange's name). Read again every half hour:
-- the exchange adds them a day or two before kick-off.
CREATE TABLE IF NOT EXISTS reference_player_markets (
  event_id TEXT NOT NULL REFERENCES events(id),
  market TEXT NOT NULL,
  market_id TEXT NOT NULL,
  runners TEXT NOT NULL,
  seen_at TEXT NOT NULL,
  PRIMARY KEY (event_id, market)
);

-- Their latest prices, by runner (the exchange's name), with our player's
-- name when the runner is one of the bookmakers' players. "fair" (the mid
-- price) only when they are reliable enough to show (src/reference/exchange.ts,
-- playerReliability).
CREATE TABLE IF NOT EXISTS reference_player_odds (
  event_id TEXT NOT NULL REFERENCES events(id),
  market TEXT NOT NULL,
  runner TEXT NOT NULL,
  player TEXT,
  back REAL,
  lay REAL,
  back_size REAL,
  lay_size REAL,
  fair REAL,
  matched REAL NOT NULL,
  scraped_at TEXT NOT NULL,
  PRIMARY KEY (event_id, market, runner)
);

-- What the players' markets gave over time (src/db/playerStats.ts), kept
-- after kick-off, unlike the prices: how often each runner was priced, and
-- reliably so; every bookmaker price found above what a player is worth;
-- each cycle's totals.
CREATE TABLE IF NOT EXISTS reference_player_stats (
  event_id TEXT NOT NULL,
  market TEXT NOT NULL,
  runner TEXT NOT NULL,
  player TEXT,
  reads INTEGER NOT NULL,
  priced INTEGER NOT NULL,
  loose INTEGER NOT NULL,
  spread INTEGER NOT NULL,
  strict INTEGER NOT NULL,
  shown INTEGER NOT NULL DEFAULT 0,
  best_spread REAL,
  best_size REAL,
  matched REAL NOT NULL,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  first_strict_at TEXT,
  last_strict_at TEXT,
  PRIMARY KEY (event_id, market, runner)
);

-- Every bookmaker price found above what the exchange (or failing it, the
-- other bookmaker) says a player is worth (src/db/playerValue.ts), by way:
-- "fair", "lay" or "bookmaker". Counted from 1% (from 10% against a
-- bookmaker), so that the summary can count them at any threshold.
CREATE TABLE IF NOT EXISTS reference_player_signals (
  event_id TEXT NOT NULL,
  market TEXT NOT NULL,
  player TEXT NOT NULL,
  bookmaker TEXT NOT NULL,
  basis TEXT NOT NULL,
  cycles INTEGER NOT NULL,
  best_edge REAL NOT NULL,
  best_price REAL NOT NULL,
  best_reference REAL NOT NULL,
  reference_bookmaker TEXT,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  PRIMARY KEY (event_id, market, player, bookmaker, basis)
);

-- The Discord alerts (src/alerts/gems.ts, src/db/alerts.ts): every gem sent,
-- once per match, market and outcome (a surebet: per combination of bets),
-- the bookmaker being the first to have offered it, kept after kick-off; and
-- their state (a webhook or not, the one greeted, the last failure).
CREATE TABLE IF NOT EXISTS gem_alerts (
  event_id TEXT NOT NULL,
  market TEXT NOT NULL,
  selection TEXT NOT NULL,
  bookmaker TEXT NOT NULL,
  basis TEXT NOT NULL,
  price REAL NOT NULL,
  fair REAL NOT NULL,
  edge REAL NOT NULL,
  label TEXT NOT NULL,
  market_label TEXT NOT NULL,
  match_label TEXT NOT NULL,
  start_time TEXT NOT NULL,
  sent_at TEXT NOT NULL,
  PRIMARY KEY (event_id, market, selection, bookmaker)
);

CREATE TABLE IF NOT EXISTS alert_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reference_player_cycles (
  at TEXT PRIMARY KEY,
  matches INTEGER NOT NULL,
  markets INTEGER NOT NULL,
  runners INTEGER NOT NULL,
  priced INTEGER NOT NULL,
  loose INTEGER NOT NULL,
  spread INTEGER NOT NULL,
  strict INTEGER NOT NULL,
  players INTEGER NOT NULL,
  value_bets INTEGER NOT NULL,
  strict_value_bets INTEGER NOT NULL,
  shown INTEGER NOT NULL DEFAULT 0,
  lay_bets INTEGER NOT NULL DEFAULT 0,
  suspects INTEGER NOT NULL DEFAULT 0
);
`;

// How long a statement waits for another process's lock before failing with
// "database is locked". The worker and the web process share the file and a
// deploy restarts both at once: the first to open it replays the WAL the
// killed worker left, holding a lock the other one used to crash on.
export const BUSY_TIMEOUT_MS = 5000;

// Columns added to a table after it was first made: CREATE TABLE IF NOT
// EXISTS leaves an existing table as it is.
const ADDED_COLUMNS: [table: string, column: string, definition: string][] = [
  ["reference_player_stats", "shown", "INTEGER NOT NULL DEFAULT 0"],
  ["reference_player_cycles", "shown", "INTEGER NOT NULL DEFAULT 0"],
  ["reference_player_cycles", "lay_bets", "INTEGER NOT NULL DEFAULT 0"],
  ["reference_player_cycles", "suspects", "INTEGER NOT NULL DEFAULT 0"],
  // The money at a football 1X2's best back and lay, for the surebets
  // (src/db/surebets.ts).
  ["reference_odds", "back_size", "REAL"],
  ["reference_odds", "lay_size", "REAL"],
  // Our participants in the order a match's place on the exchange is
  // oriented on (src/db/reference.ts, orientedSource).
  ["reference_sources", "participants", "TEXT"],
  ["reference_tennis_sources", "participants", "TEXT"],
  // A football match's other markets on the exchange (JSON, src/reference/
  // football.ts), listed again every half hour.
  ["reference_sources", "markets", "TEXT"],
  ["reference_sources", "listed_at", "TEXT"],
];

function addMissingColumns(db: DatabaseSync): void {
  for (const [table, column, definition] of ADDED_COLUMNS) {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    if (!columns.some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

// The schema's changes that CREATE TABLE IF NOT EXISTS cannot make, in order:
// MIGRATIONS[i] takes the database from version i to i + 1, in a transaction,
// and PRAGMA user_version remembers where it is (like src/auth/db.ts). Never
// edit one that has shipped: add the next. A database made before the
// versions existed is at version 0, with SCHEMA's tables and ADDED_COLUMNS.
// Functions rather than SQL, so that a migration can look at what is there.
type Migration = (db: DatabaseSync) => void;

// Every other market of a match (src/scraper/marketsRun.ts), keyed by the
// catalog (src/markets/catalog.ts). Apart from the listing's main market
// (event_bookmaker_odds) so that the listing, sorted by TRJ over every match,
// never reads the thousands of prices a match's page shows.
//
// One structure, no row id and no second index: the key is the table. It puts
// the market right after the match, so that a match's prices in some markets
// (the value bets', the surebets') and its list of markets are a seek on the
// key's start, and a bookmaker's prices of a match are replaced by a delete
// and an insert on the same pages. The table was 70% of the file, three times
// over (rows, the unique key, an index on (event_id, market, scraped_at)).
const CREATE_MARKET_ODDS = `
CREATE TABLE event_market_odds (
  event_id TEXT NOT NULL REFERENCES events(id),
  market TEXT NOT NULL,
  bookmaker_id TEXT NOT NULL REFERENCES bookmakers(id),
  selection TEXT NOT NULL,
  price REAL NOT NULL,
  scraped_at TEXT NOT NULL,
  PRIMARY KEY (event_id, market, bookmaker_id, selection)
) WITHOUT ROWID
`;

const MIGRATIONS: Migration[] = [
  // event_market_odds in one structure (CREATE_MARKET_ODDS), its prices kept.
  (db) => {
    const made = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'event_market_odds'").get();
    if (made) db.exec("ALTER TABLE event_market_odds RENAME TO event_market_odds_old");
    db.exec(CREATE_MARKET_ODDS);
    if (!made) return;
    db.exec(`
      INSERT INTO event_market_odds (event_id, market, bookmaker_id, selection, price, scraped_at)
      SELECT event_id, market, bookmaker_id, selection, price, scraped_at FROM event_market_odds_old
      ORDER BY event_id, market, bookmaker_id, selection
    `);
    db.exec("DROP TABLE event_market_odds_old");
  },
];

// Copying the markets of a whole database takes seconds, and the worker and
// the web process both open it when a deploy restarts them: the second waits
// for the first, much longer than a statement does.
export const MIGRATION_BUSY_TIMEOUT_MS = 60_000;

const versionOf = (db: DatabaseSync) => (db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;

function migrate(db: DatabaseSync): void {
  if (versionOf(db) >= MIGRATIONS.length) return;
  db.exec(`PRAGMA busy_timeout = ${MIGRATION_BUSY_TIMEOUT_MS}`);
  try {
    for (;;) {
      // The write lock first, then the version: a process that waited for the
      // lock finds the migration done by the one that had it.
      db.exec("BEGIN IMMEDIATE");
      try {
        const version = versionOf(db);
        if (version >= MIGRATIONS.length) {
          db.exec("COMMIT");
          return;
        }
        MIGRATIONS[version](db);
        db.exec(`PRAGMA user_version = ${version + 1}`);
        db.exec("COMMIT");
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
    }
  } finally {
    db.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);
  }
}

// The WAL grows to this at most once it has been checkpointed, instead of
// keeping the size of its largest cycle.
const JOURNAL_SIZE_LIMIT_BYTES = 64 * 1024 * 1024;

export function openDb(path: string): DatabaseSync {
  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true });
  }
  const db = new DatabaseSync(path);
  // First, so that the statements below wait too.
  db.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);
  db.exec("PRAGMA journal_mode = WAL");
  // In WAL mode NORMAL syncs the disk at checkpoints rather than at every
  // commit: the file cannot be corrupted, but a power cut can lose the last
  // transactions. These prices are rebuilt by the next cycle; the accounts
  // (src/auth/db.ts) keep the default.
  db.exec("PRAGMA synchronous = NORMAL");
  db.exec(`PRAGMA journal_size_limit = ${JOURNAL_SIZE_LIMIT_BYTES}`);
  db.exec(SCHEMA);
  addMissingColumns(db);
  migrate(db);
  db.exec("PRAGMA optimize");
  return db;
}
