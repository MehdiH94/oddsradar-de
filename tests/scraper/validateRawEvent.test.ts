import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { checkRawEvent, validateRawEvent } from "../../src/scraper/validateRawEvent";
import { RawEvent } from "../../src/types";

// Shaped like a real parsed event (Japon - Uruguay, from
// winamax-japon-uruguay-snapshot.json after snapshotToRawEvents).
function goodEvent(): RawEvent {
  return {
    sport: "football",
    competition: "Matchs Amicaux",
    startTime: "2026-09-24T10:05:00.000Z",
    participants: ["Japon", "Uruguay"],
    odds: [
      { market: "1X2", selection: "Japon", price: 1.84 },
      { market: "1X2", selection: "Match nul", price: 3.4 },
      { market: "1X2", selection: "Uruguay", price: 3.75 },
    ],
  };
}

// Deliberately bypasses the RawEvent type: the whole point of this guard is
// to catch what a real API response can contain at runtime (e.g. Winamax's
// outright markets carry competitor1Name/competitor2Name = null) even though
// the TypeScript types say otherwise.
function withOverrides(overrides: Record<string, unknown>): RawEvent {
  return { ...goodEvent(), ...overrides } as unknown as RawEvent;
}

describe("checkRawEvent", () => {
  it("accepts a well-formed head-to-head event unchanged", () => {
    const result = checkRawEvent(goodEvent());
    expect(result).toEqual({ ok: true, event: goodEvent() });
  });

  it("rejects too few participants", () => {
    expect(checkRawEvent(withOverrides({ participants: ["Japon"] })).ok).toBe(false);
    expect(checkRawEvent(withOverrides({ participants: [] })).ok).toBe(false);
  });

  it("rejects more than two participants -- a many-contestant event must never reach the matcher's factorial permutation search", () => {
    const grid = Array.from({ length: 20 }, (_, i) => `Driver ${i + 1}`);
    const result = checkRawEvent(withOverrides({ participants: grid }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/participants/);
  });

  it("rejects null, non-string, or blank participant names", () => {
    expect(checkRawEvent(withOverrides({ participants: [null, null] })).ok).toBe(false);
    expect(checkRawEvent(withOverrides({ participants: ["Japon", undefined] })).ok).toBe(false);
    expect(checkRawEvent(withOverrides({ participants: ["Japon", 42] })).ok).toBe(false);
    expect(checkRawEvent(withOverrides({ participants: ["Japon", "   "] })).ok).toBe(false);
    expect(checkRawEvent(withOverrides({ participants: "Japon - Uruguay" })).ok).toBe(false);
  });

  it("rejects an event with no odds entry priced above 1", () => {
    const priced = (prices: unknown[]) =>
      withOverrides({ odds: prices.map((price) => ({ market: "1X2", selection: "Japon", price })) });

    expect(checkRawEvent(priced([])).ok).toBe(false);
    expect(checkRawEvent(priced([NaN])).ok).toBe(false);
    expect(checkRawEvent(priced([Infinity])).ok).toBe(false);
    expect(checkRawEvent(priced([1])).ok).toBe(false);
    expect(checkRawEvent(priced([0, -2])).ok).toBe(false);
    expect(checkRawEvent(priced(["2.5"])).ok).toBe(false);
    expect(checkRawEvent(priced([null])).ok).toBe(false);
  });

  it("keeps the valid odds entries and drops only the invalid ones when at least one is valid", () => {
    const result = checkRawEvent(
      withOverrides({
        odds: [
          { market: "1X2", selection: "Japon", price: 1.84 },
          { market: "1X2", selection: "Match nul", price: NaN },
          { market: "1X2", selection: null, price: 3.75 },
          { market: "", selection: "Uruguay", price: 3.75 },
          // 1.01 is a real, valid price (Betclic's fixture has one) -- the
          // bound is strictly "> 1", not ">= some sane minimum".
          { market: "1X2", selection: "Uruguay", price: 1.01 },
        ],
      })
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.event.odds).toEqual([
        { market: "1X2", selection: "Japon", price: 1.84 },
        { market: "1X2", selection: "Uruguay", price: 1.01 },
      ]);
    }
  });

  it("rejects an invalid or missing start time", () => {
    expect(checkRawEvent(withOverrides({ startTime: "not-a-real-date" })).ok).toBe(false);
    expect(checkRawEvent(withOverrides({ startTime: "" })).ok).toBe(false);
    expect(checkRawEvent(withOverrides({ startTime: undefined })).ok).toBe(false);
    expect(checkRawEvent(withOverrides({ startTime: 1790244300 })).ok).toBe(false);
  });

  it("normalizes a valid start time to toISOString() form, which the repository's freshness filter compares as text", () => {
    const result = checkRawEvent(withOverrides({ startTime: "2026-09-23T16:45:00.0000000Z" }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.event.startTime).toBe("2026-09-23T16:45:00.000Z");
  });

  it("rejects a missing sport or competition, which the events table stores as NOT NULL", () => {
    expect(checkRawEvent(withOverrides({ sport: "" })).ok).toBe(false);
    expect(checkRawEvent(withOverrides({ sport: undefined })).ok).toBe(false);
    expect(checkRawEvent(withOverrides({ competition: undefined })).ok).toBe(false);
  });
});

describe("checkRawEvent, winner-among-N markets", () => {
  // Shaped like a real parsed Winamax market (2026-09-29 capture).
  const race = (overrides: Record<string, unknown> = {}): RawEvent =>
    ({
      sport: "cyclisme",
      competition: "",
      startTime: "2027-07-26T19:00:00.000Z",
      participants: ["Tour de France 2027 - Compétition"],
      odds: [
        { market: "Vainqueur", selection: "Tadej Pogačar", price: 1.25 },
        { market: "Vainqueur", selection: "Jonas Vingegaard", price: 6 },
        { market: "Vainqueur", selection: "Remco Evenepoel", price: 10 },
      ],
      ...overrides,
    }) as unknown as RawEvent;

  it("accepts a title and its competitors in a sport without head-to-heads", () => {
    expect(checkRawEvent(race())).toEqual({ ok: true, event: race() });
  });

  it("accepts a competition's winner in a sport with head-to-heads, like a league's", () => {
    const league = race({ sport: "football", participants: ["Ligue 1 2026/27"] });
    expect(checkRawEvent(league)).toEqual({ ok: true, event: league });
    expect(checkRawEvent(race({ sport: "tennis", participants: ["Roland-Garros (H) 2027"] })).ok).toBe(true);
  });

  it("rejects another bet on a competition, whose title is not its winner's", () => {
    for (const title of [
      "NBA 2026/2027. Vainqueur de la division",
      "NBA 2026/2027. Marchés supplémentaires",
      "Ligue 1 2026/27 - Meilleur buteur",
      "Premier League 2026/27 Top 4",
      "Bundesliga 2026/27 - Relégation",
    ]) {
      const result = checkRawEvent(race({ sport: "basketball", participants: [title] }));
      expect(result.ok, title).toBe(false);
    }
  });

  it("rejects one in a sport with no winners among N", () => {
    expect(checkRawEvent(race({ sport: "cricket", participants: ["IPL 2027"] })).ok).toBe(false);
  });

  it("rejects odds on another market, fewer than 2 priced competitors, or an outsized field", () => {
    expect(checkRawEvent(race({ odds: [...race().odds, { market: "1X2", selection: "1", price: 2 }] })).ok).toBe(false);
    expect(checkRawEvent(race({ odds: [race().odds[0], { ...race().odds[1], price: 1 }] })).ok).toBe(false);
    // At 400 each the probabilities add up to about 1: only the field's size is tested.
    const field = Array.from({ length: 401 }, (_, i) => ({ market: "Vainqueur", selection: `Runner ${i}`, price: 400 }));
    expect(checkRawEvent(race({ odds: field })).ok).toBe(false);
    expect(checkRawEvent(race({ odds: field.slice(0, 400) })).ok).toBe(true);
  });

  it("rejects a blank title", () => {
    expect(checkRawEvent(race({ participants: [" "] })).ok).toBe(false);
  });

  // 72 runners at about 10: what a Top 5 market looks like (its probabilities
  // add up to 5, plus the margin), nothing like a winner market's 1.1 to 1.8.
  const field = (runners: number, price: number) =>
    Array.from({ length: runners }, (_, i) => ({ market: "Vainqueur", selection: `Golfer ${i}`, price }));

  it("rejects a winner market whose implied probabilities add up to far more than one, like a Top 5 read as the winner", () => {
    const result = checkRawEvent(race({ odds: field(72, 10.3) }));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/implied probabilit/);
  });

  it("accepts a whole field with the bookmaker's margin, and a few favourites alone", () => {
    expect(checkRawEvent(race({ odds: field(72, 52) })).ok).toBe(true); // sum 1.38
    expect(checkRawEvent(race({ odds: field(130, 70) })).ok).toBe(true); // sum 1.86
    expect(checkRawEvent(race({ odds: field(3, 1.5) })).ok).toBe(true); // the listing's 3 favourites
  });

  it("accepts a wide margin: NetBet's golf winners add up to 1.9 to 2.3, a Top 5 to 5 even with no margin at all", () => {
    expect(checkRawEvent(race({ odds: field(95, 40.6) })).ok).toBe(true); // sum 2.34, NetBet's PGA Championship
    expect(checkRawEvent(race({ odds: field(70, 20) })).ok).toBe(true); // sum 3.5
    expect(checkRawEvent(race({ odds: field(50, 10) })).ok).toBe(false); // sum 5.0, a Top 5 at its fair prices
  });
});

describe("validateRawEvent", () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the checked event for a valid candidate, without warning", () => {
    expect(validateRawEvent(goodEvent(), "winamax")).toEqual(goodEvent());
    expect(warn).not.toHaveBeenCalled();
  });

  it("returns null and warns (never throws) for an invalid candidate", () => {
    const bad = withOverrides({ participants: [null, null], competition: "Validate-Test Cup A" });
    let result: RawEvent | null = goodEvent();
    expect(() => {
      result = validateRawEvent(bad, "winamax");
    }).not.toThrow();
    expect(result).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain("[scraper:winamax]");
  });

  it("warns only once for the same rejected event across repeated scrape cycles", () => {
    // The worker re-fetches every POLL_INTERVAL_MINUTES; a real outright
    // market stays in the feed for days, so an unconditional warn would
    // repeat the same line into the journal forever.
    const bad = withOverrides({ participants: ["Only one"], competition: "Validate-Test Cup B" });
    validateRawEvent(bad, "betclic");
    validateRawEvent(bad, "betclic");
    validateRawEvent(bad, "betclic");
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
