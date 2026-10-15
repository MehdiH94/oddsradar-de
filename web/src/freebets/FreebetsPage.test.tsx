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
    wallet: { winamax: 30, betclic: 25.5 },
    answers: (url) => echo(url, api.wallet),
    ...over,
  };
  const calls = { saved: [] as Wallet[], asked: [] as string[] };
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

const fb = (name: string) => screen.getByRole("textbox", { name: `Freebets ${name} en euros` });
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
      expect(fb("Winamax")).toHaveValue("30");
      expect(fb("Betclic")).toHaveValue("25,5");
      expect(screen.getAllByRole("textbox")).toHaveLength(2);
      expect(screen.getByText(/Total à convertir/)).toHaveTextContent("55,50 FB");
      expect(await screen.findByText("Enregistré sur votre compte")).toBeInTheDocument();
    });

    it("says when the wallet cannot be read, and reads it again", async () => {
      let ok = false;
      const fetchMock = stubApi().fetchMock;
      fetchMock.mockImplementation((url: string) => {
        if (url === "/api/freebets/wallet") return ok ? reply({ wallet: { winamax: 5 } }) : reply({ message: "x" }, 500);
        return reply(BOOKMAKERS_ANSWER);
      });
      renderPage();
      expect(await screen.findByText(/Impossible de charger vos freebets/)).toBeInTheDocument();
      ok = true;
      fireEvent.click(screen.getByRole("button", { name: "Réessayer" }));
      expect(await screen.findByDisplayValue("5")).toBeInTheDocument();
    });

    it("saves what is typed a moment after the last change, and converts the new wallet", async () => {
      const { calls } = stubApi();
      renderPage();
      await screen.findByDisplayValue("30");
      await waitFor(() => expect(calls.asked.length).toBe(1));

      fireEvent.change(fb("Winamax"), { target: { value: "40,5" } });
      expect(screen.getByText("Enregistrement…")).toBeInTheDocument();
      // Nothing is sent while the visitor is still typing.
      expect(calls.saved).toEqual([]);
      await waitFor(() => expect(calls.saved).toEqual([{ winamax: 40.5, betclic: 25.5 }]), { timeout: 3000 });
      expect(await screen.findByText("Enregistré sur votre compte")).toBeInTheDocument();
      // The server converts what it holds: asked again once it holds the new wallet.
      await waitFor(() => expect(calls.asked.length).toBe(2), { timeout: 3000 });
      expect(screen.getByText(/Total à convertir/)).toHaveTextContent("66,00 FB");
    });

    it("sends the last of several quick changes only, and a cleared field as no freebets", async () => {
      const { calls } = stubApi();
      renderPage();
      await screen.findByDisplayValue("30");
      fireEvent.change(fb("Winamax"), { target: { value: "1" } });
      fireEvent.change(fb("Winamax"), { target: { value: "12" } });
      fireEvent.change(fb("Betclic"), { target: { value: "7.25" } });
      fireEvent.change(fb("Betclic"), { target: { value: "" } });
      await waitFor(() => expect(calls.saved).toHaveLength(1), { timeout: 3000 });
      expect(calls.saved[0]).toEqual({ winamax: 12 });
    });

    it("flags a field that is not an amount, sends nothing, and goes on once it is corrected", async () => {
      const { calls } = stubApi();
      renderPage();
      await screen.findByDisplayValue("30");
      fireEvent.change(fb("Winamax"), { target: { value: "douze" } });
      expect(fb("Winamax")).toHaveAttribute("aria-invalid", "true");
      expect(screen.getByText(/Montant invalide/)).toBeInTheDocument();
      expect(screen.getByText(/Corrigez les montants signalés/)).toBeInTheDocument();
      await new Promise((resolve) => setTimeout(resolve, 1000));
      expect(calls.saved).toEqual([]);
      fireEvent.change(fb("Winamax"), { target: { value: "12" } });
      expect(fb("Winamax")).toHaveAttribute("aria-invalid", "false");
      await waitFor(() => expect(calls.saved).toEqual([{ winamax: 12, betclic: 25.5 }]), { timeout: 3000 });
    });

    it("keeps what is typed when the server refuses it, and tries again on request", async () => {
      const { api, calls } = stubApi({ saveFails: true });
      renderPage();
      await screen.findByDisplayValue("30");
      fireEvent.change(fb("Winamax"), { target: { value: "8" } });
      expect(await screen.findByText(/Enregistrement impossible/, undefined, { timeout: 3000 })).toBeInTheDocument();
      expect(fb("Winamax")).toHaveValue("8");
      api.saveFails = false;
      fireEvent.click(screen.getByRole("button", { name: "Réessayer" }));
      await waitFor(() => expect(calls.saved).toEqual([{ winamax: 8, betclic: 25.5 }]), { timeout: 3000 });
      expect(await screen.findByText("Enregistré sur votre compte")).toBeInTheDocument();
    });

    it("writes a field back as an amount when it is left", async () => {
      stubApi();
      renderPage();
      await screen.findByDisplayValue("30");
      fireEvent.change(fb("Winamax"), { target: { value: "12.50" } });
      fireEvent.blur(fb("Winamax"));
      expect(fb("Winamax")).toHaveValue("12,5");
    });
  });

  describe("between bookmakers", () => {
    it("asks for the single bets first, and shows the three plans with the first one's detail and bets", async () => {
      const { calls } = stubApi();
      renderPage();
      expect(await screen.findByRole("heading", { name: "Top 3 des conversions · pari simple" })).toBeInTheDocument();
      expect(calls.asked).toEqual(["/api/freebets/conversions?mode=bookmakers&legs=1"]);

      const cards = within(screen.getByRole("heading", { name: /Top 3/ }).closest("section")!).getAllByRole("button");
      expect(cards).toHaveLength(3);
      expect(cards[0]).toHaveAttribute("aria-pressed", "true");
      expect(cards[0]).toHaveTextContent("59,5 %");
      expect(cards[0]).toHaveTextContent("31,20 €");
      expect(cards[0]).toHaveTextContent("Meilleur taux");
      expect(cards[1]).toHaveTextContent("Lyon – Lille");

      expect(screen.getByRole("heading", { name: "Conversion 1 · les 3 paris à placer" })).toBeInTheDocument();
      expect(screen.getByText(/Cotes indicatives relevées à/)).toHaveTextContent(/à vérifier avant de placer/);
      // The figures, in the order of the page.
      const kpis = screen.getAllByRole("term").map((term) => term.textContent);
      expect(kpis).toEqual(["Taux de conversion", "Retour cash garanti", "FB convertis", "Paris à placer"]);
      expect(screen.getByText("52,40 / 55,50")).toBeInTheDocument();
      expect(screen.getByText("3,10 FB restants")).toBeInTheDocument();
      expect(screen.getByText("2 bookmakers, 0 € de mise")).toBeInTheDocument();

      // Where to place them.
      const winamax = within(screen.getByRole("article", { name: "Winamax" }));
      expect(winamax.getByText("Paris SG")).toBeInTheDocument();
      expect(winamax.getByText("12,40 FB")).toBeInTheDocument();
      expect(winamax.getByText("28,40")).toBeInTheDocument();
      const betclic = within(screen.getByRole("article", { name: "Betclic" }));
      expect(betclic.getByText("24,00 FB")).toBeInTheDocument();
      expect(screen.getByText(/Il vous reste/)).toHaveTextContent("3,10 FB");
    });

    it("shows another plan when its card is chosen, and goes back to the first when the settings change", async () => {
      stubApi();
      renderPage();
      await screen.findByRole("heading", { name: /Top 3/ });
      fireEvent.click(screen.getByRole("button", { name: /Lyon – Lille/ }));
      expect(await screen.findByRole("heading", { name: "Conversion 2 · les 3 paris à placer" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Lyon – Lille/ })).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByText(/La recherche a été interrompue pour ce plan/)).toBeInTheDocument();
      fireEvent.click(screen.getByRole("radio", { name: "Combiné 2 matchs" }));
      await waitFor(() => expect(screen.getByRole("heading", { name: "Conversion 1 · les 3 paris à placer" })).toBeInTheDocument());
    });

    it("asks for the format chosen, and keeps it in the address", async () => {
      const { calls } = stubApi();
      renderPage();
      await screen.findByRole("heading", { name: /Top 3/ });
      fireEvent.click(screen.getByRole("radio", { name: "Combiné 3 matchs" }));
      await waitFor(() => expect(lastAsked(calls)).toBe("/api/freebets/conversions?mode=bookmakers&legs=3"));
      expect(window.location.search).toBe("?legs=3");
      expect(await screen.findByRole("heading", { name: "Top 3 des conversions · combiné 3 matchs" })).toBeInTheDocument();
    });

    it("opens on the settings of the address", async () => {
      window.history.replaceState(null, "", "/freebets?legs=2&sports=tennis");
      const { calls } = stubApi();
      renderPage();
      await screen.findByRole("heading", { name: /Top 3/ });
      expect(calls.asked[0]).toBe("/api/freebets/conversions?mode=bookmakers&legs=2&sports=tennis");
      expect(screen.getByRole("radio", { name: "Combiné 2 matchs" })).toBeChecked();
    });

    it("offers the sports on offer, all ticked, and asks again for those left ticked", async () => {
      const { calls } = stubApi();
      renderPage();
      const football = await screen.findByRole("button", { name: "Football" });
      const tennis = screen.getByRole("button", { name: "Tennis" });
      expect(football).toHaveAttribute("aria-pressed", "true");
      expect(tennis).toHaveAttribute("aria-pressed", "true");
      fireEvent.click(football);
      expect(football).toHaveAttribute("aria-pressed", "false");
      await waitFor(() => expect(lastAsked(calls)).toBe("/api/freebets/conversions?mode=bookmakers&legs=1&sports=tennis"));
      expect(window.location.search).toBe("?sports=tennis");
      // Every sport ticked again is every sport.
      fireEvent.click(screen.getByRole("button", { name: "Football" }));
      await waitFor(() => expect(lastAsked(calls)).toBe("/api/freebets/conversions?mode=bookmakers&legs=1"));
    });

    it("asks once for a few quick changes", async () => {
      const { calls } = stubApi();
      renderPage();
      await screen.findByRole("heading", { name: /Top 3/ });
      const before = calls.asked.length;
      fireEvent.click(screen.getByRole("radio", { name: "Combiné 2 matchs" }));
      fireEvent.click(screen.getByRole("radio", { name: "Combiné 3 matchs" }));
      await waitFor(() => expect(calls.asked.length).toBe(before + 1));
      expect(lastAsked(calls)).toContain("legs=3");
    });

    it("lists the bookmakers it uses", async () => {
      stubApi();
      renderPage();
      const info = (await screen.findByText(/Bookmakers utilisés/)).closest("p")!;
      expect(info).toHaveTextContent("Winamax");
      expect(info).toHaveTextContent("Betclic");
      expect(info).toHaveTextContent("Il en faut au moins deux");
    });
  });

  describe("when there is nothing to show", () => {
    const reason = (reason: string, over = {}): ConversionAnswer => ({ ...BOOKMAKERS_ANSWER, plans: [], reason: reason as never, ...over });

    it("explains an empty wallet", async () => {
      stubApi({ wallet: {}, answers: () => reason("empty_wallet", { bookmakers: [], total: 0 }) });
      renderPage();
      expect(await screen.findByText(/Indiquez vos freebets ci-dessus pour voir comment les convertir/)).toBeInTheDocument();
    });

    it("sends freebets held at one bookmaker to the exchange", async () => {
      stubApi({ wallet: { betclic: 30 }, answers: (url) => (url.searchParams.get("mode") === "exchange" ? echo(url, { betclic: 30 }) : reason("single_bookmaker")) });
      renderPage();
      expect(await screen.findByText(/il en faut au moins deux/)).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Convertir contre l'exchange" }));
      expect(await screen.findByRole("heading", { name: /Top 3 des conversions · Betclic · 30,00 FB/ })).toBeInTheDocument();
      expect(screen.getByRole("radio", { name: "Contre l'exchange" })).toBeChecked();
      expect(window.location.search).toContain("mode=exchange");
    });

    it.each([
      ["no_match", /Aucun match à convertir avec ces réglages/],
      ["no_plan", /Aucune conversion garantie n'est possible avec ces matchs/],
    ])("explains %s", async (code, text) => {
      stubApi({ answers: () => reason(code) });
      renderPage();
      expect(await screen.findByText(text)).toBeInTheDocument();
    });

    it("says when the search ran out of time", async () => {
      stubApi({ answers: () => ({ ...BOOKMAKERS_ANSWER, partial: true }) });
      renderPage();
      expect(await screen.findByText(/Le calcul a été interrompu faute de temps/)).toBeInTheDocument();
    });

    it("shows the server's message when the calculation fails, and asks again on request", async () => {
      let fails = true;
      stubApi({ answers: () => (fails ? reply({ message: "Le calcul n'a pas abouti. Réessayez dans un instant." }, 503) : BOOKMAKERS_ANSWER) });
      renderPage();
      expect(await screen.findByRole("alert")).toHaveTextContent("Le calcul n'a pas abouti");
      fails = false;
      fireEvent.click(screen.getByRole("button", { name: "Réessayer" }));
      expect(await screen.findByRole("heading", { name: /Top 3/ })).toBeInTheDocument();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it("keeps the last answer on screen when a refresh fails", async () => {
      let fails = false;
      const { calls } = stubApi({ answers: () => (fails ? reply({ message: "Occupé" }, 503) : BOOKMAKERS_ANSWER) });
      renderPage();
      await screen.findByRole("heading", { name: /Top 3/ });
      fails = true;
      fireEvent.click(screen.getByRole("button", { name: "Actualiser les cotes" }));
      await waitFor(() => expect(calls.asked.length).toBe(2));
      expect(await screen.findByRole("alert")).toHaveTextContent("Impossible d'actualiser les conversions : Occupé");
      expect(screen.getByRole("heading", { name: /Top 3/ })).toBeInTheDocument();
    });
  });

  describe("against the exchange", () => {
    // Winamax holds 10 FB and comes first in the site's order: Betclic's 30 FB are chosen.
    async function openExchange() {
      const api = stubApi({ wallet: { winamax: 10, betclic: 30 } });
      renderPage();
      await screen.findByRole("heading", { name: /Top 3/ });
      fireEvent.click(screen.getByRole("radio", { name: "Contre l'exchange" }));
      await screen.findByRole("heading", { name: /Winamax · 10,00 FB/ });
      fireEvent.click(screen.getByRole("radio", { name: /Betclic, 30,00 FB/ }));
      await screen.findByRole("heading", { name: /Betclic · 30,00 FB/ });
      return api;
    }

    it("asks for the first bookmaker that holds freebets, and shows the chain as three cards, a bar and the first step", async () => {
      window.history.replaceState(null, "", "/freebets?mode=exchange");
      const { calls } = stubApi({ wallet: { betclic: 30, winamax: 10 } });
      renderPage();
      // Winamax comes first in the site's order.
      await waitFor(() => expect(calls.asked[0]).toBe("/api/freebets/conversions?mode=exchange&bookmaker=winamax"));
    });

    it("shows the three conversions of the chain", async () => {
      await openExchange();
      const top = screen.getByRole("heading", { name: /Top 3/ }).closest("section")!;
      const cards = within(top).getAllByRole("button");
      expect(cards).toHaveLength(3);
      expect(cards[0]).toHaveTextContent("Limitée par la liquidité");
      expect(cards[0]).toHaveTextContent("75,6 %");
      expect(cards[0]).toHaveTextContent("10,67 €");
      expect(cards[0]).toHaveTextContent("Convertit 14,12 FB · 15,88 FB restants ensuite");
      expect(cards[2]).toHaveTextContent("Convertit tout le reste");
      expect(cards[2]).toHaveTextContent("Convertit 3,71 FB · 0,00 FB restants ensuite");

      // The wallet as the chain shares it.
      expect(screen.getByRole("img", { name: /Votre solde Betclic de 30,00 FB : conversion 1 : 14,12 FB, conversion 2 : 12,17 FB, conversion 3 : 3,71 FB, non converti : 0,00 FB/ })).toBeInTheDocument();
      expect(screen.getByText(/Conversion 2 :/)).toHaveTextContent("12,17 FB");
    });

    it("details a conversion: the freebet bet, the lay, the liquidity and what is left in each case", async () => {
      await openExchange();
      expect(screen.getByRole("heading", { name: "Conversion 1 · deux paris à placer" })).toBeInTheDocument();
      const step1 = within(screen.getByRole("heading", { name: /Betclic · en freebet/ }).parentElement!);
      expect(step1.getByText("14,12 FB")).toBeInTheDocument();
      expect(step1.getByText("4,60")).toBeInTheDocument();
      expect(step1.getByText(/S'il gagne, le freebet rapporte 50,83 €/)).toBeInTheDocument();
      const step2 = within(screen.getByRole("heading", { name: /Lay/ }).parentElement!);
      expect(step2.getByText(/Layer/)).toHaveTextContent("Layer 11,00 € sur");
      expect(step2.getByText("4,65")).toBeInTheDocument();
      expect(step2.getByText(/commission 3 % sur les gains/)).toBeInTheDocument();
      expect(step2.getByText(/Lay nécessaire/)).toHaveTextContent("disponible sur l'exchange 11,00 €");

      expect(screen.getByRole("heading", { name: "Quel que soit le résultat, il vous reste au moins 10,67 €" })).toBeInTheDocument();
      expect(screen.getByText("Si Auxerre gagne")).toBeInTheDocument();
      expect(screen.getByText("Si Auxerre ne gagne pas (Brest gagne ou match nul)")).toBeInTheDocument();
      expect(screen.getByText(/votre lay perd/)).toBeInTheDocument();
      expect(screen.getByText(/Avec cette liquidité, seuls 14,12 FB sur 30,00 FB peuvent être convertis ici. Passez à la conversion 2 pour les 15,88 FB restants/)).toBeInTheDocument();
    });

    it("details the other conversions: a draw, and the one that takes the rest", async () => {
      await openExchange();
      fireEvent.click(screen.getAllByRole("button", { pressed: false })[0]);
      expect(await screen.findByRole("heading", { name: "Conversion 2 · deux paris à placer" })).toBeInTheDocument();
      expect(screen.getByText("Si le match est nul")).toBeInTheDocument();
      expect(screen.getByText(/Si le match n'est pas nul/)).toBeInTheDocument();
      fireEvent.click(screen.getAllByRole("button", { pressed: false })[1]);
      expect(await screen.findByRole("heading", { name: "Conversion 3 · deux paris à placer" })).toBeInTheDocument();
      expect(screen.getByText(/Cette conversion absorbe tout le reste de votre solde Betclic \(3,71 FB\)/)).toBeInTheDocument();
    });

    it("says 'at least' when the two cases leave different cents, and the amount alone when they leave the same", async () => {
      await openExchange();
      // The first conversion leaves 10,68 € or 10,67 € (the lay is rounded to the cent), the third 2,65 € either way.
      expect(screen.getByRole("heading", { name: "Quel que soit le résultat, il vous reste au moins 10,67 €" })).toBeInTheDocument();
      fireEvent.click(screen.getAllByRole("button", { pressed: false })[1]);
      expect(await screen.findByRole("heading", { name: "Quel que soit le résultat, il vous reste 2,65 €" })).toBeInTheDocument();
    });

    describe("the chain's hint", () => {
      async function openChain(chain: Partial<typeof CHAIN>) {
        window.history.replaceState(null, "", "/freebets?mode=exchange&bookmaker=betclic");
        stubApi({
          wallet: { betclic: 30 },
          answers: (url) => (url.searchParams.get("mode") === "exchange" ? { ...EXCHANGE_ANSWER, chain: { ...CHAIN, ...chain } } : BOOKMAKERS_ANSWER),
        });
        renderPage();
        await screen.findByRole("heading", { name: /Betclic · 30,00 FB/ });
      }
      const hint = () => screen.getByRole("heading", { name: /Betclic · 30,00 FB/ }).closest("section")!.querySelector("p")!;

      it("tells the conversions to chain, from the first to the last", async () => {
        await openChain({});
        expect(hint()).toHaveTextContent("enchaînez-les, du n°1 au n°3, pour convertir tout votre solde Betclic.");
      });

      it("does not ask to chain a single conversion", async () => {
        await openChain({ steps: [CHAIN.steps[2]], converted: 30, leftover: 0 });
        expect(hint()).toHaveTextContent("Une seule conversion suffit à convertir tout votre solde Betclic.");
        expect(hint()).not.toHaveTextContent("enchaînez");
      });

      it("says what stays unconverted when the liquidity runs out", async () => {
        await openChain({ steps: [CHAIN.steps[0]], converted: 14.12, leftover: 15.88 });
        expect(hint()).toHaveTextContent("Un seul match est proposé et la liquidité de l'exchange le limite : 15,88 FB de votre solde Betclic resteront non convertis.");
      });

      it("says it for a chain too short for the balance as well", async () => {
        await openChain({ steps: CHAIN.steps.slice(0, 2), converted: 26.29, leftover: 3.71 });
        expect(hint()).toHaveTextContent("du n°1 au n°2. 3,71 FB de votre solde Betclic resteront non convertis.");
      });
    });

    it("lets the freebets of another bookmaker be chosen", async () => {
      const { calls } = await openExchange();
      const choice = screen.getByRole("radio", { name: /Winamax, 10,00 FB/ });
      fireEvent.click(choice);
      await waitFor(() => expect(lastAsked(calls)).toBe("/api/freebets/conversions?mode=exchange&bookmaker=winamax"));
      expect(window.location.search).toContain("bookmaker=winamax");
    });

    it.each([
      ["no_freebets", /Vous n'avez pas de freebets chez ce bookmaker/],
      ["no_match", /Aucun match de ce bookmaker n'a, pour le moment, d'argent à layer/],
      ["no_plan", /Aucune conversion garantie n'est possible contre l'exchange/],
    ])("explains %s", async (code, text) => {
      stubApi({ answers: (url) => (url.searchParams.get("mode") === "exchange" ? { ...EXCHANGE_ANSWER, chain: null, reason: code as never } : BOOKMAKERS_ANSWER) });
      renderPage();
      await screen.findByRole("heading", { name: /Top 3/ });
      fireEvent.click(screen.getByRole("radio", { name: "Contre l'exchange" }));
      expect(await screen.findByText(text)).toBeInTheDocument();
    });

    it("asks to fill the wallet when no bookmaker holds freebets", async () => {
      window.history.replaceState(null, "", "/freebets?mode=exchange");
      const { calls } = stubApi({ wallet: {} });
      renderPage();
      expect((await screen.findAllByText(/un seul bookmaker suffit pour les convertir contre l'exchange/)).length).toBeGreaterThan(0);
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
      const winamax = within(await screen.findByRole("article", { name: "Winamax" }));
      fireEvent.click(winamax.getByRole("button", { name: "Copier la liste" }));
      await waitFor(() => expect(writeText).toHaveBeenCalledWith("Winamax : 2 paris en freebet\n- Paris SG : 12,40 FB\n- Marseille : 16,00 FB"));
      expect(await winamax.findByText("Liste copiée")).toBeInTheDocument();
    });

    it("says when the list cannot be copied", async () => {
      stubApi();
      Object.defineProperty(navigator, "clipboard", { value: { writeText: () => Promise.reject(new Error("denied")) }, configurable: true });
      renderPage();
      const betclic = within(await screen.findByRole("article", { name: "Betclic" }));
      fireEvent.click(betclic.getByRole("button", { name: "Copier la liste" }));
      expect(await betclic.findByText(/Copie impossible/)).toBeInTheDocument();
    });
  });

  describe("what the prices are worth", () => {
    const note = () => screen.queryByRole("note");

    it("says between bookmakers that the prices are indicative and that the bookmakers' stake limits are unknown", async () => {
      stubApi();
      renderPage();
      await screen.findByRole("heading", { name: "Top 3 des conversions · pari simple" });
      expect(note()).toHaveTextContent("Cotes indicatives. Elles bougent vite : vérifiez la cote de chaque pari");
      expect(note()).toHaveTextContent("l'argent disponible à layer");
      expect(note()).toHaveTextContent("Le calcul ne connaît ni les mises minimales ni les mises maximales de chaque bookmaker, surtout sur les combinés.");
    });

    it("says it against the exchange too, without the stake limits of the bookmakers", async () => {
      window.history.replaceState(null, "", "/freebets?mode=exchange&bookmaker=betclic");
      stubApi({ wallet: { betclic: 30 } });
      renderPage();
      await screen.findByRole("heading", { name: /Betclic · 30,00 FB/ });
      expect(note()).toHaveTextContent("Cotes indicatives. Elles bougent vite");
      expect(note()).not.toHaveTextContent("mises minimales");
      // The header of the detail says it as well.
      expect(screen.getByText(/Cotes indicatives relevées à/)).toHaveTextContent(/Brest – Auxerre.*à vérifier avant de placer/);
    });

    it("is not shown when there is nothing to place", async () => {
      stubApi({ wallet: {}, answers: () => ({ ...BOOKMAKERS_ANSWER, plans: [], bookmakers: [], total: 0, reason: "empty_wallet" }) });
      renderPage();
      await screen.findByText(/Indiquez vos freebets ci-dessus/);
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
      fireEvent.change(fb("Winamax"), { target: { value: "40" } });
      await advance(SAVE_DELAY_MS - 100);
      expect(calls.saved).toEqual([]);
      fireEvent.change(fb("Winamax"), { target: { value: "41" } });
      await advance(SAVE_DELAY_MS - 100);
      expect(calls.saved).toEqual([]);
      await advance(200);
      expect(calls.saved).toEqual([{ winamax: 41, betclic: 25.5 }]);
    });

    it("asks only once the delay has passed since the last change of settings, and again every minute", async () => {
      const { calls } = stubApi();
      renderPage();
      await opened();
      expect(calls.asked).toHaveLength(1);
      fireEvent.click(screen.getByRole("radio", { name: "Combiné 2 matchs" }));
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
          return echo(url, { winamax: 30, betclic: 25.5 });
        },
      });
      renderPage();
      await opened();
      expect(screen.getByRole("heading", { name: "Top 3 des conversions · pari simple" })).toBeInTheDocument();
      slow = true;
      fireEvent.click(screen.getByRole("radio", { name: "Combiné 3 matchs" }));
      await advance(ASK_DELAY_MS + 10);
      // The single bets' plans are not the combos': they are not shown as such.
      expect(screen.queryByRole("heading", { name: /pari simple/ })).not.toBeInTheDocument();
      // A fourth change replaces the slow question; its late answer arrives after.
      fireEvent.click(screen.getByRole("radio", { name: "Combiné 2 matchs" }));
      await advance(ASK_DELAY_MS + 10);
      expect(screen.getByRole("heading", { name: "Top 3 des conversions · combiné 2 matchs" })).toBeInTheDocument();
      await act(async () => release(reply({ ...BOOKMAKERS_ANSWER, legs: 3 })));
      expect(screen.getByRole("heading", { name: "Top 3 des conversions · combiné 2 matchs" })).toBeInTheDocument();
      expect(screen.queryByRole("heading", { name: /combiné 3 matchs/ })).not.toBeInTheDocument();
    });
  });

  describe("the page", () => {
    it("names the Freebets entry of the navigation as the page in, with the two lists beside it", async () => {
      stubApi();
      renderPage();
      await screen.findByRole("heading", { name: /Top 3/ });
      const views = within(screen.getByRole("group", { name: "Afficher" })).getAllByRole("radio");
      expect(views.map((radio) => radio.getAttribute("value"))).toEqual(["value-bets", "matches", "freebets"]);
      expect(screen.getByRole("radio", { name: "Freebets" })).toBeChecked();
      expect(screen.getByRole("heading", { level: 1, name: "Freebets" })).toBeInTheDocument();
    });

    it("goes to the dashboard's lists from the navigation", async () => {
      stubApi();
      renderPage();
      await screen.findByRole("heading", { name: /Top 3/ });
      fireEvent.click(screen.getByRole("radio", { name: "Value bets" }));
      expect(window.location.pathname).toBe("/cotes");
      expect(window.location.search).toContain("sport=value-bets");
    });

    it("shows the time of the last answer", async () => {
      stubApi();
      renderPage();
      await screen.findByRole("heading", { name: /Top 3/ });
      expect(await screen.findByText(/Mis à jour à/)).toBeInTheDocument();
    });

    it("lays out for a phone, with the bar at the bottom and the bets one under the other", async () => {
      mockPhone();
      stubApi();
      renderPage();
      await screen.findByRole("heading", { name: /Top 3/ });
      expect(screen.getByRole("navigation", { name: "Navigation principale" })).toBeInTheDocument();
      expect(screen.getByRole("radio", { name: "Freebets" })).toBeChecked();
    });

    it("has no accessibility violation axe can find, with plans and with a chain", async () => {
      stubApi();
      const page = renderPage();
      await screen.findByRole("heading", { name: /Top 3/ });
      const rules = { rules: { "color-contrast": { enabled: false } } };
      expect((await axe.run(page.container, rules)).violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.html).join(" | ")}`)).toEqual([]);
      fireEvent.click(screen.getByRole("radio", { name: "Contre l'exchange" }));
      await screen.findByRole("heading", { name: /Winamax · 30,00 FB/ });
      expect((await axe.run(page.container, rules)).violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.html).join(" | ")}`)).toEqual([]);
    });
  });

});
