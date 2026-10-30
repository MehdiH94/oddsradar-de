import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { openAuthDb } from "../../src/auth/db";
import { createUser } from "../../src/auth/store";
import { listPromos, setPromoTaken } from "../../src/auth/promos";
import { BETATHOME_PROMOS_URL, htmlText, jsonAfter, parseBetathomePromos, ribbonEnd } from "../../src/promos/betathome";
import { refreshSitePromos, saveSitePromos, SitePromo } from "../../src/promos/sitePromos";

// bet-at-home's promotions page as read on 27/10/2026, its state's
// `promotionsData` kept whole (14 promotions, two of them for sports only and
// one for every product), the rest of the page left out.
const PAGE = readFileSync(join(__dirname, "fixtures/betathome-promotions.html"), "utf8");
const NOW = new Date("2026-10-27T10:00:00Z");

describe("bet-at-home's promotions", () => {
  it("keeps the sports promotions of the page, each with its text, its end and the promotions page", () => {
    const promos = parseBetathomePromos(PAGE, NOW);
    expect(promos.map((p) => [p.sourceKey, p.title, p.endsAt])).toEqual([
      ["betathome:28774", "100€ HALLOWEEN BONUS", "2026-11-08T22:59:00.000Z"],
      ["betathome:2830", "ENTDECKE UNSERE NEUE APP!", null],
      ["betathome:20307", "500% QUOTENBOOST + 100€ BONUS", null],
    ]);
    for (const promo of promos) {
      expect(promo).toMatchObject({ bookmaker: "betathome", url: BETATHOME_PROMOS_URL });
      // Plain text: no tag, no entity left.
      expect(promo.details).not.toMatch(/<[a-z/]|&[a-z#0-9]+;/i);
    }
    expect(promos[0].details.length).toBeGreaterThan(20);
  });

  it("puts a promotion's bonus code first, and reads an expiry date before the ribbon", () => {
    const page = `<script>window.__PRELOADED_STATE__={"promotionsData":{"items":[
      {"id":1,"title":"Cashback &#8211; 10&nbsp;%","content":"<p>Bis 50&#8364;<br/>pro Woche</p>","bonusCode":"BACK10","ribbonText":"01.11. - 07.11.","expiryDate":"2026-11-30T22:59:00Z","categories":["sports"]},
      {"id":2,"title":"Slots","content":"","categories":["casino"]}
    ]}};</script>`;
    expect(parseBetathomePromos(page, NOW)).toEqual([
      {
        sourceKey: "betathome:1",
        bookmaker: "betathome",
        title: "Cashback – 10 %",
        details: "Bonuscode: BACK10\nBis 50€\npro Woche",
        url: BETATHOME_PROMOS_URL,
        endsAt: "2026-11-30T22:59:00.000Z",
      },
    ]);
  });

  it("fails on a page without its list, rather than reading it as no promotion", () => {
    expect(() => parseBetathomePromos("<html>Wartungsarbeiten</html>", NOW)).toThrow("no promotionsData");
  });

  it("ends a ribbon on its last date's evening in Berlin, in the year nearest to now", () => {
    expect(ribbonEnd("26.10. - 08.11.", NOW)).toBe("2026-11-08T22:59:00.000Z");
    // Summer time: 21:59 UTC.
    expect(ribbonEnd("bis 15.07.", new Date("2026-07-01T10:00:00Z"))).toBe("2026-07-15T21:59:00.000Z");
    // Read in December, a January date is next year's; read in January, a December one last year's.
    expect(ribbonEnd("20.12. - 05.01.", new Date("2026-12-28T10:00:00Z"))).toBe("2027-01-05T22:59:00.000Z");
    expect(ribbonEnd("01.12. - 20.12.", new Date("2027-01-03T10:00:00Z"))).toBe("2026-12-20T22:59:00.000Z");
    expect(ribbonEnd("bis 31.12.2026", NOW)).toBe("2026-12-31T22:59:00.000Z");
    expect(ribbonEnd("", NOW)).toBeNull();
    expect(ribbonEnd("Jeden Montag", NOW)).toBeNull();
  });

  it("reads a JSON object out of a page, braces in its strings included", () => {
    expect(jsonAfter('x={"a":{"b":"}{\\"","c":[1]}};', '"a":')).toEqual({ b: '}{"', c: [1] });
    expect(jsonAfter("nothing", '"a":')).toBeNull();
  });

  it("turns HTML into lines of text", () => {
    expect(htmlText("<p>Eins&nbsp;&amp; zwei</p>\n<div>drei<br>vier &#x2013; f&uuml;nf &Uuml;ber &bogus;</div>")).toBe(
      "Eins & zwei\ndrei\nvier – fünf Über &bogus;"
    );
  });
});

describe("the site's promotions in auth.sqlite", () => {
  const promo = (key: string, over: Partial<SitePromo> = {}): SitePromo => ({
    sourceKey: `betathome:${key}`,
    bookmaker: "betathome",
    title: `Promo ${key}`,
    details: "",
    url: BETATHOME_PROMOS_URL,
    endsAt: null,
    ...over,
  });

  it("are everyone's, updated in place with their marks, and removed once off the page", () => {
    const db = openAuthDb(":memory:");
    const ada = createUser(db, { email: "ada@example.com", passwordHash: "x", verified: true }, NOW);
    const bob = createUser(db, { email: "bob@example.com", passwordHash: "x", verified: true }, NOW);
    expect(saveSitePromos(db, "betathome", [promo("1"), promo("2")], NOW)).toEqual({ added: [promo("1"), promo("2")], removed: 0 });
    const [first] = listPromos(db, ada.id);
    expect(first).toMatchObject({ source: "site", mine: false, bookmaker: "betathome" });
    expect(listPromos(db, bob.id)).toHaveLength(2);

    setPromoTaken(db, ada.id, first.id, true, NOW);
    // Read again: one changed, one gone, one new; the mark stays on the changed one.
    const changed = first.title === "Promo 1" ? "1" : "2";
    const gone = changed === "1" ? "2" : "1";
    expect(saveSitePromos(db, "betathome", [promo(changed, { title: "Neu" }), promo("3")], NOW)).toEqual({ added: [promo("3")], removed: 1 });
    const now = listPromos(db, ada.id);
    expect(now.map((p) => p.title).sort()).toEqual(["Neu", "Promo 3"]);
    expect(now.find((p) => p.title === "Neu")).toMatchObject({ id: first.id, takenAt: NOW.toISOString() });
    expect(now.some((p) => p.title === `Promo ${gone}`)).toBe(false);

    // An empty read removes nothing; another bookmaker's are left alone.
    expect(saveSitePromos(db, "betathome", [], NOW)).toEqual({ added: [], removed: 0 });
    saveSitePromos(db, "leovegas", [promo("9", { sourceKey: "leovegas:9", bookmaker: "leovegas" })], NOW);
    expect(listPromos(db, bob.id)).toHaveLength(3);
  });

  it("refreshes each bookmaker's, one failing costing only its own", async () => {
    const db = openAuthDb(":memory:");
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    const reads = await refreshSitePromos(db, {
      broken: async () => {
        throw new Error("HTTP 403");
      },
      empty: async () => [],
      betathome: async (now) => parseBetathomePromos(PAGE, now),
    }, NOW);
    // Each bookmaker's outcome, for the admins' alert: an empty read is suspect too.
    expect(reads).toEqual([
      { bookmaker: "broken", ok: false, error: "HTTP 403" },
      { bookmaker: "empty", ok: false, error: "no promotion found" },
      { bookmaker: "betathome", ok: true, added: expect.any(Array), found: 3 },
    ]);
    // Read again: nothing new.
    const again = await refreshSitePromos(db, { betathome: async (now) => parseBetathomePromos(PAGE, now) }, NOW);
    expect(again).toEqual([{ bookmaker: "betathome", ok: true, added: [], found: 3 }]);
    expect(db.prepare("SELECT COUNT(*) AS n FROM promos WHERE source = 'site'").get()).toEqual({ n: 3 });
    expect(errors).toHaveBeenCalledWith("[site-promos] broken: could not read its promotions:", expect.any(Error));
    vi.restoreAllMocks();
  });
});
