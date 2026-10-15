import { useContext } from "react";
import { AuthContext, type AuthValue } from "./AuthContext";

// The signed-in user and the way out. Without a provider (a component's own
// test) it reads as signed out.
export function useAuth(): AuthValue {
  return useContext(AuthContext);
}
