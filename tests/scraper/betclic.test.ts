import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  fetchBetclicSport,
  fetchBetclicSportFrame,
  parseBetclicFrame,
  readBetclicMarket,
} from "../../src/scraper/betclic";
import { decodeFields, encodeStringField, encodeVarintField } from "../../src/scraper/protoWire";

const FIXTURE_PATH = join(__dirname, "fixtures/betclic-matchservice-response.bin");

// The committed fixture is a real gRPC-Web response frame with its 5-byte
// frame header (flag + big-endian length) already stripped by the capture
// script -- parseBetclicFrame takes the protobuf message bytes directly.
function loadFixtureMessageBytes(): Buffer {
  const raw = readFileSync(FIXTURE_PATH);
  const declaredLen = raw.readUInt32BE(1);
  return raw.subarray(5, 5 + declaredLen);
}

// --- hand-built minimal frames, for exercising per-match error isolation ---
//
// protoWire.ts only exports encodeStringField/encodeVarintField (string and
// varint leaf fields -- everything a real *request* needs). Betclic's
// *response* shape also nests length-delimited submessages and float64
// fields, so these two local helpers extend the same wire-format encoding
// (tag + varint length + payload) to build synthetic match/competition/
// market/selection/contestant submessages byte-for-byte compatible with what
// decodeFields/fieldMessage/fieldDouble expect to read back.
function encodeVarint(n: number): Buffer {
  const bytes: number[] = [];
  let v = n;
  while (true) {
    const b = v & 0x7f;
    v >>>= 7;
    if (v !== 0) {
      bytes.push(b | 0x80);
    } else {
      bytes.push(b);
      break;
    }
  }
  return Buffer.from(bytes);
}

function encodeMessageField(fieldNumber: number, inner: Buffer): Buffer {
  const tag = encodeVarint((fieldNumber << 3) | 2);
  return Buffer.concat([tag, encodeVarint(inner.length), inner]);
}

function encodeDoubleField(fieldNumber: number, value: number): Buffer {
  const tag = encodeVarint((fieldNumber << 3) | 1);
  const buf = Buffer.alloc(8);
  buf.writeDoubleLE(value, 0);
  return Buffer.concat([tag, buf]);
}

// Builds one match message covering every field matchToRawEvent reads: .3
// start time, .8 competition (.2 name, .3 sport info .1 slug), .9 market (.2
// name, repeated .16 selection { .10 label, .12 price }), and repeated
// top-level .12 contestants ({ .3 team name }).
function buildMatch(opts: {
  startTime: string;
  contestants: string[];
  labels?: string[]; // selection labels; defaults to the contestant names
  prices?: number[]; // one per selection; defaults to one per label
  sportSlug?: string;
  name?: string; // the match's own name (.2), all an outright market has
  marketName?: string; // the main market's own name (.9.2)
}): Buffer {
  const { startTime, contestants, sportSlug = "football" } = opts;
  const labels = opts.labels ?? contestants;
  const prices = opts.prices ?? labels.map((_, i) => 2.5 + i);
  const sportInfo = encodeStringField(1, sportSlug);
  const competition = Buffer.concat([encodeStringField(2, "Test League"), encodeMessageField(3, sportInfo)]);
  const selections = labels.map((label, i) =>
    encodeMessageField(16, Buffer.concat([encodeStringField(10, label), encodeDoubleField(12, prices[i])]))
  );
  const market = Buffer.concat([encodeStringField(2, opts.marketName ?? "Résultat du match (t. rég)"), ...selections]);

  return Buffer.concat([
    ...(opts.name === undefined ? [] : [encodeStringField(2, opts.name)]),
    encodeStringField(3, startTime),
    encodeMessageField(8, competition),
    encodeMessageField(9, market),
    ...contestants.map((name) => encodeMessageField(12, encodeStringField(3, name))),
  ]);
}

function buildGoodMatch(startTime: string, home: string, away: string): Buffer {
  return buildMatch({ startTime, contestants: [home, away], prices: [2.5, 3.5] });
}

// A match with an otherwise-well-formed shape, but whose start-time field
// (.3) holds a string Date can't parse. matchToRawEvent's presence check
// only confirms the field exists -- it doesn't validate its *content*, so
// this reaches normalizeTimestamp()'s `new Date(raw).toISOString()`, which
// throws RangeError: Invalid time value on unparseable input (verified:
// `new Date("not-a-real-date").toISOString()` throws).
function buildMatchWithUnparseableStartTime(): Buffer {
  return buildGoodMatch("not-a-real-date", "Bad Home", "Bad Away");
}

function wrapAsFrame(matches: Buffer[]): Buffer {
  const wrapperBody = Buffer.concat(matches.map((m) => encodeMessageField(3, m)));
  return encodeMessageField(1, wrapperBody);
}

describe("parseBetclicFrame", () => {
  it("parses real Betclic match data into RawEvent[]", () => {
    const events = parseBetclicFrame(loadFixtureMessageBytes());

    expect(events.length).toBeGreaterThan(30); // fixture has 40 real football matches

    const first = events[0];
    expect(first.sport).toBe("football");
    expect(first.competition).toBe("Ligue des Champions F.");
    expect(first.startTime).toBe("2026-09-23T16:45:00.000Z");
    expect(first.participants).toEqual(["Servette FC Chenois F.", "OL Lyonnes F."]);
    // The shared cross-bookmaker key, NOT Betclic's own market name
    // ("Résultat du match (t. rég)") -- Winamax calls the same market
    // "Résultat", and the frontend compares market strings exactly.
    expect(first.odds).toEqual([
      { market: "1X2", selection: "Servette FC Chenois F.", price: 30 },
      { market: "1X2", selection: "Nul", price: 15 },
      { market: "1X2", selection: "OL Lyonnes F.", price: 1.01 },
    ]);
  });

  it("gives each event Betclic's id for the match, to ask for its other markets", () => {
    const events = parseBetclicFrame(loadFixtureMessageBytes());
    expect(events.every((e) => /^\d+$/.test(e.sourceId ?? ""))).toBe(true);
    expect(new Set(events.map((e) => e.sourceId)).size).toBe(events.length);
  });

  it("labels every real 3-way market in the capture with the shared 1X2 key", () => {
    const events = parseBetclicFrame(loadFixtureMessageBytes());
    const markets = new Set(events.flatMap((e) => e.odds.map((o) => o.market)));
    expect(markets).toEqual(new Set(["1X2"]));
  });

  it("maps Betclic's sport slug onto the shared canonical sport key", () => {
    const frame = wrapAsFrame([
      buildMatch({
        startTime: "2026-09-23T18:00:00.0000000Z",
        contestants: ["Amur Khabarovsk", "Severstal Cherepovets"],
        labels: ["Amur Khabarovsk", "Nul", "Severstal Cherepovets"],
        prices: [2.1, 3.75, 2.4],
        sportSlug: "ice_hockey",
      }),
    ]);
    const [event] = parseBetclicFrame(frame);
    // Same key Winamax's real "Hockey sur glace" maps to (see canonical.test.ts).
    expect(event.sport).toBe("hockey sur glace");
    expect(new Set(event.odds.map((o) => o.market))).toEqual(new Set(["1X2"]));
  });

  it("maps a winner-among-N market of a sport without head-to-heads, and still skips one elsewhere", () => {
    const race = (sportSlug: string, name: string) =>
      buildMatch({
        startTime: "2026-10-04T07:00:00.0000000Z",
        contestants: [],
        name,
        labels: ["Kimi Antonelli", "George Russell", "Max Verstappen"],
        prices: [2.5, 4.5, 7],
        sportSlug,
      });
    const events = parseBetclicFrame(wrapAsFrame([race("formula_1", "GP de Bahreïn."), race("football", "Ligue 1")]));

    expect(events).toEqual([
      {
        sport: "formule 1",
        competition: "Test League",
        startTime: "2026-10-04T07:00:00.000Z",
        // Stray full stops and spaces trimmed off the title.
        participants: ["GP de Bahreïn"],
        odds: [
          { market: "Vainqueur", selection: "Kimi Antonelli", price: 2.5 },
          { market: "Vainqueur", selection: "George Russell", price: 4.5 },
          { market: "Vainqueur", selection: "Max Verstappen", price: 7 },
        ],
      },
    ]);
  });

  it("returns an empty array for a message with no matches", () => {
    expect(parseBetclicFrame(Buffer.alloc(0))).toEqual([]);
  });

  // Plan's Global Constraint: "a match/field that fails to parse is skipped
  // with a console.warn, never thrown, so one bad entry doesn't drop the
  // whole fetch." Without per-match error isolation, matchToRawEvent's
  // unguarded fieldString/fieldMessage/fieldDouble calls (or
  // normalizeTimestamp's Date parsing) throwing on a single malformed match
  // would propagate out of parseBetclicFrame and lose every other match in
  // the same frame -- up to 40 real matches for football in the real
  // fixture, and most BETCLIC_SPORT_SLUGS entries were only checked to answer
  // with a frame, not parsed field by field, so a field-shape mismatch for
  // those sports is plausible in production.
  it("skips a single malformed match and still returns the well-formed ones in the same frame, without throwing", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const frame = wrapAsFrame([
      buildGoodMatch("2026-09-23T16:45:00.0000000Z", "Home A", "Away A"),
      buildMatchWithUnparseableStartTime(),
      buildGoodMatch("2026-09-24T18:00:00.0000000Z", "Home B", "Away B"),
    ]);

    let events: ReturnType<typeof parseBetclicFrame> = [];
    expect(() => {
      events = parseBetclicFrame(frame);
    }).not.toThrow();

    expect(events).toHaveLength(2);
    expect(events.map((e) => e.participants)).toEqual([
      ["Home A", "Away A"],
      ["Home B", "Away B"],
    ]);
    expect(warnSpy).toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  it("reads only a main market that is the match's result or winner", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const match = (marketName: string, home: string, labels?: string[]) =>
      buildMatch({ startTime: "2026-10-05T18:00:00.0000000Z", contestants: [home, "Away"], marketName, sportSlug: "rugby_union", labels, prices: [1.84, 1.6] });
    const frame = wrapAsFrame([
      match("Vainqueur du match", "Winner"),
      match("Écart de points (handicap)", "Handicap", ["Handicap -28.5", "Away +28.5"]),
      match("Vainqueur (remboursé si match nul)", "Refunded"),
    ]);
    expect(parseBetclicFrame(frame).map((e) => [e.participants[0], e.odds[0].market])).toEqual([["Winner", "Vainqueur du match"]]);
    expect(warnSpy.mock.calls.some(([msg]) => String(msg).includes('"Écart de points (handicap)"'))).toBe(true);
    warnSpy.mockRestore();
  });

  // The shared validation guard (src/scraper/validateRawEvent.ts) runs on
  // every parsed match before it is returned, so neither of these can reach
  // the matcher -- whose permutation search is factorial in participant count.
  it("filters out a many-contestant match and a match with no real price, keeping the good one", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const grid = Array.from({ length: 20 }, (_, i) => `Driver ${i + 1}`);
    const frame = wrapAsFrame([
      buildMatch({ startTime: "2026-09-27T13:00:00.0000000Z", contestants: grid, sportSlug: "formula_1" }),
      buildMatch({ startTime: "2026-09-23T16:45:00.0000000Z", contestants: ["No", "Price"], prices: [1, 0] }),
      buildGoodMatch("2026-09-24T18:00:00.0000000Z", "Home B", "Away B"),
    ]);

    let events: ReturnType<typeof parseBetclicFrame> = [];
    expect(() => {
      events = parseBetclicFrame(frame);
    }).not.toThrow();

    expect(events.map((e) => e.participants)).toEqual([["Home B", "Away B"]]);
    expect(warnSpy.mock.calls.filter(([msg]) => String(msg).includes("skipping event"))).toHaveLength(2);

    warnSpy.mockRestore();
  });
});

// --- paging: Betclic answers 40 matches per request at most ---

// One page as Betclic sends it, gRPC-Web frame header included: each match
// carries its id (.1), and the wrapper the sport's announced total (.5).
function buildPage(ids: number[], total: number): Buffer {
  const wrapper = Buffer.concat([
    ...ids.map((id) =>
      encodeMessageField(
        3,
        Buffer.concat([encodeVarintField(1, id), buildGoodMatch("2026-10-01T18:00:00.0000000Z", `Home ${id}`, `Away ${id}`)])
      )
    ),
    encodeVarintField(5, total),
  ]);
  const message = encodeMessageField(1, wrapper);
  const header = Buffer.alloc(5);
  header.writeUInt32BE(message.length, 1);
  return Buffer.concat([header, message]);
}

// The match a match page request asked for (.1).
function requestedMatchId(init: RequestInit): number {
  return Number(decodeFields((init.body as Buffer).subarray(5)).find((f) => f.fieldNumber === 1)!.varint);
}

// Where a request asked its page to start (.4), 0 when it left that out.
function requestedOffset(init: RequestInit): number {
  const field = decodeFields((init.body as Buffer).subarray(5)).find((f) => f.fieldNumber === 4);
  return field ? Number(field.varint) : 0;
}

// Answers each listing request with the page for its offset, and each match
// page request with matchPage's answer for its match id; or fails it.
function stubBetclic(pageAt: (offset: number) => Buffer | Error, matchPage?: (matchId: number) => Buffer | Error) {
  const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
    const page = url.endsWith("/GetMatchWithNotification")
      ? (matchPage?.(requestedMatchId(init)) ?? new Error("no match page"))
      : pageAt(requestedOffset(init));
    if (page instanceof Error) throw page;
    return new Response(page);
  });
  vi.stubGlobal("fetch", fetchMock);
  return {
    fetchMock,
    offsets: () =>
      fetchMock.mock.calls.filter(([url]) => !url.endsWith("/GetMatchWithNotification")).map(([, init]) => requestedOffset(init)),
  };
}

const homeTeams = (events: Awaited<ReturnType<typeof fetchBetclicSport>>) => events.map((e) => e.participants[0]);

describe("fetchBetclicSport", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("reads every page of a sport, each request starting where the previous page ended", async () => {
    const pages: Record<number, number[]> = { 0: [1, 2], 2: [3, 4], 4: [5] };
    const { fetchMock, offsets } = stubBetclic((offset) => buildPage(pages[offset] ?? [], 5));

    const events = await fetchBetclicSport("football");

    expect(homeTeams(events)).toEqual(["Home 1", "Home 2", "Home 3", "Home 4", "Home 5"]);
    // Stops once the announced total is reached, without asking for offset 5.
    expect(offsets()).toEqual([0, 2, 4]);
    // The first request is the one Betclic's own site sends: no offset field.
    const firstRequest = decodeFields((fetchMock.mock.calls[0][1].body as Buffer).subarray(5));
    expect(firstRequest.map((f) => f.fieldNumber)).toEqual([1, 3, 5]);
  });

  it("stops on an empty page even when the announced total is higher", async () => {
    // Betclic's total also counts entries it never lists (football: 677
    // announced, 640 listed).
    const { offsets } = stubBetclic((offset) => buildPage(offset === 0 ? [1, 2] : [], 10));

    const events = await fetchBetclicSport("football");

    expect(homeTeams(events)).toEqual(["Home 1", "Home 2"]);
    expect(offsets()).toEqual([0, 2]);
  });

  it("keeps a match only once when the list shifts between two pages", async () => {
    const pages: Record<number, number[]> = { 0: [1, 2], 2: [2, 3], 4: [4, 5] };
    stubBetclic((offset) => buildPage(pages[offset] ?? [], 5));

    const events = await fetchBetclicSport("football");

    expect(homeTeams(events)).toEqual(["Home 1", "Home 2", "Home 3", "Home 4", "Home 5"]);
  });

  it("stops instead of looping when Betclic ignores the offset", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { offsets } = stubBetclic(() => buildPage([1, 2], 100));

    const events = await fetchBetclicSport("football");

    expect(homeTeams(events)).toEqual(["Home 1", "Home 2"]);
    expect(offsets()).toEqual([0, 2]);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("repeats earlier ones"));
  });

  it("keeps the pages already read when a later page fails", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    stubBetclic((offset) => (offset === 0 ? buildPage([1, 2], 6) : new Error("connection reset")));

    const events = await fetchBetclicSport("football");

    expect(homeTeams(events)).toEqual(["Home 1", "Home 2"]);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("keeping the 2 matches"), expect.any(Error));
  });

  it("fails when the first page does, for the caller to report the sport", async () => {
    stubBetclic(() => new Error("connection reset"));

    await expect(fetchBetclicSport("football")).rejects.toThrow("connection reset");
  });

  it("reads a sport with nothing to list as empty, not as a failure", async () => {
    // Betclic answers a sport without events (Australian rules out of season,
    // a rally week with none open: 8/10/2026) with an empty body, not a frame.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    stubBetclic(() => Buffer.alloc(0));

    await expect(fetchBetclicSport("australian_rules")).resolves.toEqual([]);
    expect(warn).not.toHaveBeenCalled();
  });

  it("still fails on a reply cut short inside its frame header", async () => {
    stubBetclic(() => Buffer.from([0, 0, 0]));

    await expect(fetchBetclicSport("football")).rejects.toThrow("too short");
  });

  it("gives up on a request that gets no answer, instead of holding the scrape cycle", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal!.addEventListener("abort", () => reject(new Error("aborted")));
          })
      )
    );

    const result = expect(fetchBetclicSportFrame("football")).rejects.toThrow("no answer within 20000 ms");
    await vi.advanceTimersByTimeAsync(20_000);
    await result;
  });
});

// --- winner-among-N markets: the listing's favourites, the match page's whole field ---

const withFrameHeader = (message: Buffer) => {
  const header = Buffer.alloc(5);
  header.writeUInt32BE(message.length, 1);
  return Buffer.concat([header, message]);
};

const selection = (name: string, price: number) =>
  Buffer.concat([encodeStringField(10, name), encodeDoubleField(12, price)]);

// A match page Market: its id (.1), name (.2), and its runners either in its
// selection matrix (.10 rows of .1 nullable selections holding .1 a
// selection) or only as main selections (.16), like the listing's.
function buildMarket(
  id: number,
  runners: Array<[string, number]>,
  opts: { matrix?: boolean; title?: string } = {}
): Buffer {
  const selections = runners.map(([name, price]) => selection(name, price));
  const body =
    opts.matrix === false
      ? selections.map((s) => encodeMessageField(16, s))
      : [encodeMessageField(10, Buffer.concat(selections.map((s) => encodeMessageField(1, encodeMessageField(1, s)))))];
  return Buffer.concat([encodeVarintField(1, id), encodeStringField(2, opts.title ?? "Vainqueur"), ...body]);
}

// GetMatchWithNotification's first frame: payload .1 { match .1 { sub_categories
// .11 [{ markets .3 }] } }, frame header included.
function buildMatchPage(markets: Buffer[]): Buffer {
  const subCategory = Buffer.concat([encodeStringField(2, "Principaux"), ...markets.map((m) => encodeMessageField(3, m))]);
  return withFrameHeader(encodeMessageField(1, encodeMessageField(1, encodeMessageField(11, subCategory))));
}

const readMarket = (page: Buffer, marketId: number | null) =>
  readBetclicMarket(page.subarray(5), marketId === null ? null : BigInt(marketId)).map((o) => [o.selection, o.price]);

const GRID: Array<[string, number]> = [
  ["Kimi Antonelli", 2.5],
  ["George Russell", 4.5],
  ["Max Verstappen", 7],
  ["Lando Norris", 9],
  ["Charles Leclerc", 15],
];

describe("readBetclicMarket", () => {
  it("reads the whole field of the listing's market, among the match page's others", () => {
    const page = buildMatchPage([buildMarket(10, [["Mercedes", 1.8], ["McLaren", 3]]), buildMarket(20, GRID)]);

    expect(readMarket(page, 20)).toEqual(GRID);
  });

  it("takes the page's first market with prices when the listing shows none", () => {
    const page = buildMatchPage([buildMarket(10, []), buildMarket(20, GRID), buildMarket(30, [["Mercedes", 1.8]])]);

    expect(readMarket(page, null)).toEqual(GRID);
  });

  it("falls back on a market's main selections when it has no selection matrix", () => {
    const page = buildMatchPage([buildMarket(20, GRID.slice(0, 3), { matrix: false })]);

    expect(readMarket(page, 20)).toEqual(GRID.slice(0, 3));
  });

  it("labels the runners with the shared outright market key", () => {
    const page = buildMatchPage([buildMarket(20, GRID)]);

    expect(new Set(readBetclicMarket(page.subarray(5), 20n).map((o) => o.market))).toEqual(new Set(["Vainqueur"]));
  });

  it("finds nothing in a page without a match", () => {
    expect(readBetclicMarket(Buffer.alloc(0), null)).toEqual([]);
  });

  // A golf tournament's page (Baycurrent Classic, 6/10/2026): the winner
  // first, then its Top 5, Top 10 and the leader after round 1. Betclic's
  // listing named the Top 5 as the tournament's main market.
  const WINNER_FIELD: Array<[string, number]> = [["Xander Schauffele", 10], ["Collin Morikawa", 15], ["Adam Scott", 25]];
  const TOP_5_FIELD: Array<[string, number]> = [["Xander Schauffele", 3], ["Collin Morikawa", 4.1], ["Adam Scott", 5.6]];
  const golfPage = () =>
    buildMatchPage([
      buildMarket(20, WINNER_FIELD, { title: "Vainqueur Compétition" }),
      buildMarket(30, TOP_5_FIELD, { title: "Top 5" }),
      buildMarket(40, TOP_5_FIELD, { title: "Top 10" }),
      buildMarket(50, WINNER_FIELD, { title: "Leader après la manche 1" }),
    ]);

  it("reads the winner market, not the Top 5 the listing named as the main market", () => {
    expect(readMarket(golfPage(), 30)).toEqual(WINNER_FIELD);
  });

  it("reads the winner market of a page whose listing shows no market, whatever the other markets' order", () => {
    const page = buildMatchPage([
      buildMarket(30, TOP_5_FIELD, { title: "Top 5" }),
      buildMarket(20, WINNER_FIELD, { title: "Vainqueur Compétition" }),
    ]);

    expect(readMarket(page, null)).toEqual(WINNER_FIELD);
  });

  it("leaves out the markets that are not a winner when the page has none titled as one", () => {
    const page = buildMatchPage([
      buildMarket(10, TOP_5_FIELD, { title: "Top 10" }),
      buildMarket(11, TOP_5_FIELD, { title: "Face-à-face - A v. B" }),
      buildMarket(12, TOP_5_FIELD, { title: "Double Chance - Vainqueur" }),
      buildMarket(20, GRID, { title: "Qualifications - Vainqueur" }),
    ]);

    expect(readMarket(page, null)).toEqual(GRID);
  });

  it("keeps trusting a listing's market that is not titled as a winner but is not a known other market", () => {
    const page = buildMatchPage([
      buildMarket(10, [["Mercedes", 1.8]], { title: "Vainqueur" }),
      buildMarket(20, GRID, { title: "Qualifications - Vainqueur" }),
    ]);

    expect(readMarket(page, 20)).toEqual(GRID);
  });

  it("reads nothing, rather than a wrong price, when the page only has markets that are not a winner", () => {
    const page = buildMatchPage([buildMarket(10, TOP_5_FIELD, { title: "Top 5" })]);

    expect(readMarket(page, 10)).toEqual([]);
    expect(readMarket(page, null)).toEqual([]);
  });
});

// A listed Formula 1 race: its id (.1), title (.2) and, unless marketId is
// null, its market (.9) with the first 3 runners only, like Betclic's listing.
function buildListedRace(
  id: number,
  title: string,
  marketId: number | null,
  opts: { marketTitle?: string; sportSlug?: string; favourites?: Array<[string, number]> } = {}
): Buffer {
  const competition = Buffer.concat([
    encodeStringField(2, "GP Bahrein"),
    encodeMessageField(3, encodeStringField(1, opts.sportSlug ?? "formula_1")),
  ]);
  const market =
    marketId === null
      ? []
      : [
          encodeMessageField(
            9,
            Buffer.concat([
              encodeVarintField(1, marketId),
              ...(opts.marketTitle === undefined ? [] : [encodeStringField(2, opts.marketTitle)]),
              ...(opts.favourites ?? GRID.slice(0, 3)).map(([name, price]) => encodeMessageField(16, selection(name, price))),
            ])
          ),
        ];
  return Buffer.concat([
    encodeVarintField(1, id),
    encodeStringField(2, title),
    encodeStringField(3, "2026-10-04T07:00:00.0000000Z"),
    encodeMessageField(8, competition),
    ...market,
  ]);
}

function buildListing(matches: Buffer[]): Buffer {
  const wrapper = Buffer.concat([...matches.map((m) => encodeMessageField(3, m)), encodeVarintField(5, matches.length)]);
  return withFrameHeader(encodeMessageField(1, wrapper));
}

const runnersOf = (events: Awaited<ReturnType<typeof fetchBetclicSport>>, title: string) =>
  events.find((e) => e.participants[0] === title)?.odds.map((o) => o.selection);

describe("fetchBetclicSport, winner-among-N markets", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("completes a race's 3 listed favourites with its whole field from the match page", async () => {
    const listing = buildListing([buildListedRace(1236976484257792, "GP de Bahreïn", 20)]);
    const { fetchMock } = stubBetclic(
      () => listing,
      (matchId) => (matchId === 1236976484257792 ? buildMatchPage([buildMarket(10, [["Mercedes", 1.8]]), buildMarket(20, GRID)]) : new Error("wrong match"))
    );

    const events = await fetchBetclicSport("formula_1");

    expect(runnersOf(events, "GP de Bahreïn")).toEqual(GRID.map(([name]) => name));
    // The match page request is the one Betclic's site sends: match id, language.
    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toMatch(/\.MatchService\/GetMatchWithNotification$/);
    const request = decodeFields((init.body as Buffer).subarray(5));
    expect(request.map((f) => f.fieldNumber)).toEqual([1, 2]);
  });

  it("keeps a race the listing shows no price for, with its match page's field", async () => {
    stubBetclic(
      () => buildListing([buildListedRace(7, "Championnat du Monde 2026", null)]),
      () => buildMatchPage([buildMarket(30, GRID)])
    );

    const events = await fetchBetclicSport("formula_1");

    expect(runnersOf(events, "Championnat du Monde 2026")).toEqual(GRID.map(([name]) => name));
  });

  it("keeps the listing's favourites when the match page fails, and drops a race with none", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    stubBetclic(
      () => buildListing([buildListedRace(1, "GP de Bahreïn", 20), buildListedRace(2, "GP de Bahreïn - Qualif.", null)]),
      () => new Error("connection reset")
    );

    const events = await fetchBetclicSport("formula_1");

    expect(events.map((e) => e.participants[0])).toEqual(["GP de Bahreïn"]);
    expect(runnersOf(events, "GP de Bahreïn")).toEqual(GRID.slice(0, 3).map(([name]) => name));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("keeping the listing's 3 favourites"), expect.any(Error));
  });

  // Baycurrent Classic as Betclic listed it on 6/10/2026: its main market is
  // the Top 5 (whose 3 listed favourites carry the Top 20's prices), and its
  // match page holds the winner market too.
  const TOP_5_FAVOURITES: Array<[string, number]> = [["Xander Schauffele", 1.45], ["Wyndham Clark", 1.72], ["Hideki Matsuyama", 1.75]];
  const WINNER_FIELD: Array<[string, number]> = [["Xander Schauffele", 10], ["Wyndham Clark", 15], ["Hideki Matsuyama", 16], ["Adam Scott", 25]];
  const baycurrent = () =>
    buildListing([
      buildListedRace(1243613502660608, "Baycurrent Classic 2026", 30, {
        sportSlug: "golf",
        marketTitle: "Top 5",
        favourites: TOP_5_FAVOURITES,
      }),
    ]);
  const pricesOf = (events: Awaited<ReturnType<typeof fetchBetclicSport>>, title: string) =>
    events.find((e) => e.participants[0] === title)?.odds.map((o) => [o.selection, o.price]);

  it("gives a golf tournament its winner prices when the listing names its Top 5 as the main market", async () => {
    stubBetclic(
      baycurrent,
      () => buildMatchPage([buildMarket(20, WINNER_FIELD, { title: "Vainqueur Compétition" }), buildMarket(30, TOP_5_FAVOURITES, { title: "Top 5" })])
    );

    const events = await fetchBetclicSport("golf");

    expect(pricesOf(events, "Baycurrent Classic 2026")).toEqual(WINNER_FIELD);
  });

  it("does not take a Top 5's listed favourites for the winner's when the match page fails", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    stubBetclic(baycurrent, () => new Error("connection reset"));

    const events = await fetchBetclicSport("golf");

    expect(pricesOf(events, "Baycurrent Classic 2026")).toBeUndefined();
    expect(warnSpy).toHaveBeenCalled();
  });

  it("keeps the listed favourites of a main market that is the winner, when the match page fails", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    stubBetclic(
      () =>
        buildListing([
          buildListedRace(7, "Masters 2027", 20, { sportSlug: "golf", marketTitle: "Vainqueur Compétition", favourites: WINNER_FIELD.slice(0, 3) }),
        ]),
      () => new Error("connection reset")
    );

    const events = await fetchBetclicSport("golf");

    expect(pricesOf(events, "Masters 2027")).toEqual(WINNER_FIELD.slice(0, 3));
  });

  describe("the winners of competitions", () => {
    const LEAGUE: Array<[string, number]> = [["Paris SG", 1.4], ["Marseille", 6], ["Monaco", 9], ["Lyon", 12]];
    const league = (id: number, title: string, marketTitle: string) =>
      buildListedRace(id, title, id + 1000, { sportSlug: "football", marketTitle, favourites: LEAGUE.slice(0, 3) });
    const stubListing = (races: Buffer[], page: () => Buffer | Error = () => buildMatchPage([buildMarket(1001, LEAGUE, { title: "Vainqueur" })])) =>
      stubBetclic(() => buildListing(races), page);

    it("reads the winner of a league as an outright of football, completed from its match page", async () => {
      stubListing([league(1, "Ligue 1 McDonald's®", "Vainqueur")]);

      const events = await fetchBetclicSport("football");

      expect(events).toHaveLength(1);
      expect(events[0].sport).toBe("football");
      expect(events[0].participants).toEqual(["Ligue 1 McDonald's®"]);
      expect(events[0].odds).toEqual(LEAGUE.map(([selection, price]) => ({ market: "Vainqueur", selection, price })));
    });

    it("leaves out another bet on a competition: one whose main market, or whose title, is not its winner's", async () => {
      stubListing([
        league(1, "Ligue 1 McDonald's®", "Meilleur buteur"),
        league(2, "Ligue 1 McDonald's® - Meilleur buteur", "Vainqueur"),
        league(3, "Premier League", "Vainqueur"),
      ]);
      vi.spyOn(console, "warn").mockImplementation(() => {});

      const events = await fetchBetclicSport("football");

      expect(events.map((e) => e.participants[0])).toEqual(["Premier League"]);
    });

    it("reads the winners of the first competitions of a sport only, a match page costing a request each", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const { fetchMock } = stubListing(Array.from({ length: 125 }, (_, i) => league(i + 1, `Championnat ${i + 1}`, "Vainqueur")));

      const events = await fetchBetclicSport("football");

      expect(events).toHaveLength(120);
      // The listing, and a match page for each.
      expect(fetchMock).toHaveBeenCalledTimes(121);
      expect(warn.mock.calls.filter(([message]) => String(message).includes("competitions' winners"))).toHaveLength(1);
    });
  });

  it("asks no match page for a head-to-head", async () => {
    const { fetchMock } = stubBetclic(() => buildPage([1, 2], 2));

    await fetchBetclicSport("football");

    expect(fetchMock.mock.calls.map(([url]) => url.split("/").pop())).toEqual(["GetMatchesBySportWithNotifications"]);
  });
});
