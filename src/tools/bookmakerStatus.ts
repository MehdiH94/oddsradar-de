import "dotenv/config";
import { openDb } from "../db/client";
import { formatBookmakerStatus, listBookmakerStatus } from "../db/bookmakerStatus";

// npm run bookmaker-status
// Each bookmaker's last read (src/db/bookmakerStatus.ts), as the admin page's
// "Bookmakers" tab shows it: run on the server, in the app's folder, the
// worker's database read as the worker reads it.
function main(): void {
  const db = openDb(process.env.DB_PATH ?? "./data/coteradar.sqlite");
  console.log(formatBookmakerStatus(listBookmakerStatus(db)));
  db.close();
}

main();
