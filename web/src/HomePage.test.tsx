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

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/The best odds of the German bookmakers/);
    const hero = screen.getByRole("region", { name: /The best odds/ });
    expect(within(hero).getByRole("link", { name: "See the value bets" })).toHaveAttribute(
      "href",
      "/odds?sport=value-bets&sort=value"
    );
    expect(within(hero).getByRole("link", { name: "Compare the odds" })).toHaveAttribute("href", "/odds");
    // The freebets are one of the ways in, at the level of the two others.
    expect(within(hero).getByRole("link", { name: "Convert my freebets" })).toHaveAttribute("href", "/freebets");
    // Signed out: the way in is the login page.
    expect(screen.getByRole("navigation", { name: "Main navigation" })).toHaveTextContent("Log in");
    expect(screen.getByRole("link", { name: "Log in" })).toHaveAttribute("href", "/login");
  });

  it("tells from the first screen that it converts freebets, and that an account is needed", () => {
    stubApi(LIVE);
    render(<HomePage />);

    const hero = screen.getByRole("region", { name: /The best odds/ });
    expect(hero).toHaveTextContent("Odds comparison · value bets · freebets");
    expect(hero).toHaveTextContent("It also turns your freebets into guaranteed cash.");
    // An account is needed to see the odds: the page never says otherwise.
    expect(hero).toHaveTextContent("Free account · odds refreshed every few minutes");
    expect(document.body.textContent).not.toMatch(/sans inscription/i);
  });

  it("presents the freebets' conversions: what a freebet is, the two ways, the way in, and that prices are indicative", () => {
    stubApi(LIVE);
    render(<HomePage />);

    const section = screen.getByRole("region", { name: "Your freebets, turned into cash" });
    expect(section).toHaveTextContent("the stake is not returned");
    const ways = within(section).getAllByRole("listitem");
    expect(ways.map((way) => within(way).getByRole("heading", { level: 3 }).textContent)).toEqual(["Between bookmakers", "Against the exchange"]);
    // What each way asks: no real money between bookmakers, the lay advanced against the exchange.
    expect(ways[0]).toHaveTextContent("No real money staked");
    expect(ways[1]).toHaveTextContent("The lay's liability is advanced, then returned after the match");
    expect(section).toHaveTextContent("The prices are a guide: check them before placing your bets");
    // The way in is the group of buttons of the hero and of the end of the page, not a button of its own.
    expect(within(section).queryByRole("link", { name: "Convert my freebets" })).not.toBeInTheDocument();
    expect(section).toHaveTextContent("A free account is all it takes");
  });

  it("opens with the gambling warning, the generic one of a home page", () => {
    stubApi(LIVE);
    render(<HomePage />);

    expect(screen.getByRole("complementary", { name: "Responsible gambling" })).toHaveTextContent(
      "Gambling can be addictive"
    );
  });

  it("names the bookmakers it compares", () => {
    stubApi(LIVE);
    render(<HomePage />);
    const list = screen.getByRole("list", { name: "Bookmakers compared" });
    expect(within(list).getAllByRole("listitem").map((item) => item.textContent)).toEqual(["LeoVegas", "Winamax"]);
  });

  it("asks the API for the public totals only, and shows its figures", async () => {
    const fetchMock = stubApi(LIVE);
    render(<HomePage />);

    const live = screen.getByRole("region", { name: "Right now on OddsRadar" });
    await waitFor(() => expect(within(live).getByText("312")).toBeInTheDocument());
    // Nothing of the accounts' data: no events, no value bets.
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(["/api/public/home"]);

    const tiles = within(live).getAllByRole("listitem").slice(0, 3);
    expect(tiles.map((tile) => tile.textContent)).toEqual(["312Matches tracked", "2Bookmakers compared", "3Sports"]);
    expect(within(live).getByText(/Figures as of/)).toBeInTheDocument();
  });

  it("shows a made-up example of a value bet, said to be one, never a real one", async () => {
    stubApi(LIVE);
    render(<HomePage />);

    expect(await screen.findByRole("heading", { name: "What a value bet looks like" })).toBeInTheDocument();
    expect(screen.getByText("Example")).toBeInTheDocument();
    expect(screen.getByText(/it is a value bet/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Every market of the match/ })).not.toBeInTheDocument();
  });

  it("lists the sports that have matches", async () => {
    stubApi(LIVE);
    render(<HomePage />);
    const sports = await screen.findByRole("region", { name: "The sports covered" });
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

    expect(await screen.findByText("Figures unavailable for now.")).toBeInTheDocument();
    expect(screen.getByText("Example")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "See the value bets" })).not.toHaveLength(0);
    expect(screen.getByRole("region", { name: "What OddsRadar changes" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "How it works" })).toBeInTheDocument();
    vi.restoreAllMocks();
  });

  it("answers the questions a newcomer has, without promising a gain", () => {
    stubApi(LIVE);
    render(<HomePage />);

    const faq = screen.getByRole("region", { name: "Frequently asked questions" });
    const questions = [...faq.querySelectorAll("summary")].map((summary) => summary.textContent);
    expect(questions).toEqual([
      "What is a value bet?",
      "Where do the fair odds come from?",
      "What is a surebet?",
      "What is a freebet, and how do you turn it into cash?",
      "Do I need an account? Can I bet on OddsRadar?",
    ]);
    expect(faq).toHaveTextContent("a free account");
    expect(faq).toHaveTextContent("the surebets and the freebet conversions");
    expect(faq).toHaveTextContent("OddsRadar takes no bets");
    expect(faq).toHaveTextContent("a bet above the fair odds can lose");
  });

  it("closes on the responsible gambling notice, and on the way in once more", () => {
    stubApi(LIVE);
    render(<HomePage />);
    expect(screen.getByText(/Gambling is for adults only/)).toBeInTheDocument();
    const closing = screen.getByRole("region", { name: "Today's odds are one click away." });
    expect(within(closing).getByRole("link", { name: "See the value bets" })).toBeInTheDocument();
    expect(within(closing).getByRole("link", { name: "Convert my freebets" })).toHaveAttribute("href", "/freebets");
  });

  it("puts the three ways in side by side: the same group, in the same order, at the start and at the end", () => {
    stubApi(LIVE);
    render(<HomePage />);
    const names = ["See the value bets", "Compare the odds", "Convert my freebets"];
    for (const region of [screen.getByRole("region", { name: /The best odds/ }), screen.getByRole("region", { name: "Today's odds are one click away." })]) {
      const links = names.map((name) => within(region).getByRole("link", { name }));
      // One group: the three share their parent, whatever its class.
      expect(new Set(links.map((link) => link.parentElement)).size).toBe(1);
      expect([...links[0].parentElement!.children]).toEqual(links);
    }
  });

  it("has no accessibility violation axe can find, with the API's answers and without", async () => {
    stubApi(LIVE);
    const live = render(<HomePage />);
    await screen.findByRole("region", { name: "The sports covered" });
    // jsdom renders no pixels: contrast is checked on real pages instead.
    const rules = { rules: { "color-contrast": { enabled: false } } };
    const results = await axe.run(live.container, rules);
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(", ")}`)).toEqual([]);
    live.unmount();

    vi.spyOn(console, "error").mockImplementation(() => {});
    stubApi();
    const down = render(<HomePage />);
    await screen.findByText("Figures unavailable for now.");
    const downResults = await axe.run(down.container, rules);
    expect(downResults.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(", ")}`)).toEqual([]);
    vi.restoreAllMocks();
  });
});
