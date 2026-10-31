import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { AuthContext, type AuthValue } from "../auth/AuthContext";
import { AdminPage } from "./AdminPage";
import type { AdminBookmaker, AdminFeedback, AdminPromoReader, AdminUser } from "./adminApi";

const reply = (body: unknown, status = 200) => Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) });

const user = (over: Partial<AdminUser>): AdminUser => ({
  id: "u1",
  email: "ada@example.com",
  role: "user",
  status: "active",
  emailVerifiedAt: "2026-10-01T10:00:00.000Z",
  subscriptionStatus: "none",
  createdAt: "2026-10-01T09:00:00.000Z",
  lastLoginAt: null,
  ...over,
});

const ME = user({ id: "me", email: "root@example.com", role: "admin" });
const ADA = user({});
const PENDING = user({ id: "u2", email: "pending@example.com", emailVerifiedAt: null });

const auth: AuthValue = {
  status: "authenticated",
  user: { id: "me", email: ME.email, role: "admin" },
  login: async () => {},
  logout: async () => {},
};

function renderPage(users: AdminUser[], patch?: (url: string, init: RequestInit) => Promise<unknown>) {
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    if (init?.method === "PATCH") return patch ? patch(url, init) : reply({});
    return reply({ users });
  });
  vi.stubGlobal("fetch", fetchMock);
  render(
    <AuthContext.Provider value={auth}>
      <AdminPage />
    </AuthContext.Provider>
  );
  return fetchMock;
}

const rowOf = (email: string) => screen.getByRole("row", { name: new RegExp(email) });

describe("AdminPage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("lists the accounts with their confirmation, subscription, role and status", async () => {
    renderPage([ME, ADA, PENDING]);
    expect(await screen.findByText("3 accounts")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Users", selected: true })).toBeInTheDocument();

    const ada = within(rowOf("ada@example.com"));
    expect(ada.getByText("Confirmed")).toBeInTheDocument();
    expect(ada.getByText("No subscription")).toBeInTheDocument();
    expect(ada.getByText("User")).toBeInTheDocument();
    expect(ada.getByText("Active")).toBeInTheDocument();
    expect(within(rowOf("pending@example.com")).getByText("Not confirmed")).toBeInTheDocument();
    expect(within(rowOf("root@example.com")).getByText("Admin")).toBeInTheDocument();
  });

  it("leaves the signed-in admin's own account alone", async () => {
    renderPage([ME, ADA]);
    const own = within(await screen.findByRole("row", { name: /root@example.com/ }));
    expect(own.getByText("(you)")).toBeInTheDocument();
    expect(own.getByRole("button", { name: /Block/ })).toBeDisabled();
    expect(own.getByRole("button", { name: /Remove admin/ })).toBeDisabled();
    expect(within(rowOf("ada@example.com")).getByRole("button", { name: /Block/ })).toBeEnabled();
  });

  it("blocks an account after a confirmation, and shows it blocked", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const fetchMock = renderPage([ME, ADA], () => reply({ user: { ...ADA, status: "disabled" } }));
    fireEvent.click(await within(await screen.findByRole("row", { name: /ada@example.com/ })).findByRole("button", { name: /Block/ }));

    await waitFor(() => expect(within(rowOf("ada@example.com")).getByText("Blocked")).toBeInTheDocument());
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining("ada@example.com"));
    const [url, init] = fetchMock.mock.calls.find(([, i]) => i?.method === "PATCH")!;
    expect(url).toBe("/api/admin/users/u1");
    expect(JSON.parse(String(init?.body))).toEqual({ status: "disabled" });
    expect(within(rowOf("ada@example.com")).getByRole("button", { name: /Unblock/ })).toBeInTheDocument();
  });

  it("does nothing when the confirmation is declined", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const fetchMock = renderPage([ME, ADA]);
    fireEvent.click(await within(await screen.findByRole("row", { name: /ada@example.com/ })).findByRole("button", { name: /Block/ }));
    expect(fetchMock.mock.calls.some(([, i]) => i?.method === "PATCH")).toBe(false);
  });

  it("makes an account an admin", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const fetchMock = renderPage([ME, ADA], () => reply({ user: { ...ADA, role: "admin" } }));
    fireEvent.click(await within(await screen.findByRole("row", { name: /ada@example.com/ })).findByRole("button", { name: /Make admin/ }));

    await waitFor(() => expect(within(rowOf("ada@example.com")).getByText("Admin")).toBeInTheDocument());
    const [, init] = fetchMock.mock.calls.find(([, i]) => i?.method === "PATCH")!;
    expect(JSON.parse(String(init?.body))).toEqual({ role: "admin" });
  });

  it("shows the server's message when a change is refused", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderPage([ME, ADA], () => reply({ error: "self", message: "You cannot change your own account." }, 409));
    fireEvent.click(await within(await screen.findByRole("row", { name: /ada@example.com/ })).findByRole("button", { name: /Block/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("You cannot change your own account.");
    expect(within(rowOf("ada@example.com")).getByText("Active")).toBeInTheDocument();
  });

  it("says so when the list can't be loaded, and tries again on request", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(reply({ message: "Access denied." }, 403)).mockReturnValue(reply({ users: [ME] }));
    vi.stubGlobal("fetch", fetchMock);
    render(
      <AuthContext.Provider value={auth}>
        <AdminPage />
      </AuthContext.Provider>
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("Access denied.");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("1 account")).toBeInTheDocument();
  });

  it("shows each bookmaker's health in its own tab, the down ones in red", async () => {
    const bookmakers: AdminBookmaker[] = [
      { bookmaker: "betway", lastReadAt: "2026-10-20T10:05:00.000Z", lastEvents: 950, lastError: null, lastGoodAt: "2026-10-20T10:05:00.000Z", lastGoodEvents: 950, health: "ok", downAlerted: false },
      { bookmaker: "oddset", lastReadAt: "2026-10-20T10:05:00.000Z", lastEvents: null, lastError: "oddset sport 4: HTTP 403", lastGoodAt: "2026-10-20T09:00:00.000Z", lastGoodEvents: 830, health: "down", downAlerted: true },
    ];
    const fetchMock = vi.fn((url: string) => reply(url.endsWith("/bookmakers") ? { bookmakers } : { users: [ME] }));
    vi.stubGlobal("fetch", fetchMock);
    render(
      <AuthContext.Provider value={auth}>
        <AdminPage />
      </AuthContext.Provider>
    );
    fireEvent.click(screen.getByRole("tab", { name: "Bookmakers" }));
    expect(screen.getByRole("tab", { name: "Bookmakers" })).toHaveAttribute("aria-selected", "true");

    expect(await screen.findByText("1 bookmaker down.")).toBeInTheDocument();
    const oddset = screen.getByRole("row", { name: /ODDSET/ });
    expect(within(oddset).getByText("Down").className).toContain("blocked");
    expect(within(oddset).getByText("oddset sport 4: HTTP 403")).toBeInTheDocument();
    expect(within(oddset).getByText("(830 matches)")).toBeInTheDocument();
    expect(within(screen.getByRole("row", { name: /Betway/ })).getByText("OK").className).toContain("active");
    expect(fetchMock).toHaveBeenCalledWith("/api/admin/bookmakers", undefined);
  });

  it("shows each promo reader's state in its own tab, the failing ones in red with their error", async () => {
    const readers: AdminPromoReader[] = [
      { bookmaker: "neobet", count: 18, newestTitle: "Early Payout", newestFoundAt: "2026-10-28T04:20:00.000Z", lastRead: { at: "2026-10-30T12:05:00.000Z", found: 18 } },
      { bookmaker: "twentybet", count: 9, newestTitle: "Bet Builder", newestFoundAt: "2026-10-29T01:05:00.000Z", failing: { failingSince: Date.parse("2026-10-29T08:00:00.000Z"), lastError: "HTTP 404", alerted: true }, lastRead: null },
      { bookmaker: "merkurbets", count: 0, newestTitle: null, newestFoundAt: null, lastRead: null },
    ];
    const fetchMock = vi.fn((url: string) => reply(url.endsWith("/promo-readers") ? { readers } : { users: [ME] }));
    vi.stubGlobal("fetch", fetchMock);
    render(
      <AuthContext.Provider value={auth}>
        <AdminPage />
      </AuthContext.Provider>
    );
    fireEvent.click(screen.getByRole("tab", { name: "Promos" }));

    expect(await screen.findByText("1 promo reader failing.")).toBeInTheDocument();
    const twentybet = screen.getByRole("row", { name: /20bet/ });
    expect(within(twentybet).getByText("Failing").className).toContain("blocked");
    expect(within(twentybet).getByText("HTTP 404")).toBeInTheDocument();
    expect(within(twentybet).getByText("(admins told)")).toBeInTheDocument();
    const neobet = screen.getByRole("row", { name: /neobet/ });
    expect(within(neobet).getByText("OK").className).toContain("active");
    expect(within(neobet).getByText("Early Payout")).toBeInTheDocument();
    expect(within(neobet).getByText("(18 found)")).toBeInTheDocument();
    expect(within(screen.getByRole("row", { name: /Merkur Bets/ })).getByText("Empty").className).toContain("warning");
    expect(fetchMock).toHaveBeenCalledWith("/api/admin/promo-readers", undefined);
  });

  it("reads the promo readers again every minute, keeping the last list when a refresh fails", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const reader: AdminPromoReader = { bookmaker: "neobet", count: 18, newestTitle: "Early Payout", newestFoundAt: null, lastRead: null };
      let calls = 0;
      const fetchMock = vi.fn((url: string) => {
        if (!url.endsWith("/promo-readers")) return reply({ users: [ME] });
        calls++;
        return calls === 2 ? reply({ message: "Server down." }, 500) : reply({ readers: [reader] });
      });
      vi.stubGlobal("fetch", fetchMock);
      render(
        <AuthContext.Provider value={auth}>
          <AdminPage />
        </AuthContext.Provider>
      );
      fireEvent.click(screen.getByRole("tab", { name: "Promos" }));
      expect(await screen.findByText("Every promo reader works.")).toBeInTheDocument();
      expect(screen.getByText(/· updated \d\d:\d\d/)).toBeInTheDocument();
      expect(calls).toBe(1);

      await vi.advanceTimersByTimeAsync(60_000);
      expect(calls).toBe(2);
      expect(await screen.findByText("· the last refresh failed")).toBeInTheDocument();
      expect(screen.getByRole("row", { name: /neobet/ })).toBeInTheDocument();

      await vi.advanceTimersByTimeAsync(60_000);
      expect(calls).toBe(3);
      await waitFor(() => expect(screen.queryByText("· the last refresh failed")).not.toBeInTheDocument());
    } finally {
      vi.useRealTimers();
    }
  });

  it("lists the testers' feedback in its own tab, and marks a message done", async () => {
    const feedback: AdminFeedback[] = [
      { id: 2, email: "ada@example.com", message: "Betway is missing tonight's NBA", page: "/odds?sport=basketball", createdAt: "2026-10-20T10:05:00.000Z", doneAt: null },
      { id: 1, email: "bob@example.com", message: "Love it", page: null, createdAt: "2026-10-19T08:00:00.000Z", doneAt: "2026-10-19T09:00:00.000Z" },
    ];
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (init?.method === "PATCH") return reply({ feedback: { ...feedback[0], doneAt: "2026-10-20T11:00:00.000Z" } });
      return reply(url.endsWith("/feedback") ? { feedback } : { users: [ME] });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(
      <AuthContext.Provider value={auth}>
        <AdminPage />
      </AuthContext.Provider>
    );
    fireEvent.click(screen.getByRole("tab", { name: "Feedback" }));

    expect(await screen.findByText("1 open message, 2 in all.")).toBeInTheDocument();
    const ada = screen.getByRole("row", { name: /ada@example.com/ });
    expect(within(ada).getByText("Betway is missing tonight's NBA")).toBeInTheDocument();
    expect(within(ada).getByText("/odds?sport=basketball")).toBeInTheDocument();
    expect(within(screen.getByRole("row", { name: /bob@example.com/ })).getByRole("button", { name: /Reopen/ })).toBeInTheDocument();

    fireEvent.click(within(ada).getByRole("button", { name: /Mark done/ }));
    expect(await screen.findByText("0 open messages, 2 in all.")).toBeInTheDocument();
    const patch = fetchMock.mock.calls.find(([, init]) => init?.method === "PATCH")!;
    expect(patch[0]).toBe("/api/admin/feedback/2");
    expect(JSON.parse(patch[1]!.body as string)).toEqual({ done: true });
  });
});
