import { DatabaseSync } from "node:sqlite";
import { getAlertState, setAlertState } from "../db/alerts";
import { APP_NAME } from "../brand";
import { SitePromoRead } from "../promos/sitePromos";
import { DiscordMessage, post, Send } from "./gems";

// The admin alert of the promotions the site reads itself (src/promos/),
// after each hourly read (src/api/index.ts): a message when a bookmaker's
// read has failed, or found nothing, for SITE_PROMOS_DOWN_AFTER_MS, with its
// last error, and one when it reads again, each once. Its reader can break
// unseen: 20bet's mirror renamed, a page changed. Each bookmaker's state is
// kept in the odds database's alert state, so that a restart (every deploy)
// does not start its 24 hours over. To the administrators' channel
// (DISCORD_ADMIN_WEBHOOK_URL), like the exchange's alert.

// A day: a page down for an hour or a night is no news.
export const SITE_PROMOS_DOWN_AFTER_MS = 24 * 60 * 60 * 1000;
const STATE_KEY = (bookmaker: string) => `site_promos_down:${bookmaker}`;

export interface ReaderState {
  failingSince: number;
  lastError?: string;
  alerted?: true;
}

export interface SitePromoAlertOptions {
  webhookUrl?: string;
  now?: number;
  send?: Send;
  sleep?: (ms: number) => Promise<void>;
}

export function sitePromosDownMessage(bookmaker: string, state: ReaderState, now: number): DiscordMessage {
  const hours = Math.round((now - state.failingSince) / 3_600_000);
  return {
    username: APP_NAME,
    allowed_mentions: { parse: [] },
    content: [
      `⚠️ **${bookmaker}'s promotions** have not been read for ${hours} h: the Promos page keeps their last ones.`,
      `Last error: ${state.lastError ?? "unknown"}`,
      `Its reader is src/promos/${bookmaker}.ts; \`vps-report promo-network\` shows what its page reads now.`,
    ].join("\n"),
  };
}

export function sitePromosUpMessage(bookmaker: string): DiscordMessage {
  return { username: APP_NAME, allowed_mentions: { parse: [] }, content: `✅ **${bookmaker}'s promotions** are read again.` };
}

// Also read by `npm run promo-status` (src/promos/status.ts).
export function readState(db: DatabaseSync, bookmaker: string): ReaderState | undefined {
  const value = getAlertState(db, STATE_KEY(bookmaker));
  try {
    return value ? (JSON.parse(value) as ReaderState) : undefined;
  } catch {
    return undefined;
  }
}

// Never throws: a failure is logged, and the alert is tried again next read.
export async function runSitePromoAlerts(db: DatabaseSync, reads: readonly SitePromoRead[], opts: SitePromoAlertOptions): Promise<void> {
  const url = opts.webhookUrl?.trim();
  const now = opts.now ?? Date.now();
  const send = opts.send ?? (fetch as unknown as Send);
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  for (const read of reads) {
    try {
      const state = readState(db, read.bookmaker);
      if (read.ok) {
        if (state?.alerted && url) await post(send, url, sitePromosUpMessage(read.bookmaker), sleep);
        if (state) setAlertState(db, STATE_KEY(read.bookmaker), undefined);
        continue;
      }
      const failing: ReaderState = { ...state, failingSince: state?.failingSince ?? now, lastError: read.error };
      if (url && !failing.alerted && now - failing.failingSince >= SITE_PROMOS_DOWN_AFTER_MS) {
        await post(send, url, sitePromosDownMessage(read.bookmaker, failing, now), sleep);
        failing.alerted = true;
      }
      setAlertState(db, STATE_KEY(read.bookmaker), JSON.stringify(failing));
    } catch (err) {
      console.error(`[alerts:site-promos] ${read.bookmaker}: could not send the alert:`, err);
    }
  }
}
