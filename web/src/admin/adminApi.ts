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

// A bookmaker's last read by the worker (src/db/bookmakerStatus.ts).
export interface AdminBookmaker {
  bookmaker: string;
  lastReadAt: string;
  lastEvents: number | null;
  lastError: string | null;
  lastGoodAt: string | null;
  lastGoodEvents: number | null;
  health: "ok" | "failing" | "empty" | "down";
  downAlerted: boolean;
}

// The Odds API's credits left this month (src/scraper/oddsApiCredits.ts):
// Tipico's, Winamax's and Pinnacle's prices. Null before the worker read it.
export interface AdminOddsApiCredits {
  creditsLeft: number | null;
  checkedAt: string | null;
  // At or under it, no more reads until the credits renew.
  floor: number;
  // The refresh time the worker last used, paced to last the month (minutes).
  refreshMinutes?: number | null;
}

export interface AdminBookmakers {
  bookmakers: AdminBookmaker[];
  oddsApiCredits: AdminOddsApiCredits | null;
}

// A promo reader's state (src/promos/status.ts, PromoReaderStatus): the
// promotions it holds, and while its reads fail or find nothing, since when
// (ms), its last error and whether the admins' Discord was told.
export interface AdminPromoReader {
  bookmaker: string;
  count: number;
  newestTitle: string | null;
  newestFoundAt: string | null;
  failing?: { failingSince: number; lastError?: string; alerted?: boolean };
  // Its last good read and how many promotions it found, null before the first.
  lastRead: { at: string; found: number } | null;
}

// A tester's message (src/auth/feedback.ts, FeedbackItem).
export interface AdminFeedback {
  id: number;
  email: string;
  message: string;
  page: string | null;
  createdAt: string;
  doneAt: string | null;
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

export const fetchAdminBookmakers = () =>
  call<AdminBookmakers>("/api/admin/bookmakers").then((r) => ({ bookmakers: r.bookmakers, oddsApiCredits: r.oddsApiCredits ?? null }));

export const fetchAdminPromoReaders = () => call<{ readers: AdminPromoReader[] }>("/api/admin/promo-readers").then((r) => r.readers);

export const fetchAdminFeedback = () => call<{ feedback: AdminFeedback[] }>("/api/admin/feedback").then((r) => r.feedback);

export const updateAdminFeedback = (id: number, done: boolean) =>
  call<{ feedback: AdminFeedback }>(`/api/admin/feedback/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ done }),
  }).then((r) => r.feedback);
