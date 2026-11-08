import "dotenv/config";
import { openDb } from "../db/client";
import { formatBookmakerStatus, listBookmakerStatus } from "../db/bookmakerStatus";
import { formatOddsApiCredits, oddsApiPace, readOddsApiCredits } from "../scraper/oddsApiCredits";
import { formatSundayReports } from "../alerts/weeklyReport";

// npm run bookmaker-status
// Each bookmaker's last read (src/db/bookmakerStatus.ts), as the admin page's
// "Bookmakers" tab shows it: run on the server, in the app's folder, the
// worker's database read as the worker reads it; then The Odds API's credits
// left, from the worker's cache file; and when the Sunday reports were last
// sent (src/alerts/weeklyReport.ts).
function main(): void {
  const db = openDb(process.env.DB_PATH ?? "./data/coteradar.sqlite");
  const credits = readOddsApiCredits();
  console.log(formatBookmakerStatus(listBookmakerStatus(db, Date.now(), oddsApiPace(credits))));
  console.log(formatOddsApiCredits(credits));
  console.log(formatSundayReports(db));
  db.close();
}

main();
