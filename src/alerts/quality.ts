import { DatabaseSync } from "node:sqlite";
import { ListingOptions } from "../db/repository";
import { EXCHANGE, getSuspectSurebets, SuspectSurebet } from "../db/surebets";
import { APP_NAME } from "../brand";
import { bookmakerName, DiscordMessage, matchUrl, post, Send } from "./gems";

// The data's own check, after each reference cycle (src/worker/index.ts): the
// surebets left out because a leg's price is out of line with the other
// sources' (src/db/surebets.ts, SUREBET_OUT_OF_LINE) are a swapped team, an
// old price or another match at one source, a bug to find before a user does.
// Each is told once to the administrators' channel (DISCORD_ADMIN_WEBHOOK_URL),
// never the users' one.

export interface QualityAlertOptions {
  webhookUrl?: string;
  publicUrl?: string;
  listing?: ListingOptions;
  now?: number;
  send?: Send;
  sleep?: (ms: number) => Promise<void>;
}

// At most this many messages a cycle: a source gone wrong at once would
// otherwise flood the channel.
export const MAX_QUALITY_ALERTS = 5;
// A suspect is told again after this long, if it is still there.
const FORGET_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

const sourceName = (source: string) => (source === EXCHANGE ? "the exchange" : bookmakerName(source));

// One suspect: its match, market and source's leg.
export const suspectKey = (s: SuspectSurebet) =>
  [s.eventId, s.market, s.suspect.leg.source, s.suspect.leg.side, s.suspect.leg.selection].join("|");

export function suspectMessage(s: SuspectSurebet, publicUrl?: string): DiscordMessage {
  const { leg, others } = s.suspect;
  const link = matchUrl(s.eventId, publicUrl);
  const lines = [
    `🔎 **Suspect price**, a surebet of ${(s.payoutRate * 100).toFixed(1)} % left out: ${s.participants.join(" - ")} (${s.competition || s.sport}), ${s.marketLabel}.`,
    `${sourceName(leg.source)} ${leg.side === "lay" ? "lays" : "pays"} ${leg.price.toFixed(2)} on ${leg.label}, the other sources ${others.toFixed(2)}: teams the other way round, an old price or another match?`,
    ...(link ? [link] : []),
  ];
  return { username: APP_NAME, allowed_mentions: { parse: [] }, content: lines.join("\n") };
}

// Never throws: a failure is logged, and the alert is tried again next cycle.
export async function runQualityAlerts(db: DatabaseSync, opts: QualityAlertOptions): Promise<void> {
  const url = opts.webhookUrl?.trim();
  if (!url) return;
  const now = opts.now ?? Date.now();
  const send = opts.send ?? (fetch as unknown as Send);
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let suspects: SuspectSurebet[];
  try {
    db.prepare("DELETE FROM quality_alerts WHERE sent_at < ?").run(new Date(now - FORGET_AFTER_MS).toISOString());
    suspects = getSuspectSurebets(db, opts.listing);
  } catch (err) {
    console.error("[alerts:quality] could not read the suspects:", err);
    return;
  }
  const told = db.prepare("SELECT 1 FROM quality_alerts WHERE key = ?");
  const fresh = [...new Map(suspects.map((s) => [suspectKey(s), s])).values()].filter((s) => !told.get(suspectKey(s)));
  for (const suspect of fresh.slice(0, MAX_QUALITY_ALERTS)) {
    try {
      await post(send, url, suspectMessage(suspect, opts.publicUrl), sleep);
      db.prepare("INSERT OR REPLACE INTO quality_alerts (key, sent_at) VALUES (?, ?)").run(suspectKey(suspect), new Date(now).toISOString());
    } catch (err) {
      console.error(`[alerts:quality] ${suspectKey(suspect)}: could not send the alert:`, err);
    }
  }
}
