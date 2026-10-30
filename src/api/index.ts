import "dotenv/config";
import { openDb } from "../db/client";
import { createServer } from "./server";
import { openAuthDb } from "../auth/db";
import { createAuthContext } from "../auth/context";
import { mailerFromEnv } from "../auth/mailer";
import { purgeExpired } from "../auth/store";
import { purgeTakenSurebets } from "../auth/takenSurebets";
import { purgePromos } from "../auth/promos";
import { runSurebetReminders } from "../auth/surebetReminders";
import { runPromoReminders } from "../auth/promoReminders";
import { refreshSitePromos } from "../promos/sitePromos";
import { runSitePromoAlerts } from "../alerts/sitePromos";
import { postNewPromos } from "../alerts/newPromos";
import { PROMO_READERS } from "../promos/readers";
import { recordPromoReads } from "../promos/status";
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
purgeTakenSurebets(authDb);
purgePromos(authDb);
setInterval(() => {
  purgeExpired(authDb);
  purgeTakenSurebets(authDb);
  purgePromos(authDb);
}, 60 * 60 * 1000).unref();
// The taken surebets' reminders, an hour before kick-off (src/auth/surebetReminders.ts).
setInterval(() => void runSurebetReminders(auth), 60 * 1000).unref();
// The promos' reminders, the day before they end (src/auth/promoReminders.ts).
setInterval(() => void runPromoReminders(auth), 10 * 60 * 1000).unref();
// The promotions the site reads on the bookmakers' pages (src/promos/): a
// minute after the start, then every hour.
// A reader failing for a day is told to the admins (src/alerts/sitePromos.ts),
// each promotion found for the first time to the testers (src/alerts/newPromos.ts).
const readSitePromos = async () => {
  const reads = await refreshSitePromos(authDb, PROMO_READERS, new Date());
  recordPromoReads(db, reads);
  await runSitePromoAlerts(db, reads, { webhookUrl: process.env.DISCORD_ADMIN_WEBHOOK_URL });
  await postNewPromos(reads, { webhookUrl: process.env.DISCORD_WEBHOOK_URL, publicUrl: auth.publicUrl });
};
setTimeout(() => void readSitePromos(), 60 * 1000).unref();
setInterval(() => void readSitePromos(), 60 * 60 * 1000).unref();

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
