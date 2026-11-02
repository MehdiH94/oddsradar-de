import { DatabaseSync } from "node:sqlite";
import { ListingOptions } from "../db/repository";
import { EXCHANGE, getSuspectSurebets, SurebetLeg, SuspectSurebet } from "../db/surebets";
import { APP_NAME } from "../brand";
import { bookmakerName, DISCORD_LIMITS, DiscordMessage, matchUrl, post, Send } from "./gems";

// The data's own check, after each reference cycle (src/worker/index.ts): the
// surebets left out because a leg's price is out of line with the other
// sources' (src/db/surebets.ts, SUREBET_OUT_OF_LINE) are a swapped team, an
// old price or another match at one source, a bug to find before a user does;
// or a real price, which the owner wants to bet (24/10/2026). Each is told once
// to the administrators' channel (DISCORD_ADMIN_WEBHOOK_URL), never the users'
// one, with its bets in full.

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

const euros = (amount: number) => `${amount.toFixed(2)} €`;

// One suspect, in full, so that the owner can check it and bet it if its price
// is a real one (24/10/2026): its match, kick-off and profit, each bet for
// 100 € with its stake and its bookmaker's page, then the price out of line.
// How long ago a leg's price was read: "read just now", "read 12 min ago",
// "read 3 h ago".
export function readAgo(readAt: string, now: number): string {
  const minutes = Math.max(0, Math.floor((now - Date.parse(readAt)) / 60_000));
  if (minutes < 1) return "read just now";
  if (minutes < 60) return `read ${minutes} min ago`;
  return `read ${Math.floor(minutes / 60)} h ago`;
}

// A leg's price that moved within the hour: "up from 2.40 12 min ago", "down
// from 2.80 3 min ago". A price that jumped just before the surebet appeared
// is the likeliest to be a mistake, or gone already.
export function movedLine(moved: { from: number; at: string }, price: number, now: number): string {
  const minutes = Math.max(0, Math.floor((now - Date.parse(moved.at)) / 60_000));
  return `${price > moved.from ? "up" : "down"} from ${moved.from.toFixed(2)} ${minutes < 1 ? "just now" : `${minutes} min ago`}`;
}

export function suspectMessage(s: SuspectSurebet, publicUrl?: string, now = Date.now()): DiscordMessage {
  const { leg, others } = s.suspect;
  const link = matchUrl(s.eventId, publicUrl);
  const kickOff = Math.floor(Date.parse(s.startTime) / 1000);
  const legLine = (l: SurebetLeg) => {
    const stake = l.side === "lay" && l.liability !== undefined ? `stake ${euros(l.stake)}, liability ${euros(l.liability)}` : `stake ${euros(l.stake)}`;
    const size = l.size !== undefined ? `, ${euros(l.size)} on the exchange` : "";
    const read = l.readAt ? `, ${readAgo(l.readAt, now)}` : "";
    const moved = l.moved ? `, ${movedLine(l.moved, l.price, now)}` : "";
    return `• ${l.side} ${l.label} @ ${sourceName(l.source)} ${l.price.toFixed(2)}: ${stake}${size}${read}${moved}${l.url ? ` · <${l.url}>` : ""}`;
  };
  const head = `🔎 **Suspect surebet, ${(s.payoutRate * 100).toFixed(1)} %** (+${euros(s.profit)} on 100 €): ${s.participants.join(" - ")} (${s.competition || s.sport}), ${s.marketLabel}, kick-off <t:${kickOff}:f> (<t:${kickOff}:R>).`;
  const tail = [
    `⚠️ ${sourceName(leg.source)} ${leg.side === "lay" ? "lays" : "pays"} ${leg.price.toFixed(2)} on ${leg.label}, the other sources ${others.toFixed(2)}: teams the other way round, an old price or another match? Check the price at the bookmaker before betting. Shown on the site, marked.`,
    ...(link ? [link] : []),
  ];
  // A race's many runners would go over Discord's limit: the first legs, then how many more.
  let shown = s.legs.length;
  const text = () =>
    [
      head,
      ...s.legs.slice(0, shown).map(legLine),
      ...(shown < s.legs.length ? [`• and ${s.legs.length - shown} more, on the site`] : []),
      ...tail,
    ].join("\n");
  while (shown > 0 && text().length > DISCORD_LIMITS.content) shown--;
  return { username: APP_NAME, allowed_mentions: { parse: [] }, content: text() };
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
      await post(send, url, suspectMessage(suspect, opts.publicUrl, now), sleep);
      db.prepare("INSERT OR REPLACE INTO quality_alerts (key, sent_at) VALUES (?, ?)").run(suspectKey(suspect), new Date(now).toISOString());
    } catch (err) {
      console.error(`[alerts:quality] ${suspectKey(suspect)}: could not send the alert:`, err);
    }
  }
}
