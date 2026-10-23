import "dotenv/config";
import { openDb } from "../db/client";
import { oddsMaxAgeForPollInterval } from "../db/repository";
import { currentSurebetReadGaps, formatSurebetReport, sentSurebetsByPair } from "../db/surebetReport";

// npm run surebet-report -- [days]
// Which sources the surebets come from, and how far apart their legs were
// read (src/db/surebetReport.ts): run on the server, in the app's folder, the
// worker's database read as the worker reads it. 7 days of alerts by default.
function main(): void {
  const days = Number(process.argv[2] ?? "7");
  if (!Number.isFinite(days) || days <= 0) {
    console.error("usage: npm run surebet-report -- [days]");
    process.exit(1);
  }
  const db = openDb(process.env.DB_PATH ?? "./data/coteradar.sqlite");
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const listing = { oddsMaxAgeMs: oddsMaxAgeForPollInterval(Number(process.env.POLL_INTERVAL_MINUTES ?? "5")) };
  console.log(formatSurebetReport(sentSurebetsByPair(db, since), currentSurebetReadGaps(db, listing), since));
  db.close();
}

main();
