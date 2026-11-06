import { DatabaseSync } from "node:sqlite";
import { BookmakerPace, BookmakerStatus, listBookmakerStatus, setDownAlerted } from "../db/bookmakerStatus";
import { oddsApiPace, readOddsApiCredits } from "../scraper/oddsApiCredits";
import { APP_NAME } from "../brand";
import { bookmakerName, DiscordMessage, post, Send } from "./gems";

// The admin alerts of the bookmakers' health, after each scraping cycle
// (src/worker/index.ts): a message when a bookmaker goes down (no match for
// DOWN_AFTER_MS, src/db/bookmakerStatus.ts), one when it comes back, each
// once. To the administrators' own channel (DISCORD_ADMIN_WEBHOOK_URL), never
// the alerts' one, which the users read.

export interface HealthAlertOptions {
  webhookUrl?: string;
  // The bookmakers read only so often (The Odds API's, paced): between two
  // reads they are paused, not down. Read from the worker's cache file when absent.
  pace?: BookmakerPace;
  now?: number;
  send?: Send;
  sleep?: (ms: number) => Promise<void>;
}

const minutesSince = (iso: string | null, now: number) => (iso ? Math.round((now - Date.parse(iso)) / 60_000) : null);

export function downMessage(status: BookmakerStatus, now: number): DiscordMessage {
  const since = minutesSince(status.lastGoodAt, now);
  const lines = [
    `⚠️ **${bookmakerName(status.bookmaker)}** gives no odds ${since === null ? "since the worker started" : `for ${since} min`}.`,
    status.lastError ? `Last error: ${status.lastError.slice(0, 300)}` : "Its last read gave no match.",
  ];
  return { username: APP_NAME, allowed_mentions: { parse: [] }, content: lines.join("\n") };
}

export function upMessage(status: BookmakerStatus): DiscordMessage {
  return { username: APP_NAME, allowed_mentions: { parse: [] }, content: `✅ **${bookmakerName(status.bookmaker)}** gives odds again (${status.lastEvents ?? 0} matches).` };
}

// Never throws: a failure is logged, and the alert is tried again next cycle.
export async function runHealthAlerts(db: DatabaseSync, opts: HealthAlertOptions): Promise<void> {
  const url = opts.webhookUrl?.trim();
  if (!url) return;
  const now = opts.now ?? Date.now();
  const send = opts.send ?? (fetch as unknown as Send);
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const pace = opts.pace ?? oddsApiPace(readOddsApiCredits());
  for (const status of listBookmakerStatus(db, now, pace)) {
    try {
      if (status.health === "down" && !status.downAlerted) {
        await post(send, url, downMessage(status, now), sleep);
        setDownAlerted(db, status.bookmaker, true);
      } else if (status.health === "ok" && status.downAlerted) {
        await post(send, url, upMessage(status), sleep);
        setDownAlerted(db, status.bookmaker, false);
      }
    } catch (err) {
      console.error(`[alerts:health] ${status.bookmaker}: could not send the alert:`, err);
    }
  }
}
