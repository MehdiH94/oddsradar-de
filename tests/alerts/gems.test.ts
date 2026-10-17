import { describe, it, expect, beforeEach, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { openDb } from "../../src/db/client";
import { saveMarketOdds, upsertCanonicalEvents } from "../../src/db/repository";
import { saveReferenceOdds } from "../../src/db/reference";
import { savePlayerOdds } from "../../src/db/playerReference";
import { gemKey, getAlertStatus } from "../../src/db/alerts";
import {
  assertSendable,
  DISCORD_LIMITS,
  embedChars,
  fitMessage,
  GEM_MIN_EDGE,
  gemEmbed,
  gemsMessage,
  helloMessage,
  isGem,
  MAX_GEMS_PER_MESSAGE,
  RATE_LIMIT_MAX_WAIT_MS,
  runGemAlerts,
  surebetEmbed,
  surebetsMessage,
} from "../../src/alerts/gems";
import { Surebet } from "../../src/db/surebets";
import { ValueBet } from "../../src/db/repository";
import { RawOdds } from "../../src/types";

const WEBHOOK = "https://discord.com/api/webhooks/1/token-secret";
const SITE = "https://cote-radar.fr";
const KICK_OFF = new Date(Date.now() + 2 * 3600e3);
KICK_OFF.setUTCSeconds(0, 0);
const oneXTwo = ([one, draw, two]: number[]): RawOdds[] => [
  { market: "1X2", selection: "1", price: one },
  { market: "1X2", selection: "X", price: draw },
  { market: "1X2", selection: "2", price: two },
];

describe("isGem", () => {
  it("is a 1X2's value bet from 5%, a player's from 15%", () => {
    expect(GEM_MIN_EDGE).toEqual({ match: 0.05, players: 0.15 });
    expect(isGem({ market: "1X2", edge: 2.1 / 2 - 1 })).toBe(true);
    expect(isGem({ market: "1X2", edge: 0.0499 })).toBe(false);
    expect(isGem({ market: "anytime_scorer", edge: 2.3 / 2 - 1 })).toBe(true);
    expect(isGem({ market: "scorer_goals|2", edge: 0.149 })).toBe(false);
    expect(isGem({ market: "first_scorer", edge: 0.1 })).toBe(false);
  });
});

describe("a golf tournament's winner", () => {
  it("is a gem from 15% like a player's, its prices being as wide", () => {
    expect(isGem({ market: "Vainqueur", edge: 0.1 })).toBe(false);
    expect(isGem({ market: "Vainqueur", edge: 0.15 })).toBe(true);
  });

  it("is sent with its percentage and its tournament only", () => {
    const message = gemsMessage(
      [
        {
          eventId: "e",
          sport: "golf",
          competition: "Baycurrent Classic",
          startTime: "2026-10-10T20:30:00.000Z",
          participants: ["Baycurrent Classic 2026"],
          marketCount: 0,
          market: "Vainqueur",
          marketLabel: "Vainqueur du tournoi",
          selection: "Collin Morikawa",
          label: "Collin Morikawa",
          bookmaker: "unibet",
          price: 18,
          basis: "fair",
          fair: 15,
          edge: 0.2,
          matched: 44105,
        },
      ],
      SITE
    ) as { embeds: { title: string; description?: string; fields: { name: string; value: string }[] }[] };
    expect(message.embeds[0].title).toBe("💎 +20.0%");
    expect(message.embeds[0].description).toBeUndefined();
    expect(message.embeds[0].fields[0].value).toBe("Baycurrent Classic 2026 · Baycurrent Classic");
  });
});

describe("what an alert is sent once for", () => {
  const tournament = { eventId: "masters", market: "Vainqueur", selection: "Collin Morikawa", bookmaker: "unibet" };

  it("is a match, a market and an outcome, whoever offers the price", () => {
    const key = gemKey(tournament);
    // The same outcome at another bookmaker: the same alert.
    expect(gemKey({ ...tournament, bookmaker: "merkurbets" })).toBe(key);
    // The winner, the Top 5 and the Top 10 of a tournament: three alerts.
    const keys = ["Vainqueur", "golf_top|5", "golf_top|10"].map((market) => gemKey({ ...tournament, market }));
    expect(new Set(keys).size).toBe(3);
    // A second winner of the same tournament: another alert, same title.
    expect(gemKey({ ...tournament, selection: "Scottie Scheffler" })).not.toBe(key);
    // A football match's 1X2 and a player's market: two alerts.
    expect(gemKey({ eventId: "m", market: "1X2", selection: "1", bookmaker: "leovegas" })).not.toBe(
      gemKey({ eventId: "m", market: "anytime_scorer", selection: "Mbappé", bookmaker: "leovegas" })
    );
    // Another tournament: another alert.
    expect(gemKey({ ...tournament, eventId: "pga" })).not.toBe(key);
  });

  it("is, for a surebet, its combination of bets", () => {
    const surebet = { eventId: "e", market: "Vainqueur du match", selection: "surebet", bookmaker: "1@leovegas:back,2@merkurbets:back" };
    expect(gemKey({ ...surebet })).toBe(gemKey({ ...surebet }));
    expect(gemKey({ ...surebet, bookmaker: "1@merkurbets:back,2@merkurbets:back" })).not.toBe(gemKey(surebet));
  });
});

describe("a gem", () => {
  it("tells the match and the percentage, not the outcome, the bookmaker nor the price", () => {
    const message = gemsMessage(
      [
        {
          eventId: "e",
          sport: "football",
          competition: "Ligue 1 - Algérie",
          startTime: "2026-10-08T17:00:00.000Z",
          participants: ["JS Saoura", "Olympique Akbou"],
          marketCount: 0,
          market: "1X2",
          marketLabel: "Résultat",
          selection: "2",
          label: "Olympique Akbou",
          bookmaker: "betsson",
          price: 4.05,
          basis: "fair",
          fair: 3.6,
          edge: 0.125,
          matched: 44105,
        },
      ],
      SITE
    );
    const text = JSON.stringify(message.embeds);
    expect(message.embeds![0].title).toBe("💎 +12.5%");
    for (const hidden of ["Akbou Olympique", "Résultat", "Betsson", "4,05", "3,60", "44"]) expect(text).not.toContain(hidden);
    expect(message.embeds![0].fields.map((f) => f.name)).toEqual(["Match", "Kick-off", "Match page"]);
  });
});

describe("runGemAlerts", () => {
  let db: DatabaseSync;
  let send: ReturnType<typeof vi.fn>;
  const ok = () => Promise.resolve({ ok: true, status: 204 });
  const bodies = () => send.mock.calls.map(([, init]) => JSON.parse(init.body));
  // null: no webhook.
  const run = (webhookUrl: string | null = WEBHOOK) =>
    runGemAlerts(db, { webhookUrl: webhookUrl ?? undefined, publicUrl: SITE, send });

  beforeEach(() => {
    db = openDb(":memory:");
    send = vi.fn(ok);
    // France - Italie: LeoVegas's 2.10 on "1" is 5% above the fair 2.00 (a
    // gem), Merkur Bets's 2.06 3% (a value bet only).
    upsertCanonicalEvents(db, [
      {
        id: "fra-ita",
        sport: "football",
        competition: "Ligue des Nations",
        startTime: KICK_OFF.toISOString(),
        participants: ["France", "Italie"],
        byBookmaker: { leovegas: oneXTwo([2.1, 3.3, 3.8]), merkurbets: oneXTwo([2.06, 3.3, 3.8]) },
      },
    ]);
    saveReferenceOdds(db, "fra-ita", { fair: { "1": 2, X: 3.4, "2": 4 }, back: { "1": 2, X: 3.4, "2": 4 }, lay: { "1": 2, X: 3.4, "2": 4 }, matched: 125000 }, new Date().toISOString());
    // Scorers: Mbappé's fair odds 2.00, LeoVegas's 2.30 15% above (a gem),
    // Merkur Bets's 2.20 10%, too little money on his lay for a surebet; Doué only
    // a lay of 2.40, LeoVegas's 2.80 17% above it (a gem).
    savePlayerOdds(
      db,
      "fra-ita",
      "anytime_scorer",
      [
        { runner: "Mbappe", player: "Mbappé", back: 1.95, lay: 2.05, backSize: 50, laySize: 10, fair: 2 },
        { runner: "Doue", player: "Doué", back: 1.5, lay: 2.4, backSize: 5, laySize: 5, fair: null },
      ],
      3400,
      new Date().toISOString()
    );
    saveMarketOdds(
      db,
      [
        {
          eventId: "fra-ita",
          bookmakerId: "leovegas",
          odds: [
            { market: "anytime_scorer", selection: "Mbappé", price: 2.3 },
            { market: "anytime_scorer", selection: "Doué", price: 2.8 },
          ],
        },
        { eventId: "fra-ita", bookmakerId: "merkurbets", odds: [{ market: "anytime_scorer", selection: "Mbappé", price: 2.2 }] },
      ],
      new Date().toISOString()
    );
  });

  it("sends no gem nor surebet on Tipico or Winamax.de, whose prices may be hours old", async () => {
    // Spain - Portugal: Tipico's 2.40 on "1", 20% above the fair 2.00, and with
    // Winamax.de's 5.00 on "2" a surebet: shown on the site, never sent.
    upsertCanonicalEvents(db, [
      {
        id: "esp-por",
        sport: "football",
        competition: "Ligue des Nations",
        startTime: KICK_OFF.toISOString(),
        participants: ["Espagne", "Portugal"],
        byBookmaker: { tipico: oneXTwo([2.4, 3.3, 3.8]), winamaxde: oneXTwo([2.0, 3.3, 5.0]), leovegas: oneXTwo([1.9, 3.2, 3.9]) },
      },
    ]);
    saveReferenceOdds(db, "esp-por", { fair: { "1": 2, X: 3.4, "2": 4 }, back: { "1": 2, X: 3.4, "2": 4 }, lay: { "1": 2, X: 3.4, "2": 4 }, matched: 125000 }, new Date().toISOString());
    await run();
    const sent = getAlertStatus(db).sent;
    expect(sent.some((g) => g.matchLabel === "Espagne - Portugal")).toBe(false);
    // France - Italie's are sent as before.
    expect(sent.some((g) => g.matchLabel === "France - Italie")).toBe(true);
  });

  it("does nothing without a webhook, and says so", async () => {
    await run(null);
    expect(send).not.toHaveBeenCalled();
    expect(getAlertStatus(db)).toEqual({ configured: false, lastError: null, sent: [] });
  });

  it("greets a new webhook, then sends each gem once", async () => {
    await run();
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls.every(([url, init]) => url === WEBHOOK && init.method === "POST")).toBe(true);
    const [hello, gems] = bodies();
    expect(hello.content).toBe(
      "✅ OddsBlitzer is connected to this channel. An alert will come here for each new gem: a 1X2 or match winner " +
        "value bet (football, tennis, basketball, baseball, American football, hockey, rugby, MMA) 5% or more above the " +
        "fair odds, or a player, games or sets bet 15% or more; and each surebet (payout over 100%, " +
        "those “to verify” flagged as such). A single alert per match, market and outcome." +
        "\n" +
        `${SITE}/?sport=value-bets&sort=value&bookmakers=leovegas,merkurbets,twentybet,admiralbet,tipico,winamaxde`
    );
    // No one pinged by a name, ever.
    expect([hello.allowed_mentions, gems.allowed_mentions]).toEqual([{ parse: [] }, { parse: [] }]);

    // Biggest edge first: Doué (16.7%), Mbappé (15%), France (5%).
    expect(gems.content).toBe("💎 3 new gems");
    expect(gems.embeds.map((e: { title: string }) => e.title)).toEqual(["💎 +16.7%", "💎 +15.0%", "💎 +5.0%"]);
    const [, , france] = gems.embeds;
    const kickOff = KICK_OFF.getTime() / 1000;
    expect(france).toEqual({
      title: "💎 +5.0%",
      url: `${SITE}/?match=fra-ita&bookmakers=leovegas,merkurbets,twentybet,admiralbet,tipico,winamaxde`,
      color: 0xd97706,
      fields: [
        { name: "Match", value: "France - Italie · Ligue des Nations" },
        { name: "Kick-off", value: `<t:${kickOff}:f> (<t:${kickOff}:R>)`, inline: true },
        {
          name: "Match page",
          value: `[See the match on OddsBlitzer](${SITE}/?match=fra-ita&bookmakers=leovegas,merkurbets,twentybet,admiralbet,tipico,winamaxde)`,
        },
      ],
    });

    // Nothing new: nothing sent.
    await run();
    expect(send).toHaveBeenCalledTimes(2);
    expect(getAlertStatus(db)).toMatchObject({ configured: true, lastError: null });
    expect(getAlertStatus(db).sent.map((g) => [g.label, g.bookmaker, g.basis, g.matchLabel])).toEqual([
      ["Doué", "leovegas", "lay", "France - Italie"],
      ["Mbappé", "leovegas", "fair", "France - Italie"],
      ["France", "leovegas", "fair", "France - Italie"],
    ]);
  });

  it("sends each new surebet once, by its combination, the ones to be checked flagged as such", async () => {
    const winner = (one: number, two: number): RawOdds[] => [
      { market: "Vainqueur du match", selection: "1", price: one },
      { market: "Vainqueur du match", selection: "2", price: two },
    ];
    const nba = (id: string, participants: string[], leovegas: RawOdds[], merkurbets: RawOdds[]) => ({
      id,
      sport: "basketball",
      competition: "NBA",
      startTime: KICK_OFF.toISOString(),
      participants,
      byBookmaker: { leovegas, merkurbets },
    });
    upsertCanonicalEvents(db, [
      // 1 / (1/2.2 + 1/2.1): 107.4 %.
      nba("lal-bos", ["Lakers", "Celtics"], winner(2.2, 1.7), winner(1.9, 2.1)),
      // 124.8 %: to be checked.
      nba("chi-nyk", ["Bulls", "Knicks"], winner(2.6, 1.4), winner(1.5, 2.4)),
    ]);
    await run();
    // The hello, the gems, the surebets.
    expect(send).toHaveBeenCalledTimes(3);
    const surebets = bodies()[2];
    expect(surebets.content).toBe("⚖️ 2 new surebets");
    expect(surebets.allowed_mentions).toEqual({ parse: [] });
    const kickOff = KICK_OFF.getTime() / 1000;
    // Biggest TRJ first. The one over 110% is sent too, flagged as to be checked.
    const [toVerify, sure] = surebets.embeds;
    expect(toVerify.title).toBe("⚖️ To verify · 124.8%");
    expect(toVerify.fields.map((f: { name: string }) => f.name)).toEqual([
      "Match",
      "Kick-off",
      "Profit",
      "⚠️ To verify",
      "Match page",
    ]);
    expect(toVerify.fields[3].value).toMatch(/^Payout over 110%/);
    expect([sure]).toEqual([
      {
        title: "⚖️ 107.4%",
        url: `${SITE}/?match=lal-bos&bookmakers=leovegas,merkurbets,twentybet,admiralbet,tipico,winamaxde`,
        color: 0x16a34a,
        fields: [
          { name: "Match", value: "Lakers - Celtics · NBA" },
          { name: "Kick-off", value: `<t:${kickOff}:f> (<t:${kickOff}:R>)`, inline: true },
          { name: "Profit", value: "+7.4%", inline: true },
          {
            name: "Match page",
            value: `[See the match on OddsBlitzer](${SITE}/?match=lal-bos&bookmakers=leovegas,merkurbets,twentybet,admiralbet,tipico,winamaxde)`,
          },
        ],
      },
    ]);

    // Nothing new: nothing sent.
    await run();
    expect(send).toHaveBeenCalledTimes(3);
    // Merkur Bets's Lakers up to 2.25: another combination, sent too.
    upsertCanonicalEvents(db, [nba("lal-bos", ["Lakers", "Celtics"], winner(2.2, 1.7), winner(2.25, 2.1))]);
    await run();
    expect(send).toHaveBeenCalledTimes(4);
    expect(bodies()[3].embeds).toHaveLength(1);
    // 1 / (1/2.25 + 1/2.1): 108.6 %, on the same match as the first, in a card of its own.
    expect(bodies()[3].embeds[0].title).toBe("⚖️ 108.6%");
    expect(bodies()[3].embeds[0].url).toBe(sure.url);
    expect(
      getAlertStatus(db)
        .sent.filter((g) => g.basis.startsWith("surebet"))
        .map((g) => [g.matchLabel, g.label])
    ).toEqual([
      ["Lakers - Celtics", "Lakers @ Merkur Bets 2.25 / Celtics @ Merkur Bets 2.10"],
      ["Bulls - Knicks", "Bulls @ LeoVegas 2.60 / Knicks @ Merkur Bets 2.40"],
      ["Lakers - Celtics", "Lakers @ LeoVegas 2.20 / Celtics @ Merkur Bets 2.10"],
    ]);
  });

  it("flags a golf Top N surebet as to be checked, whatever its TRJ", () => {
    const base: Surebet = {
      eventId: "masters",
      sport: "golf",
      competition: "Masters",
      startTime: "2026-10-10T20:30:00.000Z",
      participants: ["Masters 2026"],
      marketCount: 0,
      market: "golf_top|5",
      marketLabel: "Dans le Top 5",
      kind: "bookmakers",
      payoutRate: 1.03,
      profit: 3,
      toVerify: true,
      thin: false,
      legs: [{ selection: "a", label: "Joueur A", source: "leovegas", side: "back", price: 5, stake: 50 }],
    };
    const embed = surebetEmbed(base, SITE);
    expect(embed.title).toBe("⚖️ To verify · 103.0%");
    expect(embed.fields.find((f) => f.name === "⚠️ To verify")?.value).toMatch(/^Market with several winners/);
    // One that is not to be checked says nothing of it.
    const sure = surebetEmbed({ ...base, market: "Vainqueur", marketLabel: "Vainqueur du tournoi", toVerify: false }, SITE);
    expect(sure.title).toBe("⚖️ 103.0%");
    expect(sure.fields.map((f) => f.name)).not.toContain("⚠️ To verify");
  });

  it("sends a value bet a surebet holds as that surebet only", async () => {
    // 50 EUR on Mbappé's lay at 2.20: LeoVegas's 2.30 laid there pays 103.4%
    // whatever happens, a surebet; Merkur Bets's 2.20 doesn't (98.9%).
    savePlayerOdds(
      db,
      "fra-ita",
      "anytime_scorer",
      [
        { runner: "Mbappe", player: "Mbappé", back: 2.1, lay: 2.2, backSize: 50, laySize: 50, fair: 2 },
        { runner: "Doue", player: "Doué", back: 1.5, lay: 2.4, backSize: 5, laySize: 5, fair: null },
      ],
      3400,
      new Date().toISOString()
    );
    await run();
    // The hello, the gems, the surebets.
    expect(send).toHaveBeenCalledTimes(3);
    const [, gems, surebets] = bodies();
    expect(gems.embeds.map((e: { title: string }) => e.title)).toEqual(["💎 +16.7%", "💎 +5.0%"]);
    expect(surebets.embeds).toHaveLength(1);
    expect(getAlertStatus(db, 50).sent.filter((g) => g.basis.startsWith("surebet")).map((g) => g.label)).toEqual([
      expect.stringMatching(/^Mbappé @ LeoVegas 2.30/),
    ]);
  });

  it("sends a gem that appears later, alone, and greets a new webhook again", async () => {
    await run();
    // Merkur Bets's Mbappé goes up to 2.40, 20% above: already sent, at LeoVegas.
    saveMarketOdds(
      db,
      [{ eventId: "fra-ita", bookmakerId: "merkurbets", odds: [{ market: "anytime_scorer", selection: "Mbappé", price: 2.4 }] }],
      new Date().toISOString()
    );
    await run();
    expect(send).toHaveBeenCalledTimes(2);
    // Dembélé, another outcome of the same market: LeoVegas's 2.50, 25% above.
    savePlayerOdds(
      db,
      "fra-ita",
      "anytime_scorer",
      [
        { runner: "Mbappe", player: "Mbappé", back: 1.95, lay: 2.05, backSize: 50, laySize: 10, fair: 2 },
        { runner: "Doue", player: "Doué", back: 1.5, lay: 2.4, backSize: 5, laySize: 5, fair: null },
        { runner: "Dembele", player: "Dembélé", back: 1.95, lay: 2.05, backSize: 50, laySize: 10, fair: 2 },
      ],
      3400,
      new Date().toISOString()
    );
    saveMarketOdds(
      db,
      [
        {
          eventId: "fra-ita",
          bookmakerId: "leovegas",
          odds: [
            { market: "anytime_scorer", selection: "Mbappé", price: 2.3 },
            { market: "anytime_scorer", selection: "Doué", price: 2.8 },
            { market: "anytime_scorer", selection: "Dembélé", price: 2.5 },
          ],
        },
      ],
      new Date().toISOString()
    );
    await run();
    expect(send).toHaveBeenCalledTimes(3);
    expect(bodies()[2].content).toBe("💎 New gem");
    // Dembélé's +25,0 %: nothing else of the bet is told.
    expect(bodies()[2].embeds.map((e: { title: string }) => e.title)).toEqual(["💎 +25.0%"]);

    const other = "https://discord.com/api/webhooks/2/other-token";
    await run(other);
    expect(send).toHaveBeenCalledTimes(4);
    expect(send.mock.calls[3][0]).toBe(other);
    expect(bodies()[3].content).toMatch(/^✅ OddsBlitzer is connected/);

    // Removed, then put back: greeted again.
    await run(null);
    await run(other);
    expect(send).toHaveBeenCalledTimes(5);
    expect(bodies()[4].content).toMatch(/^✅ OddsBlitzer is connected/);
  });

  it("sends an outcome once, at the best bookmaker's price, not once per bookmaker", async () => {
    // Mbappé at LeoVegas 2.30 (15%) and at Merkur Bets 2.40 (20%): one alert, Merkur Bets's.
    saveMarketOdds(
      db,
      [{ eventId: "fra-ita", bookmakerId: "merkurbets", odds: [{ market: "anytime_scorer", selection: "Mbappé", price: 2.4 }] }],
      new Date().toISOString()
    );
    await run();
    expect(bodies()[1].embeds.map((e: { title: string }) => e.title)).toEqual(["💎 +20.0%", "💎 +16.7%", "💎 +5.0%"]);
    expect(getAlertStatus(db).sent).toHaveLength(3);

    // LeoVegas's Mbappé is still a gem: nothing more for the same outcome.
    await run();
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("keeps a failure without the webhook's token, and sends at the next cycle", async () => {
    send.mockImplementationOnce(() => Promise.reject(new Error(`fetch failed for ${WEBHOOK}`)));
    await run();
    expect(getAlertStatus(db)).toMatchObject({
      configured: true,
      lastError: { message: "fetch failed for <webhook>", at: expect.any(String) },
      sent: [],
    });

    // Greeted, then refused: Discord's rate limit.
    send.mockImplementationOnce(ok).mockImplementationOnce(() => Promise.resolve({ ok: false, status: 429 }));
    await run();
    expect(getAlertStatus(db).lastError?.message).toBe("HTTP 429: Discord limits the sending, next try at the next cycle");
    expect(getAlertStatus(db).sent).toEqual([]);

    await run();
    expect(getAlertStatus(db)).toMatchObject({ lastError: null });
    expect(getAlertStatus(db).sent).toHaveLength(3);
    // The hello once, the gems twice (refused, then sent).
    expect(bodies().map((b) => [...b.content][0])).toEqual(["✅", "✅", "💎", "💎"]);
  });

  it(`sends ${MAX_GEMS_PER_MESSAGE} gems a message at most, the rest at the next cycle`, async () => {
    const players = Array.from({ length: 12 }, (_, i) => `Joueur ${String(i).padStart(2, "0")}`);
    // Too little on their lays for LeoVegas's 13.00 to be surebets: gems.
    savePlayerOdds(
      db,
      "fra-ita",
      "first_scorer",
      players.map((p) => ({ runner: p, player: p, back: 9.8, lay: 10.2, backSize: 30, laySize: 10, fair: 10 })),
      900,
      new Date().toISOString()
    );
    saveMarketOdds(
      db,
      [
        {
          eventId: "fra-ita",
          bookmakerId: "leovegas",
          odds: [
            { market: "anytime_scorer", selection: "Mbappé", price: 2.3 },
            { market: "anytime_scorer", selection: "Doué", price: 2.8 },
            ...players.map((p) => ({ market: "first_scorer", selection: p, price: 13 })),
          ],
        },
      ],
      new Date().toISOString()
    );
    await run();
    expect(bodies()[1].embeds).toHaveLength(10);
    await run();
    // 15 gems: 10, then 5.
    expect(bodies()[2].embeds).toHaveLength(5);
    expect(getAlertStatus(db, 50).sent).toHaveLength(15);
  });
});

describe("the size of a message", () => {
  const long = (n: number) => "é".repeat(n);
  // A gem as long as its fields allow: the longest title (cut at 256), a
  // competition that fills the "Match" field (cut at 1024).
  const longGem = (i: number): ValueBet => ({
    eventId: `e${i}`,
    sport: "football",
    competition: long(2000),
    startTime: "2026-10-10T20:30:00.000Z",
    participants: [long(500), long(500)],
    marketCount: 0,
    market: "anytime_scorer",
    marketLabel: long(500),
    selection: "x",
    label: long(500),
    bookmaker: "leovegas",
    price: 123456.78,
    basis: "lay",
    fair: 123456.78,
    edge: 99.9,
    matched: 123456789,
  });
  const legs = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      selection: `p${i}`,
      label: `Joueur numéro ${i}`,
      source: "leovegas",
      side: "back" as const,
      price: 51.5,
      stake: 0.9,
    }));
  const surebet = (id: string, legCount: number): Surebet => ({
    eventId: id,
    sport: "golf",
    competition: "Open",
    startTime: "2026-10-10T20:30:00.000Z",
    participants: ["Open 2026"],
    marketCount: 0,
    market: "Vainqueur",
    marketLabel: "Vainqueur du tournoi",
    kind: "bookmakers",
    payoutRate: 1.02,
    profit: 2,
    toVerify: false,
    thin: false,
    legs: legs(legCount),
  });

  it("holds an embed alone within 6000 characters, whatever the longest it can be", () => {
    expect(embedChars(gemEmbed(longGem(0)))).toBeLessThanOrEqual(DISCORD_LIMITS.embedChars);
    expect(embedChars(surebetEmbed({ ...surebet("a", 120), competition: long(2000), participants: [long(2000)] }))).toBeLessThanOrEqual(
      DISCORD_LIMITS.embedChars
    );
    // One to be checked has a field more.
    expect(
      embedChars(surebetEmbed({ ...surebet("a", 120), toVerify: true, competition: long(2000), participants: [long(2000)] }))
    ).toBeLessThanOrEqual(DISCORD_LIMITS.embedChars);
  });

  it("keeps the usual message far below the limit, the hello too", () => {
    // 10 gems of a long-named league and match: what a real cycle can send.
    const usual = Array.from({ length: 10 }, (_, i) => ({
      ...longGem(i),
      competition: "Ligue des Champions de l'UEFA - Phase de ligue",
      participants: ["Paris Saint-Germain", "Olympique de Marseille"],
      marketLabel: "Résultat du match",
      label: "Paris Saint-Germain",
      edge: 0.0731,
      price: 2.45,
      fair: 2.28,
      matched: 1250000,
    }));
    const message = gemsMessage(usual, SITE);
    expect(message.embeds).toHaveLength(10);
    const chars = message.embeds!.reduce((sum, e) => sum + embedChars(e), 0);
    expect(chars).toBeLessThan(DISCORD_LIMITS.embedChars * 0.75);
    expect(() => assertSendable(message)).not.toThrow();
    expect(helloMessage(SITE).content.length).toBeLessThan(DISCORD_LIMITS.content / 2);
    expect(helloMessage(SITE).embeds).toBeUndefined();
  });

  it("takes as many embeds as fit in one message, at least one", () => {
    const gems = Array.from({ length: 10 }, (_, i) => longGem(i));
    const size = embedChars(gemEmbed(gems[0]));
    const fitted = fitMessage(gems, (g) => gemEmbed(g));
    expect(fitted.length).toBe(Math.floor(DISCORD_LIMITS.embedChars / size));
    expect(fitted.length).toBeLessThan(10);
    expect(fitted.length).toBeGreaterThanOrEqual(1);
    expect(() => assertSendable(gemsMessage(fitted))).not.toThrow();
    // Surebets whose match field is as long as it can be, about 1100 characters each: five fit.
    const longSurebet = (id: string): Surebet => ({ ...surebet(id, 2), competition: long(2000), participants: [long(2000)] });
    expect(fitMessage(Array.from({ length: 8 }, (_, i) => longSurebet(`l${i}`)), (s) => surebetEmbed(s))).toHaveLength(5);
    expect(fitMessage(Array.from({ length: 12 }, (_, i) => surebet(`s${i}`, 2)), (s) => surebetEmbed(s))).toHaveLength(10);
    expect(fitMessage([], (s: Surebet) => surebetEmbed(s))).toEqual([]);
  });

  it("refuses to send a message Discord would refuse", () => {
    const over = gemsMessage(Array.from({ length: 10 }, (_, i) => longGem(i)));
    expect(() => assertSendable(over)).toThrow(/message too long for Discord: \d+ characters, 6000 at most/);
    expect(() => assertSendable(gemsMessage(Array.from({ length: 11 }, (_, i) => ({ ...longGem(i), competition: "L1", label: "A", marketLabel: "B", participants: ["C", "D"] }))))).toThrow(
      /11 cards, 10 at most/
    );
    expect(() => assertSendable({ content: "x".repeat(2001) })).toThrow(/text of 2001 characters, 2000 at most/);
    expect(() => assertSendable({ content: "x".repeat(2000) })).not.toThrow();
    expect(() => assertSendable(surebetsMessage([surebet("a", 2)]))).not.toThrow();
  });
});

describe("the link to the match", () => {
  const gem = {
    eventId: "psg-om",
    sport: "football",
    competition: "Ligue 1",
    startTime: "2026-10-10T20:30:00.000Z",
    participants: ["PSG", "Marseille"],
    marketCount: 0,
    market: "1X2",
    marketLabel: "Résultat du match",
    selection: "1",
    label: "PSG",
    bookmaker: "leovegas",
    price: 2.1,
    basis: "fair",
    fair: 2,
    edge: 0.05,
    matched: 125000,
  } as ValueBet;
  const surebet = {
    ...gem,
    kind: "bookmakers",
    payoutRate: 1.02,
    profit: 2,
    toVerify: false,
    thin: false,
    legs: [{ selection: "1", label: "PSG", source: "leovegas", side: "back", price: 2.1, stake: 100 }],
  } as unknown as Surebet;
  const url = "https://cote-radar.fr/?match=psg-om&bookmakers=leovegas,merkurbets,twentybet,admiralbet,tipico,winamaxde";

  it("is the title's and a line of its own, on a gem and a surebet", () => {
    for (const embed of [gemEmbed(gem, "https://cote-radar.fr"), surebetEmbed(surebet, "https://cote-radar.fr")]) {
      expect(embed.url).toBe(url);
      expect(embed.fields.at(-1)).toEqual({ name: "Match page", value: `[See the match on OddsBlitzer](${url})` });
    }
  });

  it("is left out without the site's address, and keeps a Markdown link whole", () => {
    for (const [embed, names] of [
      [gemEmbed(gem), ["Match", "Kick-off"]],
      [surebetEmbed(surebet), ["Match", "Kick-off", "Profit"]],
    ] as const) {
      expect(embed.url).toBeUndefined();
      expect(embed.fields.map((f) => f.name)).toEqual(names);
    }
    const odd = gemEmbed({ ...gem, eventId: "a(b)c d" }, "https://cote-radar.fr");
    expect(odd.url).toBe("https://cote-radar.fr/?match=a%28b%29c%20d&bookmakers=leovegas,merkurbets,twentybet,admiralbet,tipico,winamaxde");
    // One "(" and one ")": the link's own.
    const value = odd.fields.at(-1)!.value;
    expect([value.split("(").length - 1, value.split(")").length - 1]).toEqual([1, 1]);
  });
});

describe("runGemAlerts, size and rate limit", () => {
  let db: DatabaseSync;
  let send: ReturnType<typeof vi.fn>;
  let sleep: ReturnType<typeof vi.fn>;
  const ok = () => Promise.resolve({ ok: true, status: 204 });
  const limited = (retryAfter?: string) =>
    Promise.resolve({ ok: false, status: 429, headers: { get: (name: string) => (name === "retry-after" ? (retryAfter ?? null) : null) } });
  const bodies = () => send.mock.calls.map(([, init]) => JSON.parse(init.body));
  const run = () => runGemAlerts(db, { webhookUrl: WEBHOOK, publicUrl: SITE, send, sleep });

  beforeEach(() => {
    db = openDb(":memory:");
    send = vi.fn(ok);
    sleep = vi.fn(() => Promise.resolve());
    upsertCanonicalEvents(db, [
      {
        id: "fra-ita",
        sport: "football",
        competition: "Ligue des Nations",
        startTime: KICK_OFF.toISOString(),
        participants: ["France", "Italie"],
        byBookmaker: { leovegas: oneXTwo([2.1, 3.3, 3.8]), merkurbets: oneXTwo([2.06, 3.3, 3.8]) },
      },
    ]);
    saveReferenceOdds(db, "fra-ita", { fair: { "1": 2, X: 3.4, "2": 4 }, back: { "1": 2, X: 3.4, "2": 4 }, lay: { "1": 2, X: 3.4, "2": 4 }, matched: 125000 }, new Date().toISOString());
  });

  it("waits out a rate limit Discord says how long to wait for, then sends", async () => {
    send.mockImplementationOnce(ok).mockImplementationOnce(() => limited("2")).mockImplementationOnce(() => limited("0.5"));
    await run();
    // The hello; the gems refused twice, then taken; no failure left.
    expect(send).toHaveBeenCalledTimes(4);
    expect(sleep.mock.calls).toEqual([[2000], [500]]);
    expect(bodies()[1]).toEqual(bodies()[2]);
    expect(bodies()[1]).toEqual(bodies()[3]);
    expect(getAlertStatus(db)).toMatchObject({ configured: true, lastError: null });
    expect(getAlertStatus(db).sent).toHaveLength(1);
  });

  it("does not wait for a long rate limit, or one without a delay: next cycle", async () => {
    send.mockImplementationOnce(ok).mockImplementationOnce(() => limited(String(RATE_LIMIT_MAX_WAIT_MS / 1000 + 1)));
    await run();
    expect(sleep).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledTimes(2);
    expect(getAlertStatus(db).lastError?.message).toBe("HTTP 429: Discord limits the sending, next try at the next cycle");
    expect(getAlertStatus(db).sent).toEqual([]);

    send.mockImplementationOnce(() => limited());
    await run();
    expect(sleep).not.toHaveBeenCalled();
    expect(getAlertStatus(db).sent).toEqual([]);

    await run();
    expect(getAlertStatus(db)).toMatchObject({ lastError: null });
    expect(getAlertStatus(db).sent).toHaveLength(1);
  });

  it("gives up after two retries, marks nothing sent, and keeps the rest for the next cycle", async () => {
    send.mockImplementationOnce(ok);
    for (let i = 0; i < 3; i++) send.mockImplementationOnce(() => limited("1"));
    await run();
    expect(send).toHaveBeenCalledTimes(4);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(getAlertStatus(db).lastError?.message).toMatch(/^HTTP 429/);
    expect(getAlertStatus(db).sent).toEqual([]);

    await run();
    expect(getAlertStatus(db)).toMatchObject({ lastError: null });
    expect(getAlertStatus(db).sent).toHaveLength(1);
  });

  it("splits gems that would pass 6000 characters, the rest at the next cycle", async () => {
    // 12 players' gems on a match whose competition fills the "Match" field
    // (1024 characters): about 1100 characters a card, 5 a message.
    upsertCanonicalEvents(db, [
      {
        id: "fra-ita",
        sport: "football",
        competition: "L".repeat(1500),
        startTime: KICK_OFF.toISOString(),
        participants: ["France", "Italie"],
        byBookmaker: { leovegas: oneXTwo([2.1, 3.3, 3.8]), merkurbets: oneXTwo([2.06, 3.3, 3.8]) },
      },
    ]);
    const players = Array.from({ length: 12 }, (_, i) => `Joueur ${String(i).padStart(2, "0")}`);
    savePlayerOdds(
      db,
      "fra-ita",
      "first_scorer",
      players.map((p) => ({ runner: p, player: p, back: 9.8, lay: 10.2, backSize: 30, laySize: 10, fair: 10 })),
      900,
      new Date().toISOString()
    );
    saveMarketOdds(
      db,
      [{ eventId: "fra-ita", bookmakerId: "leovegas", odds: players.map((p) => ({ market: "first_scorer", selection: p, price: 13 })) }],
      new Date().toISOString()
    );

    const total = () => getAlertStatus(db, 50).sent.length;
    await run();
    await run();
    await run();
    await run();
    const gemMessages = bodies().filter((b) => b.content.startsWith("💎"));
    // 13 gems (the 12 players and France's), 5 a message at most.
    expect(gemMessages.length).toBeGreaterThanOrEqual(3);
    for (const body of gemMessages) {
      const chars = body.embeds.reduce((sum: number, e: Parameters<typeof embedChars>[0]) => sum + embedChars(e), 0);
      expect(chars).toBeLessThanOrEqual(DISCORD_LIMITS.embedChars);
      expect(body.embeds.length).toBeLessThanOrEqual(MAX_GEMS_PER_MESSAGE);
    }
    expect(gemMessages[0].embeds.length).toBeLessThan(MAX_GEMS_PER_MESSAGE);
    expect(total()).toBe(13);
    expect(getAlertStatus(db).lastError).toBeNull();
  });
});
