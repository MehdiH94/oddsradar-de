import express, { Router } from "express";
import { AuthContext } from "../auth/context";
import { sameSiteOnly } from "../auth/middleware";
import { getWallet, parseWallet, saveWallet } from "./wallet";

// Mounted under /api after requireAuth: req.user is always set here, and the
// wallet is always that account's own. Like the preferences' router, this one
// brings its own body parser and CSRF check.
export function walletRouter(auth: AuthContext): Router {
  const router = Router();

  router.use((_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });
  router.use(express.json({ limit: "2kb" }));
  router.use(sameSiteOnly(auth));

  router.get("/", (req, res) => {
    res.json({ wallet: getWallet(auth.db, req.user!.id) });
  });

  // Replaces the whole wallet (a bookmaker left out goes back to nothing) and
  // answers what was stored: unlike the preferences, the body can come back
  // corrected (cents rounded, a bookmaker the site does not know left out).
  router.put("/", (req, res) => {
    const wallet = parseWallet(req.body?.wallet);
    if (!wallet) {
      res.status(400).json({ error: "invalid", message: "Montants de freebets invalides." });
      return;
    }
    saveWallet(auth.db, req.user!.id, wallet, auth.now());
    res.json({ wallet: getWallet(auth.db, req.user!.id) });
  });

  return router;
}
