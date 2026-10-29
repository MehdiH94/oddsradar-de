import { MAX_DETAILS, MAX_TITLE } from "../auth/promos";
import { htmlText } from "./betathome";
import { SitePromo } from "./sitePromos";

// 20bet's promotions, from the list its promotions page reads (`/api/
// promotion/list`, seen by `vps-report promo-network` on 28/10/2026): public
// JSON, no account. 20bet.com answers Germany "not available in your region"
// and sends German visitors to a mirror domain, whose list answers the VPS
// (`vps-report promo-samples`, #80); its odds' API (platform.20bet.com,
// src/scraper/twentybet.ts) has no promotions list. A mirror's name can
// change: the read then fails, logged, and the last promotions stay.
// The sports promotions are kept: those of type 1 (the sportsbook's), and the
// sports VIP programme; the casino's would bury them.
export const TWENTYBET_PROMOS_URL =
  "https://20betz0ne1.com/api/promotion/list?isUserAuthenticated=false&excludePromotionType=3&lang=de&_trlang=de";
const SITE = "https://20bet.com";

const SPORTS = 1;
const REQUEST_TIMEOUT_MS = 20_000;
const HEADERS = {
  accept: "application/json",
  "accept-language": "de-DE",
  "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36",
};

export interface TwentybetPromo {
  id?: number;
  type?: number;
  title?: string;
  description?: string | null;
  mobileDescription?: string | null;
  bonusCode?: string | null;
  landing?: string | null;
  endsAt?: string | null;
}

// A promotion's page on 20bet.com: its landing's path, whichever mirror it
// was written for; the promotions page without one.
export function landingUrl(landing: string | null | undefined): string {
  try {
    if (landing) {
      const url = new URL(landing);
      return `${SITE}${url.pathname}${url.search}`;
    }
  } catch {
    // Not a URL: the promotions page.
  }
  return `${SITE}/de/promotions`;
}

const isSports = (promo: TwentybetPromo) => promo.type === SPORTS || /\/sport-vip-programs/.test(promo.landing ?? "");

// The sports promotions of the list, as the site keeps them.
export function parseTwentybetPromos(body: unknown): SitePromo[] {
  const data = (body as { data?: unknown })?.data;
  if (!Array.isArray(data)) throw new Error("20bet promotions: no list in the answer");
  const promos: SitePromo[] = [];
  for (const promo of data as TwentybetPromo[]) {
    if (typeof promo.id !== "number" || !promo.title?.trim() || !isSports(promo)) continue;
    const text = htmlText(promo.description ?? "") || promo.mobileDescription?.trim() || "";
    const code = promo.bonusCode?.trim();
    const end = promo.endsAt ? Date.parse(promo.endsAt) : NaN;
    promos.push({
      sourceKey: `twentybet:${promo.id}`,
      bookmaker: "twentybet",
      title: htmlText(promo.title).slice(0, MAX_TITLE),
      details: [code ? `Bonuscode: ${code}` : "", text].filter(Boolean).join("\n").slice(0, MAX_DETAILS),
      url: landingUrl(promo.landing),
      endsAt: Number.isFinite(end) ? new Date(end).toISOString() : null,
    });
  }
  return promos;
}

export async function fetchTwentybetPromos(): Promise<SitePromo[]> {
  const res = await fetch(TWENTYBET_PROMOS_URL, { headers: HEADERS, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`20bet promotions: HTTP ${res.status}`);
  return parseTwentybetPromos(await res.json());
}
