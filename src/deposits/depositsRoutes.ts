import express, { Router } from "express";
import { AuthContext } from "../auth/context";
import { sameSiteOnly } from "../auth/middleware";
import { getDeposits, parseDeposits, parseLimit, saveDeposits, setDepositLimit } from "./deposits";

// Mounted under /api after requireAuth: always the account's own deposits.
// Its own body parser and CSRF check, like the freebets wallet's router.
export function depositsRouter(auth: AuthContext): Router {
  const router = Router();

  router.use((_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });
  router.use(express.json({ limit: "2kb" }));
  router.use(sameSiteOnly(auth));

  router.get("/", (req, res) => {
    res.json(getDeposits(auth.db, req.user!.id, auth.now()));
  });

  // Replaces this month's deposits, and the account's own limit when sent
  // (null back to the default), and answers what was stored.
  router.put("/", (req, res) => {
    const deposits = parseDeposits(req.body?.deposits);
    const limit = parseLimit(req.body?.limit);
    if (!deposits || limit === "invalid") {
      res.status(400).json({ error: "invalid", message: "Ungültige Einzahlungsbeträge." });
      return;
    }
    saveDeposits(auth.db, req.user!.id, deposits, auth.now());
    if (limit !== undefined) setDepositLimit(auth.db, req.user!.id, limit, auth.now());
    res.json(getDeposits(auth.db, req.user!.id, auth.now()));
  });

  return router;
}
