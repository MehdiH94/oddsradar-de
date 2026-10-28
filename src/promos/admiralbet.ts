import { MAX_DETAILS, MAX_TITLE } from "../auth/promos";
import { htmlText } from "./betathome";
import { SitePromo } from "./sitePromos";

// Admiralbet's promotions, from the banners list its pages read from its
// platform's CRM (Greentube's `v3/bonus/banners`, seen by `vps-report
// promo-network` on 28/10/2026): public JSON, no account, answering from
// outside Germany too. The list holds every banner of the site (146 on
// 28/10, slots' teasers and seasonal calendars mostly); only those the
// promotions page shows under its sports filter are kept, not those it
// shows under its slots filter as well (the responsible-gaming page).
export const ADMIRALBET_BANNERS_URL = "https://rmg-crm-api-at.greentube.com/v3/bonus/banners?platform=admiralbetde&client=web&lang=de";
const SITE = "https://www.admiralbet.de";
export const ADMIRALBET_PROMOS_URL = `${SITE}/de/promotions`;

const SPORTS = "promotion.filter.sports";
const SLOTS = "promotion.filter.slots";
// A campaign's end is set years ahead when it has none ("2060-03-31").
const LONGEST_END_MS = 366 * 24 * 3600_000;

const REQUEST_TIMEOUT_MS = 20_000;
const HEADERS = {
  accept: "application/json",
  "accept-language": "de-DE",
  "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36",
};

export interface AdmiralbetBanner {
  campaign?: { id?: number; scheduledTime?: string; endTime?: string };
  actions?: { banner?: Record<string, unknown> & { locations?: string[] } }[];
}

const text = (value: unknown): string => (typeof value === "string" ? value : "");

// Where the banner's button leads, when it stays on admiralbet.de; the
// promotions page otherwise (the app's store link, none).
export function bannerUrl(href: string): string {
  const link = href.trim();
  if (link.startsWith("/")) return `${SITE}${link}`;
  if (/^https:\/\/(www\.)?admiralbet\.de\//.test(link)) return link;
  return ADMIRALBET_PROMOS_URL;
}

// The sports promotions of the list, running at `now`, as the site keeps them.
export function parseAdmiralbetBanners(body: unknown, now: Date): SitePromo[] {
  if (!Array.isArray(body)) throw new Error("Admiralbet banners: the answer is not a list");
  const promos: SitePromo[] = [];
  for (const { campaign, actions } of body as AdmiralbetBanner[]) {
    if (typeof campaign?.id !== "number") continue;
    if (campaign.scheduledTime && Date.parse(campaign.scheduledTime) > now.getTime()) continue;
    const end = campaign.endTime ? Date.parse(campaign.endTime) : NaN;
    if (end <= now.getTime()) continue;
    const banner = actions?.find((a) => a.banner?.locations?.includes(SPORTS) && !a.banner.locations.includes(SLOTS))?.banner;
    if (!banner) continue;
    const title = htmlText(text(banner.textLine1) || text(banner["title-text"]));
    if (!title) continue;
    const summary = htmlText(text(banner.textLine2) || text(banner["subtitle-text"]));
    const terms = htmlText(text(banner.textLine4) || text(banner.textLine7));
    promos.push({
      sourceKey: `admiralbet:${campaign.id}`,
      bookmaker: "admiralbet",
      title: title.slice(0, MAX_TITLE),
      details: [summary, terms].filter(Boolean).join("\n").slice(0, MAX_DETAILS),
      url: bannerUrl(text(banner.actionUrl1) || text(banner.url)),
      endsAt: Number.isFinite(end) && end - now.getTime() < LONGEST_END_MS ? new Date(end).toISOString() : null,
    });
  }
  return promos;
}

export async function fetchAdmiralbetPromos(now = new Date()): Promise<SitePromo[]> {
  const res = await fetch(ADMIRALBET_BANNERS_URL, { headers: HEADERS, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`Admiralbet banners: HTTP ${res.status}`);
  return parseAdmiralbetBanners(await res.json(), now);
}
