import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import axe from "axe-core";
import { AuthContext, type AuthValue } from "../auth/AuthContext";
import { PromosPage } from "./PromosPage";
import { bookmakerOf, countNew, endLabel, endOfDay, groupByBookmaker, isNew, type Promo } from "./promosApi";

const reply = (body: unknown, status = 200) => Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) });

const auth: AuthValue = {
  status: "authenticated",
  user: { id: "u1", email: "ada@example.com", role: "user" },
  login: async () => {},
  logout: async () => {},
};

const promo = (over: Partial<Promo>): Promo => ({
  id: 1,
  source: "manual",
  bookmaker: "Winamax",
  title: "100 % bis 100 €",
  details: "",
  url: null,
  endsAt: null,
  foundAt: "2026-10-01T10:00:00.000Z",
  mine: true,
  takenAt: null,
  ...over,
});

// The API as the page sees it: the list, and what is sent to it.
function stubApi(promos: Promo[], refuse = false, remind = true) {
  const sent: Array<{ url: string; method: string; body: unknown }> = [];
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    if (init?.method) {
      sent.push({ url, method: init.method, body: JSON.parse(String(init.body)) });
      if (refuse) return reply({ message: "Buchmacher und Titel angeben; der Link muss mit https:// beginnen." }, 400);
      return init.method === "POST" ? reply({ id: 9 }, 201) : reply(null, 204);
    }
    return reply({ promos, remind });
  });
  vi.stubGlobal("fetch", fetchMock);
  return { sent, fetchMock };
}

function renderPage() {
  return render(
    <AuthContext.Provider value={auth}>
      <PromosPage />
    </AuthContext.Provider>
  );
}

describe("the promos' helpers", () => {
  it("files a promo under the bookmaker the site knows, in any case, and any other as written", () => {
    expect(bookmakerOf("winamax")).toEqual({ key: "winamaxde", name: "Winamax", id: "winamaxde" });
    expect(bookmakerOf(" LeoVegas ")).toEqual({ key: "leovegas", name: "LeoVegas", id: "leovegas" });
    expect(bookmakerOf("Stake")).toEqual({ key: "stake", name: "Stake", id: null });
  });

  it("groups by bookmaker in the list's order", () => {
    const groups = groupByBookmaker([promo({ id: 1, bookmaker: "Stake" }), promo({ id: 2 }), promo({ id: 3, bookmaker: "stake" })]);
    expect(groups.map((g) => [g.name, g.promos.map((p) => p.id)])).toEqual([
      ["Stake", [1, 3]],
      ["Winamax", [2]],
    ]);
  });

  it("says when a promo ends, or that it has", () => {
    const now = new Date("2026-10-10T10:00:00Z");
    expect(endLabel(null, now)).toBeNull();
    expect(endLabel("2026-10-09T10:00:00Z", now)).toBe("Abgelaufen");
    expect(endLabel("2026-10-20T20:59:00Z", now)).toMatch(/^Endet Di\., 20\.10\., \d\d:59$/);
    expect(endOfDay("2026-10-20")).toBe(new Date("2026-10-20T23:59:00").toISOString());
    expect(endOfDay("bald")).toBeNull();
  });

  it("marks new the promotions the site found in the last 24 hours, never one written by hand", () => {
    const now = new Date("2026-10-30T12:00:00Z");
    expect(isNew({ source: "site", foundAt: "2026-10-30T01:00:00Z" }, now)).toBe(true);
    expect(isNew({ source: "site", foundAt: "2026-10-29T11:59:00Z" }, now)).toBe(false);
    expect(isNew({ source: "manual", foundAt: "2026-10-30T11:00:00Z" }, now)).toBe(false);
    expect(isNew({ source: "site", foundAt: "soon" }, now)).toBe(false);
  });

  it("counts the new promotions not yet taken", () => {
    const now = new Date("2026-10-30T12:00:00Z");
    const fresh = "2026-10-30T10:00:00Z";
    expect(
      countNew(
        [
          promo({ id: 1, source: "site", foundAt: fresh }),
          promo({ id: 2, source: "site", foundAt: fresh, takenAt: fresh }),
          promo({ id: 3, source: "manual", foundAt: fresh }),
        ],
        now
      )
    ).toBe(1);
  });
});

describe("PromosPage", () => {
  beforeEach(() => window.history.replaceState(null, "", "/promos"));
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    window.history.replaceState(null, "", "/");
  });

  it("shows one card per bookmaker, with each promo's conditions, end and link", async () => {
    stubApi([
      promo({ id: 1, details: "Umsatz 5x\nab Quote 1,50", url: "https://www.winamax.de/promo", endsAt: "2099-10-20T21:59:00.000Z" }),
      promo({ id: 2, bookmaker: "Stake", title: "Rakeback 10 %", mine: false, source: "site" }),
    ]);
    renderPage();
    const winamax = await screen.findByRole("region", { name: "Winamax" });
    expect(within(winamax).getByRole("heading", { level: 3, name: "100 % bis 100 €" })).toBeInTheDocument();
    expect(within(winamax).getByText(/Umsatz 5x/)).toBeInTheDocument();
    expect(within(winamax).getByText(/^Endet /)).toBeInTheDocument();
    expect(within(winamax).getByRole("link", { name: "Zur Aktion: 100 % bis 100 €" })).toHaveAttribute("href", "https://www.winamax.de/promo");
    expect(within(winamax).getByText("1 offen")).toBeInTheDocument();
    const stake = screen.getByRole("region", { name: "Stake" });
    // A promo the site found cannot be deleted, only marked.
    expect(within(stake).queryByRole("button", { name: /Löschen/ })).not.toBeInTheDocument();
    expect(screen.getByText("2 offene Promos")).toBeInTheDocument();
  });

  it("marks \"Neu\" a promotion the site just found, and only it", async () => {
    stubApi([
      promo({ id: 1, bookmaker: "neobet", title: "Early Payout", mine: false, source: "site", foundAt: new Date(Date.now() - 60 * 60 * 1000).toISOString() }),
      promo({ id: 2, bookmaker: "neobet", title: "Quoten-Boost", mine: false, source: "site" }),
      promo({ id: 3, foundAt: new Date().toISOString() }),
    ]);
    renderPage();
    const neobet = await screen.findByRole("region", { name: "neobet" });
    expect(within(neobet).getByRole("heading", { level: 3, name: "Neu Early Payout" })).toBeInTheDocument();
    expect(within(neobet).getByRole("heading", { level: 3, name: "Quoten-Boost" })).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Winamax" })).queryByText("Neu")).not.toBeInTheDocument();
    expect(screen.getAllByText("Neu")).toHaveLength(1);
    // The navigation counts it too, from the page's own list.
    expect(screen.getByRole("radio", { name: "Promos, 1 neu" })).toBeChecked();
  });

  it("marks a promo taken and back, on the account", async () => {
    const { sent } = stubApi([promo({ id: 4 })]);
    renderPage();
    const button = await screen.findByRole("button", { name: "Genommen: 100 % bis 100 €" });
    expect(button).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-pressed", "true");
    expect(button).toHaveTextContent("✓ Genommen");
    expect(screen.getByText("0 offene Promos")).toBeInTheDocument();
    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-pressed", "false");
    await waitFor(() => expect(sent).toHaveLength(2));
    expect(sent).toEqual([
      { url: "/api/promos/4/taken", method: "PUT", body: { taken: true } },
      { url: "/api/promos/4/taken", method: "PUT", body: { taken: false } },
    ]);
  });

  it("undoes a mark the server refuses", async () => {
    stubApi([promo({ id: 4 })], true);
    renderPage();
    const button = await screen.findByRole("button", { name: "Genommen: 100 % bis 100 €" });
    fireEvent.click(button);
    await waitFor(() => expect(button).toHaveAttribute("aria-pressed", "false"));
  });

  it("deletes the account's own promo", async () => {
    const { sent } = stubApi([promo({ id: 4 })]);
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Löschen: 100 % bis 100 €" }));
    expect(screen.queryByRole("region", { name: "Winamax" })).not.toBeInTheDocument();
    await waitFor(() => expect(sent).toEqual([{ url: "/api/promos/4", method: "DELETE", body: {} }]));
  });

  it("writes a promo down, to the end of the chosen day, and reads the list again", async () => {
    const { sent, fetchMock } = stubApi([]);
    renderPage();
    expect(await screen.findByText(/Noch keine Promo/)).toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "Buchmacher" }), { target: { value: " Stake " } });
    fireEvent.change(screen.getByRole("textbox", { name: "Titel" }), { target: { value: "Rakeback 10 %" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Bedingungen (optional)" }), { target: { value: "Code BLITZ" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Link (optional)" }), { target: { value: "https://stake.com/promotions" } });
    fireEvent.change(screen.getByLabelText("Gültig bis (optional)"), { target: { value: "2026-10-20" } });
    fireEvent.click(screen.getByRole("button", { name: "Promo speichern" }));
    expect(await screen.findByText("Promo gespeichert.")).toHaveAttribute("role", "status");
    expect(sent).toEqual([
      {
        url: "/api/promos",
        method: "POST",
        body: { bookmaker: "Stake", title: "Rakeback 10 %", details: "Code BLITZ", url: "https://stake.com/promotions", endsAt: endOfDay("2026-10-20") },
      },
    ]);
    expect(screen.getByRole("textbox", { name: "Titel" })).toHaveValue("");
    await waitFor(() => expect(fetchMock.mock.calls.filter(([, init]) => !init?.method)).toHaveLength(2));
  });

  it("says why the server refused a promo, keeping what was typed", async () => {
    stubApi([], true);
    renderPage();
    await screen.findByText(/Noch keine Promo/);
    fireEvent.change(screen.getByRole("combobox", { name: "Buchmacher" }), { target: { value: "Stake" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Titel" }), { target: { value: "Rakeback" } });
    fireEvent.click(screen.getByRole("button", { name: "Promo speichern" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("der Link muss mit https:// beginnen");
    expect(screen.getByRole("textbox", { name: "Titel" })).toHaveValue("Rakeback");
  });

  it("shows whether the e-mail the day before is on, and turns it off and on", async () => {
    const { sent } = stubApi([], false, false);
    renderPage();
    const box = await screen.findByRole("checkbox", { name: "E-Mail am Vortag, wenn eine offene Promo endet" });
    await waitFor(() => expect(box).not.toBeChecked());
    fireEvent.click(box);
    expect(box).toBeChecked();
    fireEvent.click(box);
    expect(box).not.toBeChecked();
    await waitFor(() => expect(sent).toHaveLength(2));
    expect(sent).toEqual([
      { url: "/api/promos/settings", method: "PUT", body: { remind: true } },
      { url: "/api/promos/settings", method: "PUT", body: { remind: false } },
    ]);
  });

  it("puts the switch back when the server refuses it", async () => {
    stubApi([], true);
    renderPage();
    const box = await screen.findByRole("checkbox", { name: "E-Mail am Vortag, wenn eine offene Promo endet" });
    await screen.findByText(/Noch keine Promo/);
    fireEvent.click(box);
    await waitFor(() => expect(box).toBeChecked());
  });

  it("says when the promos cannot be read", async () => {
    vi.stubGlobal("fetch", vi.fn(() => reply({ message: "x" }, 500)));
    renderPage();
    expect(await screen.findByRole("alert")).toHaveTextContent("Die Promos konnten nicht geladen werden");
  });

  it("names the Promos entry of the navigation as the page in, and goes to the others", async () => {
    stubApi([]);
    renderPage();
    await screen.findByText(/Noch keine Promo/);
    expect(screen.getByRole("radio", { name: "Promos" })).toBeChecked();
    fireEvent.click(screen.getByRole("radio", { name: "Freebets" }));
    expect(window.location.pathname).toBe("/freebets");
  });

  it("has no accessibility violation axe can find", async () => {
    stubApi([promo({ id: 1, url: "https://www.winamax.de/promo", endsAt: "2099-10-20T21:59:00.000Z" }), promo({ id: 2, takenAt: "2026-10-02T10:00:00.000Z" })]);
    const page = renderPage();
    await screen.findByRole("region", { name: "Winamax" });
    const rules = { rules: { "color-contrast": { enabled: false } } };
    expect((await axe.run(page.container, rules)).violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.html).join(" | ")}`)).toEqual([]);
  });
});
