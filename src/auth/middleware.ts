import { NextFunction, Request, RequestHandler, Response } from "express";
import { AuthContext } from "./context";
import { findSessionUser, Role, User } from "./store";

declare module "express-serve-static-core" {
  interface Request {
    user?: User;
    sessionToken?: string;
  }
}

export function sessionCookieName(auth: AuthContext): string {
  return auth.secureCookies ? "__Host-session" : "session";
}

function readCookie(req: Request, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const eq = part.indexOf("=");
    if (eq > 0 && part.slice(0, eq).trim() === name) {
      try {
        return decodeURIComponent(part.slice(eq + 1).trim());
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

export function setSessionCookie(auth: AuthContext, res: Response, token: string, maxAgeMs: number): void {
  res.cookie(sessionCookieName(auth), token, {
    httpOnly: true,
    secure: auth.secureCookies,
    sameSite: "lax",
    path: "/",
    maxAge: maxAgeMs,
  });
}

export function clearSessionCookie(auth: AuthContext, res: Response): void {
  res.clearCookie(sessionCookieName(auth), { httpOnly: true, secure: auth.secureCookies, sameSite: "lax", path: "/" });
}

// Fills req.user from the session cookie, when there is a live one. Never
// answers: requireAuth and requireRole decide.
export function loadSession(auth: AuthContext): RequestHandler {
  return (req, _res, next) => {
    const token = readCookie(req, sessionCookieName(auth));
    if (token) {
      const user = findSessionUser(auth.db, token, auth.now());
      if (user) {
        req.user = user;
        req.sessionToken = token;
      }
    }
    next();
  };
}

export const requireAuth: RequestHandler = (req, res, next) => {
  if (!req.user) {
    res.status(401).json({ error: "unauthenticated", message: "Connexion requise." });
    return;
  }
  next();
};

// For the day some pages are for some roles only: requireRole("admin").
export function requireRole(...roles: Role[]): RequestHandler {
  return (req, res, next) => {
    if (!req.user) {
      res.status(401).json({ error: "unauthenticated", message: "Connexion requise." });
    } else if (!roles.includes(req.user.role)) {
      res.status(403).json({ error: "forbidden", message: "Accès refusé." });
    } else {
      next();
    }
  };
}

// CSRF, on top of SameSite=Lax: a request that changes something must be JSON
// (a cross-site form cannot send that) and, when the browser says where it
// comes from, come from this site.
export function sameSiteOnly(auth: AuthContext): RequestHandler {
  const own = new URL(auth.publicUrl).origin;
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") {
      next();
      return;
    }
    const origin = req.headers.origin;
    let fromHere = origin === undefined;
    if (origin !== undefined) {
      try {
        // Same host as the request covers the dev server's proxy too.
        fromHere = origin === own || new URL(origin).host === req.headers.host;
      } catch {
        fromHere = false;
      }
    }
    if (!fromHere || !req.is("application/json")) {
      res.status(403).json({ error: "forbidden", message: "Requête refusée." });
      return;
    }
    next();
  };
}
