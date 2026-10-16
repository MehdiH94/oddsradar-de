import { announceUnauthorized } from "../auth/session";

// An account as the administration page lists it (src/auth/store.ts, AdminUser).
export interface AdminUser {
  id: string;
  email: string;
  role: "user" | "admin";
  status: "active" | "disabled";
  emailVerifiedAt: string | null;
  subscriptionStatus: "none" | "active";
  createdAt: string;
  lastLoginAt: string | null;
}

export type AdminUserChange = Partial<Pick<AdminUser, "status" | "role">>;

// An answer of /api/admin/* that is not a success, with the server's message
// (in French, fit to show).
export class AdminError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    throw new AdminError("Could not connect. Check your network and try again.", 0);
  }
  if (res.status === 401) announceUnauthorized();
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new AdminError(data.message ?? "Something went wrong. Try again in a moment.", res.status);
  return data as T;
}

export const fetchAdminUsers = () => call<{ users: AdminUser[] }>("/api/admin/users").then((r) => r.users);

export const updateAdminUser = (id: string, change: AdminUserChange) =>
  call<{ user: AdminUser }>(`/api/admin/users/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(change),
  }).then((r) => r.user);
