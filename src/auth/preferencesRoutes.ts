import express, { Router } from "express";
import { AuthContext } from "./context";
import { sameSiteOnly } from "./middleware";
import { getPreferences, parsePreferences, savePreferences } from "./preferences";

// Mounted under /api after requireAuth: req.user is always set here. The body
// parser and the CSRF check are not global, so this router brings its own.
export function preferencesRouter(auth: AuthContext): Router {
  const router = Router();

  router.use((_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });
  router.use(express.json({ limit: "2kb" }));
  router.use(sameSiteOnly(auth));

  router.get("/", (req, res) => {
    res.json({ preferences: getPreferences(auth.db, req.user!.id) });
  });

  router.put("/", (req, res) => {
    const preferences = parsePreferences(req.body);
    if (!preferences) {
      res.status(400).json({ error: "invalid", message: "Ungültige Einstellungen." });
      return;
    }
    savePreferences(auth.db, req.user!.id, preferences, auth.now());
    res.status(204).end();
  });

  return router;
}
