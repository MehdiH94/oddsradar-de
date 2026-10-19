import "dotenv/config";
import { openDb } from "../db/client";
import { runScrapeCycle } from "../scraper/run";
import { runMarketsCycle } from "../scraper/marketsRun";
import { runReferenceCycle } from "../reference/run";
import { runTennisReferenceCycle } from "../reference/tennisRun";
import { runFootballMarketsReferenceCycle } from "../reference/footballRun";
import { runSportsReferenceCycle } from "../reference/sportsRun";
import { runGolfReferenceCycle } from "../reference/golfRun";
import { runF1ReferenceCycle } from "../reference/f1Run";
import { REFERENCE_SPORTS } from "../reference/sports";
import { GEM_MIN_EDGE, runGemAlerts } from "../alerts/gems";
import { marketsMaxAgeForInterval, oddsMaxAgeForPollInterval } from "../db/repository";
import { startScheduler } from "./scheduler";
import { leovegasScraper } from "../scraper/kambi";
import { merkurbetsScraper } from "../scraper/merkurbets";
import { twentybetScraper } from "../scraper/twentybet";
import { admiralbetScraper } from "../scraper/admiralbet";
import { betathomeScraper } from "../scraper/betathome";
import { oddsetScraper } from "../scraper/oddset";
import { betwayScraper } from "../scraper/betway";
import { tipicoScraper, winamaxdeScraper } from "../scraper/oddsApi";

const dbPath = process.env.DB_PATH ?? "./data/coteradar.sqlite";
const intervalMinutes = Number(process.env.POLL_INTERVAL_MINUTES ?? "5");
// Every market of the matches starting within 48 h: a bigger job than the
// listing's main market, run less often (src/scraper/marketsRun.ts).
const marketsIntervalMinutes = Number(process.env.MARKETS_INTERVAL_MINUTES ?? "15");

const db = openDb(dbPath);
// The bookmakers: LeoVegas.de (Kambi), Merkur Bets, Admiralbet and
// bet-at-home.de (src/scraper/betathome.ts), German;
// 20bet (a Curaçao licence, src/scraper/twentybet.ts); Tipico and Winamax.de
// through The Odds API (src/scraper/oddsApi.ts, every 15 minutes).
const scrapers = [
  leovegasScraper,
  merkurbetsScraper,
  twentybetScraper,
  admiralbetScraper,
  betathomeScraper,
  oddsetScraper,
  betwayScraper,
  tipicoScraper,
  winamaxdeScraper,
];

console.log(`[worker] starting, polling every ${intervalMinutes} min, db=${dbPath}`);
startScheduler(intervalMinutes, () => runScrapeCycle(db, scrapers));
console.log(`[worker] every market of the next 48 h's football matches every ${marketsIntervalMinutes} min`);
startScheduler(marketsIntervalMinutes, () => runMarketsCycle(db));
// The reference's fair odds (an exchange's, src/reference/) for the same
// matches' 1X2 and players' markets, as often as the listing: they move with
// it. The players' are compared to the markets cycle's prices.
const listing = {
  oddsMaxAgeMs: oddsMaxAgeForPollInterval(intervalMinutes),
  marketsMaxAgeMs: marketsMaxAgeForInterval(marketsIntervalMinutes),
};
console.log(
  `[worker] reference fair odds of the next 48 h's football, tennis, ${REFERENCE_SPORTS.join(", ")} matches, and of the next 7 days' golf tournaments and Formula 1 races, every ${intervalMinutes} min`
);
// Then the gems those fair odds make, to Discord (src/alerts/gems.ts), even
// when the cycle failed: the bookmakers' prices may have moved anyway.
const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
console.log(
  webhookUrl
    ? `[worker] Discord alerts on, for the 1X2's value bets from ${GEM_MIN_EDGE.match * 100}% and the players' from ${GEM_MIN_EDGE.players * 100}%`
    : "[worker] Discord alerts off (no DISCORD_WEBHOOK_URL)"
);
startScheduler(intervalMinutes, async () => {
  try {
    await runReferenceCycle(db, listing);
  } catch (err) {
    console.error("[reference] cycle failed:", err);
  }
  try {
    // The main tours' tennis matches (src/reference/tennisRun.ts).
    await runTennisReferenceCycle(db, listing);
  } catch (err) {
    console.error("[reference:tennis] cycle failed:", err);
  }
  try {
    // The football matches' totals, handicaps, scores... (src/reference/footballRun.ts).
    await runFootballMarketsReferenceCycle(db, listing);
  } catch (err) {
    console.error("[reference:football] cycle failed:", err);
  }
  try {
    // The other head-to-head sports' main market (src/reference/sportsRun.ts).
    await runSportsReferenceCycle(db, listing);
  } catch (err) {
    console.error("[reference:sports] cycle failed:", err);
  }
  try {
    // The Formula 1 races starting within a week (src/reference/f1Run.ts).
    await runF1ReferenceCycle(db, listing);
  } catch (err) {
    console.error("[reference:f1] cycle failed:", err);
  }
  try {
    // The golf tournaments starting within a week (src/reference/golfRun.ts).
    await runGolfReferenceCycle(db, listing);
  } finally {
    await runGemAlerts(db, { webhookUrl, publicUrl: process.env.PUBLIC_URL, ...listing });
  }
});
