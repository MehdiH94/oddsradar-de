import { describe, it, expect } from "vitest";
import { openDb } from "../../src/db/client";
import { openAuthDb } from "../../src/auth/db";
import { saveSitePromos, SitePromo } from "../../src/promos/sitePromos";
import { runSitePromoAlerts } from "../../src/alerts/sitePromos";
import { formatPromoReaderStatus, listPromoReaderStatus } from "../../src/promos/status";
import { PROMO_READERS } from "../../src/promos/readers";

const promo = (sourceKey: string, title: string): SitePromo => ({ sourceKey, bookmaker: "neobet", title, details: "", url: null, endsAt: null });

describe("promo readers' status (vps-report promos)", () => {
  it("lists every reader the web process runs", () => {
    expect(Object.keys(PROMO_READERS)).toEqual(["betathome", "neobet", "admiralbet", "twentybet", "merkurbets"]);
  });

  it("counts each bookmaker's site promotions, names the newest and shows a failing reader", async () => {
    const auth = openAuthDb(":memory:");
    const odds = openDb(":memory:");
    const now = Date.parse("2026-10-29T12:00:00Z");
    saveSitePromos(auth, "neobet", [promo("neobet:1", "Quoten-Boost")], new Date(now - 5 * 3_600_000));
    saveSitePromos(auth, "neobet", [promo("neobet:1", "Quoten-Boost"), promo("neobet:2", "Gratiswette")], new Date(now - 30 * 60_000));
    // A manual promotion is no reader's.
    auth.prepare("INSERT INTO promos (source, bookmaker, title, found_at) VALUES ('manual', 'neobet', 'Mine', ?)").run(new Date(now).toISOString());
    await runSitePromoAlerts(odds, [{ bookmaker: "twentybet", ok: false, error: "HTTP 404" }], { now: now - 3 * 3_600_000 });

    const statuses = listPromoReaderStatus(auth, odds, ["neobet", "twentybet", "betathome"]);
    expect(statuses[0]).toMatchObject({ bookmaker: "neobet", count: 2, newestTitle: "Gratiswette", failing: undefined });
    expect(statuses[1]).toMatchObject({ bookmaker: "twentybet", count: 0, newestTitle: null, failing: { lastError: "HTTP 404" } });

    expect(formatPromoReaderStatus(statuses, now).split("\n")).toEqual([
      'OK      neobet       2 promotions, newest "Gratiswette" found 30 min ago',
      "FAILING twentybet    no promotion held; failing since 3 h ago (admins not told yet)",
      "    error: HTTP 404",
      "EMPTY   betathome    no promotion held",
    ]);
  });
});
