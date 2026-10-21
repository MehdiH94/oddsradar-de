import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  fetchSport888,
  parseSport888Events,
  Sport888Digest,
  sport888Periods,
  Sport888Reply,
  SPORT888_SPORTS,
} from "../../src/scraper/888sport";

// Real answers of 888sport.de's API (spectate-web.888sport.de/spectate, in
// English, 21/10/2026): a few matches of each list, live ones among them, with
// their main markets as the lists give them; a sport's digest; the tax its
// anonymous session says.
const fixture = <T>(name: string): T => JSON.parse(readFileSync(join(__dirname, `fixtures/888sport-${name}.json`), "utf8"));
const FOOTBALL = fixture<Sport888Reply>("football-today");
const FOOTBALL_LATER = fixture<Sport888Reply>("football-upcoming");
const TENNIS = fixture<Sport888Reply>("tennis-tomorrow");
const BASKETBALL = fixture<Sport888Reply>("basketball-today");
const ICE_HOCKEY = fixture<Sport888Reply>("ice-hockey-upcoming");
const AMERICAN_FOOTBALL = fixture<Sport888Reply>("american-football-upcoming");
const DIGEST = fixture<Sport888Digest>("digest-football");
const HANDBALL_DIGEST = fixture<Sport888Digest>("digest-handball");
const STATE = fixture<object>("state");

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const changed = (r: Sport888Reply, edit: (copy: Sport888Reply) => void): Sport888Reply => {
  const copy = structuredClone(r);
  edit(copy);
  return copy;
};
const priceOf = (event: { odds: { selection: string; price: number }[] }, selection: string) =>
  event.odds.find((o) => o.selection === selection)?.price;

describe("parseSport888Events", () => {
  it("reads a football match's result, its prices net of the 5% tax, and leaves the live matches out", () => {
    const events = parseSport888Events(FOOTBALL, "football");
    expect(events).toHaveLength(6);
    const bayern = events.find((e) => e.sourceId === "8404353")!;
    expect(bayern).toMatchObject({
      sport: "football",
      competition: "UEFA Champions League",
      participants: ["Bayern Munich", "Arsenal"],
      startTime: "2026-10-21T19:00:00.000Z",
    });
    // The site's 2.20 / 3.70 / 2.875, net of the tax.
    expect([priceOf(bayern, "Bayern Munich"), priceOf(bayern, "Draw"), priceOf(bayern, "Arsenal")]).toEqual([2.09, 3.515, 2.731]);
    expect(bayern.odds.every((o) => o.market === "1X2")).toBe(true);
    expect(events.some((e) => e.sourceId === "8417285")).toBe(false);
  });

  it("takes the tax the session says", () => {
    const bayern = parseSport888Events(FOOTBALL, "football", 0.053).find((e) => e.sourceId === "8404353")!;
    expect(bayern.odds.find((o) => o.selection === "Bayern Munich")?.price).toBe(2.083);
  });

  it("reads a tennis match's winner", () => {
    const first = parseSport888Events(TENNIS, "tennis").find((e) => e.sourceId === "8437505")!;
    expect(first.participants).toEqual(["Valentin Vacherot", "Luca Van Assche"]);
    expect(first.odds.map((o) => [o.market, o.selection, o.price])).toEqual([
      ["Vainqueur du match", "Valentin Vacherot", 1.492],
      ["Vainqueur du match", "Luca Van Assche", 2.256],
    ]);
  });

  it("marks a women's team \"(W)\" as the other bookmakers do", () => {
    const events = parseSport888Events(FOOTBALL_LATER, "football");
    expect(events.map((e) => e.participants)).toEqual([
      ["Central Coast Mariners (W)", "Canberra Utd (W)"],
      ["San Diego Wave (W)", "Boston Legacy FC (W)"],
    ]);
  });

  it("puts the home team first in an American match, named \"Away @ Home\"", () => {
    const [nfl] = parseSport888Events(AMERICAN_FOOTBALL, "american-football").filter((e) => e.competition === "NFL");
    expect(nfl.participants).toEqual(["Chicago Bears", "New England Patriots"]);
    expect([priceOf(nfl, "Chicago Bears"), priceOf(nfl, "New England Patriots")]).toEqual([1.492, 2.256]);
  });

  it("reads an ice hockey game's result after 60 minutes, or its money line where the list gives only that", () => {
    const events = parseSport888Events(ICE_HOCKEY, "ice-hockey");
    expect(events).toHaveLength(4);
    const davos = events.find((e) => e.participants[0] === "HC Davos")!;
    expect(davos.sport).toBe("hockey sur glace");
    expect(davos.odds.map((o) => o.market)).toEqual(["1X2", "1X2", "1X2"]);
    const nice = events.find((e) => e.participants[0] === "Nice Aigles")!;
    expect(nice.odds.map((o) => [o.market, o.selection])).toEqual([
      ["Vainqueur du match", "GAP Rapaces"],
      ["Vainqueur du match", "Nice Aigles"],
    ]);
  });

  it("leaves out a match whose main market has no selection, or is suspended, and a sport it does not read", () => {
    // A Money Line without its selections (8430299's, 21/10/2026).
    expect(parseSport888Events(BASKETBALL, "basketball").map((e) => e.sourceId).sort()).toEqual(["8427435", "8435202", "8435204"]);
    const all = parseSport888Events(BASKETBALL, "basketball").length;
    const suspended = changed(BASKETBALL, (copy) => {
      const event = Object.values(copy.events!)[0];
      Object.values(event.markets!).find((m) => m.name === "Money Line")!.tradable = false;
    });
    expect(parseSport888Events(suspended, "basketball")).toHaveLength(all - 1);
    const closedOutcome = changed(FOOTBALL, (copy) => {
      const event = copy.events!["8404353"];
      for (const s of Object.values(event.markets!["1632241"].selections!)) if (s.type === "X") s.active = false;
    });
    expect(parseSport888Events(closedOutcome, "football").find((e) => e.sourceId === "8404353")?.odds.map((o) => o.selection)).toEqual([
      "Arsenal",
      "Bayern Munich",
    ]);
    expect(parseSport888Events(FOOTBALL, "esports")).toEqual([]);
  });
});

describe("sport888Periods", () => {
  it("asks today's, tomorrow's and the later days' lists of a sport that has matches in them", () => {
    expect(sport888Periods(DIGEST)).toEqual(["today", "tomorrow", "upcoming"]);
    // Handball, 21/10/2026: one match tomorrow, none after ("upcoming": []).
    expect(sport888Periods(HANDBALL_DIGEST)).toEqual(["tomorrow"]);
    expect(sport888Periods({ live: 0, today: 0, tomorrow: 0, upcoming: [] } as Sport888Digest)).toEqual([]);
  });
});

describe("fetchSport888", () => {
  const json = (body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { headers });
  const emptyDigest = { live: 0, starting_soon: 0, today: 0, tomorrow: 0, upcoming: [], display_day_tabs: false };

  it("opens a session as the page does, then reads each sport's lists with its cookies", async () => {
    const calls: { url: string; method: string; cookie: string }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const headers = (init?.headers ?? {}) as Record<string, string>;
        calls.push({ url, method: init?.method ?? "GET", cookie: headers.cookie ?? "" });
        if (url === "https://www.888sport.de/") return new Response('<script>document.cookie="spectate_client_ver=2.180;"</script>');
        if (url.endsWith("/load/state")) {
          const form = init!.body as FormData;
          expect([form.get("language"), form.get("brand_id"), form.get("regulation_type_id")]).toEqual(["eng", "84", "12"]);
          return json(STATE, { "set-cookie": "spectate_session=abc%3Aanon; path=/; secure" });
        }
        if (url.endsWith("getEventsDigest/football")) return json(DIGEST);
        if (url.includes("getEventsDigest/")) return json(emptyDigest);
        if (url.endsWith("football/today")) return json(FOOTBALL);
        if (url.endsWith("football/upcoming")) return json(FOOTBALL_LATER);
        // "today" lists some of tomorrow's matches too: they are read once.
        if (url.endsWith("football/tomorrow")) return json(FOOTBALL);
        throw new Error(`unexpected ${url}`);
      })
    );

    const events = await fetchSport888({ delayMs: 0 });

    expect(events).toHaveLength(8);
    const state = calls.find((c) => c.url.endsWith("/load/state"))!;
    expect(state.cookie).toBe("888Cookie=lang%3Dde; spectate_client_ver=2.180");
    const list = calls.find((c) => c.url.endsWith("football/today"))!;
    expect(list.method).toBe("POST");
    expect(list.cookie).toContain("spectate_session=abc%3Aanon");
    expect(calls.filter((c) => c.url.includes("getEventsDigest/"))).toHaveLength(Object.keys(SPORT888_SPORTS).length);
  });

  it("fails when every sport fails, so that the cycle retries it", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => (url.endsWith("/load/state") ? json(STATE) : new Response("<html>", { status: 403 })))
    );
    await expect(fetchSport888({ delayMs: 0 })).rejects.toThrow("every 888sport sport failed");
  });

  it("fails when the session cannot be opened", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 406 })));
    await expect(fetchSport888({ delayMs: 0 })).rejects.toThrow("888sport load/state: HTTP 406");
  });
});
