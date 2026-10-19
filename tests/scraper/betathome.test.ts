import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  BahDump,
  BahSocket,
  BETATHOME_SPORTS,
  betathomeTopic,
  fetchBetathome,
  parseBetathomeMatches,
} from "../../src/scraper/betathome";

// Real answers of bet-at-home.de's sports API (its initial dump of
// next-matches-aggregator-groups-overview-top-bets-by-dates, in English, 18/10/2026):
// each sport's first 6 matches with their main market.
const dump = (name: string): BahDump => JSON.parse(readFileSync(join(__dirname, `fixtures/betathome-${name}.json`), "utf8"));
const FOOTBALL = dump("football");
const TENNIS = dump("tennis");
const BASKETBALL = dump("basketball");
const ICE_HOCKEY = dump("ice-hockey");

afterEach(() => {
  vi.restoreAllMocks();
});

// A copy of an answer, changed by `edit`.
const changed = (d: BahDump, edit: (copy: BahDump) => void): BahDump => {
  const copy = structuredClone(d);
  edit(copy);
  return copy;
};

describe("parseBetathomeMatches", () => {
  it("reads a football match's result in ordinary time, its prices net of the 5.3% tax", () => {
    const events = parseBetathomeMatches(FOOTBALL, "1");
    expect(events).toHaveLength(6);
    const napoli = events.find((e) => e.participants[0] === "Napoli")!;
    expect(napoli.sport).toBe("football");
    expect(napoli.competition).toBe("UEFA Champions League - League Phase");
    expect(napoli.participants).toEqual(["Napoli", "Bodo/Glimt"]);
    // The site's 1.60 / 4.50 / 4.90, net of the tax.
    const price = (selection: string) => napoli.odds.find((o) => o.selection === selection)?.price;
    expect([price("Napoli"), price("Draw"), price("Bodo/Glimt")]).toEqual([1.515, 4.262, 4.64]);
    expect(napoli.odds.every((o) => o.market === "1X2")).toBe(true);
    expect(napoli.sourceId).toEqual(expect.any(String));
  });

  it("reads a tennis match's winner, a basketball game's overtime included, an ice hockey game's result", () => {
    for (const [d, sport, market] of [
      [TENNIS, "3", "Vainqueur du match"],
      [BASKETBALL, "8", "Vainqueur du match"],
      [ICE_HOCKEY, "6", "1X2"],
    ] as const) {
      const events = parseBetathomeMatches(d, sport);
      expect(events.length).toBeGreaterThan(0);
      for (const e of events) expect(e.odds.every((o) => o.market === market)).toBe(true);
    }
  });

  it("marks a women's team by its league, which the name may leave out", () => {
    // bet-at-home's "FC Bayern Munich - VfB Stuttgart" in "Bundesliga Women"
    // (18/10/2026): read as the men's, it was their match.
    const women = changed(FOOTBALL, (copy) => {
      const match = copy.records!.find((r) => r._type === "MATCH")!;
      match.parentName = "Bundesliga Women 2026/2027";
    });
    const [first] = parseBetathomeMatches(women, "1");
    expect(first.competition).toBe("Bundesliga Women");
    expect(first.participants.every((p) => p.endsWith(" (W)"))).toBe(true);
  });

  it("leaves out a match started, or whose market lacks a price", () => {
    const started = changed(FOOTBALL, (copy) => {
      copy.records!.find((r) => r._type === "MATCH")!.statusId = "2";
    });
    expect(parseBetathomeMatches(started, "1")).toHaveLength(5);
    const closed = changed(FOOTBALL, (copy) => {
      for (const offer of copy.records!.filter((r) => r._type === "BETTING_OFFER")) offer.isAvailable = false;
    });
    expect(parseBetathomeMatches(closed, "1")).toEqual([]);
    expect(parseBetathomeMatches(FOOTBALL, "999")).toEqual([]);
  });
});

// A fake of the API's socket: answers a HELLO with a WELCOME, a REGISTER with
// REGISTERED, a CALL with `answer(topic)`.
function fakeSocket(answer: (topic: string) => BahDump, topics: string[]) {
  return (): BahSocket => {
    const socket: BahSocket = {
      onopen: null,
      onmessage: null,
      onerror: null,
      onclose: null,
      send(data: string) {
        const msg = JSON.parse(data);
        const reply = (m: unknown[]) => queueMicrotask(() => socket.onmessage?.({ data: JSON.stringify(m) }));
        if (msg[0] === 1) reply([2, 1, {}]);
        else if (msg[0] === 64) reply([65, msg[1], 7]);
        else if (msg[0] === 48) {
          topics.push(msg[5].topic);
          reply([50, msg[1], {}, [], answer(msg[5].topic)]);
        }
      },
      close() {},
    };
    queueMicrotask(() => socket.onopen?.());
    return socket;
  };
}

describe("fetchBetathome", () => {
  it("asks each sport's pre-match matches of the next 14 days, with its main market's group", async () => {
    const topics: string[] = [];
    const events = await fetchBetathome({
      socket: fakeSocket((topic) => (topic.includes("-by-dates/1/") ? FOOTBALL : { records: [] }), topics),
      now: () => 1_792_360_000_000,
      delayMs: 0,
    });
    expect(events).toHaveLength(6);
    expect(topics).toHaveLength(Object.keys(BETATHOME_SPORTS).length);
    expect(topics[0]).toBe(betathomeTopic("1", "2721", 1_792_360_000, 1_792_360_000 + 14 * 24 * 3600));
    expect(topics[0]).toBe(
      "/sports/2687/en/next-matches-aggregator-groups-overview-top-bets-by-dates/1/1792360000-1793569600/NOT_LIVE/500/2721"
    );
  });

  it("reads a full window again in halves, a match on the line once", async () => {
    const topics: string[] = [];
    // 200 matches: the API's most, the window is read again in two.
    const full = changed(FOOTBALL, (copy) => {
      const match = copy.records!.find((r) => r._type === "MATCH")!;
      for (let i = 0; i < 200; i++) copy.records!.push({ ...match, id: `x${i}` });
    });
    await fetchBetathome({
      socket: fakeSocket(
        (topic) => (!topic.includes("-by-dates/1/") ? { records: [] } : topics.length === 1 ? full : FOOTBALL),
        topics
      ),
      now: () => 1_792_360_000_000,
      delayMs: 0,
    }).then((events) => expect(events).toHaveLength(6));
    const football = topics.filter((t) => t.includes("-by-dates/1/"));
    expect(football).toHaveLength(3);
    expect(football[1]).toContain("/1792360000-1792964800/");
    expect(football[2]).toContain("/1792964801-1793569600/");
  });

  it("fails when every sport fails, so that the cycle retries it", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const failing = (): BahSocket => {
      const socket: BahSocket = { onopen: null, onmessage: null, onerror: null, onclose: null, send() {}, close() {} };
      queueMicrotask(() => socket.onerror?.(new Error("refused")));
      return socket;
    };
    await expect(fetchBetathome({ socket: failing, delayMs: 0 })).rejects.toThrow("every betathome sport failed");
  });
});
