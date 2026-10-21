import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fetchVbet, openVbetSession, parseVbetGames, VBET_SPORTS, VbetReply, VbetSession, VbetSocket, vbetGamesQuery } from "../../src/scraper/vbet";

// Real answers of VBET.de's Swarm server (wss://eu-swarm-reverse.betconstruct.com/,
// in English, 21/10/2026): each sport's matches before kick-off with their
// main market, a few competitions each: the Bundesliga, the Champions League
// and the women's A-League; ATP and WTA singles and a doubles; the NBA, the
// Euroleague and a women's EuroCup game; the NHL, the SHL and the DEL 2;
// handball's Bundesliga; the NFL.
const reply = (name: string): VbetReply => JSON.parse(readFileSync(join(__dirname, `fixtures/vbet-${name}.json`), "utf8"));
const FOOTBALL = reply("football");
const TENNIS = reply("tennis");
const BASKETBALL = reply("basketball");
const ICE_HOCKEY = reply("ice-hockey");
const HANDBALL = reply("handball");
const AMERICAN_FOOTBALL = reply("american-football");
const NOW = Date.parse("2026-10-21T10:45:00Z");

afterEach(() => vi.restoreAllMocks());

const changed = (r: VbetReply, edit: (copy: VbetReply) => void): VbetReply => {
  const copy = structuredClone(r);
  edit(copy);
  return copy;
};
const gameOf = (r: VbetReply, id: number) =>
  Object.values(r.data!.sport!)
    .flatMap((s) => Object.values(s.region ?? {}))
    .flatMap((region) => Object.values(region.competition ?? {}))
    .map((c) => c.game?.[String(id)])
    .find(Boolean)!;
const priceOf = (event: { odds: { selection: string; price: number }[] }, selection: string) =>
  event.odds.find((o) => o.selection === selection)?.price;

describe("parseVbetGames", () => {
  it("reads a football match's result in ordinary time, its prices net of the tax included in the stake", () => {
    const events = parseVbetGames(FOOTBALL, "Soccer", NOW);
    expect(events).toHaveLength(7);
    const stuttgart = events.find((e) => e.sourceId === "31165393")!;
    expect(stuttgart).toMatchObject({
      sport: "football",
      competition: "Bundesliga",
      participants: ["VfB Stuttgart", "Borussia Monchengladbach"],
      startTime: "2026-10-23T18:30:00.000Z",
    });
    // The site's 1.35 / 5.50 / 6.40, times 1 / 1.053: what its bet slip pays.
    expect(stuttgart.odds.map((o) => [o.market, o.selection, o.price])).toEqual([
      ["1X2", "VfB Stuttgart", 1.282],
      ["1X2", "Draw", 5.223],
      ["1X2", "Borussia Monchengladbach", 6.078],
    ]);
  });

  it("writes a women's team with \"(W)\"", () => {
    const women = parseVbetGames(FOOTBALL, "Soccer", NOW).find((e) => e.sourceId === "31178160")!;
    expect(women.participants).toEqual(["Central Coast Mariners (W)", "Canberra United (W)"]);
    // Its outcomes come out of order in the answer: each one by its type.
    expect([priceOf(women, "Central Coast Mariners (W)"), priceOf(women, "Draw"), priceOf(women, "Canberra United (W)")]).toEqual([3.153, 3.409, 1.728]);
    const [ensino] = parseVbetGames(BASKETBALL, "Basketball", NOW).filter((e) => e.competition === "EuroCup - Women");
    expect(ensino.participants).toEqual(["Duran Maquinaria Ensino (W)", "AZS AJP Gorzow Wielkopolski (W)"]);
  });

  it("reads a tennis match's winner, doubles included", () => {
    const events = parseVbetGames(TENNIS, "Tennis", NOW);
    expect(events).toHaveLength(5);
    const navone = events.find((e) => e.sourceId === "31293546")!;
    expect(navone.odds.map((o) => [o.market, o.selection, o.price])).toEqual([
      ["Vainqueur du match", "Mariano Navone", 2.279],
      ["Vainqueur du match", "Tallon Griekspoor", 1.472],
    ]);
    expect(events.map((e) => e.participants[0])).toContain("Guido Andreozzi/Manuel Guinard");
  });

  it("reads basketball's and American football's winner, and ice hockey's and handball's result in regular time", () => {
    const nba = parseVbetGames(BASKETBALL, "Basketball", NOW).filter((e) => e.competition === "NBA");
    expect(nba.map((e) => e.participants)).toContainEqual(["Orlando Magic", "Atlanta Hawks"]);
    expect(nba.every((e) => e.odds.length === 2)).toBe(true);
    const nfl = parseVbetGames(AMERICAN_FOOTBALL, "AmericanFootball", NOW);
    expect(nfl).toHaveLength(3);
    expect(nfl.every((e) => e.sport === "football américain" && e.odds.every((o) => o.market === "Vainqueur du match"))).toBe(true);
    const hockey = parseVbetGames(ICE_HOCKEY, "IceHockey", NOW);
    expect(hockey).toHaveLength(5);
    expect(hockey.every((e) => e.sport === "hockey sur glace" && e.odds.map((o) => o.selection)[1] === "Draw")).toBe(true);
    const handball = parseVbetGames(HANDBALL, "Handball", NOW);
    expect(handball.map((e) => e.participants)).toContainEqual(["HC Erlangen", "THW Kiel"]);
    expect(handball.every((e) => e.odds.length === 3)).toBe(true);
  });

  it("leaves out a match started, live or blocked, and one whose market lacks an outcome", () => {
    // At 11:00, the three matches of 11:00 have started: Chidekh and
    // Fearnley's at 12:30 and Eala and Shnaider's the next day are left.
    expect(parseVbetGames(TENNIS, "Tennis", Date.parse("2026-10-21T11:00:00Z")).map((e) => e.sourceId)).toEqual(["31295446", "31291540"]);
    const edited = changed(FOOTBALL, (copy) => {
      gameOf(copy, 31165393).is_blocked = 1;
      gameOf(copy, 31177728).type = 1;
      gameOf(copy, 31177729).is_started = 1;
      const market = Object.values(gameOf(copy, 31142860).market!)[0];
      delete market.event![Object.keys(market.event!)[0]];
    });
    expect(parseVbetGames(edited, "Soccer", NOW).map((e) => e.sourceId)).toEqual(["31142861", "31178160", "31178161"]);
  });

  it("keeps a missing price missing, and refuses an outcome it does not know", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const edited = changed(FOOTBALL, (copy) => {
      const [first] = Object.values(Object.values(gameOf(copy, 31165393).market!)[0].event!);
      delete first.price;
      const [other] = Object.values(Object.values(gameOf(copy, 31177728).market!)[0].event!);
      other.type = "1X";
    });
    const events = parseVbetGames(edited, "Soccer", NOW);
    expect(events.map((e) => e.sourceId)).not.toContain("31177728");
    // The outcome without a price is left out (validateRawEvent), never made up.
    const stuttgart = events.find((e) => e.sourceId === "31165393")!;
    expect(stuttgart.odds).toHaveLength(2);
  });
});

// A session answering each sport's "get" from the fixtures, nothing for the others.
function fakeSession(calls: string[], failing: string[] = []): () => Promise<VbetSession> {
  const answers: Record<string, VbetReply> = {
    Soccer: FOOTBALL,
    Tennis: TENNIS,
    Basketball: BASKETBALL,
    IceHockey: ICE_HOCKEY,
    Handball: HANDBALL,
    AmericanFootball: AMERICAN_FOOTBALL,
  };
  return async () => ({
    request: async <T>(command: string, params: Record<string, unknown>): Promise<T> => {
      const alias = ((params.where as { sport: { alias: string } }).sport.alias);
      calls.push(`${command} ${alias}`);
      if (failing.includes(alias) || failing.includes("*")) throw new Error("refused");
      return (answers[alias] ?? { data: { sport: {} } }) as T;
    },
    close: () => calls.push("close"),
  });
}

describe("fetchVbet", () => {
  it("asks for each sport's matches before kick-off with their main market, on one session", async () => {
    const calls: string[] = [];
    const events = await fetchVbet({ connect: fakeSession(calls), now: () => NOW, delayMs: 0 });
    expect(calls).toEqual([...Object.keys(VBET_SPORTS).map((a) => `get ${a}`), "close"]);
    expect(events).toHaveLength(7 + 5 + 5 + 5 + 3 + 3);
    expect(vbetGamesQuery("IceHockey")).toMatchObject({ where: { sport: { alias: "IceHockey" }, game: { type: { "@in": [0, 2] } }, market: { type: "P1XP2" } } });
  });

  it("skips a sport that fails, and fails when every sport fails, so that the cycle retries it", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const some = await fetchVbet({ connect: fakeSession([], ["Soccer"]), now: () => NOW, delayMs: 0 });
    expect(some.some((e) => e.sport === "football")).toBe(false);
    expect(some.length).toBeGreaterThan(0);
    const calls: string[] = [];
    await expect(fetchVbet({ connect: fakeSession(calls, ["*"]), now: () => NOW, delayMs: 0 })).rejects.toThrow("every vbet sport failed");
    expect(calls).toContain("close");
  });
});

// A socket that answers like the server: request_session, then each command
// by its rid.
class FakeSocket implements VbetSocket {
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  onclose: (() => void) | null = null;
  sent: { command: string; params: Record<string, unknown>; rid: string }[] = [];
  closed = false;
  constructor(private answer: (msg: { command: string; rid: string }) => unknown) {
    setTimeout(() => this.onopen?.(), 0);
  }
  send(data: string) {
    const msg = JSON.parse(data);
    this.sent.push(msg);
    const reply = this.answer(msg);
    if (reply !== undefined) setTimeout(() => this.onmessage?.({ data: JSON.stringify(reply) }), 0);
  }
  close() {
    this.closed = true;
  }
}

describe("openVbetSession", () => {
  it("opens a session for VBET.de's site, then matches each answer to its command", async () => {
    let socket!: FakeSocket;
    const session = await openVbetSession(() => {
      socket = new FakeSocket((msg) => ({ code: 0, rid: msg.rid, data: msg.command === "get" ? FOOTBALL : { sid: "x" } }));
      return socket;
    });
    expect(socket.sent[0]).toMatchObject({ command: "request_session", params: { site_id: 18764169, language: "eng" } });
    const answer = await session.request<VbetReply>("get", vbetGamesQuery("Soccer"));
    expect(parseVbetGames(answer, "Soccer", NOW)).toHaveLength(7);
    session.close();
    expect(socket.closed).toBe(true);
  });

  it("fails a command the server refuses, and one that gets no answer", async () => {
    const session = await openVbetSession(
      () => new FakeSocket((msg) => (msg.command === "request_session" ? { code: 0, rid: msg.rid, data: {} } : msg.command === "get" ? { code: 2, rid: msg.rid, msg: "Invalid command" } : undefined)),
      50
    );
    await expect(session.request("get", {})).rejects.toThrow("Invalid command");
    await expect(session.request("silent", {})).rejects.toThrow("no answer");
    session.close();
  });

  it("fails when the socket closes before the session opens", async () => {
    const failing = () => {
      const socket = new FakeSocket(() => undefined);
      socket.onopen = null;
      setTimeout(() => socket.onclose?.(), 0);
      return socket;
    };
    await expect(openVbetSession(failing, 1000)).rejects.toThrow("vbet socket closed");
  });
});
