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

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/Die besten Quoten der deutschen Buchmacher/);
    const hero = screen.getByRole("region", { name: /Die besten Quoten/ });
    expect(within(hero).getByRole("link", { name: "Value Bets ansehen" })).toHaveAttribute(
      "href",
      "/odds?sport=value-bets&sort=value"
    );
    expect(within(hero).getByRole("link", { name: "Quoten vergleichen" })).toHaveAttribute("href", "/odds");
    // The freebets are one of the ways in, at the level of the two others.
    expect(within(hero).getByRole("link", { name: "Meine Freebets umwandeln" })).toHaveAttribute("href", "/freebets");
    // Signed out: the way in is the login page.
    expect(screen.getByRole("navigation", { name: "Hauptnavigation" })).toHaveTextContent("Anmelden");
    expect(screen.getByRole("link", { name: "Anmelden" })).toHaveAttribute("href", "/login");
  });

  it("tells from the first screen that it converts freebets, and that an account is needed", () => {
    stubApi(LIVE);
    render(<HomePage />);

    const hero = screen.getByRole("region", { name: /Die besten Quoten/ });
    expect(hero).toHaveTextContent("Quotenvergleich · Value Bets · Freebets");
    expect(hero).toHaveTextContent("Außerdem macht es aus deinen Freebets garantiertes Geld.");
    // An account is needed to see the odds: the page never says otherwise.
    expect(hero).toHaveTextContent("Kostenloses Konto · Quoten alle paar Minuten aktualisiert");
    expect(document.body.textContent).not.toMatch(/sans inscription/i);
  });

  it("presents the freebets' conversions: what a freebet is, the two ways, the way in, and that prices are indicative", () => {
    stubApi(LIVE);
    render(<HomePage />);

    const section = screen.getByRole("region", { name: "Deine Freebets, in Geld verwandelt" });
    expect(section).toHaveTextContent("aber nicht den Einsatz");
    const ways = within(section).getAllByRole("listitem");
    expect(ways.map((way) => within(way).getByRole("heading", { level: 3 }).textContent)).toEqual(["Zwischen Buchmachern", "Gegen die Wettbörse"]);
    // What each way asks: no real money between bookmakers, the lay advanced against the exchange.
    expect(ways[0]).toHaveTextContent("Kein echtes Geld im Einsatz");
    expect(ways[1]).toHaveTextContent("Die Haftung des Lays streckst du vor, du bekommst sie nach dem Spiel zurück");
    expect(section).toHaveTextContent("Die Quoten sind ein Richtwert");
    // The way in is the group of buttons of the hero and of the end of the page, not a button of its own.
    expect(within(section).queryByRole("link", { name: "Meine Freebets umwandeln" })).not.toBeInTheDocument();
    expect(section).toHaveTextContent("Ein kostenloses Konto genügt");
  });

  it("opens with the gambling warning, the generic one of a home page", () => {
    stubApi(LIVE);
    render(<HomePage />);

    expect(screen.getByRole("complementary", { name: "Verantwortungsvolles Spielen" })).toHaveTextContent(
      "Glücksspiel kann süchtig machen"
    );
  });

  it("names the bookmakers it compares", () => {
    stubApi(LIVE);
    render(<HomePage />);
    const list = screen.getByRole("list", { name: "Verglichene Buchmacher" });
    expect(within(list).getAllByRole("listitem").map((item) => item.textContent)).toEqual(["LeoVegas", "Merkur Bets", "20bet", "Admiralbet", "bet-at-home", "ODDSET", "Betway", "Sportingbet", "VBET", "888sport", "neobet", "Tipico", "Winamax"]);
  });

  it("asks the API for the public totals only, and shows its figures", async () => {
    const fetchMock = stubApi(LIVE);
    render(<HomePage />);

    const live = screen.getByRole("region", { name: "Gerade auf OddsBlitzer" });
    await waitFor(() => expect(within(live).getByText("312")).toBeInTheDocument());
    // Nothing of the accounts' data: no events, no value bets.
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(["/api/public/home"]);

    const tiles = within(live).getAllByRole("listitem").slice(0, 3);
    expect(tiles.map((tile) => tile.textContent)).toEqual(["312Beobachtete Spiele", "13Verglichene Buchmacher", "3Sportarten"]);
    expect(within(live).getByText(/Stand:/)).toBeInTheDocument();
  });

  it("shows a made-up example of a value bet, said to be one, never a real one", async () => {
    stubApi(LIVE);
    render(<HomePage />);

    expect(await screen.findByRole("heading", { name: "So sieht eine Value Bet aus" })).toBeInTheDocument();
    expect(screen.getByText("Beispiel")).toBeInTheDocument();
    expect(screen.getByText(/Das ist eine Value Bet/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Every market of the match/ })).not.toBeInTheDocument();
  });

  it("lists the sports that have matches", async () => {
    stubApi(LIVE);
    render(<HomePage />);
    const sports = await screen.findByRole("region", { name: "Die Sportarten" });
    expect(within(sports).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "⚽ Fußball",
      "🎾 Tennis",
      "🏀 Basketball",
    ]);
  });

  it("stays whole when the API is down: its text, its example, and its way in", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    stubApi();
    render(<HomePage />);

    expect(await screen.findByText("Zahlen derzeit nicht verfügbar.")).toBeInTheDocument();
    expect(screen.getByText("Beispiel")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Value Bets ansehen" })).not.toHaveLength(0);
    expect(screen.getByRole("region", { name: "Was OddsBlitzer dir bringt" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "So funktioniert es" })).toBeInTheDocument();
    vi.restoreAllMocks();
  });

  it("answers the questions a newcomer has, without promising a gain", () => {
    stubApi(LIVE);
    render(<HomePage />);

    const faq = screen.getByRole("region", { name: "Häufige Fragen" });
    const questions = [...faq.querySelectorAll("summary")].map((summary) => summary.textContent);
    expect(questions).toEqual([
      "Was ist eine Value Bet?",
      "Woher kommt die faire Quote?",
      "Was ist eine Surebet?",
      "Was ist eine Freebet, und wie macht man daraus Geld?",
      "Brauche ich ein Konto? Kann ich auf OddsBlitzer wetten?",
    ]);
    expect(faq).toHaveTextContent("ein kostenloses Konto");
    expect(faq).toHaveTextContent("Surebets und den Freebet-Umwandlungen");
    expect(faq).toHaveTextContent("OddsBlitzer nimmt keine Wetten an");
    expect(faq).toHaveTextContent("Auch eine Wette über der fairen Quote kann verlieren");
  });

  it("closes on the responsible gambling notice, and on the way in once more", () => {
    stubApi(LIVE);
    render(<HomePage />);
    expect(screen.getByText(/Glücksspiel nur für Erwachsene/)).toBeInTheDocument();
    const closing = screen.getByRole("region", { name: "Die Quoten von heute sind nur einen Klick entfernt." });
    expect(within(closing).getByRole("link", { name: "Value Bets ansehen" })).toBeInTheDocument();
    expect(within(closing).getByRole("link", { name: "Meine Freebets umwandeln" })).toHaveAttribute("href", "/freebets");
  });

  it("puts the three ways in side by side: the same group, in the same order, at the start and at the end", () => {
    stubApi(LIVE);
    render(<HomePage />);
    const names = ["Value Bets ansehen", "Quoten vergleichen", "Meine Freebets umwandeln"];
    for (const region of [screen.getByRole("region", { name: /Die besten Quoten/ }), screen.getByRole("region", { name: "Die Quoten von heute sind nur einen Klick entfernt." })]) {
      const links = names.map((name) => within(region).getByRole("link", { name }));
      // One group: the three share their parent, whatever its class.
      expect(new Set(links.map((link) => link.parentElement)).size).toBe(1);
      expect([...links[0].parentElement!.children]).toEqual(links);
    }
  });

  it("has no accessibility violation axe can find, with the API's answers and without", async () => {
    stubApi(LIVE);
    const live = render(<HomePage />);
    await screen.findByRole("region", { name: "Die Sportarten" });
    // jsdom renders no pixels: contrast is checked on real pages instead.
    const rules = { rules: { "color-contrast": { enabled: false } } };
    const results = await axe.run(live.container, rules);
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(", ")}`)).toEqual([]);
    live.unmount();

    vi.spyOn(console, "error").mockImplementation(() => {});
    stubApi();
    const down = render(<HomePage />);
    await screen.findByText("Zahlen derzeit nicht verfügbar.");
    const downResults = await axe.run(down.container, rules);
    expect(downResults.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(", ")}`)).toEqual([]);
    vi.restoreAllMocks();
  });
});
