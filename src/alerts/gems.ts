import { APP_NAME } from "../brand";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { getValueBets, ListingOptions, ValueBet } from "../db/repository";
import { gemKey, getAlertState, recordSentGems, SentGem, sentGemKeys, setAlertState, SUREBET_SELECTION } from "../db/alerts";
import { EXCHANGE, Surebet, SUREBET_TO_VERIFY, surebetsOrNone, withoutSurebets } from "../db/surebets";
import { parseMarketKey, winnersOf } from "../markets/catalog";
import { BookmakerId, MARKET_1X2, MARKET_MATCH_WINNER } from "../scraper/canonical";

// A gem: a value bet big enough for a Discord message. 5% above the fair odds
// on a match's main market, a 1X2 or a winner (src/reference/), whose exchange prices
// are tight (a value bet from 1%); 15% on a player's market or a tennis
// match's others (games, sets), against their fair odds or the lay's ceiling
// (src/db/playerValue.ts, tennisValue.ts), which move more (a value bet from
// 5%), and on a golf tournament's winner (a value bet from 5% too), whose
// players' prices are as wide. Suspect prices are not value bets on the site,
// so never gems.
export const GEM_MIN_EDGE = { match: 0.05, players: 0.15 } as const;

export function isGem(bet: Pick<ValueBet, "market" | "edge">): boolean {
  const main = bet.market === MARKET_1X2 || bet.market === MARKET_MATCH_WINNER;
  return bet.edge >= (main ? GEM_MIN_EDGE.match : GEM_MIN_EDGE.players) - 1e-12;
}

// A Discord message holds 10 embeds at most, and the text of all of them
// (titles, descriptions, fields' names and values) 6000 characters at most; its
// content 2000. One message per cycle, the rest the next one.
export const MAX_GEMS_PER_MESSAGE = 10;
export const DISCORD_LIMITS = { embeds: MAX_GEMS_PER_MESSAGE, embedChars: 6000, content: 2000 } as const;

export interface Embed {
  title: string;
  url?: string;
  color: number;
  description?: string;
  fields: { name: string; value: string; inline?: boolean }[];
}

export interface DiscordMessage {
  username: string;
  allowed_mentions: { parse: never[] };
  content: string;
  embeds?: Embed[];
}

// What Discord counts of an embed. UTF-16 units, so an emoji counts for 2:
// never fewer than Discord's own count.
export function embedChars(embed: Embed): number {
  return (
    embed.title.length +
    (embed.description?.length ?? 0) +
    embed.fields.reduce((sum, f) => sum + f.name.length + f.value.length, 0)
  );
}

// The first of `items` that make one message Discord accepts: 10 embeds and
// 6000 characters at most. The rest waits for the next cycle. Always the
// first one at least: an embed alone is always within the limit (its fields
// are cut, `fieldValue`).
export function fitMessage<T>(items: readonly T[], embedOf: (item: T) => Embed): T[] {
  const taken: T[] = [];
  let chars = 0;
  for (const item of items) {
    const size = embedChars(embedOf(item));
    if (taken.length >= DISCORD_LIMITS.embeds) break;
    if (taken.length > 0 && chars + size > DISCORD_LIMITS.embedChars) break;
    taken.push(item);
    chars += size;
  }
  return taken;
}

// Checked before every sending: a message Discord would refuse is never sent,
// and says why.
export function assertSendable(message: Pick<DiscordMessage, "content" | "embeds">): void {
  const embeds = message.embeds ?? [];
  const chars = embeds.reduce((sum, e) => sum + embedChars(e), 0);
  if (embeds.length > DISCORD_LIMITS.embeds) throw new Error(`message too long for Discord: ${embeds.length} cards, ${DISCORD_LIMITS.embeds} at most`);
  if (chars > DISCORD_LIMITS.embedChars) throw new Error(`message too long for Discord: ${chars} characters, ${DISCORD_LIMITS.embedChars} at most`);
  const tooLong = embeds.find((e) => (e.description?.length ?? 0) > 4096 || e.title.length > 256 || e.fields.some((f) => f.value.length > 1024));
  if (tooLong) throw new Error(`message too long for Discord: the card “${tooLong.title.slice(0, 40)}” goes over a Discord limit`);
  if (message.content.length > DISCORD_LIMITS.content) throw new Error(`message too long for Discord: text of ${message.content.length} characters, ${DISCORD_LIMITS.content} at most`);
}

// A field's value holds 1024 characters at most.
const fieldValue = (text: string) => text.slice(0, 1024);

// Amber, like the site's value bets; a surebet in the best prices' green.
const GEM_COLOR = 0xd97706;
const SUREBET_COLOR = 0x16a34a;
const BOOKMAKER_NAMES: Record<string, string> = {
  winamax: "Winamax",
  betclic: "Betclic",
  leovegas: "LeoVegas",
  merkurbets: "Merkur Bets",
  twentybet: "20bet",
  admiralbet: "Admiralbet",
  betathome: "bet-at-home",
  tipico: "Tipico",
  winamaxde: "Winamax",
  [EXCHANGE]: "Exchange",
};
const bookmakerName = (id: string) => BOOKMAKER_NAMES[id] ?? id;
// Every bookmaker the site lists: an alert's links name them all, so that a gem
// is never hidden by the site's default selection when opened.
export const ALL_BOOKMAKER_IDS: readonly BookmakerId[] = [
  "leovegas",
  "merkurbets",
  "twentybet",
  "admiralbet",
  "betathome",
  "tipico",
  "winamaxde",
];
const ALL_BOOKMAKERS_QUERY = `bookmakers=${ALL_BOOKMAKER_IDS.join(",")}`;
// A match's page on the site (none without PUBLIC_URL). Parentheses are
// escaped: the address ends a Markdown link in the "Page du match" field.
const matchUrl = (eventId: string, publicUrl?: string) =>
  publicUrl
    ? `${publicUrl}/?match=${encodeURIComponent(eventId).replace(/\(/g, "%28").replace(/\)/g, "%29")}&${ALL_BOOKMAKERS_QUERY}`
    : undefined;
// The embed's last field: the title is a link too, but a quiet one.
const matchLinkFields = (url?: string) => (url ? [{ name: "Match page", value: `[See the match on ${APP_NAME}](${url})` }] : []);
const formatPrice = (price: number) => price.toFixed(2);
const formatEdge = (edge: number) => `+${(edge * 100).toFixed(1)}%`;
const formatPercent = (rate: number) => `${Math.round(rate * 100)}%`;
const formatRate = (rate: number) => `${(rate * 100).toFixed(1)}%`;

type Send = (
  url: string,
  init: { method: "POST"; headers: Record<string, string>; body: string; signal: AbortSignal }
) => Promise<{ ok: boolean; status: number; headers?: { get(name: string): string | null } }>;

export interface GemAlertOptions extends ListingOptions {
  // The channel's webhook (DISCORD_WEBHOOK_URL): no alerts without it.
  webhookUrl?: string;
  // The site's address (PUBLIC_URL), for the links to the matches.
  publicUrl?: string;
  send?: Send;
  // Waits out a rate limit (tests pass their own).
  sleep?: (ms: number) => Promise<void>;
}

export function helloMessage(publicUrl?: string): DiscordMessage {
  const link = publicUrl ? `\n${publicUrl}/?sport=value-bets&sort=value&${ALL_BOOKMAKERS_QUERY}` : "";
  return {
    username: APP_NAME,
    allowed_mentions: { parse: [] },
    content:
      `✅ ${APP_NAME} is connected to this channel. An alert will come here for each new gem: a 1X2 ` +
      `or match winner value bet (football, tennis, basketball, baseball, American football, hockey, rugby, MMA) ` +
      `${formatPercent(GEM_MIN_EDGE.match)} or more above the fair odds, ` +
      `or a player, games or sets bet ${formatPercent(GEM_MIN_EDGE.players)} or more; and each surebet (payout over ` +
      `100%, those “to verify” flagged as such). A single alert per match, market and outcome.${link}`,
  };
}

// One embed per gem: the edge, the match and its kick-off (a Discord timestamp,
// shown in the reader's time zone), a link to the match's page. Never the
// outcome, the bookmaker or the price: the alert says where to look, the site
// says what to bet.
export function gemEmbed(gem: ValueBet, publicUrl?: string): Embed {
  const link = matchUrl(gem.eventId, publicUrl);
  const kickOff = Math.floor(Date.parse(gem.startTime) / 1000);
  return {
    title: `💎 ${formatEdge(gem.edge)}`,
    ...(link ? { url: link } : {}),
    color: GEM_COLOR,
    fields: [
      { name: "Match", value: fieldValue(`${gem.participants.join(" - ")}${gem.competition ? ` · ${gem.competition}` : ""}`) },
      { name: "Kick-off", value: `<t:${kickOff}:f> (<t:${kickOff}:R>)`, inline: true },
      ...matchLinkFields(link),
    ],
  };
}

export function gemsMessage(gems: readonly ValueBet[], publicUrl?: string): DiscordMessage {
  return {
    username: APP_NAME,
    allowed_mentions: { parse: [] },
    content: gems.length === 1 ? "💎 New gem" : `💎 ${gems.length} new gems`,
    embeds: gems.map((gem) => gemEmbed(gem, publicUrl)),
  };
}

// A surebet as the alerts know it (src/db/alerts.ts): its combination, which
// outcome where, stands for the bookmaker, so that each is sent once.
const surebetCombination = (s: Surebet) => s.legs.map((l) => `${l.selection}@${l.source}:${l.side}`).join(",");
const surebetGem = (s: Surebet) => ({ eventId: s.eventId, market: s.market, selection: SUREBET_SELECTION, bookmaker: surebetCombination(s) });

// The first of each alert (`gemKey`): the gems come biggest edge first, so the
// same outcome at several bookmakers is sent once, at the best price.
function onePerAlert<T extends Pick<SentGem, "eventId" | "market" | "selection" | "bookmaker">>(items: readonly T[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = gemKey(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// Why a surebet is "to be checked" (src/db/surebets.ts), as the alert says it.
function toVerifyReason(s: Surebet): string {
  if (s.payoutRate > SUREBET_TO_VERIFY) {
    return `Payout over ${formatPercent(SUREBET_TO_VERIFY)}: most often two different rules or lines, or an old price. Check at the bookmakers before betting.`;
  }
  if ((winnersOf(parseMarketKey(s.market)) ?? 1) > 1) {
    return "Market with several winners: each bookmaker applies its own rule on a tie for the last place. Check before betting.";
  }
  return "Check before betting.";
}

// One embed per surebet: its TRJ, the match, its kick-off and the profit as a
// percentage, a link to the match's page. Never the market, the bets or the
// stakes (see gemEmbed). One "to be checked" says so in its title and in a
// field of its own, after the profit.
export function surebetEmbed(s: Surebet, publicUrl?: string): Embed {
  const link = matchUrl(s.eventId, publicUrl);
  const kickOff = Math.floor(Date.parse(s.startTime) / 1000);
  return {
    title: `⚖️ ${s.toVerify ? "To verify · " : ""}${formatRate(s.payoutRate)}`,
    ...(link ? { url: link } : {}),
    color: SUREBET_COLOR,
    fields: [
      { name: "Match", value: fieldValue(`${s.participants.join(" - ")}${s.competition ? ` · ${s.competition}` : ""}`) },
      { name: "Kick-off", value: `<t:${kickOff}:f> (<t:${kickOff}:R>)`, inline: true },
      { name: "Profit", value: formatEdge(s.payoutRate - 1), inline: true },
      ...(s.toVerify ? [{ name: "⚠️ To verify", value: toVerifyReason(s) }] : []),
      ...matchLinkFields(link),
    ],
  };
}

export function surebetsMessage(surebets: readonly Surebet[], publicUrl?: string): DiscordMessage {
  return {
    username: APP_NAME,
    allowed_mentions: { parse: [] },
    content: surebets.length === 1 ? "⚖️ New surebet" : `⚖️ ${surebets.length} new surebets`,
    embeds: surebets.map((s) => surebetEmbed(s, publicUrl)),
  };
}

// Discord's rate limit (HTTP 429) says how long to wait, in seconds, in the
// Retry-After header. A short wait is waited out and the sending retried, as
// many times as RATE_LIMIT_RETRIES; a longer one, or none, is left to the
// next cycle, nothing being marked sent until Discord has taken it.
export const RATE_LIMIT_MAX_WAIT_MS = 10_000;
export const RATE_LIMIT_RETRIES = 2;
const RATE_LIMIT_MESSAGE = "HTTP 429: Discord limits the sending, next try at the next cycle";

function retryAfterMs(res: { headers?: { get(name: string): string | null } }): number | undefined {
  const seconds = Number.parseFloat(res.headers?.get("retry-after") ?? "");
  return Number.isFinite(seconds) && seconds >= 0 ? Math.ceil(seconds * 1000) : undefined;
}

async function post(send: Send, url: string, message: DiscordMessage, sleep: (ms: number) => Promise<void>): Promise<void> {
  assertSendable(message);
  for (let retry = 0; ; retry++) {
    const res = await send(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(message),
      signal: AbortSignal.timeout(15_000),
    });
    if (res.ok) return;
    if (res.status !== 429) throw new Error(`HTTP ${res.status}`);
    const wait = retryAfterMs(res);
    if (wait === undefined || wait > RATE_LIMIT_MAX_WAIT_MS || retry >= RATE_LIMIT_RETRIES) throw new Error(RATE_LIMIT_MESSAGE);
    console.warn(`[alerts] Discord rate limit, retrying in ${wait} ms`);
    await sleep(wait);
  }
}

// After each reference cycle (src/worker/index.ts): sends the new gems to
// Discord, each once; greets a new webhook first. Never throws: a failure is
// logged and kept (GET /api/alerts), nothing is marked sent, and the next
// cycle tries again. A rate limit (429) that Discord asks to wait out for a
// few seconds is waited out and retried at once (see `post`).
export async function runGemAlerts(db: DatabaseSync, opts: GemAlertOptions): Promise<void> {
  const url = opts.webhookUrl?.trim();
  try {
    setAlertState(db, "configured", url ? "1" : "0");
    if (!url) {
      // Greeted again if it comes back.
      setAlertState(db, "hello_for", undefined);
      return;
    }
    const send = opts.send ?? (fetch as unknown as Send);
    const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
    const fingerprint = createHash("sha256").update(url).digest("hex");
    if (getAlertState(db, "hello_for") !== fingerprint) {
      await post(send, url, helloMessage(opts.publicUrl), sleep);
      setAlertState(db, "hello_for", fingerprint);
      console.log("[alerts] Discord webhook greeted");
    }

    const listing = { sort: "value", oddsMaxAgeMs: opts.oddsMaxAgeMs, marketsMaxAgeMs: opts.marketsMaxAgeMs } as const;
    // Every surebet, those to be checked too: a value bet one of them holds
    // is that surebet's, not a gem (like the site's). Not the thin ones
    // (a lay with under 20 EUR on it): the site shows them, but they are not
    // sent, so the gem is.
    const allSurebets = surebetsOrNone(db, listing).filter((s) => !s.thin);
    const gems = withoutSurebets(getValueBets(db, listing).bets, allSurebets).filter(isGem);
    const sent = sentGemKeys(db, gems.map((g) => g.eventId));
    // As many as make one message Discord accepts (10 cards, 6000 characters).
    const fresh = fitMessage(
      onePerAlert(gems.filter((g) => !sent.has(gemKey(g)))),
      (g) => gemEmbed(g, opts.publicUrl)
    );
    if (fresh.length > 0) {
      await post(send, url, gemsMessage(fresh, opts.publicUrl), sleep);
      const sentAt = new Date().toISOString();
      recordSentGems(
        db,
        fresh.map(
          (g): SentGem => ({
            eventId: g.eventId,
            market: g.market,
            selection: g.selection,
            bookmaker: g.bookmaker,
            basis: g.basis,
            price: g.price,
            fair: g.fair,
            edge: g.edge,
            label: g.label,
            marketLabel: g.marketLabel,
            matchLabel: g.participants.join(" - "),
            startTime: g.startTime,
            sentAt,
          })
        )
      );
      console.log(`[alerts] ${fresh.length} gem(s) sent to Discord`);
    }

    // The surebets from 100 %, those to be checked too: the alert says so.
    const surebets = allSurebets;
    const sentSurebets = sentGemKeys(db, surebets.map((s) => s.eventId));
    const freshSurebets = fitMessage(
      surebets.filter((s) => !sentSurebets.has(gemKey(surebetGem(s)))),
      (s) => surebetEmbed(s, opts.publicUrl)
    );
    if (freshSurebets.length > 0) {
      await post(send, url, surebetsMessage(freshSurebets, opts.publicUrl), sleep);
      const sentAt = new Date().toISOString();
      recordSentGems(
        db,
        freshSurebets.map(
          (s): SentGem => ({
            ...surebetGem(s),
            basis: `surebet:${s.kind}`,
            price: s.payoutRate,
            fair: 1,
            edge: s.payoutRate - 1,
            label: s.legs.map((l) => `${l.label} @ ${bookmakerName(l.source)} ${formatPrice(l.price)}`).join(" / "),
            marketLabel: s.marketLabel,
            matchLabel: s.participants.join(" - "),
            startTime: s.startTime,
            sentAt,
          })
        )
      );
      console.log(`[alerts] ${freshSurebets.length} surebet(s) sent to Discord`);
    }
    setAlertState(db, "last_error", undefined);
    setAlertState(db, "last_error_at", undefined);
  } catch (err) {
    // Never the webhook's address (its token) in a log or the API.
    const raw = err instanceof Error ? err.message : String(err);
    const message = url ? raw.split(url).join("<webhook>") : raw;
    console.error(`[alerts] Discord: ${message}`);
    try {
      setAlertState(db, "last_error", message);
      setAlertState(db, "last_error_at", new Date().toISOString());
    } catch {
      // The database itself failing: already logged above.
    }
  }
}
