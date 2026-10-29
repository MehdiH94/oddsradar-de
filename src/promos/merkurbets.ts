import { MAX_DETAILS, MAX_TITLE } from "../auth/promos";
import { htmlText } from "./betathome";
import { SitePromo } from "./sitePromos";

// Merkur Bets' promotions, from the CMS its site builds its pages from
// (apiv3-msw-mb-de.cashpoint.solutions, the call its page de/page/
// promotions-sportwetten makes, seen by `vps-report promo-network` on
// 29/10/2026): public JSON GETs, no account, no header of their own. That
// page shows its offers as a carousel of images, each linking to the offer's
// own page (de/page/<slug>); the offers struck out of it (an HTML comment, a
// past "Sunny Bonus Pick") are left out. Each offer's page gives its title and
// summary (its SEO title and description), one request each.
const CMS = "https://apiv3-msw-mb-de.cashpoint.solutions/api/v1/cms/get";
const SITE = "https://www.merkurbets.de";
export const MERKURBETS_PROMOS_SLUG = "promotions-sportwetten";

const REQUEST_TIMEOUT_MS = 20_000;
const HEADERS = {
  accept: "application/json",
  "accept-language": "de-DE",
  "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36",
};

export const cmsPageUrl = (slug: string) =>
  `${CMS}?ext_name=ext_api_v1_0&language=de&slug=${encodeURIComponent(slug)}&type=page&domain=www.merkurbets.de`;

export interface CmsPage {
  status?: string;
  SEO?: { title?: string | null; description?: string | null };
  CONTENT?: Record<string, { content?: string }[]>;
}

// The offers of the promotions page's carousel, by their page's slug, in its
// order and once each.
export function carouselSlugs(page: CmsPage): string[] {
  if (page.status !== "success" || !page.CONTENT) throw new Error("Merkur Bets promotions: no page in the CMS's answer");
  const html = Object.values(page.CONTENT)
    .flat()
    .map((block) => {
      try {
        return String((JSON.parse(block.content ?? "{}") as { content?: unknown }).content ?? "");
      } catch {
        return "";
      }
    })
    .join("\n")
    .replace(/<!--[\s\S]*?-->/g, "");
  const slugs: string[] = [];
  for (const item of html.matchAll(/<div class="carousel-item">\s*<a href="([^"]+)"/g)) {
    const slug = /\/de\/page\/([^/?#"]+)/.exec(item[1])?.[1];
    if (slug && slug !== MERKURBETS_PROMOS_SLUG && !slugs.includes(slug)) slugs.push(slug);
  }
  return slugs;
}

// An offer's title, without the site's name its SEO title carries ("Edeljoker
// bei MERKUR BETS", "KOMBI BOOST: … | MERKUR BETS").
export function offerTitle(seoTitle: string): string {
  return htmlText(seoTitle)
    .replace(/\s*\|\s*MERKUR BETS\s*$/i, "")
    .replace(/\s+bei MERKUR BETS\b.*$/i, "")
    .trim();
}

// An offer's page as the site keeps it, or null without a title.
export function parseMerkurbetsOffer(slug: string, page: CmsPage): SitePromo | null {
  const title = page.status === "success" && page.SEO?.title ? offerTitle(page.SEO.title) : "";
  if (!title) return null;
  return {
    sourceKey: `merkurbets:${slug}`,
    bookmaker: "merkurbets",
    title: title.slice(0, MAX_TITLE),
    details: htmlText(page.SEO?.description ?? "").slice(0, MAX_DETAILS),
    url: `${SITE}/de/page/${slug}`,
    endsAt: null,
  };
}

async function getPage(slug: string): Promise<CmsPage> {
  const res = await fetch(cmsPageUrl(slug), { headers: HEADERS, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`Merkur Bets CMS ${slug}: HTTP ${res.status}`);
  return (await res.json()) as CmsPage;
}

export async function fetchMerkurbetsPromos(): Promise<SitePromo[]> {
  const promos: SitePromo[] = [];
  for (const slug of carouselSlugs(await getPage(MERKURBETS_PROMOS_SLUG))) {
    const promo = parseMerkurbetsOffer(slug, await getPage(slug));
    if (promo) promos.push(promo);
  }
  return promos;
}
