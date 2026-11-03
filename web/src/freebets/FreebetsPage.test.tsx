import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import axe from "axe-core";
import { AuthContext, type AuthValue } from "../auth/AuthContext";
import { mockPhone } from "../testUtils";
import { FreebetsPage } from "./FreebetsPage";
import { ASK_DELAY_MS, REFRESH_MS } from "./useConversions";
import { SAVE_DELAY_MS } from "./useWallet";
import type { BookmakerId, ConversionAnswer, Wallet } from "./freebetsApi";
import { BOOKMAKERS_ANSWER, CHAIN, EXCHANGE_ANSWER } from "./testData";

const reply = (body: unknown, status = 200) => Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) });

const auth: AuthValue = {
  status: "authenticated",
  user: { id: "u1", email: "ada@example.com", role: "user" },
  login: async () => {},
  logout: async () => {},
};

// The canned answers, about what was asked (the format, the bookmaker and its freebets).
function echo(url: URL, wallet: Wallet): ConversionAnswer {
  if (url.searchParams.get("mode") === "exchange") {
    const bookmaker = url.searchParams.get("bookmaker") as BookmakerId;
    return { ...EXCHANGE_ANSWER, bookmaker, fb: wallet[bookmaker] ?? 0 };
  }
  return { ...BOOKMAKERS_ANSWER, legs: Number(url.searchParams.get("legs")) as 1 | 2 | 3 };
}

interface Api {
  wallet: Wallet;
  // What the server answers a conversions request with, by mode.
  answers: (url: URL) => ConversionAnswer | Promise<unknown>;
  saveFails?: boolean;
}

// The API as the page sees it: the wallet (read, then replaced), the conversions.
function stubApi(over: Partial<Api> = {}) {
  const api: Api = {
    wallet: { leovegas: 30, merkurbets: 25.5 },
    answers: (url) => echo(url, api.wallet),
    ...over,
  };
  const calls = { saved: [] as Wallet[], asked: [] as string[] };
  let depositLimit: number | null = null;
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    if (url === "/api/freebets/wallet") {
      if (init?.method === "PUT") {
        if (api.saveFails) return reply({ message: "Erreur" }, 500);
        const sent = JSON.parse(String(init.body)).wallet as Wallet;
        calls.saved.push(sent);
        api.wallet = sent;
      }
      return reply({ wallet: api.wallet });
    }
    if (url === "/api/deposits") {
      const body = init?.method === "PUT" ? JSON.parse(String(init.body)) : {};
      const deposits = body.deposits ?? {};
      if (body.limit !== undefined) depositLimit = body.limit;
      const total = Object.values(deposits as Record<string, number>).reduce((a, b) => a + b, 0);
      return reply({ month: "2026-11", deposits, total, limit: depositLimit ?? 1000, personalLimit: depositLimit !== null });
    }
    if (url.startsWith("/api/freebets/conversions")) {
      calls.asked.push(url);
      const answer = api.answers(new URL(url, "http://localhost"));
      return answer instanceof Promise ? answer : reply(answer);
    }
    return reply({});
  });
  vi.stubGlobal("fetch", fetchMock);
  return { api, calls, fetchMock };
}

function renderPage() {
  return render(
    <AuthContext.Provider value={auth}>
      <FreebetsPage />
    </AuthContext.Provider>
  );
}

const fb = (name: string) => screen.getByRole("textbox", { name: `Freebets bei ${name} in Euro` });
const lastAsked = (calls: { asked: string[] }) => calls.asked[calls.asked.length - 1];

describe("FreebetsPage", () => {
  beforeEach(() => window.history.replaceState(null, "", "/freebets"));
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    window.history.replaceState(null, "", "/");
  });

  describe("the wallet", () => {
    it("shows the freebets the account holds at each bookmaker, and their total", async () => {
      stubApi();
      renderPage();
      expect(await screen.findByDisplayValue("30")).toBeInTheDocument();
      expect(fb("LeoVegas")).toHaveValue("30");
      expect(fb("Merkur Bets")).toHaveValue("25,5");
      expect(fb("20bet")).toHaveValue("");
      expect(fb("Admiralbet")).toHaveValue("");
      expect(fb("Tipico")).toHaveValue("");
      expect(screen.getAllByRole("textbox", { name: /^Freebets bei/ })).toHaveLength(13);
      expect(screen.getByText(/Insgesamt umzuwandeln/)).toHaveTextContent("55,50 FB");
      expect(await screen.findByText("In deinem Konto gespeichert")).toBeInTheDocument();
    });

    it("keeps this month's deposits against LUGAS's limit, the German-licensed bookmakers only, saved when a field is left", async () => {
      const { fetchMock } = stubApi();
      renderPage();
      const leovegas = await screen.findByRole("textbox", { name: "Einzahlungen bei LeoVegas im November 2026 in Euro" });
      expect(screen.queryByRole("textbox", { name: /^Einzahlungen bei 20bet/ })).not.toBeInTheDocument();
      expect(screen.getAllByRole("textbox", { name: /^Einzahlungen bei/ })).toHaveLength(12);
      fireEvent.change(leovegas, { target: { value: "400" } });
      fireEvent.change(screen.getByRole("textbox", { name: /^Einzahlungen bei ODDSET/ }), { target: { value: "240,5" } });
      fireEvent.blur(leovegas);
      await waitFor(() => expect(screen.getByText(/November 2026:/)).toHaveTextContent(/640,50\s€ von 1\.000,00\s€ eingezahlt · noch 359,50\s€ frei/));
      const put = fetchMock.mock.calls.find(([url, init]) => url === "/api/deposits" && init?.method === "PUT");
      expect(JSON.parse(String(put![1]!.body))).toEqual({ deposits: { leovegas: 400, oddset: 240.5 } });
    });

    it("takes an account's own LUGAS limit, and warns from 80 % of it", async () => {
      const { fetchMock } = stubApi();
      renderPage();
      const limit = await screen.findByRole("textbox", { name: /^Mein monatliches Einzahlungslimit/ });
      fireEvent.change(limit, { target: { value: "500" } });
      fireEvent.blur(limit);
      await waitFor(() => expect(screen.getByText(/November 2026:/)).toHaveTextContent(/von 500,00\s€ eingezahlt/));
      const leovegas = screen.getByRole("textbox", { name: /^Einzahlungen bei LeoVegas/ });
      fireEvent.change(leovegas, { target: { value: "420" } });
      fireEvent.blur(leovegas);
      expect(await screen.findByText(/Achtung: über 80 % deines Limits eingezahlt/)).toBeInTheDocument();
      const puts = fetchMock.mock.calls.filter(([url, init]) => url === "/api/deposits" && init?.method === "PUT").map(([, init]) => JSON.parse(String(init!.body)));
      expect(puts).toEqual([{ deposits: {}, limit: 500 }, { deposits: { leovegas: 420 } }]);
    });

    it("says when the wallet cannot be read, and reads it again", async () => {
      let ok = false;
      const fetchMock = stubApi().fetchMock;
      fetchMock.mockImplementation((url: string) => {
        if (url === "/api/freebets/wallet") return ok ? reply({ wallet: { leovegas: 5 } }) : reply({ message: "x" }, 500);
        return reply(BOOKMAKERS_ANSWER);
      });
      renderPage();
      expect(await screen.findByText(/Deine Freebets konnten nicht geladen werden/)).toBeInTheDocument();
      ok = true;
      fireEvent.click(screen.getByRole("button", { name: "Erneut versuchen" }));
      expect(await screen.findByDisplayValue("5")).toBeInTheDocument();
    });

    it("saves what is typed a moment after the last change, and converts the new wallet", async () => {
      const { calls } = stubApi();
      renderPage();
      await screen.findByDisplayValue("30");
      await waitFor(() => expect(calls.asked.length).toBe(1));

      fireEvent.change(fb("LeoVegas"), { target: { value: "40.5" } });
      expect(screen.getByText("Wird gespeichert…")).toBeInTheDocument();
      // Nothing is sent while the visitor is still typing.
      expect(calls.saved).toEqual([]);
      await waitFor(() => expect(calls.saved).toEqual([{ leovegas: 40.5, merkurbets: 25.5 }]), { timeout: 3000 });
      expect(await screen.findByText("In deinem Konto gespeichert")).toBeInTheDocument();
      // The server converts what it holds: asked again once it holds the new wallet.
      await waitFor(() => expect(calls.asked.length).toBe(2), { timeout: 3000 });
      expect(screen.getByText(/Insgesamt umzuwandeln/)).toHaveTextContent("66,00 FB");
    });

    it("sends the last of several quick changes only, and a cleared field as no freebets", async () => {
      const { calls } = stubApi();
      renderPage();
      await screen.findByDisplayValue("30");
      fireEvent.change(fb("LeoVegas"), { target: { value: "1" } });
      fireEvent.change(fb("LeoVegas"), { target: { value: "12" } });
      fireEvent.change(fb("Merkur Bets"), { target: { value: "7.25" } });
      fireEvent.change(fb("Merkur Bets"), { target: { value: "" } });
      await waitFor(() => expect(calls.saved).toHaveLength(1), { timeout: 3000 });
      expect(calls.saved[0]).toEqual({ leovegas: 12 });
    });

    it("flags a field that is not an amount, sends nothing, and goes on once it is corrected", async () => {
      const { calls } = stubApi();
      renderPage();
      await screen.findByDisplayValue("30");
      fireEvent.change(fb("LeoVegas"), { target: { value: "douze" } });
      expect(fb("LeoVegas")).toHaveAttribute("aria-invalid", "true");
      expect(screen.getByText(/Ungültiger Betrag/)).toBeInTheDocument();
      expect(screen.getByText(/Korrigiere die markierten Beträge/)).toBeInTheDocument();
      await new Promise((resolve) => setTimeout(resolve, 1000));
      expect(calls.saved).toEqual([]);
      fireEvent.change(fb("LeoVegas"), { target: { value: "12" } });
      expect(fb("LeoVegas")).toHaveAttribute("aria-invalid", "false");
      await waitFor(() => expect(calls.saved).toEqual([{ leovegas: 12, merkurbets: 25.5 }]), { timeout: 3000 });
    });

    it("keeps what is typed when the server refuses it, and tries again on request", async () => {
      const { api, calls } = stubApi({ saveFails: true });
      renderPage();
      await screen.findByDisplayValue("30");
      fireEvent.change(fb("LeoVegas"), { target: { value: "8" } });
      expect(await screen.findByText(/Speichern fehlgeschlagen/, undefined, { timeout: 3000 })).toBeInTheDocument();
      expect(fb("LeoVegas")).toHaveValue("8");
      api.saveFails = false;
      fireEvent.click(screen.getByRole("button", { name: "Erneut versuchen" }));
      await waitFor(() => expect(calls.saved).toEqual([{ leovegas: 8, merkurbets: 25.5 }]), { timeout: 3000 });
      expect(await screen.findByText("In deinem Konto gespeichert")).toBeInTheDocument();
    });

    it("writes a field back as an amount when it is left", async () => {
      stubApi();
      renderPage();
      await screen.findByDisplayValue("30");
      fireEvent.change(fb("LeoVegas"), { target: { value: "12.50" } });
      fireEvent.blur(fb("LeoVegas"));
      expect(fb("LeoVegas")).toHaveValue("12,5");
    });
  });

  describe("between bookmakers", () => {
    it("asks for the single bets first, and shows the three plans with the first one's detail and bets", async () => {
      const { calls } = stubApi();
      renderPage();
      expect(await screen.findByRole("heading", { name: "Top-3-Umwandlungen · Einzelwette" })).toBeInTheDocument();
      expect(calls.asked).toEqual(["/api/freebets/conversions?mode=bookmakers&legs=1"]);

      const cards = within(screen.getByRole("heading", { name: /Top-3/ }).closest("section")!).getAllByRole("button");
      expect(cards).toHaveLength(3);
      expect(cards[0]).toHaveAttribute("aria-pressed", "true");
      expect(cards[0]).toHaveTextContent("59,5 %");
      expect(cards[0]).toHaveTextContent("31,20 €");
      expect(cards[0]).toHaveTextContent("Beste Rate");
      expect(cards[1]).toHaveTextContent("Lyon – Lille");

      expect(screen.getByRole("heading", { name: "Umwandlung 1 · 3 Wetten platzieren" })).toBeInTheDocument();
      expect(screen.getByText(/Unverbindliche Quoten von/)).toHaveTextContent(/vor dem Platzieren prüfen/);
      // The figures, in the order of the page.
      const kpis = screen.getAllByRole("term").map((term) => term.textContent);
      expect(kpis).toEqual(["Umwandlungsrate", "Garantierte Auszahlung", "Umgewandelte FB", "Zu platzierende Wetten"]);
      expect(screen.getByText("52,40 / 55,50")).toBeInTheDocument();
      expect(screen.getByText("3,10 FB übrig")).toBeInTheDocument();
      expect(screen.getByText("2 Buchmacher, 0,00 € eigener Einsatz")).toBeInTheDocument();

      // Where to place them.
      const leovegas = within(screen.getByRole("article", { name: "LeoVegas" }));
      expect(leovegas.getByText("Paris SG")).toBeInTheDocument();
      expect(leovegas.getByText("12,40 FB")).toBeInTheDocument();
      expect(leovegas.getByText("28,40")).toBeInTheDocument();
      const merkurbets = within(screen.getByRole("article", { name: "Merkur Bets" }));
      expect(merkurbets.getByText("24,00 FB")).toBeInTheDocument();
      expect(screen.getByText(/Dir bleiben/)).toHaveTextContent("3,10 FB");
    });

    it("shows another plan when its card is chosen, and goes back to the first when the settings change", async () => {
      stubApi();
      renderPage();
      await screen.findByRole("heading", { name: /Top-3/ });
      fireEvent.click(screen.getByRole("button", { name: /Lyon – Lille/ }));
      expect(await screen.findByRole("heading", { name: "Umwandlung 2 · 3 Wetten platzieren" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Lyon – Lille/ })).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByText(/Die Suche wurde für diesen Plan abgekürzt/)).toBeInTheDocument();
      fireEvent.click(screen.getByRole("radio", { name: "2er-Kombiwette" }));
      await waitFor(() => expect(screen.getByRole("heading", { name: "Umwandlung 1 · 3 Wetten platzieren" })).toBeInTheDocument());
    });

    it("asks for the format chosen, and keeps it in the address", async () => {
      const { calls } = stubApi();
      renderPage();
      await screen.findByRole("heading", { name: /Top-3/ });
      fireEvent.click(screen.getByRole("radio", { name: "3er-Kombiwette" }));
      await waitFor(() => expect(lastAsked(calls)).toBe("/api/freebets/conversions?mode=bookmakers&legs=3"));
      expect(window.location.search).toBe("?legs=3");
      expect(await screen.findByRole("heading", { name: "Top-3-Umwandlungen · 3er-Kombiwette" })).toBeInTheDocument();
    });

    it("opens on the settings of the address", async () => {
      window.history.replaceState(null, "", "/freebets?legs=2&sports=tennis");
      const { calls } = stubApi();
      renderPage();
      await screen.findByRole("heading", { name: /Top-3/ });
      expect(calls.asked[0]).toBe("/api/freebets/conversions?mode=bookmakers&legs=2&sports=tennis");
      expect(screen.getByRole("radio", { name: "2er-Kombiwette" })).toBeChecked();
    });

    it("offers the sports on offer, all ticked, and asks again for those left ticked", async () => {
      const { calls } = stubApi();
      renderPage();
      const football = await screen.findByRole("button", { name: "Fußball" });
      const tennis = screen.getByRole("button", { name: "Tennis" });
      expect(football).toHaveAttribute("aria-pressed", "true");
      expect(tennis).toHaveAttribute("aria-pressed", "true");
      fireEvent.click(football);
      expect(football).toHaveAttribute("aria-pressed", "false");
      await waitFor(() => expect(lastAsked(calls)).toBe("/api/freebets/conversions?mode=bookmakers&legs=1&sports=tennis"));
      expect(window.location.search).toBe("?sports=tennis");
      // Every sport ticked again is every sport.
      fireEvent.click(screen.getByRole("button", { name: "Fußball" }));
      await waitFor(() => expect(lastAsked(calls)).toBe("/api/freebets/conversions?mode=bookmakers&legs=1"));
    });

    it("asks once for a few quick changes", async () => {
      const { calls } = stubApi();
      renderPage();
      await screen.findByRole("heading", { name: /Top-3/ });
      const before = calls.asked.length;
      fireEvent.click(screen.getByRole("radio", { name: "2er-Kombiwette" }));
      fireEvent.click(screen.getByRole("radio", { name: "3er-Kombiwette" }));
      await waitFor(() => expect(calls.asked.length).toBe(before + 1));
      expect(lastAsked(calls)).toContain("legs=3");
    });

    it("lists the bookmakers it uses", async () => {
      stubApi();
      renderPage();
      const info = (await screen.findByText(/Genutzte Buchmacher/)).closest("p")!;
      expect(info).toHaveTextContent("LeoVegas");
      expect(info).toHaveTextContent("Merkur Bets");
      expect(info).toHaveTextContent("Mindestens zwei sind nötig");
    });
  });

  describe("when there is nothing to show", () => {
    const reason = (reason: string, over = {}): ConversionAnswer => ({ ...BOOKMAKERS_ANSWER, plans: [], reason: reason as never, ...over });

    it("explains an empty wallet", async () => {
      stubApi({ wallet: {}, answers: () => reason("empty_wallet", { bookmakers: [], total: 0 }) });
      renderPage();
      expect(await screen.findByText(/Trag oben deine Freebets ein, um zu sehen, wie du sie umwandelst/)).toBeInTheDocument();
    });

    it("sends freebets held at one bookmaker to the exchange", async () => {
      stubApi({ wallet: { merkurbets: 30 }, answers: (url) => (url.searchParams.get("mode") === "exchange" ? echo(url, { merkurbets: 30 }) : reason("single_bookmaker")) });
      renderPage();
      expect(await screen.findByText(/Zum Umwandeln zwischen Buchmachern brauchst du mindestens zwei/)).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Gegen die Wettbörse umwandeln" }));
      expect(await screen.findByRole("heading", { name: /Top-3-Umwandlungen · Merkur Bets · 30,00 FB/ })).toBeInTheDocument();
      expect(screen.getByRole("radio", { name: "Gegen die Wettbörse" })).toBeChecked();
      expect(window.location.search).toContain("mode=exchange");
    });

    it.each([
      ["no_match", /Mit diesen Einstellungen gibt es gerade kein Spiel zum Umwandeln/],
      ["no_plan", /Mit diesen Spielen und deinen Freebets ist keine garantierte Umwandlung möglich/],
    ])("explains %s", async (code, text) => {
      stubApi({ answers: () => reason(code) });
      renderPage();
      expect(await screen.findByText(text)).toBeInTheDocument();
    });

    it("says when the search ran out of time", async () => {
      stubApi({ answers: () => ({ ...BOOKMAKERS_ANSWER, partial: true }) });
      renderPage();
      expect(await screen.findByText(/Die Zeit für die Berechnung war zu knapp/)).toBeInTheDocument();
    });

    it("shows the server's message when the calculation fails, and asks again on request", async () => {
      let fails = true;
      stubApi({ answers: () => (fails ? reply({ message: "Die Berechnung wurde nicht abgeschlossen. Versuch es gleich noch einmal." }, 503) : BOOKMAKERS_ANSWER) });
      renderPage();
      expect(await screen.findByRole("alert")).toHaveTextContent("Die Berechnung wurde nicht abgeschlossen");
      fails = false;
      fireEvent.click(screen.getByRole("button", { name: "Erneut versuchen" }));
      expect(await screen.findByRole("heading", { name: /Top-3/ })).toBeInTheDocument();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it("keeps the last answer on screen when a refresh fails", async () => {
      let fails = false;
      const { calls } = stubApi({ answers: () => (fails ? reply({ message: "Busy" }, 503) : BOOKMAKERS_ANSWER) });
      renderPage();
      await screen.findByRole("heading", { name: /Top-3/ });
      fails = true;
      fireEvent.click(screen.getByRole("button", { name: "Quoten aktualisieren" }));
      await waitFor(() => expect(calls.asked.length).toBe(2));
      expect(await screen.findByRole("alert")).toHaveTextContent("Die Umwandlungen konnten nicht aktualisiert werden: Busy");
      expect(screen.getByRole("heading", { name: /Top-3/ })).toBeInTheDocument();
    });
  });

  describe("against the exchange", () => {
    // LeoVegas holds 10 FB and comes first in the site's order: Merkur Bets's 30 FB are chosen.
    async function openExchange() {
      const api = stubApi({ wallet: { leovegas: 10, merkurbets: 30 } });
      renderPage();
      await screen.findByRole("heading", { name: /Top-3/ });
      fireEvent.click(screen.getByRole("radio", { name: "Gegen die Wettbörse" }));
      await screen.findByRole("heading", { name: /LeoVegas · 10,00 FB/ });
      fireEvent.click(screen.getByRole("radio", { name: /Merkur Bets, 30,00 FB/ }));
      await screen.findByRole("heading", { name: /Merkur Bets · 30,00 FB/ });
      return api;
    }

    it("asks for the first bookmaker that holds freebets, and shows the chain as three cards, a bar and the first step", async () => {
      window.history.replaceState(null, "", "/freebets?mode=exchange");
      const { calls } = stubApi({ wallet: { merkurbets: 30, leovegas: 10 } });
      renderPage();
      // LeoVegas comes first in the site's order.
      await waitFor(() => expect(calls.asked[0]).toBe("/api/freebets/conversions?mode=exchange&bookmaker=leovegas"));
    });

    it("shows the three conversions of the chain", async () => {
      await openExchange();
      const top = screen.getByRole("heading", { name: /Top-3/ }).closest("section")!;
      const cards = within(top).getAllByRole("button");
      expect(cards).toHaveLength(3);
      expect(cards[0]).toHaveTextContent("Durch Liquidität begrenzt");
      expect(cards[0]).toHaveTextContent("75,6 %");
      expect(cards[0]).toHaveTextContent("10,67 €");
      expect(cards[0]).toHaveTextContent("Wandelt 14,12 FB um · danach 15,88 FB übrig");
      expect(cards[2]).toHaveTextContent("Wandelt den ganzen Rest um");
      expect(cards[2]).toHaveTextContent("Wandelt 3,71 FB um · danach 0,00 FB übrig");

      // The wallet as the chain shares it.
      expect(screen.getByRole("img", { name: /Dein Guthaben bei Merkur Bets: 30,00 FB\. Umwandlung 1: 14,12 FB, Umwandlung 2: 12,17 FB, Umwandlung 3: 3,71 FB, nicht umgewandelt: 0,00 FB/ })).toBeInTheDocument();
      expect(screen.getByText(/Umwandlung 2:/)).toHaveTextContent("12,17 FB");
    });

    it("details a conversion: the freebet bet, the lay, the liquidity and what is left in each case", async () => {
      await openExchange();
      expect(screen.getByRole("heading", { name: "Umwandlung 1 · zwei Wetten platzieren" })).toBeInTheDocument();
      const step1 = within(screen.getByRole("heading", { name: /Merkur Bets · als Freebet/ }).parentElement!);
      expect(step1.getByText("14,12 FB")).toBeInTheDocument();
      expect(step1.getByText("4,60")).toBeInTheDocument();
      expect(step1.getByText(/Gewinnt sie, bringt die Freebet 50,83 €/)).toBeInTheDocument();
      const step2 = within(screen.getByRole("heading", { name: /Lay/ }).parentElement!);
      expect(step2.getByText(/^Lay auf/)).toHaveTextContent("Lay 11,00 € auf");
      expect(step2.getByText("4,65")).toBeInTheDocument();
      expect(step2.getByText(/3 % Kommission auf Gewinne/)).toBeInTheDocument();
      expect(step2.getByText(/Benötigter Lay/)).toHaveTextContent("verfügbar an der Wettbörse 11,00 €");

      expect(screen.getByRole("heading", { name: /^Unabhängig vom Ergebnis behältst du mindestens 10,67\s€$/ })).toBeInTheDocument();
      expect(screen.getByText("Wenn Auxerre gewinnt")).toBeInTheDocument();
      expect(screen.getByText("Wenn Auxerre nicht gewinnt (Brest gewinnt oder Unentschieden)")).toBeInTheDocument();
      expect(screen.getByText(/dein Lay verliert/)).toBeInTheDocument();
      expect(screen.getByText(/Bei dieser Liquidität lassen sich hier nur 14,12 FB von 30,00 FB umwandeln\. Mach mit Umwandlung 2 für die restlichen 15,88 FB weiter/)).toBeInTheDocument();
    });

    it("details the other conversions: a draw, and the one that takes the rest", async () => {
      await openExchange();
      fireEvent.click(screen.getAllByRole("button", { pressed: false })[0]);
      expect(await screen.findByRole("heading", { name: "Umwandlung 2 · zwei Wetten platzieren" })).toBeInTheDocument();
      expect(screen.getByText("Wenn das Spiel unentschieden endet")).toBeInTheDocument();
      expect(screen.getByText(/Wenn das Spiel nicht unentschieden endet/)).toBeInTheDocument();
      fireEvent.click(screen.getAllByRole("button", { pressed: false })[1]);
      expect(await screen.findByRole("heading", { name: "Umwandlung 3 · zwei Wetten platzieren" })).toBeInTheDocument();
      expect(screen.getByText(/Diese Umwandlung nimmt den ganzen Rest deines Guthabens bei Merkur Bets \(3,71 FB\)/)).toBeInTheDocument();
    });

    it("says 'at least' when the two cases leave different cents, and the amount alone when they leave the same", async () => {
      await openExchange();
      // The first conversion leaves 10,68 € or 10,67 € (the lay is rounded to the cent), the third 2,65 € either way.
      expect(screen.getByRole("heading", { name: /^Unabhängig vom Ergebnis behältst du mindestens 10,67\s€$/ })).toBeInTheDocument();
      fireEvent.click(screen.getAllByRole("button", { pressed: false })[1]);
      expect(await screen.findByRole("heading", { name: /^Unabhängig vom Ergebnis behältst du 2,65\s€$/ })).toBeInTheDocument();
    });

    describe("the chain's hint", () => {
      async function openChain(chain: Partial<typeof CHAIN>) {
        window.history.replaceState(null, "", "/freebets?mode=exchange&bookmaker=merkurbets");
        stubApi({
          wallet: { merkurbets: 30 },
          answers: (url) => (url.searchParams.get("mode") === "exchange" ? { ...EXCHANGE_ANSWER, chain: { ...CHAIN, ...chain } } : BOOKMAKERS_ANSWER),
        });
        renderPage();
        await screen.findByRole("heading", { name: /Merkur Bets · 30,00 FB/ });
      }
      const hint = () => screen.getByRole("heading", { name: /Merkur Bets · 30,00 FB/ }).closest("section")!.querySelector("p")!;

      it("tells the conversions to chain, from the first to the last", async () => {
        await openChain({});
        expect(hint()).toHaveTextContent("Mach sie nacheinander, von Nr. 1 bis Nr. 3, um dein ganzes Guthaben bei Merkur Bets umzuwandeln.");
      });

      it("does not ask to chain a single conversion", async () => {
        await openChain({ steps: [CHAIN.steps[2]], converted: 30, leftover: 0 });
        expect(hint()).toHaveTextContent("Eine einzige Umwandlung wandelt dein ganzes Guthaben bei Merkur Bets um.");
        expect(hint()).not.toHaveTextContent("nacheinander");
      });

      it("says what stays unconverted when the liquidity runs out", async () => {
        await openChain({ steps: [CHAIN.steps[0]], converted: 14.12, leftover: 15.88 });
        expect(hint()).toHaveTextContent("Nur ein Spiel ist im Angebot, und die Liquidität der Wettbörse begrenzt es: 15,88 FB deines Guthabens bei Merkur Bets bleiben nicht umgewandelt.");
      });

      it("says it for a chain too short for the balance as well", async () => {
        await openChain({ steps: CHAIN.steps.slice(0, 2), converted: 26.29, leftover: 3.71 });
        expect(hint()).toHaveTextContent("von Nr. 1 bis Nr. 2. 3,71 FB deines Guthabens bei Merkur Bets bleiben nicht umgewandelt.");
      });
    });

    it("lets the freebets of another bookmaker be chosen", async () => {
      const { calls } = await openExchange();
      const choice = screen.getByRole("radio", { name: /LeoVegas, 10,00 FB/ });
      fireEvent.click(choice);
      await waitFor(() => expect(lastAsked(calls)).toBe("/api/freebets/conversions?mode=exchange&bookmaker=leovegas"));
      expect(window.location.search).toContain("bookmaker=leovegas");
    });

    it.each([
      ["no_freebets", /Du hast keine Freebets bei diesem Buchmacher/],
      ["no_match", /kein Spiel dieses Buchmachers Geld für einen Lay an der Wettbörse/],
      ["no_plan", /keine garantierte Umwandlung gegen die Wettbörse möglich/],
    ])("explains %s", async (code, text) => {
      stubApi({ answers: (url) => (url.searchParams.get("mode") === "exchange" ? { ...EXCHANGE_ANSWER, chain: null, reason: code as never } : BOOKMAKERS_ANSWER) });
      renderPage();
      await screen.findByRole("heading", { name: /Top-3/ });
      fireEvent.click(screen.getByRole("radio", { name: "Gegen die Wettbörse" }));
      expect(await screen.findByText(text)).toBeInTheDocument();
    });

    it("asks to fill the wallet when no bookmaker holds freebets", async () => {
      window.history.replaceState(null, "", "/freebets?mode=exchange");
      const { calls } = stubApi({ wallet: {} });
      renderPage();
      expect((await screen.findAllByText(/Ein Buchmacher reicht, um sie gegen die Wettbörse umzuwandeln/)).length).toBeGreaterThan(0);
      expect(calls.asked).toEqual([]);
    });
  });

  describe("placing the bets", () => {
    afterEach(() => vi.unstubAllGlobals());

    it("copies a bookmaker's list, and says it did", async () => {
      stubApi();
      const writeText = vi.fn(() => Promise.resolve());
      Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
      renderPage();
      const leovegas = within(await screen.findByRole("article", { name: "LeoVegas" }));
      fireEvent.click(leovegas.getByRole("button", { name: "Liste kopieren" }));
      await waitFor(() => expect(writeText).toHaveBeenCalledWith("LeoVegas: 2 Freebet-Wetten\n- Paris SG: 12,40 FB\n- Marseille: 16,00 FB"));
      expect(await leovegas.findByText("Liste kopiert")).toBeInTheDocument();
    });

    it("says when the list cannot be copied", async () => {
      stubApi();
      Object.defineProperty(navigator, "clipboard", { value: { writeText: () => Promise.reject(new Error("denied")) }, configurable: true });
      renderPage();
      const merkurbets = within(await screen.findByRole("article", { name: "Merkur Bets" }));
      fireEvent.click(merkurbets.getByRole("button", { name: "Liste kopieren" }));
      expect(await merkurbets.findByText(/Kopieren fehlgeschlagen/)).toBeInTheDocument();
    });
  });

  describe("what the prices are worth", () => {
    const note = () => screen.queryByRole("note");

    it("says between bookmakers that the prices are indicative and that the bookmakers' stake limits are unknown", async () => {
      stubApi();
      renderPage();
      await screen.findByRole("heading", { name: "Top-3-Umwandlungen · Einzelwette" });
      expect(note()).toHaveTextContent("Unverbindliche Quoten. Sie ändern sich schnell: Prüfe vor dem Platzieren die Quote jeder Wette");
      expect(note()).toHaveTextContent("das Geld, das für den Lay verfügbar ist");
      expect(note()).toHaveTextContent("Die Berechnung kennt weder die Mindest- noch die Höchsteinsätze der einzelnen Buchmacher, besonders bei Kombiwetten.");
    });

    it("says it against the exchange too, without the stake limits of the bookmakers", async () => {
      window.history.replaceState(null, "", "/freebets?mode=exchange&bookmaker=merkurbets");
      stubApi({ wallet: { merkurbets: 30 } });
      renderPage();
      await screen.findByRole("heading", { name: /Merkur Bets · 30,00 FB/ });
      expect(note()).toHaveTextContent("Unverbindliche Quoten. Sie ändern sich schnell");
      expect(note()).not.toHaveTextContent("Mindest-");
      // The header of the detail says it as well.
      expect(screen.getByText(/Unverbindliche Quoten von/)).toHaveTextContent(/Brest – Auxerre.*vor dem Platzieren prüfen/);
    });

    it("is not shown when there is nothing to place", async () => {
      stubApi({ wallet: {}, answers: () => ({ ...BOOKMAKERS_ANSWER, plans: [], bookmakers: [], total: 0, reason: "empty_wallet" }) });
      renderPage();
      await screen.findByText(/Trag oben deine Freebets ein/);
      expect(note()).toBeNull();
    });
  });

  describe("the timing", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());
    const advance = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));
    // The wallet is read, then the first question waits its delay.
    const opened = async () => {
      await advance(0);
      await advance(ASK_DELAY_MS + 10);
    };

    it("saves the wallet only once the delay has passed since the last change", async () => {
      const { calls } = stubApi();
      renderPage();
      await opened();
      fireEvent.change(fb("LeoVegas"), { target: { value: "40" } });
      await advance(SAVE_DELAY_MS - 100);
      expect(calls.saved).toEqual([]);
      fireEvent.change(fb("LeoVegas"), { target: { value: "41" } });
      await advance(SAVE_DELAY_MS - 100);
      expect(calls.saved).toEqual([]);
      await advance(200);
      expect(calls.saved).toEqual([{ leovegas: 41, merkurbets: 25.5 }]);
    });

    it("asks only once the delay has passed since the last change of settings, and again every minute", async () => {
      const { calls } = stubApi();
      renderPage();
      await opened();
      expect(calls.asked).toHaveLength(1);
      fireEvent.click(screen.getByRole("radio", { name: "2er-Kombiwette" }));
      await advance(ASK_DELAY_MS - 50);
      expect(calls.asked).toHaveLength(1);
      await advance(100);
      expect(calls.asked).toHaveLength(2);
      await advance(REFRESH_MS);
      await advance(ASK_DELAY_MS + 10);
      expect(calls.asked).toHaveLength(3);
      expect(lastAsked(calls)).toContain("legs=2");
    });

    it("does not ask again while the page is hidden", async () => {
      const { calls } = stubApi();
      renderPage();
      await opened();
      const state = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
      await advance(REFRESH_MS * 2);
      expect(calls.asked).toHaveLength(1);
      state.mockReturnValue("visible");
      await advance(REFRESH_MS);
      await advance(ASK_DELAY_MS + 10);
      expect(calls.asked).toHaveLength(2);
    });

    it("shows nothing of the old settings while the answer to the new ones is on its way, and ignores a late old answer", async () => {
      let release: (answer: unknown) => void = () => {};
      let slow = false;
      stubApi({
        answers: (url) => {
          if (slow && url.searchParams.get("legs") === "3") return new Promise((resolve) => (release = resolve));
          return echo(url, { leovegas: 30, merkurbets: 25.5 });
        },
      });
      renderPage();
      await opened();
      expect(screen.getByRole("heading", { name: "Top-3-Umwandlungen · Einzelwette" })).toBeInTheDocument();
      slow = true;
      fireEvent.click(screen.getByRole("radio", { name: "3er-Kombiwette" }));
      await advance(ASK_DELAY_MS + 10);
      // The single bets' plans are not the combos': they are not shown as such.
      expect(screen.queryByRole("heading", { name: /Einzelwette/ })).not.toBeInTheDocument();
      // A fourth change replaces the slow question; its late answer arrives after.
      fireEvent.click(screen.getByRole("radio", { name: "2er-Kombiwette" }));
      await advance(ASK_DELAY_MS + 10);
      expect(screen.getByRole("heading", { name: "Top-3-Umwandlungen · 2er-Kombiwette" })).toBeInTheDocument();
      await act(async () => release(reply({ ...BOOKMAKERS_ANSWER, legs: 3 })));
      expect(screen.getByRole("heading", { name: "Top-3-Umwandlungen · 2er-Kombiwette" })).toBeInTheDocument();
      expect(screen.queryByRole("heading", { name: /3er-Kombiwette/ })).not.toBeInTheDocument();
    });
  });

  describe("the page", () => {
    it("names the Freebets entry of the navigation as the page in, with the two lists and the Promos beside it", async () => {
      stubApi();
      renderPage();
      await screen.findByRole("heading", { name: /Top-3/ });
      const views = within(screen.getByRole("group", { name: "Anzeigen" })).getAllByRole("radio");
      expect(views.map((radio) => radio.getAttribute("value"))).toEqual(["value-bets", "matches", "freebets", "promos"]);
      expect(screen.getByRole("radio", { name: "Freebets" })).toBeChecked();
      expect(screen.getByRole("heading", { level: 1, name: "Freebets" })).toBeInTheDocument();
    });

    it("goes to the dashboard's lists from the navigation", async () => {
      stubApi();
      renderPage();
      await screen.findByRole("heading", { name: /Top-3/ });
      fireEvent.click(screen.getByRole("radio", { name: "Value Bets" }));
      expect(window.location.pathname).toBe("/odds");
      expect(window.location.search).toContain("sport=value-bets");
    });

    it("goes to the Promos page from the navigation", async () => {
      stubApi();
      renderPage();
      await screen.findByRole("heading", { name: /Top-3/ });
      fireEvent.click(screen.getByRole("radio", { name: "Promos" }));
      expect(window.location.pathname).toBe("/promos");
    });

    it("shows the time of the last answer", async () => {
      stubApi();
      renderPage();
      await screen.findByRole("heading", { name: /Top-3/ });
      expect(await screen.findByText(/Aktualisiert um/)).toBeInTheDocument();
    });

    it("lays out for a phone, with the bar at the bottom and the bets one under the other", async () => {
      mockPhone();
      stubApi();
      renderPage();
      await screen.findByRole("heading", { name: /Top-3/ });
      expect(screen.getByRole("navigation", { name: "Hauptnavigation" })).toBeInTheDocument();
      expect(screen.getByRole("radio", { name: "Freebets" })).toBeChecked();
    });

    it("has no accessibility violation axe can find, with plans and with a chain", async () => {
      stubApi();
      const page = renderPage();
      await screen.findByRole("heading", { name: /Top-3/ });
      const rules = { rules: { "color-contrast": { enabled: false } } };
      expect((await axe.run(page.container, rules)).violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.html).join(" | ")}`)).toEqual([]);
      fireEvent.click(screen.getByRole("radio", { name: "Gegen die Wettbörse" }));
      await screen.findByRole("heading", { name: /LeoVegas · 30,00 FB/ });
      expect((await axe.run(page.container, rules)).violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.html).join(" | ")}`)).toEqual([]);
    });
  });

});
