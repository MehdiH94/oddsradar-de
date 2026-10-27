import { MAX_DETAILS, MAX_TITLE } from "../auth/promos";
import { SitePromo } from "./sitePromos";

// bet-at-home's promotions, from its public promotions page
// (bet-at-home.de/de/promotions, 27/10/2026): the page carries its whole list
// in the state it hands its own script (`promotionsData.items`), no account
// and no challenge in front of it. Only the sports promotions are kept: the
// owner bets on sports (26/10/2026), the casino's would bury them.
export const BETATHOME_PROMOS_URL = "https://www.bet-at-home.de/de/promotions";

const REQUEST_TIMEOUT_MS = 20_000;
const HEADERS = {
  accept: "text/html",
  "accept-language": "de-DE",
  "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36",
};

export interface BetathomePromo {
  id?: number;
  title?: string;
  content?: string;
  ribbonText?: string;
  bonusCode?: string;
  expiryDate?: string;
  categories?: string[];
}

// The JSON object that follows `key` in a page, read to its closing brace
// (strings and their escapes skipped), or null when it is not there.
export function jsonAfter(page: string, key: string): unknown {
  const start = page.indexOf(key);
  if (start === -1) return null;
  let i = start + key.length;
  while (/\s/.test(page[i] ?? "")) i++;
  if (page[i] !== "{") return null;
  let depth = 0;
  let inString = false;
  for (let j = i; j < page.length; j++) {
    const c = page[j];
    if (inString) {
      if (c === "\\") j++;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return JSON.parse(page.slice(i, j + 1));
  }
  return null;
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  euro: "€",
  ndash: "–",
  auml: "ä",
  ouml: "ö",
  uuml: "ü",
  Auml: "Ä",
  Ouml: "Ö",
  Uuml: "Ü",
  szlig: "ß",
};

// HTML as plain text: the tags gone (a paragraph or a line break ends a
// line), the entities ("&#8211;", "&nbsp;") read, the spaces collapsed.
export function htmlText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>|<\/(p|div|li|tr|h\d)>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
      if (name[0] === "#") {
        const code = name[1] === "x" || name[1] === "X" ? parseInt(name.slice(2), 16) : Number(name.slice(1));
        return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
      }
      return ENTITIES[name] ?? ENTITIES[name.toLowerCase()] ?? whole;
    })
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

// The end of a day in Berlin, as an instant.
function endOfBerlinDay(year: number, month: number, day: number): Date {
  const asUtc = Date.UTC(year, month - 1, day, 23, 59);
  const offset = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Berlin", timeZoneName: "shortOffset" })
    .formatToParts(new Date(asUtc))
    .find((p) => p.type === "timeZoneName")?.value;
  const hours = Number(/GMT([+-]\d+)/.exec(offset ?? "")?.[1] ?? 1);
  return new Date(asUtc - hours * 3600_000);
}

// When a promotion ends, from its ribbon ("26.10. - 08.11.": the last date,
// the end of that day in Berlin): the year is the one that puts it nearest
// after `now`, so that a December ribbon read in January is last year's and
// a January one read in December next year's. Null without a date.
export function ribbonEnd(ribbon: string | undefined, now: Date): string | null {
  const dates = [...(ribbon ?? "").matchAll(/(\d{1,2})\.(\d{1,2})\.(\d{4})?/g)];
  const last = dates[dates.length - 1];
  if (!last) return null;
  const [day, month] = [Number(last[1]), Number(last[2])];
  if (day < 1 || day > 31 || month < 1 || month > 12) return null;
  if (last[3]) return endOfBerlinDay(Number(last[3]), month, day).toISOString();
  const year = now.getUTCFullYear();
  const candidates = [year - 1, year, year + 1].map((y) => endOfBerlinDay(y, month, day));
  // The nearest to now, a past one counting as far: more than half a year back is next year's.
  const halfYear = 183 * 24 * 3600_000;
  const pick = candidates.find((c) => c.getTime() >= now.getTime() - halfYear && c.getTime() < now.getTime() + halfYear) ?? candidates[1];
  return pick.toISOString();
}

// The sports promotions of the page's state, as the site keeps them.
export function parseBetathomePromos(page: string, now = new Date()): SitePromo[] {
  const data = jsonAfter(page, '"promotionsData":') as { items?: BetathomePromo[] } | null;
  if (!data || !Array.isArray(data.items)) throw new Error("bet-at-home promotions: no promotionsData in the page");
  const promos: SitePromo[] = [];
  for (const item of data.items) {
    if (typeof item.id !== "number" || !item.title || !item.categories?.includes("sports")) continue;
    const title = htmlText(item.title).slice(0, MAX_TITLE);
    const text = htmlText(item.content ?? "");
    const code = item.bonusCode?.trim();
    const details = [code ? `Bonuscode: ${code}` : "", text].filter(Boolean).join("\n").slice(0, MAX_DETAILS);
    const expiry = item.expiryDate ? Date.parse(item.expiryDate) : NaN;
    promos.push({
      sourceKey: `betathome:${item.id}`,
      bookmaker: "betathome",
      title,
      details,
      url: BETATHOME_PROMOS_URL,
      endsAt: Number.isFinite(expiry) ? new Date(expiry).toISOString() : ribbonEnd(item.ribbonText, now),
    });
  }
  return promos;
}

export async function fetchBetathomePromos(now = new Date()): Promise<SitePromo[]> {
  const res = await fetch(BETATHOME_PROMOS_URL, { headers: HEADERS, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`bet-at-home promotions: HTTP ${res.status}`);
  return parseBetathomePromos(await res.text(), now);
}
