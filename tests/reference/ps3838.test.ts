import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  accessMessage,
  accessOf,
  Fetch,
  fetchPs3838Matches,
  PS3838_MIN_READ_MS,
  pinnacleSource,
  ps3838Credentials,
  Ps3838Error,
  Ps3838Fixtures,
  ps3838MatchesOf,
  Ps3838Odds,
  REFUSED_RETRY_MS,
} from "../../src/reference/ps3838";
import { PinnacleMatch } from "../../src/reference/pinnacle";

const FIXTURES: Ps3838Fixtures = {
  league: [
    {
      id: 1842,
      name: "Germany - Bundesliga",
      events: [
        { id: 101, starts: "2026-11-21T14:30:00Z", home: "Bayern Munich", away: "Borussia Dortmund", liveStatus: 0, resultingUnit: "Regular" },
        { id: 102, starts: "2026-11-21T14:30:00Z", home: "Bayern Munich (Corners)", away: "Borussia Dortmund (Corners)", liveStatus: 0 },
        { id: 103, starts: "2026-11-21T14:30:00Z", home: "VfB Stuttgart", away: "SC Freiburg", liveStatus: 1 },
        { id: 104, starts: "2026-11-21T17:30:00Z", home: "RB Leipzig", away: "Werder Bremen", liveStatus: 2, resultingUnit: "Bookings" },
        { id: 105, starts: "2026-11-22T16:30:00Z", home: "Union Berlin", away: "Mainz 05", liveStatus: 2 },
      ],
    },
  ],
};

const ODDS: Ps3838Odds = {
  leagues: [
    {
      id: 1842,
      events: [
        { id: 101, periods: [{ number: 0, status: 1, moneyline: { home: 1.4, draw: 5.6, away: 7.1 } }, { number: 1, status: 1, moneyline: { home: 1.9, draw: 2.6, away: 6 } }] },
        { id: 102, periods: [{ number: 0, status: 1, moneyline: { home: 1.8, draw: 9, away: 2.5 } }] },
        { id: 103, periods: [{ number: 0, status: 1, moneyline: { home: 2.1, draw: 3.4, away: 3.5 } }] },
        { id: 104, periods: [{ number: 0, status: 1, moneyline: { home: 1.7, draw: 4, away: 4.6 } }] },
        // Offline line: no price.
        { id: 105, periods: [{ number: 0, status: 2, moneyline: { home: 2.4, draw: 3.3, away: 3 } }] },
      ],
    },
  ],
};

const BAYERN: PinnacleMatch = {
  id: "ps3838:101",
  participants: ["Bayern Munich", "Borussia Dortmund"],
  startTime: "2026-11-21T14:30:00Z",
  prices: { home: 1.4, draw: 5.6, away: 7.1 },
};

describe("ps3838MatchesOf", () => {
  it("keeps the matches priced before the kick-off, with their full match's 1X2", () => {
    expect(ps3838MatchesOf(FIXTURES, ODDS)).toEqual([BAYERN]);
  });

  it("leaves out a match without its three prices", () => {
    const odds: Ps3838Odds = { leagues: [{ events: [{ id: 101, periods: [{ number: 0, moneyline: { home: 1.4, away: 7.1 } }] }] }] };
    expect(ps3838MatchesOf(FIXTURES, odds)).toEqual([]);
  });

  it("reads empty answers as no match", () => {
    expect(ps3838MatchesOf({}, {})).toEqual([]);
  });
});

describe("ps3838Credentials", () => {
  it("needs both the username and the password", () => {
    expect(ps3838Credentials({ PS3838_USERNAME: "u", PS3838_PASSWORD: "p" })).toEqual({ username: "u", password: "p" });
    expect(ps3838Credentials({ PS3838_USERNAME: "u" })).toBeNull();
    expect(ps3838Credentials({ PS3838_USERNAME: " ", PS3838_PASSWORD: "p" })).toBeNull();
  });
});

type Answer = { status: number; body: unknown };

function fakeFetch(answer: (url: string) => Answer, seen: { url: string; auth?: string }[] = []): Fetch {
  return async (url, init) => {
    seen.push({ url, auth: init.headers.Authorization });
    const { status, body } = answer(url);
    return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) };
  };
}

const okAnswers = (url: string): Answer => ({ status: 200, body: url.includes("/v3/fixtures") ? FIXTURES : ODDS });
const refused = (): Answer => ({ status: 403, body: { code: "NO_API_ACCESS", message: "Account not permitted to access the API" } });

describe("fetchPs3838Matches", () => {
  it("reads football's fixtures and decimal odds with the account's login", async () => {
    const seen: { url: string; auth?: string }[] = [];
    const matches = await fetchPs3838Matches({ username: "user", password: "secret" }, fakeFetch(okAnswers, seen));
    expect(matches).toEqual([BAYERN]);
    expect(seen.map((s) => s.url)).toEqual(["https://api.ps3838.com/v3/fixtures?sportId=29", "https://api.ps3838.com/v3/odds?sportId=29&oddsFormat=Decimal"]);
    expect(seen[0].auth).toBe(`Basic ${Buffer.from("user:secret").toString("base64")}`);
  });

  it("throws PS3838's code on a refusal, without the login", async () => {
    const err = await fetchPs3838Matches({ username: "user", password: "secret" }, fakeFetch(refused)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Ps3838Error);
    expect((err as Ps3838Error).message).toBe("PS3838: HTTP 403 NO_API_ACCESS");
    expect((err as Error).message).not.toContain("secret");
  });
});

describe("accessOf", () => {
  it("reads 401 and 403 as a refusal, the rest as a failure", () => {
    expect(accessOf(new Ps3838Error(403, "NO_API_ACCESS"))).toEqual({ access: "refused", detail: "HTTP 403 NO_API_ACCESS" });
    expect(accessOf(new Ps3838Error(401, null))).toEqual({ access: "refused", detail: "HTTP 401" });
    expect(accessOf(new Ps3838Error(503, null)).access).toBe("failing");
    expect(accessOf(new Error("timeout")).access).toBe("failing");
  });
});

describe("pinnacleSource", () => {
  const FALLBACK: PinnacleMatch = { ...BAYERN, id: "odds-api-1" };
  const fallback = async () => [FALLBACK];
  const statusFile = () => join(mkdtempSync(join(tmpdir(), "ps3838-")), "ps3838-status.json");

  it("stays on The Odds API without a login", async () => {
    const source = pinnacleSource({ credentials: null, fallback, fetch: fakeFetch(okAnswers), statusFile: statusFile() });
    expect(await source()).toEqual([FALLBACK]);
  });

  it("takes PS3838's matches when its API answers, and tells it once", async () => {
    const file = statusFile();
    const told: string[] = [];
    let now = Date.parse("2026-11-19T12:00:00Z");
    const source = pinnacleSource({
      credentials: { username: "u", password: "p" },
      fallback,
      fetch: fakeFetch(okAnswers),
      now: () => now,
      statusFile: file,
      onAccessChange: (status) => void told.push(status.access),
    });
    expect(await source()).toEqual([BAYERN]);
    now += PS3838_MIN_READ_MS;
    expect(await source()).toEqual([BAYERN]);
    expect(told).toEqual(["ok"]);
    expect(JSON.parse(readFileSync(file, "utf8"))).toMatchObject({ access: "ok", told: "ok" });
  });

  it("reads PS3838 at most every PS3838_MIN_READ_MS, its last matches in between", async () => {
    const seen: { url: string }[] = [];
    let now = 0;
    const source = pinnacleSource({ credentials: { username: "u", password: "p" }, fallback, fetch: fakeFetch(okAnswers, seen), now: () => now, statusFile: statusFile() });
    await source();
    now += PS3838_MIN_READ_MS - 1;
    expect(await source()).toEqual([BAYERN]);
    expect(seen).toHaveLength(2);
  });

  it("falls back to The Odds API when refused, asks again an hour later, and tells the refusal once", async () => {
    const seen: { url: string }[] = [];
    const told: string[] = [];
    let now = 0;
    const file = statusFile();
    const opts = {
      credentials: { username: "u", password: "p" },
      fallback,
      fetch: fakeFetch(refused, seen),
      now: () => now,
      statusFile: file,
      onAccessChange: (status: { access: string }) => void told.push(status.access),
    };
    const source = pinnacleSource(opts);
    expect(await source()).toEqual([FALLBACK]);
    now += REFUSED_RETRY_MS - 1;
    expect(await source()).toEqual([FALLBACK]);
    expect(seen).toHaveLength(1);
    now += 1;
    await source();
    expect(seen).toHaveLength(2);
    // A restarted worker reads the told refusal: not told again.
    await pinnacleSource(opts)();
    expect(told).toEqual(["refused"]);
    expect(JSON.parse(readFileSync(file, "utf8"))).toMatchObject({ access: "refused", detail: "HTTP 403 NO_API_ACCESS" });
  });

  it("does not tell a passing failure, and keeps The Odds API's prices", async () => {
    const told: string[] = [];
    const source = pinnacleSource({
      credentials: { username: "u", password: "p" },
      fallback,
      fetch: fakeFetch(() => ({ status: 503, body: "busy" })),
      statusFile: statusFile(),
      onAccessChange: (status) => void told.push(status.access),
    });
    expect(await source()).toEqual([FALLBACK]);
    expect(told).toEqual([]);
  });

  it("falls back when PS3838 prices no match", async () => {
    const empty = fakeFetch(() => ({ status: 200, body: {} }));
    const source = pinnacleSource({ credentials: { username: "u", password: "p" }, fallback, fetch: empty, statusFile: statusFile() });
    expect(await source()).toEqual([FALLBACK]);
  });
});

describe("accessMessage", () => {
  it("says where Pinnacle's prices come from", () => {
    expect(accessMessage({ access: "ok", detail: null, checkedAt: "" })).toContain("now come from it");
    expect(accessMessage({ access: "refused", detail: "HTTP 403 NO_API_ACCESS", checkedAt: "" })).toContain("HTTP 403 NO_API_ACCESS");
  });
});
