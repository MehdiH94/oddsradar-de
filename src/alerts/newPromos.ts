import { APP_NAME } from "../brand";
import { SitePromo, SitePromoRead } from "../promos/sitePromos";
import { bookmakerName, DiscordMessage, Embed, post, Send } from "./gems";

// The testers' channel (DISCORD_WEBHOOK_URL, the gems' own) hears of each
// promotion the site finds for the first time on a bookmaker's page
// (src/promos/), after each hourly read (src/api/index.ts): one message per
// bookmaker, in German, each promotion linked to the site's Promos page, where
// it can be marked taken. Only those the read added (saveSitePromos): one
// already in the table, kept across restarts, is never posted again.

// Discord's limits: 10 embeds a message, 256 characters a title; the
// details cut short enough that 10 of them stay under 6000 characters.
const MAX_PER_MESSAGE = 10;
const TITLE_MAX = 256;
const DETAILS_MAX = 200;
const PROMO_COLOR = 0x7c3aed;

export interface NewPromoAlertOptions {
  webhookUrl?: string;
  // The site's address (PUBLIC_URL), for the link to its Promos page.
  publicUrl?: string;
  send?: Send;
  sleep?: (ms: number) => Promise<void>;
}

const cut = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

export function newPromoEmbed(promo: SitePromo, promosUrl?: string): Embed {
  const ends = promo.endsAt ? Math.floor(Date.parse(promo.endsAt) / 1000) : NaN;
  const details = promo.details.replace(/\s+/g, " ").trim();
  return {
    title: cut(promo.title, TITLE_MAX),
    ...(promosUrl ? { url: promosUrl } : {}),
    color: PROMO_COLOR,
    ...(details ? { description: cut(details, DETAILS_MAX) } : {}),
    fields: Number.isFinite(ends) ? [{ name: "Endet", value: `<t:${ends}:f> (<t:${ends}:R>)`, inline: true }] : [],
  };
}

export function newPromosMessage(bookmaker: string, promos: readonly SitePromo[], publicUrl?: string): DiscordMessage {
  const promosUrl = publicUrl ? `${publicUrl}/promos` : undefined;
  const name = bookmakerName(bookmaker);
  const head = promos.length === 1 ? `🎁 Neue Promo bei **${name}**` : `🎁 ${promos.length} neue Promos bei **${name}**`;
  const more = promos.length > MAX_PER_MESSAGE ? ` (die ersten ${MAX_PER_MESSAGE} hier, alle auf der Promos-Seite)` : "";
  return {
    username: APP_NAME,
    allowed_mentions: { parse: [] },
    content: `${head}${more}${promosUrl ? `\n${promosUrl}` : ""}`,
    embeds: promos.slice(0, MAX_PER_MESSAGE).map((promo) => newPromoEmbed(promo, promosUrl)),
  };
}

// Never throws: a bookmaker whose message fails is logged, its promotions
// stay on the Promos page.
export async function postNewPromos(reads: readonly SitePromoRead[], opts: NewPromoAlertOptions): Promise<void> {
  const url = opts.webhookUrl?.trim();
  if (!url) return;
  const send = opts.send ?? (fetch as unknown as Send);
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  for (const read of reads) {
    if (!read.ok || !read.added?.length) continue;
    try {
      await post(send, url, newPromosMessage(read.bookmaker, read.added, opts.publicUrl), sleep);
    } catch (err) {
      console.error(`[alerts:new-promos] ${read.bookmaker}: could not post its new promotions:`, err);
    }
  }
}
