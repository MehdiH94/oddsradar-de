import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { AuthContext, type AuthValue } from "../auth/AuthContext";
import { AdminPage } from "./AdminPage";
import type { AdminBookmaker, AdminUser } from "./adminApi";

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
});
