import { describe, it, expect, vi } from "vitest";
import { newPromosMessage, postNewPromos } from "../../src/alerts/newPromos";
import { SitePromo } from "../../src/promos/sitePromos";

const WEBHOOK = "https://discord.com/api/webhooks/1/testers";
const SITE = "https://odds-blitzer.de";

const promo = (n: number, over: Partial<SitePromo> = {}): SitePromo => ({
  sourceKey: `neobet:${n}`,
  bookmaker: "neobet",
  title: `Promo ${n}`,
  details: "",
  url: `https://neobet.de/promo/${n}`,
  endsAt: null,
  ...over,
});

function discord() {
  const sent: Array<{ url: string; body: { content: string; embeds: Array<Record<string, unknown>> } }> = [];
  const send = vi.fn(async (url: string, init: { body: string }) => {
    sent.push({ url, body: JSON.parse(init.body) });
    return { ok: true, status: 204 };
  });
  return { sent, send };
}

describe("the new promotions' Discord message", () => {
  it("names the bookmaker and links each promotion to the site's Promos page, in German", () => {
    const message = newPromosMessage(
      "betathome",
      [promo(1, { title: "SUNDAY SEVEN", details: "Bis zu 7 €\n  Gratiswette", endsAt: "2026-11-02T22:59:00.000Z" })],
      SITE
    );
    expect(message.content).toBe("🎁 Neue Promo bei **bet-at-home**\nhttps://odds-blitzer.de/promos");
    expect(message.allowed_mentions).toEqual({ parse: [] });
    expect(message.embeds).toEqual([
      {
        title: "SUNDAY SEVEN",
        url: "https://odds-blitzer.de/promos",
        color: expect.any(Number),
        description: "Bis zu 7 € Gratiswette",
        fields: [{ name: "Endet", value: "<t:1793660340:f> (<t:1793660340:R>)", inline: true }],
      },
    ]);
  });

  it("counts several, shows ten at most and cuts long texts to Discord's limits", () => {
    const many = Array.from({ length: 12 }, (_, i) => promo(i, { title: "T".repeat(300), details: "d".repeat(500) }));
    const message = newPromosMessage("neobet", many, SITE);
    expect(message.content).toMatch(/^🎁 12 neue Promos bei \*\*neobet\*\* \(die ersten 10 hier, alle auf der Promos-Seite\)/);
    expect(message.embeds).toHaveLength(10);
    expect((message.embeds![0].title as string).length).toBe(256);
    expect((message.embeds![0].description as string).length).toBe(200);
    expect(message.embeds![0].fields).toEqual([]);
  });
});

describe("postNewPromos", () => {
  it("posts one message per bookmaker with new promotions, to the testers' channel", async () => {
    const { sent, send } = discord();
    await postNewPromos(
      [
        { bookmaker: "neobet", ok: true, added: [promo(1), promo(2)] },
        { bookmaker: "betathome", ok: true, added: [] },
        { bookmaker: "twentybet", ok: false, error: "HTTP 404" },
        { bookmaker: "admiralbet", ok: true },
      ],
      { webhookUrl: WEBHOOK, publicUrl: SITE, send }
    );
    expect(sent).toHaveLength(1);
    expect(sent[0].url).toBe(WEBHOOK);
    expect(sent[0].body.content).toMatch(/^🎁 2 neue Promos bei \*\*neobet\*\*/);
    expect(sent[0].body.embeds.map((e) => e.title)).toEqual(["Promo 1", "Promo 2"]);
  });

  it("posts nothing without a webhook, and a failure costs only its bookmaker's message", async () => {
    const { send } = discord();
    await postNewPromos([{ bookmaker: "neobet", ok: true, added: [promo(1)] }], { webhookUrl: " ", send });
    expect(send).not.toHaveBeenCalled();

    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const failing = vi.fn(async (url: string, init: { body: string }) =>
      JSON.parse(init.body).content.includes("neobet") ? { ok: false, status: 500 } : { ok: true, status: 204 }
    );
    await postNewPromos(
      [
        { bookmaker: "neobet", ok: true, added: [promo(1)] },
        { bookmaker: "merkurbets", ok: true, added: [promo(2, { bookmaker: "merkurbets" })] },
      ],
      { webhookUrl: WEBHOOK, publicUrl: SITE, send: failing }
    );
    expect(failing).toHaveBeenCalledTimes(2);
    expect(errors).toHaveBeenCalledWith("[alerts:new-promos] neobet: could not post its new promotions:", expect.any(Error));
    vi.restoreAllMocks();
  });
});
