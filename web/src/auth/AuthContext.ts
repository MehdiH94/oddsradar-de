import { createContext } from "react";
import type { AuthUser } from "./authApi";

// "loading" until /api/auth/me answers: the guarded pages wait rather than
// flash the login page at someone who is signed in.
export type AuthStatus = "loading" | "anonymous" | "authenticated";

export interface AuthValue {
  status: AuthStatus;
  user: AuthUser | null;
  login(email: string, password: string): Promise<void>;
  logout(): Promise<void>;
}

const NO_PROVIDER: AuthValue = {
  status: "anonymous",
  user: null,
  login: async () => {},
  logout: async () => {},
};

export const AuthContext = createContext<AuthValue>(NO_PROVIDER);
