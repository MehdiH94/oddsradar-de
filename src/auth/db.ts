import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

// The accounts live in their own file, apart from the odds (docs/db-audit.md):
// the odds are rebuilt by the worker every few minutes, the accounts cannot
// be. Only the web process opens it.
//
// Versioned migrations: MIGRATIONS[i] takes the schema from version i to
// i + 1, in a transaction, and PRAGMA user_version remembers where it is.
// Never edit one that has shipped: add the next.
const MIGRATIONS: string[] = [
  `
  CREATE TABLE users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL COLLATE NOCASE UNIQUE,
    email_verified_at TEXT,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    last_login_at TEXT
  );

  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    ip TEXT,
    user_agent TEXT
  );
  CREATE INDEX sessions_by_user ON sessions(user_id);

  CREATE TABLE auth_tokens (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (type IN ('verify_email', 'reset_password')),
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    used_at TEXT
  );
  CREATE INDEX auth_tokens_by_user ON auth_tokens(user_id, type);

  CREATE TABLE auth_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT,
    type TEXT NOT NULL,
    ip TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX auth_events_by_date ON auth_events(created_at);
  `,
  // The dashboard's filters and favorite sports, so that an account finds them
  // on every device (src/auth/preferences.ts). The JSON is validated before it
  // is stored.
  `
  CREATE TABLE user_preferences (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    data TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  `,
  // Whether the account pays for CoteRadar, shown on the administration page.
  // Nobody can subscribe yet: every account stays on 'none' until the payment
  // is wired in.
  `
  ALTER TABLE users ADD COLUMN subscription_status TEXT NOT NULL DEFAULT 'none' CHECK (subscription_status IN ('none', 'active'));
  `,
  // The freebets an account holds at each bookmaker (src/freebets/wallet.ts),
  // which the Freebets page turns into cash. Whole cents of freebet (1 FB is 1
  // euro), so that no float is stored; a bookmaker with nothing has no row. The
  // bookmaker is not checked here: the site's list is in the code, and adding a
  // bookmaker must not take a migration.
  `
  CREATE TABLE user_freebets (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    bookmaker TEXT NOT NULL,
    amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, bookmaker)
  );
  `,
  // What the beta's testers tell the team (src/auth/feedback.ts), read on the
  // administration page. It goes with the account; done_at is when an admin
  // marked it handled.
  `
  CREATE TABLE feedback (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    message TEXT NOT NULL,
    page TEXT,
    created_at TEXT NOT NULL,
    done_at TEXT
  );
  CREATE INDEX feedback_by_date ON feedback(created_at);
  `,
  // The surebets an account has taken (src/auth/takenSurebets.ts): shown as
  // such on every device, and, when asked, a reminder by email an hour before
  // kick-off to check the exchange's lay was matched. Forgotten two days after
  // the match.
  `
  CREATE TABLE user_taken_surebets (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    surebet_key TEXT NOT NULL,
    event_id TEXT NOT NULL,
    start_time TEXT NOT NULL,
    label TEXT NOT NULL,
    remind INTEGER NOT NULL DEFAULT 0 CHECK (remind IN (0, 1)),
    reminded_at TEXT,
    created_at TEXT NOT NULL,
    PRIMARY KEY (user_id, surebet_key)
  );
  CREATE INDEX user_taken_surebets_by_start ON user_taken_surebets(start_time);
  `,
  // The bookmakers' promotions (src/auth/promos.ts): those an account adds
  // itself (owner_id, its own only), and later those the site finds (no
  // owner, everyone's; source_key their reader's own id, to update in place).
  // Each account marks the ones it took.
  `
  CREATE TABLE promos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_id TEXT REFERENCES users(id) ON DELETE CASCADE,
    source TEXT NOT NULL CHECK (source IN ('manual', 'site', 'telegram', 'email')),
    source_key TEXT,
    bookmaker TEXT NOT NULL,
    title TEXT NOT NULL,
    details TEXT NOT NULL DEFAULT '',
    url TEXT,
    ends_at TEXT,
    found_at TEXT NOT NULL,
    UNIQUE (source, source_key)
  );
  CREATE INDEX promos_by_owner ON promos(owner_id);

  CREATE TABLE user_promo_taken (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    promo_id INTEGER NOT NULL REFERENCES promos(id) ON DELETE CASCADE,
    taken_at TEXT NOT NULL,
    PRIMARY KEY (user_id, promo_id)
  );
  `,
  // 8: the e-mail the day before a promo ends (src/auth/promoReminders.ts):
  // on unless the account turned it off, and each promo reminded once.
  `
  CREATE TABLE user_promo_settings (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    remind INTEGER NOT NULL CHECK (remind IN (0, 1))
  );

  CREATE TABLE user_promo_reminded (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    promo_id INTEGER NOT NULL REFERENCES promos(id) ON DELETE CASCADE,
    reminded_at TEXT NOT NULL,
    PRIMARY KEY (user_id, promo_id)
  );
  `,
  // 9: a taken surebet's payout when it was taken (1.024 for +2.4 %), shown in
  // "Meine Surebets" (web/src/MyTakenSurebets.tsx); null for those taken before.
  `
  ALTER TABLE user_taken_surebets ADD COLUMN payout_rate REAL;
  `,
];

export function migrate(db: DatabaseSync): void {
  const { user_version } = db.prepare("PRAGMA user_version").get() as { user_version: number };
  for (let version = user_version; version < MIGRATIONS.length; version++) {
    db.exec("BEGIN");
    try {
      db.exec(MIGRATIONS[version]);
      db.exec(`PRAGMA user_version = ${version + 1}`);
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }
}

export function openAuthDb(path: string): DatabaseSync {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  migrate(db);
  return db;
}
