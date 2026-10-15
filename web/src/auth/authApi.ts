export interface AuthUser {
  id: string;
  email: string;
  role: "user" | "admin";
}

// An answer of /api/auth/* that is not a success: the server's `error` code
// (invalid_credentials, email_not_verified, weak_password, rate_limited...)
// and its message, in French, fit to show.
export class AuthError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

async function post<T>(path: string, body: unknown = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/auth/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new AuthError("network", "Could not connect. Check your network and try again.", 0);
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new AuthError(
      data.error ?? "unknown",
      data.message ?? "Something went wrong. Try again in a moment.",
      res.status
    );
  }
  return data as T;
}

// The signed-in user, or null.
export async function fetchMe(): Promise<AuthUser | null> {
  const res = await fetch("/api/auth/me");
  if (!res.ok) throw new Error(`GET /api/auth/me failed: ${res.status}`);
  return (await res.json()).user ?? null;
}

export const login = (email: string, password: string) => post<{ user: AuthUser }>("login", { email, password }).then((r) => r.user);
export const logout = () => post<void>("logout");
export const register = (email: string, password: string) => post<{ message: string }>("register", { email, password });
export const resendVerification = (email: string) => post<{ message: string }>("resend-verification", { email });
export const verifyEmail = (token: string) => post<{ message: string }>("verify-email", { token });
export const forgotPassword = (email: string) => post<{ message: string }>("forgot-password", { email });
export const resetPassword = (token: string, password: string) => post<{ message: string }>("reset-password", { token, password });
