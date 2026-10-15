import "dotenv/config";
import { openDb } from "../db/client";
import { createServer } from "./server";
import { openAuthDb } from "../auth/db";
import { createAuthContext } from "../auth/context";
import { mailerFromEnv } from "../auth/mailer";
import { purgeExpired } from "../auth/store";
import { marketsMaxAgeForInterval, oddsMaxAgeForPollInterval } from "../db/repository";
import { createWorkerPool } from "../freebets/pool";

const dbPath = process.env.DB_PATH ?? "./data/coteradar.sqlite";
const port = Number(process.env.PORT ?? "3000");
// The worker's scrape interval: odds it hasn't refreshed for a few cycles are
// considered withdrawn by the bookmaker (see oddsMaxAgeForPollInterval).
const oddsMaxAgeMs = oddsMaxAgeForPollInterval(Number(process.env.POLL_INTERVAL_MINUTES ?? "5"));
// Same for the markets cycle's prices, every market of a match but its main one.
const marketsMaxAgeMs = marketsMaxAgeForInterval(Number(process.env.MARKETS_INTERVAL_MINUTES ?? "15"));

// How long the value bets page's answer is reused: it reads every upcoming
// match's prices, and only changes with the worker's cycles.
const valueBetsCacheMs = Number(process.env.VALUE_BETS_CACHE_SECONDS ?? "30") * 1000;

// The same for the Freebets page: the matches it converts, and each account's answer.
const freebetsCacheMs = Number(process.env.FREEBETS_CACHE_SECONDS ?? "30") * 1000;

const db = openDb(dbPath);

// The accounts: their own file (docs/db-audit.md).
const authDbPath = process.env.AUTH_DB_PATH ?? "./data/auth.sqlite";
const authDb = openAuthDb(authDbPath);
const auth = createAuthContext({
  db: authDb,
  mailer: mailerFromEnv(),
  publicUrl: process.env.PUBLIC_URL ?? `http://localhost:${port}`,
});
// Forget what has expired now, then every hour.
purgeExpired(authDb);
setInterval(() => purgeExpired(authDb), 60 * 60 * 1000).unref();

const trustProxy = Number(process.env.TRUST_PROXY ?? "0");
const app = createServer(
  db,
  { oddsMaxAgeMs, marketsMaxAgeMs },
  {
    valueBetsCacheMs: Number.isFinite(valueBetsCacheMs) ? valueBetsCacheMs : 0,
    auth,
    trustProxy: Number.isInteger(trustProxy) ? trustProxy : 0,
    // The calculations of the Freebets page run in a worker thread, so that a long one never holds up the site.
    freebetsPool: createWorkerPool(),
    freebetsCacheMs: Number.isFinite(freebetsCacheMs) ? freebetsCacheMs : 0,
  }
);
const onListening = () => console.log(`[api] listening on port ${port}, db=${dbPath}, auth=${authDbPath}`);
// HOST=127.0.0.1 behind a reverse proxy, so that only it reaches the process.
if (process.env.HOST) app.listen(port, process.env.HOST, onListening);
else app.listen(port, onListening);
