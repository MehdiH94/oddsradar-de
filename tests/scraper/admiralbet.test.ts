import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  admiralCategoryAddress,
  AdmiralSnapshotItem,
  AdmiralSocket,
  AdmiralStore,
  decodeAdmiral,
  encodeAdmiral,
  fetchAdmiralbet,
  parseAdmiralEvents,
} from "../../src/scraper/admiralbet";

// A real snapshot of Admiralbet's sports widget (wss://ws.de.admiral.at, from
// a German IP, 16/10/2026), trimmed: 15 events of the Bundesliga, the Liga ACB,
// the DEL, a tennis Challenger and the NFL (one already in play), their
// competitors, competitions and main markets, and one removal as the site
// sends when it leaves a page.
const SNAPSHOT: AdmiralSnapshotItem[] = JSON.parse(readFileSync(join(__dirname, "fixtures/admiralbet-snapshot.json"), "utf8"));
const storeOf = (items: AdmiralSnapshotItem[]) => {
  const store = new AdmiralStore();
  store.apply(items);
  return store;
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("parseAdmiralEvents", () => {
  const events = parseAdmiralEvents(storeOf(SNAPSHOT));

  it("reads a Bundesliga match's result in regular time, labelled with the teams, net of the 5.3% tax", () => {
    const hsv = events.find((e) => e.participants[0] === "Hamburger SV")!;
    expect(hsv).toEqual({
      sport: "football",
      competition: "Bundesliga",
      startTime: "2026-10-17T13:30:00.000Z",
      participants: ["Hamburger SV", "VfB Stuttgart"],
      // 4.20, 4.20 and 1.75 as the site shows them.
      odds: [
        { market: "1X2", selection: "Hamburger SV", price: 3.977 },
        { market: "1X2", selection: "Draw", price: 3.977 },
        { market: "1X2", selection: "VfB Stuttgart", price: 1.657 },
      ],
      sourceId: "asw:event:16886659",
    });
  });

  it("reads a basketball game's winner overtime included, a tennis match's and an NFL game's", () => {
    const manresa = events.find((e) => e.participants[0] === "Basquet Manresa")!;
    expect(manresa.sport).toBe("basketball");
    expect(manresa.odds.map((o) => o.selection)).toEqual(["Basquet Manresa", "CB Malaga"]);
    expect(events.filter((e) => e.sport === "tennis")).toHaveLength(3);
    expect(events.find((e) => e.sport === "football américain")?.participants).toEqual(["Jacksonville Jaguars", "Houston Texans"]);
    expect(events.filter((e) => e.sport === "hockey sur glace").every((e) => e.odds.length === 3)).toBe(true);
  });

  it("leaves out the match in play", () => {
    expect(events.find((e) => e.participants.includes("Eintracht Frankfurt"))).toBeUndefined();
    expect(events).toHaveLength(14);
  });

  it("reads a closed market or selection as no price", () => {
    const closed = SNAPSHOT.map((item) =>
      item.type === "Selection" && item === SNAPSHOT.find((i) => i.type === "Selection") ? { ...item, entity: { ...item.entity!, state: 2 } } : item
    );
    const priced = parseAdmiralEvents(storeOf(SNAPSHOT)).flatMap((e) => e.odds).length;
    expect(parseAdmiralEvents(storeOf(closed)).flatMap((e) => e.odds).length).toBe(priced - 1);
  });

  it("keeps what a page showed when the next page removes it from the snapshot", () => {
    const store = storeOf(SNAPSHOT);
    const urn = SNAPSHOT.find((i) => i.type === "Event")!.entity!.urn;
    store.apply([{ kind: 1, type: "Event", entity: { urn } }]);
    expect(parseAdmiralEvents(store)).toHaveLength(14);
  });
});

describe("admiralCategoryAddress", () => {
  it("writes a category's path from the sport down as the site does: German names, umlauts spelled out", () => {
    const store = storeOf([
      { kind: 0, type: "Category", entity: { urn: "asw:category:10000000", name: "Admiral" } },
      { kind: 0, type: "Category", entity: { urn: "asw:category:10000002", name: "Soccer", translations: { en: "Football", de: "Fußball" }, parentCategory: "asw:category:10000000" } },
      { kind: 0, type: "Category", entity: { urn: "asw:category:10000121", name: "Germany", translations: { en: "Germany", de: "Deutschland" }, parentCategory: "asw:category:10000002" } },
      { kind: 0, type: "Category", entity: { urn: "asw:category:10011361", name: "2nd Bundesliga", translations: { en: "2. Bundesliga" }, parentCategory: "asw:category:10000121" } },
      { kind: 0, type: "Category", entity: { urn: "asw:category:10000146", name: "Turkey", translations: { en: "Turkey", de: "Türkei" }, parentCategory: "asw:category:10000002" } },
      { kind: 0, type: "Category", entity: { urn: "asw:category:10011700", name: "Super Lig", translations: { en: "Süper Lig" }, parentCategory: "asw:category:10000146" } },
    ]);
    expect(admiralCategoryAddress(store, "asw:category:10011361")).toBe("/fussball/deutschland/2-bundesliga");
    expect(admiralCategoryAddress(store, "asw:category:10011700")).toBe("/fussball/tuerkei/sueper-lig");
  });
});

// A fake of the site's socket: it answers a sport page with a top league, and
// a page with its category's path, and the markets asked for with the snapshot.
function fakeSite(opts: { silent?: boolean } = {}) {
  const sent: { payload?: { type?: string; body?: { urlPart?: string } }[] }[] = [];
  const socket: AdmiralSocket = {
    binaryType: "",
    onopen: null,
    onmessage: null,
    onerror: null,
    onclose: null,
    send(data) {
      const message = decodeAdmiral(data) as (typeof sent)[number] & { connect?: unknown };
      sent.push(message);
      const reply = (payload: unknown[]) => queueMicrotask(() => socket.onmessage?.({ data: encodeAdmiral({ payload: JSON.stringify(payload) }) }));
      if (message.connect) return queueMicrotask(() => socket.onmessage?.({ data: encodeAdmiral({ connected: {} }) }));
      for (const p of message.payload ?? []) {
        if (p.type === "ConfigureEnvironment") reply([{ type: "EnvironmentConfigured", name: "ConfigureEnvironment", body: {} }]);
        if (p.type === "RetrieveSportsbookPage" && !opts.silent) {
          const url = p.body?.urlPart;
          const isFootball = url === "/fussball";
          const isLeague = url === "/fussball/deutschland/bundesliga";
          const path = isLeague ? ["asw:category:10000002", "asw:category:10000121", "asw:category:10026374"] : ["asw:category:1"];
          reply([
            {
              type: "SportsbookSnapshotUpdated",
              body: {
                snapshotUpdate: {
                  snapshotUpdateItems: isFootball
                    ? [
                        { kind: 0, type: "Category", entity: { urn: "asw:category:10000002", name: "Soccer", translations: { de: "Fußball" }, parentCategory: "asw:category:10000000" } },
                        { kind: 0, type: "Category", entity: { urn: "asw:category:10000121", name: "Germany", translations: { de: "Deutschland" }, parentCategory: "asw:category:10000002" } },
                        { kind: 0, type: "Category", entity: { urn: "asw:category:10026374", name: "Bundesliga", translations: { en: "Bundesliga" }, parentCategory: "asw:category:10000121" } },
                      ]
                    : [],
                },
              },
            },
            {
              type: "SportsbookPageRetrieved",
              name: "RetrieveSportsbookPage/RetrieveSportsbookPage",
              body: {
                categoryPath: { categories: path },
                viewDescriptions: isFootball ? [{ properties: { TopCategoryUrns: ["asw:category:10026374"] } }] : [],
                viewNode: { viewNodes: [{ id: "SportsGrid_1", availableMarketSwitcher: ["asw:marketconfig:1"] }] },
              },
            },
          ]);
        }
        if (p.type === "UpdateSportsbookPage") reply([{ type: "SportsbookSnapshotUpdated", body: { snapshotUpdate: { snapshotUpdateItems: SNAPSHOT } } }]);
      }
    },
    close: vi.fn(),
  };
  return { factory: () => socket, socket, sent };
}

describe("fetchAdmiralbet", () => {
  it("opens each sport's page, then the leagues it puts forward, asking for their markets, and reads the events", async () => {
    const site = fakeSite();
    const events = await fetchAdmiralbet({ socket: () => (setTimeout(() => site.socket.onopen?.(), 0), site.socket), pageGapMs: 0, holdMs: 1 });
    const pages = site.sent.flatMap((m) => m.payload ?? []).filter((p) => p.type === "RetrieveSportsbookPage").map((p) => p.body?.urlPart);
    expect(pages.slice(0, 2)).toEqual(["/fussball", "/basketball"]);
    expect(pages[pages.length - 1]).toBe("/fussball/deutschland/bundesliga");
    expect(site.sent.flatMap((m) => m.payload ?? []).filter((p) => p.type === "UpdateSportsbookPage").length).toBe(pages.length);
    expect(events).toHaveLength(14);
    expect(site.socket.close).toHaveBeenCalled();
  });

  it("fails when no page answers, so that the cycle retries it", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.useFakeTimers();
    const site = fakeSite({ silent: true });
    const fetching = fetchAdmiralbet({ socket: () => (setTimeout(() => site.socket.onopen?.(), 0), site.socket), pageGapMs: 0, holdMs: 1 });
    const outcome = fetching.then(
      () => "resolved",
      (err: Error) => err.message
    );
    await vi.runAllTimersAsync();
    expect(await outcome).toBe("no Admiralbet page answered");
  });
});
