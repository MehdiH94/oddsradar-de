import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import axe from "axe-core";
import { HomePage } from "./HomePage";

const reply = (body: unknown) => Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
const fail = () => Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) });

// The one request the home makes: the public totals. Left out, it fails.
function stubApi(home?: { matches: number; sports: string[] }) {
  const fetchMock = vi.fn((url: string) => (url === "/api/public/home" && home ? reply(home) : fail()));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const LIVE = { matches: 312, sports: ["football", "tennis", "basketball"] };

describe("HomePage", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("says what the product is, and leads to the dashboard from the first screen", () => {
    stubApi(LIVE);
    render(<HomePage />);

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/Les meilleures cotes des bookmakers français/);
    const hero = screen.getByRole("region", { name: /Les meilleures cotes/ });
    expect(within(hero).getByRole("link", { name: "Voir les value bets" })).toHaveAttribute(
      "href",
      "/cotes?sport=value-bets&sort=value"
    );
    expect(within(hero).getByRole("link", { name: "Comparer les cotes" })).toHaveAttribute("href", "/cotes");
    // The freebets are one of the ways in, at the level of the two others.
    expect(within(hero).getByRole("link", { name: "Convertir mes freebets" })).toHaveAttribute("href", "/freebets");
    // Signed out: the way in is the login page.
    expect(screen.getByRole("navigation", { name: "Navigation principale" })).toHaveTextContent("Se connecter");
    expect(screen.getByRole("link", { name: "Se connecter" })).toHaveAttribute("href", "/connexion");
  });

  it("tells from the first screen that it converts freebets, and that an account is needed", () => {
    stubApi(LIVE);
    render(<HomePage />);

    const hero = screen.getByRole("region", { name: /Les meilleures cotes/ });
    expect(hero).toHaveTextContent("Comparateur de cotes · value bets · freebets");
    expect(hero).toHaveTextContent("Elle convertit aussi vos freebets en cash garanti.");
    // An account is needed to see the odds: the page never says otherwise.
    expect(hero).toHaveTextContent("Compte gratuit · cotes actualisées toutes les quelques minutes");
    expect(document.body.textContent).not.toMatch(/sans inscription/i);
  });

  it("presents the freebets' conversions: what a freebet is, the two ways, the way in, and that prices are indicative", () => {
    stubApi(LIVE);
    render(<HomePage />);

    const section = screen.getByRole("region", { name: "Vos freebets, convertis en cash" });
    expect(section).toHaveTextContent("la mise n'est pas rendue");
    const ways = within(section).getAllByRole("listitem");
    expect(ways.map((way) => within(way).getByRole("heading", { level: 3 }).textContent)).toEqual(["Entre bookmakers", "Contre l'exchange"]);
    // What each way asks: no real money between bookmakers, the lay advanced against the exchange.
    expect(ways[0]).toHaveTextContent("Aucune mise d'argent réel");
    expect(ways[1]).toHaveTextContent("La mise du lay est avancée, puis rendue après le match");
    expect(section).toHaveTextContent("Les cotes sont indicatives : vérifiez-les avant de placer vos paris");
    // The way in is the group of buttons of the hero and of the end of the page, not a button of its own.
    expect(within(section).queryByRole("link", { name: "Convertir mes freebets" })).not.toBeInTheDocument();
    expect(section).toHaveTextContent("Un compte gratuit suffit");
  });

  it("opens with the gambling warning, the generic one of a home page", () => {
    stubApi(LIVE);
    render(<HomePage />);

    expect(screen.getByRole("complementary", { name: "Prévention des jeux d'argent" })).toHaveTextContent(
      "Les jeux d'argent et de hasard peuvent être dangereux"
    );
  });

  it("names the eleven bookmakers it compares", () => {
    stubApi(LIVE);
    render(<HomePage />);
    const list = screen.getByRole("list", { name: "Bookmakers comparés" });
    expect(within(list).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "Winamax",
      "Betclic",
      "Unibet",
      "PMU",
      "NetBet",
      "Genybet",
      "Vbet",
      "CircusBet",
      "DAZN Bet",
      "Betsson",
      "Betify",
    ]);
  });

  it("asks the API for the public totals only, and shows its figures", async () => {
    const fetchMock = stubApi(LIVE);
    render(<HomePage />);

    const live = screen.getByRole("region", { name: "En ce moment sur CoteRadar" });
    await waitFor(() => expect(within(live).getByText("312")).toBeInTheDocument());
    // Nothing of the accounts' data: no events, no value bets.
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(["/api/public/home"]);

    const tiles = within(live).getAllByRole("listitem").slice(0, 3);
    expect(tiles.map((tile) => tile.textContent)).toEqual(["312Matchs suivis", "11Bookmakers comparés", "3Sports"]);
    expect(within(live).getByText(/Chiffres relevés à/)).toBeInTheDocument();
  });

  it("shows a made-up example of a value bet, said to be one, never a real one", async () => {
    stubApi(LIVE);
    render(<HomePage />);

    expect(await screen.findByRole("heading", { name: "À quoi ressemble un value bet" })).toBeInTheDocument();
    expect(screen.getByText("Exemple")).toBeInTheDocument();
    expect(screen.getByText(/c'est un value bet/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Tous les marchés du match/ })).not.toBeInTheDocument();
  });

  it("lists the sports that have matches", async () => {
    stubApi(LIVE);
    render(<HomePage />);
    const sports = await screen.findByRole("region", { name: "Les sports couverts" });
    expect(within(sports).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "⚽ Football",
      "🎾 Tennis",
      "🏀 Basketball",
    ]);
  });

  it("stays whole when the API is down: its text, its example, and its way in", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    stubApi();
    render(<HomePage />);

    expect(await screen.findByText("Chiffres indisponibles pour le moment.")).toBeInTheDocument();
    expect(screen.getByText("Exemple")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Voir les value bets" })).not.toHaveLength(0);
    expect(screen.getByRole("region", { name: "Ce que CoteRadar change" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Comment ça marche" })).toBeInTheDocument();
    vi.restoreAllMocks();
  });

  it("answers the questions a newcomer has, without promising a gain", () => {
    stubApi(LIVE);
    render(<HomePage />);

    const faq = screen.getByRole("region", { name: "Questions fréquentes" });
    const questions = [...faq.querySelectorAll("summary")].map((summary) => summary.textContent);
    expect(questions).toEqual([
      "C'est quoi un value bet ?",
      "D'où vient la cote juste ?",
      "Qu'est-ce qu'un surebet ?",
      "C'est quoi un freebet, et comment le convertir en cash ?",
      "Faut-il un compte ? Peut-on parier sur CoteRadar ?",
    ]);
    expect(faq).toHaveTextContent("un compte gratuit");
    expect(faq).toHaveTextContent("aux surebets et à la conversion de freebets");
    expect(faq).toHaveTextContent("CoteRadar ne prend aucun pari");
    expect(faq).toHaveTextContent("un pari au-dessus de la cote juste peut perdre");
  });

  it("closes on the responsible gambling notice, and on the way in once more", () => {
    stubApi(LIVE);
    render(<HomePage />);
    expect(screen.getByText(/Interdit aux moins de 18 ans/)).toBeInTheDocument();
    const closing = screen.getByRole("region", { name: "Les cotes du jour sont à un clic." });
    expect(within(closing).getByRole("link", { name: "Voir les value bets" })).toBeInTheDocument();
    expect(within(closing).getByRole("link", { name: "Convertir mes freebets" })).toHaveAttribute("href", "/freebets");
  });

  it("puts the three ways in side by side: the same group, in the same order, at the start and at the end", () => {
    stubApi(LIVE);
    render(<HomePage />);
    const names = ["Voir les value bets", "Comparer les cotes", "Convertir mes freebets"];
    for (const region of [screen.getByRole("region", { name: /Les meilleures cotes/ }), screen.getByRole("region", { name: "Les cotes du jour sont à un clic." })]) {
      const links = names.map((name) => within(region).getByRole("link", { name }));
      // One group: the three share their parent, whatever its class.
      expect(new Set(links.map((link) => link.parentElement)).size).toBe(1);
      expect([...links[0].parentElement!.children]).toEqual(links);
    }
  });

  it("has no accessibility violation axe can find, with the API's answers and without", async () => {
    stubApi(LIVE);
    const live = render(<HomePage />);
    await screen.findByRole("region", { name: "Les sports couverts" });
    // jsdom renders no pixels: contrast is checked on real pages instead.
    const rules = { rules: { "color-contrast": { enabled: false } } };
    const results = await axe.run(live.container, rules);
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(", ")}`)).toEqual([]);
    live.unmount();

    vi.spyOn(console, "error").mockImplementation(() => {});
    stubApi();
    const down = render(<HomePage />);
    await screen.findByText("Chiffres indisponibles pour le moment.");
    const downResults = await axe.run(down.container, rules);
    expect(downResults.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(", ")}`)).toEqual([]);
    vi.restoreAllMocks();
  });
});
