import { deflateRawSync, inflateRawSync } from "node:zlib";
import { RawEvent, RawOdds } from "../types";
import { BookmakerScraper } from "./run";
import { canonicalMarketName, canonicalSport } from "./canonical";
import { netOfStakeTax } from "./stakeTax";
import { validateRawEvent } from "./validateRawEvent";

// Admiralbet's prices (admiralbet.de, Novomatic's German sportsbook), from the
// websocket its sports widget reads them from (wss://ws.de.admiral.at, seen in
// its pages' traffic from a German IP, 16/10/2026,
// tests/scraper/fixtures/admiralbet-snapshot.json). No HTTP route gives the
// offer: the widget opens a page (a sport, a league), asks for the markets to
// show on it, and receives a snapshot of entities (events, markets, selections,
// competitors) and its updates. Every frame is JSON compressed with raw
// deflate, both ways; no account, cookie or token.
//
// The site cuts a connection that opens pages too fast (about 20 in 30 seconds,
// 16/10/2026): a page every PAGE_GAP_MS, and only the leagues the site itself
// puts forward on each sport's page (TopCategoryUrns: the Bundesliga, the
// Premier League, the DEL...), about 50 pages, read within FETCH_BUDGET_MS.
// What the sport pages list besides is read too.

const WS_URL = "wss://ws.de.admiral.at/";
// The configuration node the widget sends (its config for admiralbet.de,
// static.admiral.at/mfo/asw.b2b.sports.ui.widget/<version>/config/admiralbet-de-gt.js):
// views come back empty under another one.
const CONFIGURATION_NODE = "asw:node:admiral:device:6ef60b8b-26fa-4dbb-b719-3c1124acb938";
// Pages are found by their German address ("/fussball/deutschland/bundesliga").
const LANGUAGE = "de";
// The German betting tax the site takes off the stake: 5.3%, its own settings
// say (api.de.admiral.at/api/sports/configuration/client/parameters,
// "stakeTaxStrategy": "FivePointThreePercent", 16/10/2026). The prices are
// stored net of it (./stakeTax.ts).
export const ADMIRALBET_TAX_ON_STAKE = 0.053;
// The widget's own name for its page subscription: a page opened under it
// replaces the one before.
const PAGE_SUBSCRIPTION = "RetrieveSportsbookPage/RetrieveSportsbookPage";
// The root of the site's categories, which no address names.
const ROOT_CATEGORY = "asw:category:10000000";

export const ADMIRAL_PAGE_GAP_MS = 3_500;
// From the markets asked for on a page to reading its prices.
export const ADMIRAL_HOLD_MS = 1_500;
// A page that doesn't answer is skipped.
const PAGE_TIMEOUT_MS = 10_000;
const MAX_PAGES = 60;
// The worker's cycle waits for its slowest bookmaker: what was read by then
// is what this cycle gets.
const FETCH_BUDGET_MS = 210_000;
const PING_MS = 20_000;

// The sports read: their page, the site's sport, its main market (Sportradar's
// ids: 1 the result in regular time, 219 the winner overtime included, 186 the
// winner, 251 the winner extra innings included) and its outcomes, by the
// site's selection types (1, 2, 3 for 1, X, 2; 4 and 5 for a winner's).
// Verified on the site's snapshots (16/10/2026).
export const ADMIRAL_SPORTS: ReadonlyArray<{ page: string; sport: string; market: string; outcomes: 2 | 3 }> = [
  { page: "/fussball", sport: "asw:sport:1", market: "asw:markettype:1", outcomes: 3 },
  { page: "/basketball", sport: "asw:sport:2", market: "asw:markettype:219", outcomes: 2 },
  { page: "/eishockey", sport: "asw:sport:4", market: "asw:markettype:1", outcomes: 3 },
  { page: "/tennis", sport: "asw:sport:5", market: "asw:markettype:186", outcomes: 2 },
  { page: "/handball", sport: "asw:sport:6", market: "asw:markettype:1", outcomes: 3 },
  { page: "/american-football", sport: "asw:sport:16", market: "asw:markettype:219", outcomes: 2 },
  { page: "/volleyball", sport: "asw:sport:23", market: "asw:markettype:186", outcomes: 2 },
  { page: "/baseball", sport: "asw:sport:3", market: "asw:markettype:251", outcomes: 2 },
  { page: "/rugby", sport: "asw:sport:12", market: "asw:markettype:1", outcomes: 3 },
];

const SIDES: Readonly<Record<string, "home" | "draw" | "away">> = {
  "asw:selectiontype:1": "home",
  "asw:selectiontype:2": "draw",
  "asw:selectiontype:3": "away",
  "asw:selectiontype:4": "home",
  "asw:selectiontype:5": "away",
};
// An event before kick-off (5 is in play).
const PRE_MATCH = 1;
// A head-to-head (2 is an outright).
const MATCH = 0;
// An entity added or updated in a snapshot (1 removes it).
const UPSERT = 0;

export interface AdmiralEntity {
  urn: string;
  [key: string]: unknown;
}
export interface AdmiralSnapshotItem {
  kind?: number;
  type?: string;
  entity?: AdmiralEntity;
}
interface AdmiralEvent extends AdmiralEntity {
  type?: number;
  state?: number;
  startTime?: string;
  sport?: string;
  competition?: string;
  eventCompetitors?: { qualifier?: string; competitor?: string }[];
  markets?: string[];
}
interface AdmiralMarket extends AdmiralEntity {
  type?: string;
  state?: number;
  selections?: string[];
  properties?: { IsMainMarket?: boolean };
}
interface AdmiralSelection extends AdmiralEntity {
  type?: string;
  odds?: number;
  state?: number;
}
interface Named extends AdmiralEntity {
  name?: string;
  translations?: Record<string, string>;
  parentCategory?: string | null;
}

// What the pages showed, entity by entity. A page's entities are removed from
// the snapshot when the next page opens: they are kept here, as last seen.
export class AdmiralStore {
  private readonly entities = new Map<string, Map<string, AdmiralEntity>>();

  apply(items: readonly AdmiralSnapshotItem[]): void {
    for (const item of items) {
      if ((item.kind ?? UPSERT) !== UPSERT || !item.type || !item.entity?.urn) continue;
      let byUrn = this.entities.get(item.type);
      if (!byUrn) this.entities.set(item.type, (byUrn = new Map()));
      byUrn.set(item.entity.urn, item.entity);
    }
  }

  get<T extends AdmiralEntity>(type: string, urn: string | null | undefined): T | undefined {
    return urn ? (this.entities.get(type)?.get(urn) as T | undefined) : undefined;
  }

  all<T extends AdmiralEntity>(type: string): T[] {
    return [...(this.entities.get(type)?.values() ?? [])] as T[];
  }
}

// A competitor by its own name, the club's full one ("Hamburger SV"; its
// English translation is often a short form, "HSV", which pairs less well
// with the other bookmakers'); a competition by its English name.
const competitorName = (entity: Named | undefined): string | undefined => (entity?.name ?? entity?.translations?.en)?.trim() || undefined;
const englishName = (entity: Named | undefined): string | undefined =>
  (entity?.translations?.en ?? entity?.name)?.trim() || undefined;

// The sport of an event. The site's rugby is both codes: its competitions'
// names say which.
function sportOf(sportUrn: string, competition: string): string {
  if (sportUrn === "asw:sport:12" && /\brugby league\b/i.test(competition)) return "rugby à xiii";
  return canonicalSport("admiralbet", sportUrn.split(":").pop() ?? sportUrn);
}

// The events the store holds as raw events: each match not yet started with its
// sport's main market, labelled with the teams' names and "Draw" (the matcher
// reads them as 1, X and 2), the prices net of the tax. A main market of
// another kind, or with outcomes it doesn't know, leaves the match out.
export function parseAdmiralEvents(store: AdmiralStore): RawEvent[] {
  const sports = new Map(ADMIRAL_SPORTS.map((s) => [s.sport, s]));
  const events: RawEvent[] = [];
  for (const event of store.all<AdmiralEvent>("Event")) {
    try {
      const config = sports.get(event.sport ?? "");
      if (!config || event.state !== PRE_MATCH || event.type !== MATCH || !event.startTime) continue;
      const side = (q: string) => competitorName(store.get<Named>("Competitor", event.eventCompetitors?.find((c) => c.qualifier === q)?.competitor));
      const [home, away] = [side("home"), side("away")];
      if (!home || !away) continue;
      const market = (event.markets ?? [])
        .map((urn) => store.get<AdmiralMarket>("Market", urn))
        .find((m) => m?.properties?.IsMainMarket && m.type === config.market);
      const selections = (market?.selections ?? []).map((urn) => store.get<AdmiralSelection>("Selection", urn));
      if (!market || selections.length !== config.outcomes || selections.some((s) => !s)) continue;
      const names = { home, draw: "Draw", away };
      const marketName = canonicalMarketName(config.outcomes);
      const odds: RawOdds[] = selections.map((s) => {
        const sideOf = SIDES[s!.type ?? ""];
        if (!sideOf || (sideOf === "draw" && config.outcomes === 2)) throw new Error(`unexpected selection type "${s!.type}"`);
        const open = market.state === 1 && s!.state === 1 && typeof s!.odds === "number";
        return { market: marketName, selection: names[sideOf], price: open ? netOfStakeTax(s!.odds as number, ADMIRALBET_TAX_ON_STAKE) : NaN };
      });
      const competition = englishName(store.get<Named>("Competition", event.competition)) ?? "";
      const raw: RawEvent = {
        sport: sportOf(config.sport, competition),
        competition,
        startTime: event.startTime,
        participants: [home, away],
        odds,
        sourceId: event.urn,
      };
      const checked = validateRawEvent(raw, "admiralbet");
      if (checked) events.push(checked);
    } catch (err) {
      // One malformed event must not take down the rest.
      console.warn(`[scraper:admiralbet] failed to read event ${event?.urn}, skipping it:`, err);
    }
  }
  return events;
}

// A category's address on the site, as the widget builds it: its path from
// the sport down, each step's German name (or English, without one) in lower
// case, umlauts spelled out, words joined by hyphens ("Fußball" / "Deutschland"
// / "2. Bundesliga" is "/fussball/deutschland/2-bundesliga").
export function admiralCategoryAddress(store: AdmiralStore, urn: string): string {
  const path: string[] = [];
  for (let at: string | null | undefined = urn; at && at !== ROOT_CATEGORY; at = store.get<Named>("Category", at)?.parentCategory) {
    const category = store.get<Named>("Category", at);
    if (!category) break;
    path.unshift(category.translations?.de ?? category.translations?.en ?? category.name ?? "");
  }
  const slug = (name: string) =>
    name
      .toLowerCase()
      .replace(/ß/g, "ss")
      .replace(/ä/g, "ae")
      .replace(/ö/g, "oe")
      .replace(/ü/g, "ue")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[.']/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  return "/" + path.map(slug).join("/");
}

// The socket the client talks through: the platform's WebSocket, or a test's.
export interface AdmiralSocket {
  binaryType: string;
  onopen: (() => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  onclose: (() => void) | null;
  send(data: Uint8Array): void;
  close(): void;
}
export type AdmiralSocketFactory = () => AdmiralSocket;

const platformSocket: AdmiralSocketFactory = () =>
  new WebSocket(WS_URL, { headers: { Origin: "https://www.admiralbet.de" } } as unknown as string[]) as unknown as AdmiralSocket;

export const encodeAdmiral = (message: unknown): Uint8Array => deflateRawSync(Buffer.from(JSON.stringify(message)));
export const decodeAdmiral = (data: unknown): unknown =>
  JSON.parse(inflateRawSync(Buffer.from(data instanceof ArrayBuffer ? new Uint8Array(data) : (data as Uint8Array))).toString());

interface PagePayload {
  type?: string;
  name?: string;
  body?: {
    snapshotUpdate?: { snapshotUpdateItems?: AdmiralSnapshotItem[] };
    categoryPath?: { categories?: string[] };
    viewDescriptions?: { properties?: { TopCategoryUrns?: string[] } }[];
    viewNode?: { viewNodes?: { id?: string; availableMarketSwitcher?: string[] }[] };
  };
}

export interface AdmiralFetchOptions {
  socket?: AdmiralSocketFactory;
  pageGapMs?: number;
  holdMs?: number;
  budgetMs?: number;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// One session: the sports' pages, then the leagues they put forward, a page at
// a time, and the events read from all of them.
export async function fetchAdmiralbet(opts: AdmiralFetchOptions = {}): Promise<RawEvent[]> {
  const pageGap = opts.pageGapMs ?? ADMIRAL_PAGE_GAP_MS;
  const hold = opts.holdMs ?? ADMIRAL_HOLD_MS;
  const started = Date.now();
  const deadline = started + (opts.budgetMs ?? FETCH_BUDGET_MS);
  const socket = (opts.socket ?? platformSocket)();
  socket.binaryType = "arraybuffer";
  const store = new AdmiralStore();
  const sportsbook = (payload: unknown[]) => socket.send(encodeAdmiral({ payload, properties: { type: "binary", service: "sportsbook" } }));
  let waiting: { accept: (p: PagePayload) => boolean; resolve: (p: PagePayload | null) => void } | null = null;
  let failed: unknown = null;

  const opened = new Promise<void>((resolve, reject) => {
    socket.onopen = () => socket.send(encodeAdmiral({ connect: { headers: {} }, properties: { type: "binary", service: "sportsbook" } }));
    socket.onerror = (err) => {
      failed = err;
      reject(new Error("Admiralbet socket error"));
      waiting?.resolve(null);
    };
    socket.onclose = () => waiting?.resolve(null);
    socket.onmessage = (ev) => {
      let message: { connected?: unknown; payload?: unknown };
      try {
        message = decodeAdmiral(ev.data) as typeof message;
      } catch {
        return;
      }
      if (message.connected) {
        sportsbook([{ type: "ConfigureEnvironment", name: "ConfigureEnvironment", body: { timeZone: "Europe/Berlin", languageCode: LANGUAGE, configurationNodeUrn: CONFIGURATION_NODE } }]);
        return;
      }
      if (typeof message.payload !== "string") return;
      for (const p of JSON.parse(message.payload) as PagePayload[]) {
        const items = p.body?.snapshotUpdate?.snapshotUpdateItems;
        if (items) store.apply(items);
        if (p.type === "EnvironmentConfigured" && p.name === "ConfigureEnvironment") resolve();
        if (waiting?.accept(p)) {
          const w = waiting;
          waiting = null;
          w.resolve(p);
        }
      }
    };
  });
  const ping = setInterval(() => {
    try {
      socket.send(encodeAdmiral({ ping: {} }));
    } catch {
      // The socket is gone: the page being waited for times out.
    }
  }, PING_MS);

  // A page, once its category is the one asked for (the site answers again
  // with each update), with the markets of its first market switch.
  let lastPageAt = 0;
  const openPage = async (address: string, category?: string): Promise<PagePayload | null> => {
    const gap = lastPageAt + pageGap - Date.now();
    if (gap > 0) await wait(gap);
    if (Date.now() > deadline || failed) return null;
    lastPageAt = Date.now();
    const page = new Promise<PagePayload | null>((resolve) => {
      const timer = setTimeout(() => {
        waiting = null;
        resolve(null);
      }, PAGE_TIMEOUT_MS);
      waiting = {
        accept: (p) => {
          if (p.type !== "SportsbookPageRetrieved" || p.name !== PAGE_SUBSCRIPTION) return false;
          const path = p.body?.categoryPath?.categories ?? [];
          return category ? path[path.length - 1] === category : path.length === 1;
        },
        resolve: (p) => {
          clearTimeout(timer);
          resolve(p);
        },
      };
    });
    sportsbook([{ type: "RetrieveSportsbookPage", name: PAGE_SUBSCRIPTION, body: { urlPart: address, pageScope: 1 } }]);
    const p = await page;
    const grid = p?.body?.viewNode?.viewNodes?.[0];
    if (!p || !grid?.id || !grid.availableMarketSwitcher?.length) return p;
    sportsbook([
      {
        type: "UpdateSportsbookPage",
        name: "UpdateSportsbookPage",
        body: {
          sportsGridViewNodeId: grid.id,
          pageSubscriptionName: PAGE_SUBSCRIPTION,
          commandProperties: [{ type: 0 }, { type: 1, value: JSON.stringify(grid.availableMarketSwitcher.slice(0, 1)) }],
        },
      },
    ]);
    await wait(hold);
    return p;
  };

  try {
    await Promise.race([opened, wait(PAGE_TIMEOUT_MS).then(() => Promise.reject(new Error("Admiralbet did not configure the session")))]);
    let pages = 0;
    let missed = 0;
    const leagues: string[] = [];
    for (const sport of ADMIRAL_SPORTS) {
      const page = await openPage(sport.page);
      pages++;
      if (!page) {
        missed++;
        continue;
      }
      for (const urn of (page.body?.viewDescriptions ?? []).flatMap((v) => v.properties?.TopCategoryUrns ?? [])) {
        if (!leagues.includes(urn)) leagues.push(urn);
      }
    }
    for (const urn of leagues) {
      if (pages >= MAX_PAGES || Date.now() > deadline) break;
      const page = await openPage(admiralCategoryAddress(store, urn), urn);
      pages++;
      if (!page) missed++;
    }
    if (missed === pages) throw new Error("no Admiralbet page answered");
    if (missed > 0) console.warn(`[scraper:admiralbet] ${missed} of ${pages} pages did not answer`);
    return parseAdmiralEvents(store);
  } finally {
    clearInterval(ping);
    socket.close();
  }
}

export const admiralbetScraper: BookmakerScraper = { id: "admiralbet", fetch: () => fetchAdmiralbet() };
