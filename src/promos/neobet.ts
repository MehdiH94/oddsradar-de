import { MAX_DETAILS, MAX_TITLE } from "../auth/promos";
import { SitePromo } from "./sitePromos";

// neobet's promotions, from the campaigns list its pages read for their
// carousel (neobet.de/.crm/banner/campaigns, seen by `vps-report
// promo-network` on 28/10/2026): public JSON, no account, answering from
// Germany only. neobet is a sportsbook only, so every campaign is a sports
// one; the player-protection notice, the top-winners list and the NEO.bet
// Million's one-per-league copies are left out. No campaign carries an end.
export const NEOBET_CAMPAIGNS_URL = "https://neobet.de/.crm/banner/campaigns?language=de&country=DE";
const SITE = "https://neobet.de";

const REQUEST_TIMEOUT_MS = 20_000;
const HEADERS = {
  accept: "application/json",
  "accept-language": "de-DE",
  "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36",
};

const NOT_PROMOTIONS = new Set(["responsiblegaming", "topBets"]);

export interface NeobetCampaign {
  campaignId?: string;
  name?: string;
  link?: string;
  carouselOptions?: { label?: string; primaryLink?: string; secondaryLink?: string };
  targetGroupDesc?: { props?: { countries?: string } };
}

// The campaign's page on neobet.de: its own link, else its buttons' ("Mehr
// Infos" first), skipping the ones that only open the account or the betslip
// ("#account/Account") and those leaving the site; the site itself without one.
export function campaignUrl(campaign: NeobetCampaign): string {
  const links = [campaign.link, campaign.carouselOptions?.secondaryLink, campaign.carouselOptions?.primaryLink];
  for (const link of links) {
    const href = link?.trim();
    if (!href || href.startsWith("#")) continue;
    if (/^https?:\/\//.test(href)) {
      if (new URL(href).hostname.endsWith("neobet.de")) return href;
      continue;
    }
    return `${SITE}/${href.replace(/^\/+/, "")}`;
  }
  return `${SITE}/de`;
}

// The German campaigns of the list, as the site keeps them.
export function parseNeobetCampaigns(body: unknown): SitePromo[] {
  if (!Array.isArray(body)) throw new Error("neobet campaigns: the answer is not a list");
  const promos: SitePromo[] = [];
  for (const campaign of body as NeobetCampaign[]) {
    const id = campaign.campaignId;
    if (!id || !campaign.name || NOT_PROMOTIONS.has(id) || id.startsWith("millions-")) continue;
    const countries = campaign.targetGroupDesc?.props?.countries;
    if (countries && !countries.split("|").includes("DE")) continue;
    const title = campaign.name.trim().slice(0, MAX_TITLE);
    const label = campaign.carouselOptions?.label?.trim() ?? "";
    promos.push({
      sourceKey: `neobet:${id}`,
      bookmaker: "neobet",
      title,
      details: label === title ? "" : label.slice(0, MAX_DETAILS),
      url: campaignUrl(campaign),
      endsAt: null,
    });
  }
  return promos;
}

export async function fetchNeobetPromos(): Promise<SitePromo[]> {
  const res = await fetch(NEOBET_CAMPAIGNS_URL, { headers: HEADERS, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`neobet campaigns: HTTP ${res.status}`);
  return parseNeobetCampaigns(await res.json());
}
