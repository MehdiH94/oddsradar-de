import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import axe from "axe-core";
import { Root, FREEBETS_TITLE, HOME_TITLE, ODDS_TITLE } from "./Root";

// The dashboard is a chunk of its own, and heavy: a stand-in is enough to know
// which page Root chose.
vi.mock("./App", () => ({
  App: ({ preferences }: { preferences?: { sport: string } | null }) => (
    <>
      <h1>Le dashboard</h1>
      <p>Settings: {preferences?.sport ?? "none"}</p>
    </>
  ),
}));

// The Freebets page is a chunk of its own, and heavy too.
vi.mock("./freebets/FreebetsPage", () => ({ FreebetsPage: () => <h1>Les freebets</h1> }));

const reply = (body: unknown, status = 200) =>
  Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) });

const USER = { id: "u1", email: "ada@example.com", role: "user" };

// The API as seen from Root: whether /api/auth/me knows a session, and what
// the login and logout calls answer. The home reads the public totals.
const SAVED = { sport: "tennis", sort: "start", bookmakers: ["winamax"], players: false, favoriteSports: [] };

function stubApi({
  signedIn = true,
  me = USER as { id: string; email: string; role: string },
  loginAnswer = reply({ user: USER }) as Promise<unknown>,
  preferences = reply({ preferences: null }) as Promise<unknown>,
} = {}) {
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    if (url === "/api/auth/me") return signedIn ? reply({ user: me }) : reply({ user: null });
    if (url === "/api/auth/login") return loginAnswer;
    if (url === "/api/auth/logout") return Promise.resolve({ ok: true, status: 204, json: () => Promise.resolve({}) });
    if (url === "/api/preferences") return preferences;
    if (url === "/api/admin/users") return reply({ users: [] });
    if (url === "/api/public/home") return reply({ matches: 3, sports: ["football"] });
    void init;
    return reply({ events: [], total: 0, page: 1, pageSize: 1 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const address = () => window.location.pathname + window.location.search;

describe("Root", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    window.history.replaceState(null, "", "/");
  });

  it("shows the home at /, with its own title", () => {
    stubApi({ signedIn: false });
    render(<Root />);
    expect(screen.getByRole("heading", { level: 1, name: /The best odds/ })).toBeInTheDocument();
    expect(document.title).toBe(HOME_TITLE);
  });

  it("shows the dashboard at /odds to someone signed in, with its own title", async () => {
    stubApi();
    window.history.replaceState(null, "", "/odds?sport=football");
    render(<Root />);
    expect(await screen.findByRole("heading", { level: 1, name: "Le dashboard" })).toBeInTheDocument();
    expect(document.title).toBe(ODDS_TITLE);
  });

  it("hands the dashboard the account's saved filters", async () => {
    stubApi({ preferences: reply({ preferences: SAVED }) });
    window.history.replaceState(null, "", "/odds");
    render(<Root />);
    expect(await screen.findByText("Settings: tennis")).toBeInTheDocument();
  });

  it("opens the dashboard all the same when the saved filters can't be fetched", async () => {
    stubApi({ preferences: reply({ error: "boom" }, 500) });
    window.history.replaceState(null, "", "/odds");
    render(<Root />);
    expect(await screen.findByText("Settings: none")).toBeInTheDocument();
  });

  it("sends someone signed out from the dashboard to the login, remembering the page", async () => {
    stubApi({ signedIn: false });
    window.history.replaceState(null, "", "/odds?sport=tennis&match=abc");
    render(<Root />);
    expect(await screen.findByRole("heading", { level: 1, name: "Log in" })).toBeInTheDocument();
    expect(address()).toBe("/login?next=%2Fodds%3Fsport%3Dtennis%26match%3Dabc");
    expect(screen.queryByText("Le dashboard")).not.toBeInTheDocument();
  });

  it("opens an old dashboard link at / on the dashboard, at its new address", async () => {
    stubApi();
    window.history.replaceState(null, "", "/?match=abc&bookmakers=winamax");
    render(<Root />);
    expect(await screen.findByRole("heading", { level: 1, name: "Le dashboard" })).toBeInTheDocument();
    expect(address()).toBe("/odds?match=abc&bookmakers=winamax");
  });

  it("keeps a campaign's link (?utm_source=...) on the home", () => {
    stubApi({ signedIn: false });
    window.history.replaceState(null, "", "/?utm_source=newsletter");
    render(<Root />);
    expect(screen.getByRole("heading", { level: 1, name: /The best odds/ })).toBeInTheDocument();
    expect(address()).toBe("/?utm_source=newsletter");
  });

  it("goes from the home to the dashboard without a reload, and Back returns to the home", async () => {
    stubApi();
    render(<Root />);

    fireEvent.click(screen.getAllByRole("link", { name: "See the value bets" })[0]);
    expect(await screen.findByRole("heading", { level: 1, name: "Le dashboard" })).toBeInTheDocument();
    expect(address()).toBe("/odds?sport=value-bets&sort=value");

    // jsdom's history.back() is asynchronous: wait for its popstate.
    act(() => window.history.back());
    await waitFor(() => expect(screen.getByRole("heading", { level: 1, name: /The best odds/ })).toBeInTheDocument());
    expect(address()).toBe("/");
    expect(document.title).toBe(HOME_TITLE);
  });
});

describe("the administration page", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    window.history.replaceState(null, "", "/");
  });

  it("opens for an admin, with its own title", async () => {
    stubApi({ me: { ...USER, role: "admin" } });
    window.history.replaceState(null, "", "/admin");
    render(<Root />);
    expect(await screen.findByRole("heading", { level: 1, name: "Administration" })).toBeInTheDocument();
    expect(document.title).toBe("Administration · OddsRadar");
  });

  it("sends an ordinary account to the odds, without showing it the page", async () => {
    stubApi();
    window.history.replaceState(null, "", "/admin");
    render(<Root />);
    expect(await screen.findByRole("heading", { level: 1, name: "Le dashboard" })).toBeInTheDocument();
    expect(address()).toBe("/odds");
    expect(screen.queryByRole("heading", { name: "Administration" })).not.toBeInTheDocument();
  });

  it("sends someone signed out to the login, remembering the page", async () => {
    stubApi({ signedIn: false });
    window.history.replaceState(null, "", "/admin");
    render(<Root />);
    expect(await screen.findByRole("heading", { level: 1, name: "Log in" })).toBeInTheDocument();
    expect(address()).toBe("/login?next=%2Fadmin");
  });
});

describe("the Freebets page", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    window.history.replaceState(null, "", "/");
  });

  it("opens for an account, with its own title", async () => {
    stubApi();
    window.history.replaceState(null, "", "/freebets");
    render(<Root />);
    expect(await screen.findByRole("heading", { level: 1, name: "Les freebets" })).toBeInTheDocument();
    expect(document.title).toBe(FREEBETS_TITLE);
    expect(address()).toBe("/freebets");
  });

  it("opens on a trailing slash too, and keeps the settings of the address", async () => {
    stubApi();
    window.history.replaceState(null, "", "/freebets/?mode=exchange");
    render(<Root />);
    expect(await screen.findByRole("heading", { level: 1, name: "Les freebets" })).toBeInTheDocument();
  });

  it("sends someone signed out to the login, remembering the page and its settings", async () => {
    stubApi({ signedIn: false });
    window.history.replaceState(null, "", "/freebets?legs=2");
    render(<Root />);
    expect(await screen.findByRole("heading", { level: 1, name: "Log in" })).toBeInTheDocument();
    expect(address()).toBe("/login?next=%2Ffreebets%3Flegs%3D2");
  });
});

describe("the account pages", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    window.history.replaceState(null, "", "/");
  });

  // The form appears once /api/auth/me has answered.
  const fill = async (label: string, value: string) => fireEvent.change(await screen.findByLabelText(label), { target: { value } });

  it("logs in and goes back to the page that asked, then the dashboard answers", async () => {
    stubApi({ signedIn: false });
    window.history.replaceState(null, "", "/login?next=%2Fodds%3Fsport%3Dtennis");
    render(<Root />);

    await fill("Email address", "ada@example.com");
    await fill("Password", "correct horse battery");
    fireEvent.click(screen.getByRole("button", { name: "Log in" }));

    expect(await screen.findByRole("heading", { level: 1, name: "Le dashboard" })).toBeInTheDocument();
    expect(address()).toBe("/odds?sport=tennis");
    expect(document.title).toBe(ODDS_TITLE);
  });

  it("shows the server's message when the login is refused, and stays on the page", async () => {
    stubApi({ signedIn: false, loginAnswer: reply({ error: "invalid_credentials", message: "Wrong email or password." }, 401) });
    window.history.replaceState(null, "", "/login");
    render(<Root />);

    await fill("Email address", "ada@example.com");
    await fill("Password", "wrong wrong wrong");
    fireEvent.click(screen.getByRole("button", { name: "Log in" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Wrong email or password.");
    expect(address()).toBe("/login");
  });

  it("never follows a ?next= that leaves the site", async () => {
    stubApi({ signedIn: false });
    window.history.replaceState(null, "", "/login?next=https%3A%2F%2Fevil.example");
    render(<Root />);

    await fill("Email address", "ada@example.com");
    await fill("Password", "correct horse battery");
    fireEvent.click(screen.getByRole("button", { name: "Log in" }));

    await screen.findByRole("heading", { level: 1, name: "Le dashboard" });
    expect(address()).toBe("/odds");
  });

  it("sends someone already signed in away from the login page", async () => {
    stubApi();
    window.history.replaceState(null, "", "/login");
    render(<Root />);
    expect(await screen.findByRole("heading", { level: 1, name: "Le dashboard" })).toBeInTheDocument();
    expect(address()).toBe("/odds");
  });

  it("asks for an email, then says the same thing whoever it is", async () => {
    const fetchMock = stubApi({ signedIn: false });
    fetchMock.mockImplementation((url: string) =>
      url === "/api/auth/me" ? reply({ user: null }) : reply({ message: "Si cette adresse est valide…" }, 202)
    );
    window.history.replaceState(null, "", "/signup");
    render(<Root />);

    await fill("Email address", "ada@example.com");
    await fill("Password", "correct horse battery");
    fireEvent.click(screen.getByRole("button", { name: "Create my account" }));

    expect(await screen.findByRole("status")).toHaveTextContent(/confirmation email/);
    const call = fetchMock.mock.calls.find(([url]) => url === "/api/auth/register")!;
    expect(JSON.parse(call[1]!.body as string)).toEqual({ email: "ada@example.com", password: "correct horse battery" });
  });

  it("confirms the email from the link by posting its token", async () => {
    const fetchMock = stubApi({ signedIn: false });
    fetchMock.mockImplementation((url: string) =>
      url === "/api/auth/me" ? reply({ user: null }) : reply({ message: "Address confirmed." })
    );
    window.history.replaceState(null, "", "/verify-email?token=abc123");
    render(<Root />);

    expect(await screen.findByText(/Address confirmed, your account is active/)).toBeInTheDocument();
    const call = fetchMock.mock.calls.find(([url]) => url === "/api/auth/verify-email")!;
    expect(call[1]!.method).toBe("POST");
    expect(JSON.parse(call[1]!.body as string)).toEqual({ token: "abc123" });
  });

  it("sets a new password from the reset link, and says an incomplete link is one", async () => {
    const fetchMock = stubApi({ signedIn: false });
    fetchMock.mockImplementation((url: string) =>
      url === "/api/auth/me" ? reply({ user: null }) : reply({ message: "Password changed." })
    );
    window.history.replaceState(null, "", "/reset-password?token=tok");
    const page = render(<Root />);
    await fill("New password", "a brand new secret");
    fireEvent.click(screen.getByRole("button", { name: "Change the password" }));
    expect(await screen.findByText(/Password changed/)).toBeInTheDocument();
    page.unmount();

    window.history.replaceState(null, "", "/reset-password");
    render(<Root />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/incomplet/);
  });

  it("offers the email again when the account is not confirmed yet", async () => {
    const fetchMock = stubApi({
      signedIn: false,
      loginAnswer: reply({ error: "email_not_verified", message: "Confirmez d'abord votre adresse email." }, 403),
    });
    window.history.replaceState(null, "", "/login");
    render(<Root />);
    await fill("Email address", "ada@example.com");
    await fill("Password", "correct horse battery");
    fireEvent.click(screen.getByRole("button", { name: "Log in" }));

    fireEvent.click(await screen.findByRole("button", { name: "Send the confirmation email again" }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => url === "/api/auth/resend-verification")).toBe(true));
  });

  it("shows and hides the typed password, and hides it again when the form is sent", async () => {
    stubApi({ signedIn: false, loginAnswer: reply({ error: "invalid_credentials", message: "Wrong email or password." }, 401) });
    window.history.replaceState(null, "", "/login");
    render(<Root />);
    await fill("Email address", "ada@example.com");
    await fill("Password", "correct horse battery");
    const password = screen.getByLabelText("Password");
    const toggle = screen.getByRole("button", { name: "Show the password" });
    expect(password).toHaveAttribute("type", "password");
    expect(toggle).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(toggle);
    expect(password).toHaveAttribute("type", "text");
    expect(password).toHaveValue("correct horse battery");
    expect(toggle).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(toggle);
    expect(password).toHaveAttribute("type", "password");

    fireEvent.click(toggle);
    fireEvent.click(screen.getByRole("button", { name: "Log in" }));
    expect(await screen.findByText("Wrong email or password.")).toBeInTheDocument();
    expect(password).toHaveAttribute("type", "password");
    expect(toggle).toHaveAttribute("aria-pressed", "false");
  });

  it("has no accessibility violation axe can find on the forms", async () => {
    for (const path of ["/login", "/signup", "/forgot-password", "/reset-password?token=t"]) {
      stubApi({ signedIn: false });
      window.history.replaceState(null, "", path);
      const page = render(<Root />);
      await screen.findByRole("heading", { level: 1 });
      await screen.findAllByRole("button");
      const results = await axe.run(page.container, { rules: { "color-contrast": { enabled: false } } });
      expect(results.violations.map((v) => `${path} ${v.id}: ${v.nodes.map((n) => n.target).join(", ")}`)).toEqual([]);
      page.unmount();
    }
  });
});
