import { describe, it, expect, beforeEach } from "vitest";
import { gunzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { openDb } from "../../src/db/client";
import { getLatestEvents, saveMarketOdds, upsertCanonicalEvents } from "../../src/db/repository";
import { saveReferenceMarkets, saveReferenceOdds } from "../../src/db/reference";
import { inChunks, savePlayerOdds } from "../../src/db/playerReference";
import { backLayRate, getSurebets, netBack, withExchangePrices, withoutSurebets } from "../../src/db/surebets";
import { readWinamaxMarkets, WinamaxMatchReply } from "../../src/scraper/winamaxMarkets";
import { readBetclicMarkets, readBetclicMatchPage } from "../../src/scraper/betclicMarkets";
import { CanonicalEvent, RawOdds } from "../../src/types";

const hoursFromNow = (h: number) => new Date(Date.now() + h * 3600e3).toISOString();
const minutesAgo = (m: number) => new Date(Date.now() - m * 60e3).toISOString();
const now = () => new Date().toISOString();

// De Minaur - Hurkacz, every market at each bookmaker (4/10/2026).
const FIXTURES = join(__dirname, "../scraper/fixtures/markets");
const MATCH = "alex-de-minaur-hubert-hurkacz";
const TABS = ["default", "ca_ten_rslt", "ca_ten_sts", "ca_ten_gms", "ca_ten_ptss"];
function realMarkets(): { winamax: RawOdds[]; betclic: RawOdds[] } {
  const reply: WinamaxMatchReply = JSON.parse(gunzipSync(readFileSync(join(FIXTURES, `winamax-tennis-${MATCH}.json.gz`))).toString());
  return {
    winamax: readWinamaxMarkets(reply, Object.keys(reply.matches ?? {})[0]),
    betclic: readBetclicMarkets(
      TABS.map((tab) => readBetclicMatchPage(gunzipSync(readFileSync(join(FIXTURES, `betclic-tennis-${MATCH}-${tab}.bin.gz`)))))
    ),
  };
}

function event(
  id: string,
  sport: string,
  participants: string[],
  byBookmaker: CanonicalEvent["byBookmaker"],
  startTime = hoursFromNow(5)
): CanonicalEvent {
  return { id, sport, competition: "", startTime, participants, byBookmaker };
}
const main = (market: string, prices: Record<string, number>) =>
  Object.entries(prices).map(([selection, price]) => ({ market, selection, price }));

describe("getSurebets", () => {
  let db: DatabaseSync;
  beforeEach(() => {
    db = openDb(":memory:");
  });

  // A boosted price (20bet's, RawOdds.boosted) is shown beside its price: the
  // surebets, like the value bets and the alerts, weigh the price only.
  it("never makes a surebet with a boosted price, which the listing still shows", () => {
    upsertCanonicalEvents(db, [
      event("lal-bos", "basketball", ["Lakers", "Celtics"], {
        leovegas: main("Vainqueur du match", { "1": 1.9, "2": 1.95 }),
        // 2.30 boosted: 1 / (1/2.3 + 1/1.95) would pay 105.5%.
        twentybet: [
          { market: "Vainqueur du match", selection: "1", price: 1.85, boosted: 2.3 },
          { market: "Vainqueur du match", selection: "2", price: 1.9 },
        ],
      }),
    ]);
    expect(getSurebets(db)).toEqual([]);
    const [listed] = getLatestEvents(db, { sport: "basketball" }).events;
    expect(listed.byBookmaker.twentybet.odds).toEqual([
      { market: "Vainqueur du match", selection: "1", price: 1.85, boosted: 2.3 },
      { market: "Vainqueur du match", selection: "2", price: 1.9 },
    ]);
  });

  describe("on a real tennis match's every market", () => {
    beforeEach(() => {
      upsertCanonicalEvents(db, [
        event("dmh", "tennis", ["Alex De Minaur", "Hubert Hurkacz"], {
          winamax: main("Vainqueur du match", { "1": 1.84, "2": 2.05 }),
          betclic: main("Vainqueur du match", { "1": 1.83, "2": 2.0 }),
        }),
      ]);
    });
    const save = (odds: { winamax: RawOdds[]; betclic: RawOdds[] }) =>
      saveMarketOdds(
        db,
        [
          { eventId: "dmh", bookmakerId: "winamax", odds: odds.winamax },
          { eventId: "dmh", bookmakerId: "betclic", odds: odds.betclic },
        ],
        now()
      );

    it("finds none at the real prices: the best, most aces, is 99.7%", () => {
      save(realMarkets());
      expect(getSurebets(db)).toEqual([]);
    });

    it("finds one between Winamax's under and Betclic's over of the same aces line", () => {
      // Hurkacz 9.5 aces: Betclic offers only the over (1.80), Winamax both.
      const { winamax, betclic } = realMarkets();
      const priced = (odds: RawOdds[], selection: string, price: number) =>
        odds.map((o) => (o.market === "player_aces@2|9.5" && o.selection === selection ? { ...o, price } : o));
      save({ winamax: priced(winamax, "under", 2.2), betclic: priced(betclic, "over", 2.0) });

      const rate = 1 / (1 / 2.0 + 1 / 2.2);
      expect(getSurebets(db)).toEqual([
        expect.objectContaining({
          eventId: "dmh",
          market: "player_aces@2|9.5",
          marketLabel: expect.stringContaining("Hubert Hurkacz"),
          kind: "bookmakers",
          payoutRate: expect.closeTo(rate, 10),
          profit: expect.closeTo(100 * (rate - 1), 10),
          toVerify: false,
          legs: [
            { selection: "over", label: "Über 9,5", source: "betclic", side: "back", price: 2.0, stake: expect.closeTo((100 * rate) / 2.0, 10) },
            { selection: "under", label: "Unter 9,5", source: "winamax", side: "back", price: 2.2, stake: expect.closeTo((100 * rate) / 2.2, 10) },
          ],
        }),
      ]);
      // Only among the ticked bookmakers.
      expect(getSurebets(db, { bookmakers: ["winamax"] })).toEqual([]);
    });

    it("notes, as they are saved, the markets that pay above 100%: the only ones of thousands it reads", () => {
      const { winamax, betclic } = realMarkets();
      const priced = (odds: RawOdds[], selection: string, price: number) =>
        odds.map((o) => (o.market === "player_aces@2|9.5" && o.selection === selection ? { ...o, price } : o));
      const noted = () => db.prepare("SELECT market FROM surebet_markets WHERE event_id = 'dmh'").all().map((r) => r.market);
      save({ winamax: priced(winamax, "under", 2.2), betclic: priced(betclic, "over", 2.0) });
      expect(noted()).toEqual(["player_aces@2|9.5"]);
      // Its prices changed behind the markets cycle's back are not read.
      db.prepare("UPDATE event_market_odds SET price = 3 WHERE event_id = 'dmh' AND market = 'total_games|22.5'").run();
      expect(getSurebets(db).map((s) => s.market)).toEqual(["player_aces@2|9.5"]);
      // Back to the real prices: none.
      save(realMarkets());
      expect(noted()).toEqual([]);
    });
  });

  it("reads every market of hundreds of matches without overflowing the stack", () => {
    // 150,000 rows: spread into push's arguments, they overflowed it.
    db.exec(`CREATE TEMP TABLE prices (event_id TEXT NOT NULL, price REAL NOT NULL);
             WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 150000)
             INSERT INTO prices SELECT 'e' || (i % 3), 1 + i / 1000.0 FROM n`);
    expect(inChunks(db, ["e0", "e1", "e2"], "SELECT price FROM prices WHERE event_id IN", {})).toHaveLength(150000);
  });

  it("marks one over 110% to be checked, and sorts by TRJ or by kick-off", () => {
    upsertCanonicalEvents(db, [
      event("late", "basketball", ["A", "B"], {
        winamax: main("Vainqueur du match", { "1": 2.4, "2": 1.75 }),
        betclic: main("Vainqueur du match", { "1": 2.0, "2": 2.15 }),
      }, hoursFromNow(9)),
      event("soon", "basketball", ["C", "D"], {
        winamax: main("Vainqueur du match", { "1": 2.1, "2": 1.8 }),
        betclic: main("Vainqueur du match", { "1": 1.9, "2": 2.0 }),
      }, hoursFromNow(2)),
    ]);
    const byValue = getSurebets(db);
    expect(byValue.map((s) => [s.eventId, s.toVerify])).toEqual([
      ["late", true],
      ["soon", false],
    ]);
    expect(byValue[0].payoutRate).toBeCloseTo(1 / (1 / 2.4 + 1 / 2.15), 10);
    expect(getSurebets(db, { sort: "start" }).map((s) => s.eventId)).toEqual(["soon", "late"]);
    expect(getSurebets(db, { q: "C - D" }).map((s) => s.eventId)).toEqual(["soon"]);
  });

  // Real cases (20/10/2026): Betway's 9.47 on K Olsa Brakel (W) where 20bet
  // paid 2.07 made a "surebet" of 154.3 %; prices of the teams the other way
  // round at one bookmaker make one too. Neither is one bet.
  it("makes none of a price far out of line with the other sources' for its outcome", () => {
    upsertCanonicalEvents(db, [
      event("brugge-brakel", "football", ["Club Brugge II (W)", "K Olsa Brakel (W)"], {
        twentybet: main("1X2", { "1": 2.63, X: 3.73, "2": 2.07 }),
        betway: main("1X2", { "1": 1.3, X: 6.16, "2": 9.47 }),
      }),
      event("swapped", "basketball", ["A", "B"], {
        winamax: main("Vainqueur du match", { "1": 2.6, "2": 1.4 }),
        betclic: main("Vainqueur du match", { "1": 1.5, "2": 2.4 }),
      }),
    ]);
    expect(getSurebets(db)).toEqual([]);
  });

  it("makes none whose every outcome is at a single bookmaker", () => {
    upsertCanonicalEvents(db, [
      // Betway alone pays 104 % on its own two outcomes; LeoVegas pays less on both.
      event("solo", "basketball", ["A", "B"], {
        betway: main("Vainqueur du match", { "1": 2.1, "2": 2.06 }),
        leovegas: main("Vainqueur du match", { "1": 1.9, "2": 1.9 }),
      }),
      // The same prices split between two bookmakers: a surebet.
      event("pair", "basketball", ["C", "D"], {
        betway: main("Vainqueur du match", { "1": 2.1, "2": 1.9 }),
        leovegas: main("Vainqueur du match", { "1": 1.9, "2": 2.06 }),
      }),
    ]);
    expect(getSurebets(db).map((s) => [s.eventId, s.legs.map((l) => l.source)])).toEqual([["pair", ["betway", "leovegas"]]]);
  });

  it("makes none of two bookmakers' different remainders, nor of a 1X2 short of its draw", () => {
    upsertCanonicalEvents(db, [
      event("cs", "football", ["G", "H"], {
        // No draw at either: 1 / (1/2.2 + 1/2.3) would be 112 %.
        winamax: main("1X2", { "1": 2.2, "2": 2.0 }),
        betclic: main("1X2", { "1": 1.9, "2": 2.3 }),
      }),
    ]);
    // Betclic's "other" holds 4-4, Winamax's doesn't: the best of each would
    // make 460 %.
    saveMarketOdds(db, [{ eventId: "cs", bookmakerId: "winamax", odds: main("correct_score", { "1-0": 7, "4-4": 110, other: 13.5 }) }], now());
    saveMarketOdds(db, [{ eventId: "cs", bookmakerId: "betclic", odds: main("correct_score", { "1-0": 7.5, other: 5.4 }) }], now());
    // A winner whose outcomes are not its two sides (a handicap's label left
    // as the bookmaker wrote it).
    upsertCanonicalEvents(db, [
      event("hc", "basketball", ["Lakers", "Celtics"], {
        winamax: main("Vainqueur du match", { "1": 2.2, "Celtics +5.5": 2.0 }),
        betclic: main("Vainqueur du match", { "1": 1.9, "Celtics +5.5": 2.3 }),
      }),
    ]);
    expect(getSurebets(db)).toEqual([]);
  });

  it("ignores old prices and started matches", () => {
    upsertCanonicalEvents(db, [
      event("started", "basketball", ["A", "B"], {
        winamax: main("Vainqueur du match", { "1": 2.6, "2": 1.4 }),
        betclic: main("Vainqueur du match", { "1": 1.5, "2": 2.4 }),
      }, hoursFromNow(-1)),
      event("e", "football", ["E", "F"], { winamax: main("1X2", { "1": 2, X: 3, "2": 4 }) }),
    ]);
    saveMarketOdds(db, [{ eventId: "e", bookmakerId: "winamax", odds: main("btts", { yes: 2.3, no: 1.6 }) }], now());
    saveMarketOdds(db, [{ eventId: "e", bookmakerId: "betclic", odds: main("btts", { yes: 1.7, no: 2.2 }) }], minutesAgo(60));
    expect(getSurebets(db)).toEqual([]);
  });

  it("weighs a race's whole field", () => {
    upsertCanonicalEvents(db, [
      event("gp", "formule 1", ["Grand Prix"], {
        // Winamax's whole field (100%), Betclic's favourite higher.
        winamax: main("Vainqueur", { Norris: 2, Verstappen: 3, Leclerc: 6 }),
        betclic: main("Vainqueur", { Norris: 2.4 }),
      }),
    ]);
    const [race] = getSurebets(db);
    expect(race).toMatchObject({ market: "Vainqueur", kind: "bookmakers", payoutRate: expect.closeTo(1 / (1 / 2.4 + 1 / 3 + 1 / 6), 10) });
    // The favourites first.
    expect(race.legs.map((l) => [l.selection, l.source])).toEqual([
      ["Norris", "betclic"],
      ["Verstappen", "winamax"],
      ["Leclerc", "winamax"],
    ]);
  });

  describe("with the exchange", () => {
    const fair = { "1": 2.2, X: 3.5, "2": 4.4 };
    beforeEach(() => {
      upsertCanonicalEvents(db, [event("psg", "football", ["PSG", "OM"], { winamax: main("1X2", { "1": 2.3, X: 3.2, "2": 3.5 }) })]);
    });
    const exchange = (backSize: number) =>
      saveReferenceOdds(
        db,
        "psg",
        {
          fair,
          back: { "1": 2.04, X: 3.75, "2": 4.6 },
          lay: { "1": 2.08, X: 3.85, "2": 4.7 },
          backSize: { "1": 50, X: backSize, "2": 25 },
          laySize: { "1": 40, X: 30, "2": 30 },
          matched: 5000,
        },
        now()
      );

    it("backs it where it pays more, net of its 3% commission, with 20 EUR at its price", () => {
      exchange(30);
      const rate = 1 / (1 / 2.3 + 1 / netBack(3.75) + 1 / netBack(4.6));
      expect(netBack(3.75)).toBeCloseTo(1 + 2.75 * 0.97, 10);
      const surebet = getSurebets(db).find((s) => s.kind === "exchange")!;
      expect(surebet).toMatchObject({ market: "1X2", marketLabel: "Spielergebnis (1X2)", payoutRate: expect.closeTo(rate, 10) });
      expect(surebet.legs.map((l) => [l.label, l.source, l.price])).toEqual([
        ["PSG", "winamax", 2.3],
        ["Unentschieden", "exchange", 3.75],
        ["OM", "exchange", 4.6],
      ]);
      expect(surebet.legs.reduce((sum, l) => sum + l.stake, 0)).toBeCloseTo(100, 10);

      // Winamax's 2.30 on PSG laid at 2.08 too.
      expect(getSurebets(db).find((s) => s.kind === "lay")).toMatchObject({ payoutRate: expect.closeTo(backLayRate(2.3, 2.08), 10) });

      // 15 EUR on the draw: the exchange is left out, and Winamax alone pays 96%.
      exchange(15);
      expect(getSurebets(db).filter((s) => s.kind !== "lay")).toEqual([]);
    });

    // Real case (20/10/2026): Avenida's lay at 1.64 shown as Chartres', against
    // 2.40 to 2.54 at the bookmakers: a "surebet" of 144.9 %.
    it("makes none of the exchange's prices of the teams the other way round", () => {
      upsertCanonicalEvents(db, [event("swap", "football", ["Chartres", "Avenida"], { winamax: main("1X2", { "1": 4.0, X: 4.2, "2": 1.8 }) })]);
      saveReferenceOdds(
        db,
        "swap",
        {
          fair: { "1": 1.8, X: 4.35, "2": 3.95 },
          back: { "1": 1.78, X: 4.3, "2": 3.9 },
          lay: { "1": 1.82, X: 4.4, "2": 4.0 },
          backSize: { "1": 50, X: 50, "2": 50 },
          laySize: { "1": 50, X: 50, "2": 50 },
          matched: 5000,
        },
        now()
      );
      expect(getSurebets(db).filter((s) => s.eventId === "swap")).toEqual([]);
    });

    it("lays an outcome a bookmaker pays more than the exchange's lay, a player's too", () => {
      saveMarketOdds(db, [{ eventId: "psg", bookmakerId: "betclic", odds: main("anytime_scorer", { "Ousmane Dembélé": 2.5, "Bradley Barcola": 3 }) }], now());
      const players = (laySize: number) =>
        savePlayerOdds(
          db,
          "psg",
          "anytime_scorer",
          [
            { runner: "Ousmane Dembele", player: "Ousmane Dembélé", back: 2.2, lay: 2.3, backSize: 50, laySize, fair: 2.25 },
            { runner: "Bradley Barcola", player: "Bradley Barcola", back: 3.1, lay: 3.2, backSize: 50, laySize: 50, fair: 3.15 },
          ],
          800,
          now()
        );
      players(40);
      const rate = backLayRate(2.5, 2.3);
      expect(rate).toBeCloseTo((2.5 * 0.97) / 2.27, 10);
      const [lay] = getSurebets(db).filter((s) => s.kind === "lay");
      expect(lay).toMatchObject({ market: "anytime_scorer", payoutRate: expect.closeTo(rate, 10), profit: expect.closeTo(100 * (rate - 1), 10) });
      const layStake = (100 * 2.5) / 2.27;
      expect(lay.legs).toEqual([
        {
          selection: "Ousmane Dembélé",
          label: "Ousmane Dembélé",
          source: "betclic",
          side: "back",
          price: 2.5,
          stake: 100,
          exchange: { back: 2.2, backSize: 50, lay: 2.3, laySize: 40 },
        },
        {
          selection: "Ousmane Dembélé",
          label: "Ousmane Dembélé",
          source: "exchange",
          side: "lay",
          price: 2.3,
          stake: expect.closeTo(layStake, 10),
          liability: expect.closeTo(layStake * 1.3, 10),
          size: 40,
        },
      ]);
      expect(lay.thin).toBe(false);
      expect(lay.legs.map((l) => l.size)).toEqual([undefined, 40]);
      // Barcola's 3.00 is under his lay 3.20.
      expect(getSurebets(db).filter((s) => s.kind === "lay")).toHaveLength(1);
    });

    // 9/10/2026, Kosovo F. - Autriche F.: Unibet's 2-2 at 100 against an
    // exchange lay at 85 with a few euros on it, shown as a value bet only.
    it("keeps a lay with less than 20 EUR on it, flagged thin with what is offered", () => {
      saveMarketOdds(db, [{ eventId: "psg", bookmakerId: "betclic", odds: main("anytime_scorer", { "Ousmane Dembélé": 2.5 }) }], now());
      const players = (laySize: number) =>
        savePlayerOdds(
          db,
          "psg",
          "anytime_scorer",
          [{ runner: "Ousmane Dembele", player: "Ousmane Dembélé", back: 2.2, lay: 2.3, backSize: 50, laySize, fair: 2.25 }],
          800,
          now()
        );
      players(10);
      const [thin] = getSurebets(db).filter((s) => s.kind === "lay");
      expect(thin).toMatchObject({ payoutRate: expect.closeTo(backLayRate(2.5, 2.3), 10), thin: true });
      expect(thin.legs.find((l) => l.side === "lay")).toMatchObject({ size: 10 });

      // 20 EUR is enough, 1 EUR is under any bet the exchange takes.
      players(20);
      expect(getSurebets(db).find((s) => s.kind === "lay")).toMatchObject({ thin: false });
      players(1);
      expect(getSurebets(db).filter((s) => s.kind === "lay")).toEqual([]);
    });

    it("holds the value bet of a thin lay's price like any surebet", () => {
      saveMarketOdds(db, [{ eventId: "psg", bookmakerId: "betclic", odds: main("anytime_scorer", { "Ousmane Dembélé": 2.5 }) }], now());
      savePlayerOdds(
        db,
        "psg",
        "anytime_scorer",
        [{ runner: "Ousmane Dembele", player: "Ousmane Dembélé", back: 2.2, lay: 2.3, backSize: 50, laySize: 5, fair: 2.25 }],
        800,
        now()
      );
      const bet = { eventId: "psg", market: "anytime_scorer", selection: "Ousmane Dembélé", price: 2.5 };
      expect(withoutSurebets([bet], getSurebets(db))).toEqual([]);
    });

    it("backs a tournament's players where the exchange pays more, those it has 20 EUR on, not all of them", () => {
      // Winamax's whole field adds up to 108%: no surebet on its own.
      upsertCanonicalEvents(db, [event("open", "golf", ["Open d'Espagne 2026"], { winamax: main("Vainqueur", { A: 3, B: 4, C: 4, D: 4 }) })]);
      expect(getSurebets(db).filter((s) => s.eventId === "open")).toEqual([]);
      const listed = (c: number) => [
        { market: "Vainqueur", selection: "A", back: 3.4, lay: 3.5, backSize: 30, laySize: 30, matched: 9000 },
        { market: "Vainqueur", selection: "B", back: 4.8, lay: 5, backSize: 25, laySize: 30, matched: 9000 },
        { market: "Vainqueur", selection: "C", back: 4.2, lay: 4.4, backSize: c, laySize: 30, matched: 9000 },
        { market: "Vainqueur", selection: "D", back: 5, lay: 5.2, backSize: 50, laySize: 30, matched: 9000 },
      ];
      // C has 10 EUR at its back, too little: Winamax's 4 stays its price.
      saveReferenceMarkets(db, "open", listed(10), now());
      const rate = 1 / (1 / netBack(3.4) + 1 / netBack(4.8) + 1 / 4 + 1 / netBack(5));
      const surebet = getSurebets(db).find((s) => s.eventId === "open" && s.kind === "exchange")!;
      expect(surebet).toMatchObject({ market: "Vainqueur", payoutRate: expect.closeTo(rate, 10), toVerify: false });
      // The favourites first, a race's order.
      expect(surebet.legs.map((l) => [l.selection, l.source, l.price])).toEqual([
        ["A", "exchange", 3.4],
        ["C", "winamax", 4],
        ["B", "exchange", 4.8],
        ["D", "exchange", 5],
      ]);
      expect(surebet.legs.reduce((sum, l) => sum + l.stake, 0)).toBeCloseTo(100, 10);

      // With 20 EUR on C's back too, its 4.20 net 4.136 pays more: all four at
      // the exchange, a single source, so no surebet (one outcome at least
      // elsewhere, the owner's rule).
      saveReferenceMarkets(db, "open", listed(20), now());
      expect(getSurebets(db).filter((s) => s.eventId === "open" && s.kind === "exchange")).toEqual([]);

      // Nobody with 20 EUR at the back: Winamax alone, 108%, nothing.
      saveReferenceMarkets(db, "open", listed(10).map((r) => ({ ...r, backSize: 10 })), now());
      expect(getSurebets(db).filter((s) => s.eventId === "open" && s.kind === "exchange")).toEqual([]);
    });

    it("prices a tennis market or another sport's main one from its stored prices", () => {
      upsertCanonicalEvents(db, [
        event("nba", "basketball", ["Lakers", "Celtics"], { winamax: main("Vainqueur du match", { "1": 2.3, "2": 1.6 }) }),
      ]);
      saveReferenceMarkets(
        db,
        "nba",
        [
          { market: "Vainqueur du match", selection: "1", back: 2.0, lay: 2.04, backSize: 100, laySize: 100, matched: 9000 },
          { market: "Vainqueur du match", selection: "2", back: 1.98, lay: 2.02, backSize: 100, laySize: 100, matched: 9000 },
        ],
        now()
      );
      const surebets = getSurebets(db).filter((s) => s.eventId === "nba");
      expect(surebets.map((s) => [s.kind, Number(s.payoutRate.toFixed(4))])).toEqual([
        ["lay", Number(backLayRate(2.3, 2.04).toFixed(4))],
        ["exchange", Number((1 / (1 / 2.3 + 1 / netBack(1.98))).toFixed(4))],
      ]);
    });
  });
});

describe("withoutSurebets", () => {
  let db: DatabaseSync;
  beforeEach(() => {
    db = openDb(":memory:");
  });
  const bet = (eventId: string, market: string, selection: string, bookmaker: string, price: number) => ({
    eventId,
    market,
    selection,
    bookmaker,
    price,
  });

  it("leaves out every price a lay surebet's lay pays at a profit, the best one's and the others'", () => {
    // Betclic's 4.65 and NetBet's 4.50 on Israel laid at 4.20: surebets
    // (the best one listed); Winamax's 4.25 laid there loses 0.4%, a value
    // bet only.
    upsertCanonicalEvents(db, [
      event("nor-isr", "football", ["Norvège (U21)", "Israël (U21)"], {
        betclic: main("1X2", { "1": 1.5, X: 3.9, "2": 4.65 }),
        netbet: main("1X2", { "1": 1.5, X: 3.9, "2": 4.5 }),
        winamax: main("1X2", { "1": 1.5, X: 3.9, "2": 4.25 }),
      }),
    ]);
    saveReferenceOdds(
      db,
      "nor-isr",
      {
        fair: { "1": 1.62, X: 4.4, "2": 4 },
        back: { "1": 1.6, X: 4.3, "2": 3.95 },
        lay: { "1": 1.63, X: 4.5, "2": 4.2 },
        backSize: { "1": 5, X: 5, "2": 5 },
        laySize: { "1": 5, X: 5, "2": 50 },
        matched: 5000,
      },
      now()
    );
    const surebets = getSurebets(db);
    expect(surebets.map((s) => [s.kind, s.legs[0].source, s.legs[0].price])).toEqual([["lay", "betclic", 4.65]]);
    expect(backLayRate(4.5, 4.2)).toBeGreaterThan(1);
    expect(backLayRate(4.25, 4.2)).toBeLessThan(1);
    const bets = [
      bet("nor-isr", "1X2", "2", "betclic", 4.65),
      bet("nor-isr", "1X2", "2", "netbet", 4.5),
      bet("nor-isr", "1X2", "2", "winamax", 4.25),
      bet("nor-isr", "1X2", "X", "winamax", 3.9),
      bet("other", "1X2", "2", "betclic", 4.65),
    ];
    expect(withoutSurebets(bets, surebets).map((b) => [b.eventId, b.selection, b.bookmaker])).toEqual([
      ["nor-isr", "2", "winamax"],
      ["nor-isr", "X", "winamax"],
      ["other", "2", "betclic"],
    ]);
  });

  it("leaves out a surebet's every back, and a price that would make one in its place", () => {
    // Winamax's 2.20 on the Lakers and Betclic's 2.10 on the Celtics: 107.4%.
    // Vbet's 1.95 on the Lakers with Betclic's 2.10: 101.1%, a surebet too;
    // Vbet's 1.85: 97.9%, not one.
    upsertCanonicalEvents(db, [
      event("lal-bos", "basketball", ["Lakers", "Celtics"], {
        winamax: main("Vainqueur du match", { "1": 2.2, "2": 1.7 }),
        betclic: main("Vainqueur du match", { "1": 1.9, "2": 2.1 }),
      }),
    ]);
    const surebets = getSurebets(db);
    expect(surebets.map((s) => [s.kind, s.payoutRate.toFixed(4)])).toEqual([["bookmakers", (1 / (1 / 2.2 + 1 / 2.1)).toFixed(4)]]);
    const kept = withoutSurebets(
      [
        bet("lal-bos", "Vainqueur du match", "1", "winamax", 2.2),
        bet("lal-bos", "Vainqueur du match", "2", "betclic", 2.1),
        bet("lal-bos", "Vainqueur du match", "1", "vbet", 1.95),
        bet("lal-bos", "Vainqueur du match", "1", "netbet", 1.85),
        bet("lal-bos", "anytime_scorer", "1", "winamax", 2.2),
      ],
      surebets
    );
    expect(kept.map((b) => [b.market, b.bookmaker])).toEqual([
      ["Vainqueur du match", "netbet"],
      ["anytime_scorer", "winamax"],
    ]);
  });
});

describe("withExchangePrices", () => {
  it("gives a bet the exchange's prices of its outcome, a winner's from the 1X2's, and none it doesn't price", () => {
    const db = openDb(":memory:");
    upsertCanonicalEvents(db, [
      { id: "tennis", sport: "tennis", competition: "ATP Wien", startTime: hoursFromNow(5), participants: ["A", "B"], byBookmaker: {} },
    ]);
    // The main market's prices, stored as the 1X2's.
    const prices = { "1": 1.8, X: 30, "2": 2.1 };
    saveReferenceOdds(
      db,
      "tennis",
      { fair: prices, back: prices, lay: { "1": 1.82, X: 40, "2": 2.14 }, laySize: { "1": 40, X: 2, "2": 55 }, matched: 900 },
      new Date().toISOString()
    );
    const bets = [
      { eventId: "tennis", market: "Vainqueur du match", selection: "2" },
      { eventId: "tennis", market: "anytime_scorer", selection: "Nobody" },
      { eventId: "other", market: "1X2", selection: "1" },
    ];
    expect(withExchangePrices(db, bets).map((b) => b.exchange)).toEqual([{ back: 2.1, lay: 2.14, laySize: 55 }, undefined, undefined]);
  });
});
