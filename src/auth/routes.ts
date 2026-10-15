import express, { Request, Response, Router } from "express";
import { AuthContext } from "./context";
import { clearSessionCookie, loadSession, sameSiteOnly, setSessionCookie } from "./middleware";
import { mails } from "./mailer";
import { hashPassword, needsRehash, passwordProblem, verifyPassword } from "./password";
import {
  consumeAuthToken,
  createAuthToken,
  createSession,
  createUser,
  deleteSession,
  deleteUserSessions,
  findUserByEmail,
  findUserById,
  markEmailVerified,
  normalizeEmail,
  peekAuthToken,
  recordEvent,
  recordLogin,
  SESSION_ABSOLUTE_MS,
  setPasswordHash,
} from "./store";

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// The same answer whether or not the email has an account: nobody learns who
// is registered from the sign-up, resend and reset forms.
const REGISTERED = {
  message: "Si cette adresse est valide, un email de confirmation vient de lui être envoyé. Ouvrez le lien qu'il contient pour activer le compte.",
};
const RESET_SENT = {
  message: "Si un compte existe pour cette adresse, un email vient de lui être envoyé avec un lien pour choisir un nouveau mot de passe.",
};

const text = (value: unknown, max: number): string | null => (typeof value === "string" && value.length <= max ? value : null);

export function authRouter(auth: AuthContext): Router {
  const router = Router();
  const { db } = auth;

  router.use((_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });
  router.use(express.json({ limit: "10kb" }));
  router.use(sameSiteOnly(auth));
  router.use(loadSession(auth));

  // Over the limit: answers 429 and says so. True when the request may go on.
  function allowed(res: Response, key: string, max: number, windowMs: number): boolean {
    const wait = auth.limiter.hit(key, max, windowMs);
    if (wait > 0) {
      res.set("Retry-After", String(wait));
      res.status(429).json({ error: "rate_limited", message: "Trop de tentatives. Réessayez dans quelques minutes." });
      return false;
    }
    return true;
  }

  const ip = (req: Request) => req.ip ?? "unknown";

  async function sendVerification(userId: string, email: string): Promise<void> {
    const token = createAuthToken(db, userId, "verify_email", auth.now());
    await auth.mailer.send(mails.verifyEmail(email, `${auth.publicUrl}/verify-email?token=${encodeURIComponent(token)}`));
  }

  async function sendReset(userId: string, email: string): Promise<void> {
    const token = createAuthToken(db, userId, "reset_password", auth.now());
    await auth.mailer.send(mails.resetPassword(email, `${auth.publicUrl}/reset-password?token=${encodeURIComponent(token)}`));
  }

  // A mail that cannot be sent must not tell the caller whether the account
  // exists (a failure would only happen for real addresses): log it, answer
  // as if sent.
  async function trySend(task: Promise<void>): Promise<void> {
    try {
      await task;
    } catch (err) {
      console.error("[auth] email not sent:", err instanceof Error ? err.message : err);
    }
  }

  router.post("/register", async (req, res) => {
    const email = text(req.body?.email, 254);
    const password = text(req.body?.password, 1024);
    if (!allowed(res, `register:ip:${ip(req)}`, 5, HOUR)) return;
    if (email === null || !EMAIL_PATTERN.test(email.trim())) {
      res.status(400).json({ error: "invalid_email", message: "Adresse email invalide." });
      return;
    }
    const problem = password === null ? "Mot de passe invalide." : passwordProblem(password, email);
    if (problem || password === null) {
      res.status(400).json({ error: "weak_password", message: problem });
      return;
    }
    // Hashed whether or not the email is taken, so the time says nothing.
    const passwordHash = await hashPassword(password, auth.cost);
    const existing = findUserByEmail(db, email);
    if (!existing) {
      const user = createUser(db, { email, passwordHash }, auth.now());
      recordEvent(db, "register", user.id, ip(req), auth.now());
      await trySend(sendVerification(user.id, user.email));
    } else if (!existing.emailVerifiedAt) {
      // Never confirmed: send the link again (the account keeps its first password).
      if (auth.limiter.hit(`verify:email:${existing.id}`, 3, HOUR) === 0) await trySend(sendVerification(existing.id, existing.email));
    } else if (auth.limiter.hit(`verify:email:${existing.id}`, 3, HOUR) === 0) {
      const token = createAuthToken(db, existing.id, "reset_password", auth.now());
      await trySend(auth.mailer.send(mails.alreadyRegistered(existing.email, `${auth.publicUrl}/reset-password?token=${encodeURIComponent(token)}`)));
    }
    res.status(202).json(REGISTERED);
  });

  router.post("/verify-email", (req, res) => {
    if (!allowed(res, `token:ip:${ip(req)}`, 20, HOUR)) return;
    const token = text(req.body?.token, 200);
    const userId = token ? consumeAuthToken(db, token, "verify_email", auth.now()) : null;
    if (!userId) {
      res.status(400).json({ error: "invalid_token", message: "Ce lien de confirmation est invalide ou a expiré." });
      return;
    }
    markEmailVerified(db, userId, auth.now());
    recordEvent(db, "email_verified", userId, ip(req), auth.now());
    res.json({ message: "Adresse confirmée. Vous pouvez vous connecter." });
  });

  router.post("/resend-verification", async (req, res) => {
    const email = text(req.body?.email, 254);
    if (!allowed(res, `resend:ip:${ip(req)}`, 5, HOUR)) return;
    const user = email ? findUserByEmail(db, email) : null;
    if (user && !user.emailVerifiedAt && auth.limiter.hit(`verify:email:${user.id}`, 3, HOUR) === 0) {
      await trySend(sendVerification(user.id, user.email));
    }
    res.status(202).json(REGISTERED);
  });

  router.post("/login", async (req, res) => {
    const email = text(req.body?.email, 254);
    const password = text(req.body?.password, 1024);
    if (email === null || password === null) {
      res.status(400).json({ error: "invalid_request", message: "Email et mot de passe requis." });
      return;
    }
    const emailKey = `login:email:${normalizeEmail(email)}`;
    if (!allowed(res, `login:ip:${ip(req)}`, 20, 15 * MINUTE) || !allowed(res, emailKey, 8, 15 * MINUTE)) return;

    const user = findUserByEmail(db, email);
    const ok = await verifyPassword(password, user ? user.passwordHash : await auth.dummyHash());
    if (!user || !ok) {
      recordEvent(db, "login_failed", user?.id ?? null, ip(req), auth.now());
      res.status(401).json({ error: "invalid_credentials", message: "Email ou mot de passe incorrect." });
      return;
    }
    // The password is right: say what is wrong with the account.
    if (user.status !== "active") {
      res.status(403).json({ error: "account_disabled", message: "Ce compte est désactivé." });
      return;
    }
    if (!user.emailVerifiedAt) {
      res.status(403).json({ error: "email_not_verified", message: "Confirmez d'abord votre adresse email : un lien vous a été envoyé." });
      return;
    }
    if (needsRehash(user.passwordHash, auth.cost)) setPasswordHash(db, user.id, await hashPassword(password, auth.cost), auth.now());
    auth.limiter.reset(emailKey);
    // A new session at each login: a session id fixed beforehand opens nothing.
    const token = createSession(db, user.id, { ip: ip(req), userAgent: req.get("user-agent") }, auth.now());
    recordLogin(db, user.id, auth.now());
    recordEvent(db, "login", user.id, ip(req), auth.now());
    setSessionCookie(auth, res, token, SESSION_ABSOLUTE_MS);
    res.json({ user: { id: user.id, email: user.email, role: user.role } });
  });

  router.post("/logout", (req, res) => {
    if (req.sessionToken) deleteSession(db, req.sessionToken);
    if (req.user) recordEvent(db, "logout", req.user.id, ip(req), auth.now());
    clearSessionCookie(auth, res);
    res.status(204).end();
  });

  // 200 with `user: null` for a visitor: asking who is signed in is not an
  // error (the browser's console would log every home page view as one).
  router.get("/me", (req, res) => {
    res.json({ user: req.user ? { id: req.user.id, email: req.user.email, role: req.user.role } : null });
  });

  router.post("/forgot-password", async (req, res) => {
    const email = text(req.body?.email, 254);
    if (!allowed(res, `forgot:ip:${ip(req)}`, 5, HOUR)) return;
    const user = email ? findUserByEmail(db, email) : null;
    if (user && user.status === "active" && auth.limiter.hit(`forgot:email:${user.id}`, 3, HOUR) === 0) {
      recordEvent(db, "forgot_password", user.id, ip(req), auth.now());
      await trySend(sendReset(user.id, user.email));
    }
    res.status(202).json(RESET_SENT);
  });

  router.post("/reset-password", async (req, res) => {
    if (!allowed(res, `token:ip:${ip(req)}`, 20, HOUR)) return;
    const token = text(req.body?.token, 200);
    const password = text(req.body?.password, 1024);
    if (token === null || password === null) {
      res.status(400).json({ error: "invalid_request", message: "Lien et mot de passe requis." });
      return;
    }
    // Check the link and the password before spending the link: a weak
    // password must not cost the user their link.
    const owner = peekAuthToken(db, token, "reset_password", auth.now());
    const user = owner ? findUserById(db, owner) : null;
    if (!user) {
      res.status(400).json({ error: "invalid_token", message: "Ce lien est invalide ou a expiré." });
      return;
    }
    const problem = passwordProblem(password, user.email);
    if (problem) {
      res.status(400).json({ error: "weak_password", message: problem });
      return;
    }
    const passwordHash = await hashPassword(password, auth.cost);
    if (consumeAuthToken(db, token, "reset_password", auth.now()) !== user.id) {
      res.status(400).json({ error: "invalid_token", message: "Ce lien est invalide ou a expiré." });
      return;
    }
    setPasswordHash(db, user.id, passwordHash, auth.now());
    // Having the link proves the mailbox; and every open session, which may be
    // the attacker's, ends.
    markEmailVerified(db, user.id, auth.now());
    deleteUserSessions(db, user.id);
    recordEvent(db, "password_reset", user.id, ip(req), auth.now());
    res.json({ message: "Mot de passe modifié. Vous pouvez vous connecter." });
  });

  return router;
}
