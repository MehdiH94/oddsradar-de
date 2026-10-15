import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { AuthContext, type AuthValue } from "../auth/AuthContext";
import { AdminPage } from "./AdminPage";
import type { AdminUser } from "./adminApi";

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
    expect(await screen.findByText("3 comptes")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Utilisateurs", selected: true })).toBeInTheDocument();

    const ada = within(rowOf("ada@example.com"));
    expect(ada.getByText("Validé")).toBeInTheDocument();
    expect(ada.getByText("Aucun abonnement")).toBeInTheDocument();
    expect(ada.getByText("Utilisateur")).toBeInTheDocument();
    expect(ada.getByText("Actif")).toBeInTheDocument();
    expect(within(rowOf("pending@example.com")).getByText("Non validé")).toBeInTheDocument();
    expect(within(rowOf("root@example.com")).getByText("Admin")).toBeInTheDocument();
  });

  it("leaves the signed-in admin's own account alone", async () => {
    renderPage([ME, ADA]);
    const own = within(await screen.findByRole("row", { name: /root@example.com/ }));
    expect(own.getByText("(vous)")).toBeInTheDocument();
    expect(own.getByRole("button", { name: /Bloquer/ })).toBeDisabled();
    expect(own.getByRole("button", { name: /Retirer admin/ })).toBeDisabled();
    expect(within(rowOf("ada@example.com")).getByRole("button", { name: /Bloquer/ })).toBeEnabled();
  });

  it("blocks an account after a confirmation, and shows it blocked", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const fetchMock = renderPage([ME, ADA], () => reply({ user: { ...ADA, status: "disabled" } }));
    fireEvent.click(await within(await screen.findByRole("row", { name: /ada@example.com/ })).findByRole("button", { name: /Bloquer/ }));

    await waitFor(() => expect(within(rowOf("ada@example.com")).getByText("Bloqué")).toBeInTheDocument());
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining("ada@example.com"));
    const [url, init] = fetchMock.mock.calls.find(([, i]) => i?.method === "PATCH")!;
    expect(url).toBe("/api/admin/users/u1");
    expect(JSON.parse(String(init?.body))).toEqual({ status: "disabled" });
    expect(within(rowOf("ada@example.com")).getByRole("button", { name: /Débloquer/ })).toBeInTheDocument();
  });

  it("does nothing when the confirmation is declined", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const fetchMock = renderPage([ME, ADA]);
    fireEvent.click(await within(await screen.findByRole("row", { name: /ada@example.com/ })).findByRole("button", { name: /Bloquer/ }));
    expect(fetchMock.mock.calls.some(([, i]) => i?.method === "PATCH")).toBe(false);
  });

  it("makes an account an admin", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const fetchMock = renderPage([ME, ADA], () => reply({ user: { ...ADA, role: "admin" } }));
    fireEvent.click(await within(await screen.findByRole("row", { name: /ada@example.com/ })).findByRole("button", { name: /Nommer admin/ }));

    await waitFor(() => expect(within(rowOf("ada@example.com")).getByText("Admin")).toBeInTheDocument());
    const [, init] = fetchMock.mock.calls.find(([, i]) => i?.method === "PATCH")!;
    expect(JSON.parse(String(init?.body))).toEqual({ role: "admin" });
  });

  it("shows the server's message when a change is refused", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderPage([ME, ADA], () => reply({ error: "self", message: "Vous ne pouvez pas modifier votre propre compte." }, 409));
    fireEvent.click(await within(await screen.findByRole("row", { name: /ada@example.com/ })).findByRole("button", { name: /Bloquer/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Vous ne pouvez pas modifier votre propre compte.");
    expect(within(rowOf("ada@example.com")).getByText("Actif")).toBeInTheDocument();
  });

  it("says so when the list can't be loaded, and tries again on request", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(reply({ message: "Accès refusé." }, 403)).mockReturnValue(reply({ users: [ME] }));
    vi.stubGlobal("fetch", fetchMock);
    render(
      <AuthContext.Provider value={auth}>
        <AdminPage />
      </AuthContext.Provider>
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("Accès refusé.");
    fireEvent.click(screen.getByRole("button", { name: "Réessayer" }));
    expect(await screen.findByText("1 compte")).toBeInTheDocument();
  });
});
