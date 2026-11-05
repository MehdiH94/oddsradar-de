import express, { Router } from "express";
import { AuthContext } from "./context";
import { sameSiteOnly } from "./middleware";
import { listFeedback, setFeedbackDone } from "./feedback";
import { trackerUsage } from "./trackerUsage";
import { deleteUserSessions, findUserById, listUsers, recordEvent, Role, setRole, setStatus, User } from "./store";

// Mounted under /api/admin after requireAuth and requireRole("admin"): req.user
// is always an admin here. The body parser and the CSRF check are not global,
// so this router brings its own.
export function adminRouter(auth: AuthContext): Router {
  const router = Router();
  const { db } = auth;

  router.use((_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });
  router.use(express.json({ limit: "2kb" }));
  router.use(sameSiteOnly(auth));

  router.get("/users", (_req, res) => {
    res.json({ users: listUsers(db) });
  });

  // Changes an account's status (blocks or unblocks it) and/or role (makes it
  // an admin or not). Nobody changes their own: an admin cannot lock themselves
  // out or leave the site without admin.
  router.patch("/users/:id", (req, res) => {
    const { status, role } = req.body ?? {};
    const validStatus = status === undefined || status === "active" || status === "disabled";
    const validRole = role === undefined || role === "user" || role === "admin";
    if (!validStatus || !validRole || (status === undefined && role === undefined)) {
      res.status(400).json({ error: "invalid", message: "Invalid change." });
      return;
    }
    const target = findUserById(db, req.params.id);
    if (!target) {
      res.status(404).json({ error: "not_found", message: "Account not found." });
      return;
    }
    if (target.id === req.user!.id) {
      res.status(409).json({ error: "self", message: "You cannot change your own account." });
      return;
    }

    const ip = req.ip ?? "unknown";
    const audit = (type: string) => recordEvent(db, `${type}:${target.id}`, req.user!.id, ip, auth.now());
    if (status !== undefined && status !== target.status) {
      setStatus(db, target.id, status as User["status"]);
      // A blocked account is signed out at once, not when its session ends.
      if (status === "disabled") deleteUserSessions(db, target.id);
      audit(status === "disabled" ? "admin_disable_user" : "admin_enable_user");
    }
    if (role !== undefined && role !== target.role) {
      setRole(db, target.id, role as Role);
      audit(role === "admin" ? "admin_grant_admin" : "admin_revoke_admin");
    }
    res.json({ user: listUsers(db).find((user) => user.id === target.id) });
  });

  // How the testers use the bet tracker: counts only (src/auth/trackerUsage.ts).
  router.get("/usage", (_req, res) => {
    res.json({ usage: trackerUsage(db, auth.now()) });
  });

  // The testers' messages (src/auth/feedback.ts), the newest first.
  router.get("/feedback", (_req, res) => {
    res.json({ feedback: listFeedback(db) });
  });

  // Marks a message handled ({ done: true }) or not.
  router.patch("/feedback/:id", (req, res) => {
    const { done } = req.body ?? {};
    const id = Number(req.params.id);
    if (typeof done !== "boolean" || !Number.isSafeInteger(id)) {
      res.status(400).json({ error: "invalid", message: "Invalid change." });
      return;
    }
    if (!setFeedbackDone(db, id, done, auth.now())) {
      res.status(404).json({ error: "not_found", message: "Message not found." });
      return;
    }
    res.json({ feedback: listFeedback(db).find((item) => item.id === id) });
  });

  return router;
}
