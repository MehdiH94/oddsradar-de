import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import { vi } from "vitest";
import { snapshotToRawEvents, WinamaxSnapshot } from "../../src/scraper/winamax";
import { matchEvents } from "../../src/matcher/match";

vi.mock("socket.io-client", () => {
  // src/scraper/winamax.ts imports the connect function as a named export,
  // `import { io } from "socket.io-client"`: the mock supplies `io`.
  return {
    io: vi.fn(() => {
      const emitter = new EventEmitter() as EventEmitter & {
        emit: (event: string, ...args: unknown[]) => boolean;
        close: () => void;
      };
      // Real socket.io-client Sockets expose close() (called in fetchWinamaxSnapshot's
      // finally block); EventEmitter doesn't have one, so the mock needs a stub.
      emitter.close = () => {};
      // Shapes as the live feed sends them (capture of 2026-09-27): "home"
      // carries teaser matches but no sport list, and "sport:<id>" carries no
      // sportName and no tournaments. Routes not listed get an empty reply.
      const responses: Record<string, unknown> = {
        home: { teasers: {}, home: {}, matches: {} },
        "sport:1": {
          sports: { "1": { matches: [66299580] } },
          matches: {
            "66299580": {
              sportId: 1,
              tournamentId: 18,
              mainBetId: 699803926,
              matchStart: 1790465400,
              competitor1Name: "Atlanta United FC",
              competitor2Name: "New York City FC",
            },
          },
          bets: { "699803926": { betTitle: "Résultat", outcomes: [1, 2, 3] } },
          outcomes: {
            "1": { label: "Atlanta United FC" },
            "2": { label: "Match nul" },
            "3": { label: "New York City FC" },
          },
          odds: { "1": 2.05, "2": 3.45, "3": 2.75 },
        },
      };

      const originalEmit = emitter.emit.bind(emitter);
      emitter.emit = (event: string, ...args: unknown[]) => {
        if (event === "m") {
          const payload = args[0] as { route: string; requestId: string };
          const response = { ...(responses[payload.route] as object), requestId: payload.requestId };
          setImmediate(() => originalEmit("m", response));
          return true;
        }
        return originalEmit(event, ...args);
      };

      setImmediate(() => originalEmit("connect"));
      return emitter;
    }),
  };
});

const FIXTURE_PATH = join(__dirname, "fixtures/winamax-sport1-snapshot.json");

function loadFixture(): WinamaxSnapshot {
  return JSON.parse(readFileSync(FIXTURE_PATH, "utf8"));
}

// Real capture (trimmed): Winamax's feed state from a live page load, holding
// a volleyball *outright* ("Championnat d'Europe 2026" winner, 10 runners)
// that Winamax models as a "match" with competitor1Name/competitor2Name =
// null, next to three real head-to-head matches (volleyball 2-way, tennis
// 2-way, ice hockey 3-way). Extracted from the PRELOADED_STATE in
// git show 7854191:tests/scraper/fixtures/winamax.html -- the same state
// shape the Socket.IO feed returns.
function loadOutrightFixture(): WinamaxSnapshot {
  return JSON.parse(readFileSync(join(__dirname, "fixtures/winamax-outright-snapshot.json"), "utf8"));
}

describe("snapshotToRawEvents", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("maps real Winamax snapshot data into RawEvent[]", () => {
    const events = snapshotToRawEvents(loadFixture());

    expect(events).toHaveLength(2);

    const atlanta = events.find((e) => e.participants.includes("Atlanta United FC"));
    expect(atlanta).toEqual({
      sport: "football",
      competition: "Major League Soccer",
      startTime: "2026-09-26T23:30:00.000Z",
      participants: ["Atlanta United FC", "New York City FC"],
      // The shared cross-bookmaker key, NOT Winamax's own betTitle
      // ("Résultat") -- Betclic calls the same market "Résultat du match
      // (t. rég)", and the frontend compares market strings exactly.
      odds: [
        { market: "1X2", selection: "Atlanta United FC", price: 2.05 },
        { market: "1X2", selection: "Match nul", price: 3.45 },
        { market: "1X2", selection: "New York City FC", price: 2.75 },
      ],
      // Winamax's id for the match: the key of its snapshot's matches.
      sourceId: "66299580",
    });

    const charlotte = events.find((e) => e.participants.includes("Charlotte FC"));
    expect(charlotte?.odds).toEqual([
      { market: "1X2", selection: "Charlotte FC", price: 2.05 },
      { market: "1X2", selection: "Match nul", price: 3.65 },
      { market: "1X2", selection: "Chicago Fire", price: 2.65 },
    ]);
  });

  it("reads a real outright (null competitors, 10 runners) as the winner of its competition, titled by it", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const events = snapshotToRawEvents(loadOutrightFixture());

    expect(events).toHaveLength(4);
    expect(events.map((e) => e.participants)).toEqual(
      expect.arrayContaining([
        ["Slovénie", "Serbie"],
        ["Kaitlin Quevedo", "Nadia Podoroska"],
        ["Amur Khabarovsk", "Severstal Cherepovets"],
        // Volleyball's European championship: a competition's winner, its title the only participant.
        ["Championnat d'Europe 2026"],
      ])
    );
    const europe = events.find((e) => e.participants.length === 1)!;
    expect(europe.sport).toBe("volley-ball");
    expect(europe.odds).toHaveLength(10);
    expect(europe.odds.every((o) => o.market === "Vainqueur")).toBe(true);
    expect(events.every((e) => e.participants.every((p) => typeof p === "string"))).toBe(true);
    warn.mockRestore();

    // And the surviving events are safe to hand to the real matcher, which
    // runs across every bookmaker at once -- before this guard, the outright's
    // null participant names made normalizeName() throw there.
    expect(() => matchEvents({ winamax: events })).not.toThrow();
  });

  it("maps a winner-among-N market of a sport without head-to-heads, and a competition's winner in one with", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const outright = (sportId: number, mainBetId: number, title: string) => ({
      title,
      sportId,
      tournamentId: 0,
      mainBetId,
      matchStart: 1816628400,
      competitor1Name: null,
      competitor2Name: null,
    });
    const snapshot = {
      sports: {},
      tournaments: {},
      matches: {
        1: outright(17, 10, "Tour de France 2027 - Compétition"),
        2: outright(1, 20, "Ligue 1 2026/27"),
        // Another bet on a competition has the same shape, and is not its winner.
        3: outright(1, 30, "Ligue 1 2026/27 - Meilleur buteur"),
        4: outright(1, 40, "Ligue 1 2026/27"),
      },
      bets: {
        10: { betTitle: "Classement général - Vainqueur", outcomes: [101, 102, 103] },
        20: { betTitle: "Vainqueur", outcomes: [201, 202, 203] },
        30: { betTitle: "Meilleur buteur", outcomes: [301, 302, 303] },
        40: { betTitle: "Top 4", outcomes: [201, 202, 203] },
      },
      outcomes: {
        101: { label: "Tadej Pogačar" },
        102: { label: "Jonas Vingegaard" },
        103: { label: "Remco Evenepoel" },
        201: { label: "PSG" },
        202: { label: "Marseille" },
        203: { label: "Lens" },
        301: { label: "Mbappé" },
        302: { label: "Dembélé" },
        303: { label: "Lacazette" },
      },
      odds: { 101: 1.25, 102: 6, 103: 10, 201: 1.3, 202: 8, 203: 12, 301: 3, 302: 5, 303: 9 },
    } as unknown as WinamaxSnapshot;

    const events = snapshotToRawEvents(snapshot);

    expect(events).toEqual([
      {
        sport: "cyclisme",
        competition: "",
        startTime: "2027-07-26T19:00:00.000Z",
        participants: ["Tour de France 2027 - Compétition"],
        odds: [
          { market: "Vainqueur", selection: "Tadej Pogačar", price: 1.25 },
          { market: "Vainqueur", selection: "Jonas Vingegaard", price: 6 },
          { market: "Vainqueur", selection: "Remco Evenepoel", price: 10 },
        ],
        sourceId: "1",
      },
      {
        sport: "football",
        competition: "",
        startTime: "2027-07-26T19:00:00.000Z",
        participants: ["Ligue 1 2026/27"],
        odds: [
          { market: "Vainqueur", selection: "PSG", price: 1.3 },
          { market: "Vainqueur", selection: "Marseille", price: 8 },
          { market: "Vainqueur", selection: "Lens", price: 12 },
        ],
        sourceId: "2",
      },
    ]);
    warnSpy.mockRestore();
  });

  it("labels real 2-way and 3-way main bets with the shared market keys and maps sports onto canonical keys", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const events = snapshotToRawEvents(loadOutrightFixture());
    const byFirst = (name: string) => events.find((e) => e.participants[0] === name)!;

    // Real betTitle "Vainqueur" (2-way) for tennis and volleyball, "Résultat"
    // (3-way) for ice hockey.
    expect(new Set(byFirst("Kaitlin Quevedo").odds.map((o) => o.market))).toEqual(new Set(["Vainqueur du match"]));
    expect(new Set(byFirst("Slovénie").odds.map((o) => o.market))).toEqual(new Set(["Vainqueur du match"]));
    expect(new Set(byFirst("Amur Khabarovsk").odds.map((o) => o.market))).toEqual(new Set(["1X2"]));

    expect(byFirst("Kaitlin Quevedo").sport).toBe("tennis");
    // Same key Betclic's "ice_hockey" slug maps to (see canonical.test.ts).
    expect(byFirst("Amur Khabarovsk").sport).toBe("hockey sur glace");
    // Same key Betclic's "volleyball" slug maps to.
    expect(byFirst("Slovénie").sport).toBe("volley-ball");
  });

  // Mirrors parseBetclicFrame's per-match isolation: a value that is present
  // but malformed must cost only its own match, never the rest of the fetch.
  it("skips a match whose data throws while mapping and still returns the good ones, without throwing", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const snapshot: WinamaxSnapshot = {
      sports: { "1": { sportName: "Football" }, "7": { sportName: 123 as unknown as string } },
      tournaments: { "66": { tournamentName: "Matchs Amicaux" } },
      matches: {
        good: {
          sportId: 1,
          tournamentId: 66,
          mainBetId: 10,
          matchStart: 1790244300,
          competitor1Name: "Japon",
          competitor2Name: "Uruguay",
        },
        // new Date(NaN).toISOString() throws RangeError: Invalid time value.
        badStart: {
          sportId: 1,
          tournamentId: 66,
          mainBetId: 10,
          matchStart: undefined as unknown as number,
          competitor1Name: "Bad",
          competitor2Name: "Start",
        },
        // A non-string sportName: canonicalSport throws a TypeError on it.
        badSport: {
          sportId: 7,
          tournamentId: 66,
          mainBetId: 10,
          matchStart: 1790244300,
          competitor1Name: "Bad",
          competitor2Name: "Sport",
        },
      },
      bets: { "10": { betTitle: "Résultat", outcomes: [1, 2, 3] } },
      outcomes: { "1": { label: "Japon" }, "2": { label: "Match nul" }, "3": { label: "Uruguay" } },
      odds: { "1": 1.84, "2": 3.4, "3": 3.75 },
    };

    let events: ReturnType<typeof snapshotToRawEvents> = [];
    expect(() => {
      events = snapshotToRawEvents(snapshot);
    }).not.toThrow();

    expect(events.map((e) => e.participants)).toEqual([["Japon", "Uruguay"]]);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("drops a match whose only prices are not real decimal odds", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const snapshot: WinamaxSnapshot = {
      sports: { "1": { sportName: "Football" } },
      tournaments: { "66": { tournamentName: "Matchs Amicaux" } },
      matches: {
        "1": {
          sportId: 1,
          tournamentId: 66,
          mainBetId: 10,
          matchStart: 1790244300,
          competitor1Name: "Japon",
          competitor2Name: "Uruguay",
        },
      },
      bets: { "10": { betTitle: "Résultat", outcomes: [1, 2, 3] } },
      outcomes: { "1": { label: "Japon" }, "2": { label: "Match nul" }, "3": { label: "Uruguay" } },
      odds: { "1": 1, "2": 0, "3": NaN },
    };

    expect(snapshotToRawEvents(snapshot)).toEqual([]);
  });

  it("skips a match whose sport, tournament, or main bet can't be resolved", () => {
    const snapshot: WinamaxSnapshot = {
      sports: {},
      tournaments: {},
      matches: {
        "1": {
          sportId: 999,
          tournamentId: 999,
          mainBetId: 999,
          matchStart: 1790465400,
          competitor1Name: "A",
          competitor2Name: "B",
        },
      },
      bets: {},
      outcomes: {},
      odds: {},
    };

    expect(snapshotToRawEvents(snapshot)).toEqual([]);
  });

  it("reads only a main bet that is the match's result or winner", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // Real titles (4/10/2026): Winamax put a handicap first on a lopsided
    // rugby match, a goals total on a football one.
    const match = (id: number, mainBetId: number, competitor1Name: string) => ({
      sportId: 12,
      tournamentId: 1,
      mainBetId,
      matchStart: 1791300000 + id,
      competitor1Name,
      competitor2Name: "RC Toulon",
    });
    const snapshot: WinamaxSnapshot = {
      sports: { "12": { sportName: "Rugby à XV" } },
      tournaments: { "1": { tournamentName: "Top 14" } },
      matches: { "1": match(1, 10, "Lyon OU"), "2": match(2, 20, "Montpellier"), "3": match(3, 30, "Toulouse"), "4": match(4, 40, "Pau") },
      bets: {
        "10": { betTitle: "Résultat", outcomes: [1, 2, 3] },
        "20": { betTitle: "Écart de points (handicap)", outcomes: [4, 5] },
        "30": { betTitle: "Vainqueur (remboursé si match nul)", outcomes: [6, 7] },
        "40": { betTitle: "Nombre de points", outcomes: [8, 9] },
      },
      outcomes: {
        "1": { label: "Lyon OU" },
        "2": { label: "Match nul" },
        "3": { label: "RC Toulon" },
        "4": { label: "Montpellier -28.5" },
        "5": { label: "RC Toulon +28.5" },
        "6": { label: "Toulouse" },
        "7": { label: "RC Toulon" },
        "8": { label: "Plus de 45,5" },
        "9": { label: "Moins de 45,5" },
      },
      odds: { "1": 1.36, "2": 18, "3": 2.55, "4": 1.84, "5": 1.6, "6": 1.2, "7": 4.1, "8": 1.9, "9": 1.9 },
    };

    expect(snapshotToRawEvents(snapshot).map((e) => [e.participants[0], e.odds.map((o) => o.market)])).toEqual([
      ["Lyon OU", ["1X2", "1X2", "1X2"]],
    ]);
    expect(warn.mock.calls.some(([msg]) => String(msg).includes('"Écart de points (handicap)"'))).toBe(true);
  });

  it("skips, without throwing, a match whose sportId has no name in the snapshot or the catalog", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const snapshot: WinamaxSnapshot = {
      sports: { "100000": {} },
      tournaments: {},
      matches: {
        "1": {
          sportId: 100000,
          tournamentId: 1,
          mainBetId: 10,
          matchStart: 1790244300,
          competitor1Name: "A",
          competitor2Name: "B",
        },
      },
      bets: { "10": { betTitle: "Vainqueur", outcomes: [1, 2] } },
      outcomes: { "1": { label: "A" }, "2": { label: "B" } },
      odds: { "1": 1.8, "2": 2.0 },
    };

    expect(snapshotToRawEvents(snapshot)).toEqual([]);
    expect(warn.mock.calls.some(([msg]) => String(msg).includes("sportId 100000"))).toBe(true);
  });
});

describe("fetchWinamaxSnapshot", () => {
  it("queries the known sport catalog even though home advertises no sports, and merges each sport's snapshot", async () => {
    const { fetchWinamaxSnapshot } = await import("../../src/scraper/winamax");
    const snapshot = await fetchWinamaxSnapshot();

    expect(Object.keys(snapshot.matches)).toEqual(["66299580"]);
  });

  it("maps a live-shaped snapshot (no sportName, no tournaments) into events", async () => {
    const { fetchWinamaxSnapshot } = await import("../../src/scraper/winamax");
    const events = snapshotToRawEvents(await fetchWinamaxSnapshot());

    expect(events).toEqual([
      {
        sport: "football",
        competition: "",
        startTime: "2026-09-26T23:30:00.000Z",
        participants: ["Atlanta United FC", "New York City FC"],
        odds: [
          { market: "1X2", selection: "Atlanta United FC", price: 2.05 },
          { market: "1X2", selection: "Match nul", price: 3.45 },
          { market: "1X2", selection: "New York City FC", price: 2.75 },
        ],
        sourceId: "66299580",
      },
    ]);
  });
});

// Real capture of Winamax's pages of table tennis (sport 20), badminton (31)
// and judo (79), 8/10/2026, trimmed to a single and a doubles match of each of
// the first two and two world championship categories of judo. The live
// feed never names the sports (sportNameFor).
const TABLE_TENNIS_BADMINTON_JUDO: WinamaxSnapshot = JSON.parse(
  readFileSync(join(__dirname, "fixtures/winamax-table-tennis-badminton-judo-snapshot.json"), "utf8")
);

describe("snapshotToRawEvents, table tennis, badminton and judo", () => {
  const events = snapshotToRawEvents(TABLE_TENNIS_BADMINTON_JUDO);
  const bySport = (sport: string) => events.filter((e) => e.sport === sport);

  it("reads the singles and the doubles of table tennis and badminton as head-to-heads", () => {
    expect(bySport("tennis de table").map((e) => e.participants)).toEqual(
      expect.arrayContaining([["Wang Manyu", "Yubin Shin"], ["M.Harimoto / H.Hayata", "Y.Jiang / Y.Wang"]])
    );
    expect(bySport("badminton").map((e) => e.participants)).toEqual(
      expect.arrayContaining([["Zii Jia Lee", "Christo Popov"], ["K.H.Liu / Y.Hsu", "Y.J.Zhu / Q.Li"]])
    );
    for (const e of [...bySport("tennis de table"), ...bySport("badminton")]) {
      expect(e.odds.map((o) => o.market)).toEqual(["Vainqueur du match", "Vainqueur du match"]);
    }
  });

  it("reads each category of the judo world championships as a winner market", () => {
    const judo = bySport("judo");
    expect(judo.map((e) => e.participants)).toEqual([["Ch. du Monde -100 kg (H)"], ["Ch. du Monde -78 kg (F)"]]);
    expect(judo.map((e) => e.odds.length)).toEqual([33, 42]);
    expect(new Set(judo.flatMap((e) => e.odds.map((o) => o.market)))).toEqual(new Set(["Vainqueur"]));
  });
});
