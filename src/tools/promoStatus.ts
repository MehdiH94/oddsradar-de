import "dotenv/config";
import { DatabaseSync } from "node:sqlite";
import { PROMO_READERS } from "../promos/readers";
import { formatPromoReaderStatus, listPromoReaderStatus } from "../promos/status";

// npm run promo-status
// Each promo reader's state (src/promos/status.ts): run on the server, in the
// app's folder. Both databases are opened read-only: no migration, no write.
function main(): void {
  const authDb = new DatabaseSync(process.env.AUTH_DB_PATH ?? "./data/auth.sqlite", { readOnly: true });
  const oddsDb = new DatabaseSync(process.env.DB_PATH ?? "./data/coteradar.sqlite", { readOnly: true });
  console.log(formatPromoReaderStatus(listPromoReaderStatus(authDb, oddsDb, Object.keys(PROMO_READERS))));
  authDb.close();
  oddsDb.close();
}

main();
