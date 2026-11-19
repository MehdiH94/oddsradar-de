import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { PinnacleMatch } from "./pinnacle";

// Pinnacle's own prices through PS3838, Pinnacle's agent site (the owner's
// request, 19/11/2026: "utiliser les API du site ps3838.com et les prendre
// comme référence pour les value-bets"). Its Lines API (ps3838api.github.io)
// is Pinnacle's: every football league it prices, its full-time 1X2 at its
// own margin, the reference of the fair odds (./pinnacleRun.ts), where The
// Odds API gives a dozen competitions only and its credits run out
// (src/scraper/oddsApi.ts). It needs an account's login, HTTP Basic: the
// owner's, in the VPS's .env (PS3838_USERNAME, PS3838_PASSWORD), never in
// the repository nor in a log. An account without API access answers 401 or
// 403 with the code NO_API_ACCESS: the reference then stays on The Odds API.

export const PS3838_API = "https://api.ps3838.com";
export const PS3838_SOCCER = 29;
const REQUEST_TIMEOUT_MS = 30_000;
// PS3838 allows one full read of a sport's fixtures or odds a minute: never
// more often than this, whatever the reference cycle's interval.
export const PS3838_MIN_READ_MS = 2 * 60 * 1000;

export interface Ps3838Credentials {
  username: string;
  password: string;
}

export function ps3838Credentials(env: NodeJS.ProcessEnv = process.env): Ps3838Credentials | null {
  const username = env.PS3838_USERNAME?.trim();
  const password = env.PS3838_PASSWORD?.trim();
  return username && password ? { username, password } : null;
}

// The Lines API's answers, the fields read only.
export interface Ps3838Fixtures {
  league?: {
    id?: number;
    name?: string;
    events?: {
      id?: number;
      starts?: string;
      home?: string;
      away?: string;
      // 1: a live-only event, 0 or 2: priced before the kick-off.
      liveStatus?: number;
      // "Regular" for the match itself, "Corners" or "Bookings" for its side markets.
      resultingUnit?: string;
      parentId?: number;
    }[];
  }[];
}

export interface Ps3838Odds {
  leagues?: {
    id?: number;
    events?: {
      id?: number;
      periods?: {
        // 0: the full match.
        number?: number;
        status?: number;
        moneyline?: { home?: number; draw?: number; away?: number };
      }[];
    }[];
  }[];
}

// A side market's teams carry their unit: "Bayern Munich (Corners)".
const SIDE_MARKET = /\((corners|bookings|cards)\)/i;

// The football matches PS3838 prices before the kick-off, with their full
// match's 1X2 in decimal odds. Live-only events, side markets (corners,
// bookings) and events without the three prices are left out.
export function ps3838MatchesOf(fixtures: Ps3838Fixtures, odds: Ps3838Odds): PinnacleMatch[] {
  const prices = new Map<number, { home: number; draw: number; away: number }>();
  for (const league of odds.leagues ?? []) {
    for (const event of league.events ?? []) {
      const full = event.periods?.find((p) => p.number === 0);
      const line = full?.moneyline;
      const ok = (price: number | undefined): price is number => typeof price === "number" && Number.isFinite(price) && price > 1;
      if (event.id === undefined || !line || !ok(line.home) || !ok(line.draw) || !ok(line.away)) continue;
      // Status 2: the line is offline for now.
      if (full?.status !== undefined && full.status !== 1) continue;
      prices.set(event.id, { home: line.home, draw: line.draw, away: line.away });
    }
  }
  const matches: PinnacleMatch[] = [];
  for (const league of fixtures.league ?? []) {
    for (const event of league.events ?? []) {
      const home = event.home?.trim();
      const away = event.away?.trim();
      if (event.id === undefined || !home || !away || !event.starts) continue;
      if (event.liveStatus === 1) continue;
      if (event.resultingUnit !== undefined && event.resultingUnit !== "Regular") continue;
      if (SIDE_MARKET.test(home) || SIDE_MARKET.test(away)) continue;
      const price = prices.get(event.id);
      if (!price) continue;
      matches.push({ id: `ps3838:${event.id}`, participants: [home, away], startTime: event.starts, prices: price });
    }
  }
  return matches;
}

// A refusal of the API: its HTTP status and PS3838's code (NO_API_ACCESS,
// INVALID_CREDENTIALS...), never the login.
export class Ps3838Error extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null
  ) {
    super(`PS3838: HTTP ${status}${code ? ` ${code}` : ""}`);
  }
}

export type Fetch = (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}>;

async function get<T>(doFetch: Fetch, path: string, credentials: Ps3838Credentials): Promise<T> {
  const auth = Buffer.from(`${credentials.username}:${credentials.password}`).toString("base64");
  const res = await doFetch(PS3838_API + path, {
    headers: { Authorization: `Basic ${auth}`, Accept: "application/json" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) {
    let code: string | null = null;
    try {
      const body = JSON.parse(await res.text()) as { code?: unknown };
      if (typeof body.code === "string" && /^[A-Z_]{2,40}$/.test(body.code)) code = body.code;
    } catch {
      // Not PS3838's JSON: the status is enough.
    }
    throw new Ps3838Error(res.status, code);
  }
  return (await res.json()) as T;
}

// The football matches and their 1X2, read in full: fixtures and odds.
export async function fetchPs3838Matches(credentials: Ps3838Credentials, doFetch: Fetch = fetch as unknown as Fetch): Promise<PinnacleMatch[]> {
  const fixtures = await get<Ps3838Fixtures>(doFetch, `/v3/fixtures?sportId=${PS3838_SOCCER}`, credentials);
  const odds = await get<Ps3838Odds>(doFetch, `/v3/odds?sportId=${PS3838_SOCCER}&oddsFormat=Decimal`, credentials);
  return ps3838MatchesOf(fixtures ?? {}, odds ?? {});
}

// Whether PS3838's API answers the owner's account, kept in the data
// folder so that its change (refused -> working, the owner's agent having
// enabled the access) is told once, not at every start of the worker.
export const PS3838_STATUS_FILE = "./data/ps3838-status.json";

export type Ps3838Access = "ok" | "refused" | "failing";

export interface Ps3838Status {
  access: Ps3838Access;
  // The refusal's or failure's reason: "HTTP 403 NO_API_ACCESS".
  detail: string | null;
  checkedAt: string;
  // The last access told to the administrators ("ok" or "refused"): a
  // failure is not told, the next read tells whether it lasts.
  told?: "ok" | "refused";
}

export function readPs3838Status(file = PS3838_STATUS_FILE): Ps3838Status | null {
  try {
    if (!existsSync(file)) return null;
    const status = JSON.parse(readFileSync(file, "utf8")) as Ps3838Status;
    return status && typeof status.access === "string" ? status : null;
  } catch {
    return null;
  }
}

export function writePs3838Status(status: Ps3838Status, file = PS3838_STATUS_FILE): void {
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(status));
  } catch (err) {
    console.warn("[reference:ps3838] could not keep its status:", err);
  }
}

// 401 and 403 are the account's answer (no API access, a wrong login): a
// refusal. Anything else (a timeout, a 5xx) is a failure, tried again.
export function accessOf(err: unknown): { access: Ps3838Access; detail: string } {
  if (err instanceof Ps3838Error) {
    return { access: err.status === 401 || err.status === 403 ? "refused" : "failing", detail: err.message.replace(/^PS3838: /, "") };
  }
  return { access: "failing", detail: err instanceof Error ? err.message.slice(0, 200) : String(err).slice(0, 200) };
}

export interface PinnacleSourceOptions {
  credentials: Ps3838Credentials | null;
  // The Odds API's Pinnacle prices, the other way (src/scraper/oddsApi.ts).
  fallback: () => Promise<PinnacleMatch[]>;
  fetch?: Fetch;
  now?: () => number;
  statusFile?: string;
  // Told when the access becomes working or refused (to the administrators'
  // Discord channel); a throw tells it again at the next read.
  onAccessChange?: (status: Ps3838Status, previous: Ps3838Status | null) => Promise<void> | void;
}

// The reference's Pinnacle matches: PS3838's when its API answers and prices
// some, The Odds API's otherwise. A refused account is asked again every
// REFUSED_RETRY_MS (its access may be enabled at any time), a working one at
// most every PS3838_MIN_READ_MS, its last matches kept in between.
export const REFUSED_RETRY_MS = 60 * 60 * 1000;

export function pinnacleSource(opts: PinnacleSourceOptions): () => Promise<PinnacleMatch[]> {
  const now = opts.now ?? Date.now;
  let last: { at: number; matches: PinnacleMatch[] } | null = null;
  let refusedAt: number | null = null;
  return async () => {
    if (!opts.credentials) return opts.fallback();
    const at = now();
    if (last && at - last.at < PS3838_MIN_READ_MS) return last.matches.length > 0 ? last.matches : opts.fallback();
    if (refusedAt !== null && at - refusedAt < REFUSED_RETRY_MS) return opts.fallback();
    const previous = readPs3838Status(opts.statusFile);
    let status: Ps3838Status;
    let matches: PinnacleMatch[] = [];
    try {
      matches = await fetchPs3838Matches(opts.credentials, opts.fetch);
      status = { access: "ok", detail: null, checkedAt: new Date(at).toISOString() };
      refusedAt = null;
      last = { at, matches };
      console.log(`[reference:ps3838] ${matches.length} football matches priced`);
    } catch (err) {
      const { access, detail } = accessOf(err);
      status = { access, detail, checkedAt: new Date(at).toISOString() };
      if (access === "refused") refusedAt = at;
      last = null;
      console.warn(`[reference:ps3838] ${access === "refused" ? "refused" : "failed"} (${detail}), The Odds API's Pinnacle prices instead`);
    }
    status.told = previous?.told;
    if (status.access !== "failing" && previous?.told !== status.access) {
      try {
        await opts.onAccessChange?.(status, previous);
        status.told = status.access;
      } catch (err) {
        console.error("[reference:ps3838] could not tell the access change:", err);
      }
    }
    writePs3838Status(status, opts.statusFile);
    return matches.length > 0 ? matches : opts.fallback();
  };
}

// The administrators' message when the access changes.
export function accessMessage(status: Ps3838Status): string {
  return status.access === "ok"
    ? "✅ **PS3838**'s API answers: Pinnacle's prices now come from it, every football league."
    : `⛔ **PS3838**'s API refuses the account (${status.detail}): Pinnacle's prices stay on The Odds API.`;
}
