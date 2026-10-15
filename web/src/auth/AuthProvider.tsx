import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import * as api from "./authApi";
import { AuthContext, type AuthStatus } from "./AuthContext";
import { onUnauthorized } from "./session";
import type { AuthUser } from "./authApi";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ status: AuthStatus; user: AuthUser | null }>({ status: "loading", user: null });

  useEffect(() => {
    let cancelled = false;
    api
      .fetchMe()
      .then((user) => !cancelled && setState({ status: user ? "authenticated" : "anonymous", user }))
      .catch(() => !cancelled && setState({ status: "anonymous", user: null }));
    return () => {
      cancelled = true;
    };
  }, []);

  // A data route said 401: the session ended somewhere else or expired.
  useEffect(() => onUnauthorized(() => setState({ status: "anonymous", user: null })), []);

  const login = useCallback(async (email: string, password: string) => {
    const user = await api.login(email, password);
    setState({ status: "authenticated", user });
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      // Signed out here whatever the server said: the cookie is cleared by
      // its answer, or expires on its own.
      setState({ status: "anonymous", user: null });
    }
  }, []);

  const value = useMemo(() => ({ ...state, login, logout }), [state, login, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
