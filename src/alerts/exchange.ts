import { DatabaseSync } from "node:sqlite";
import { getAlertState, setAlertState } from "../db/alerts";
import { APP_NAME } from "../brand";
import { exchangeReachability, ExchangeReachability } from "../reference/exchangeProxy";
import { DiscordMessage, post, Send } from "./gems";

// The admin alert of the exchange's reach, after each reference cycle
// (src/worker/index.ts): a message when every request to the exchange has
// failed for EXCHANGE_DOWN_AFTER_MS, with the fix, and one when it answers
// again, each once. On 25/10/2026 its way out of Germany (deploy/
// exchange-vpn.sh) stopped resolving names, and no reference price, value bet
// or lay was found for hours without anyone knowing. To the administrators'
// channel (DISCORD_ADMIN_WEBHOOK_URL), like the bookmakers' health.

// Three reference cycles of 5 minutes: one cycle's failure is not an outage.
export const EXCHANGE_DOWN_AFTER_MS = 15 * 60 * 1000;
const STATE_KEY = "exchange_down_alerted";

export interface ExchangeAlertOptions {
  webhookUrl?: string;
  now?: number;
  reachability?: ExchangeReachability;
  send?: Send;
  sleep?: (ms: number) => Promise<void>;
}

export function exchangeDownMessage(reach: ExchangeReachability, now: number): DiscordMessage {
  const minutes = Math.round((now - reach.failingSince!) / 60_000);
  const lines = [
    `⚠️ **The exchange (Piwi) is unreachable** for ${minutes} min: no reference price, value bet or lay until it answers again.`,
    `Last error: ${reach.lastError ?? "unknown"}`,
    "On the VPS: `sudo systemctl restart oddsradar-exchange-vpn oddsradar-exchange-proxy`, then `sudo /usr/local/sbin/oddsradar-exchange-vpn check` (an exit IP and HTTP 200 expected). If the tunnel shows no exit IP, its WireGuard configuration is to be renewed (README, deploy/exchange-vpn.sh).",
  ];
  return { username: APP_NAME, allowed_mentions: { parse: [] }, content: lines.join("\n") };
}

export function exchangeUpMessage(): DiscordMessage {
  return { username: APP_NAME, allowed_mentions: { parse: [] }, content: "✅ **The exchange (Piwi)** answers again." };
}

// Never throws: a failure is logged, and the alert is tried again next cycle.
export async function runExchangeAlerts(db: DatabaseSync, opts: ExchangeAlertOptions): Promise<void> {
  const url = opts.webhookUrl?.trim();
  if (!url) return;
  const now = opts.now ?? Date.now();
  const reach = opts.reachability ?? exchangeReachability();
  const send = opts.send ?? (fetch as unknown as Send);
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  try {
    const alerted = getAlertState(db, STATE_KEY) === "1";
    const down = reach.failingSince !== undefined && now - reach.failingSince >= EXCHANGE_DOWN_AFTER_MS;
    if (down && !alerted) {
      await post(send, url, exchangeDownMessage(reach, now), sleep);
      setAlertState(db, STATE_KEY, "1");
    } else if (alerted && reach.failingSince === undefined && reach.lastOkAt !== undefined) {
      await post(send, url, exchangeUpMessage(), sleep);
      setAlertState(db, STATE_KEY, undefined);
    }
  } catch (err) {
    console.error("[alerts:exchange] could not send the alert:", err);
  }
}
