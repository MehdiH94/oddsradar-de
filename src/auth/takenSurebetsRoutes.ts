import express, { Router } from "express";
import { AuthContext } from "./context";
import { sameSiteOnly } from "./middleware";
import { deleteTakenSurebet, listTakenSurebets, MAX_KEY, MAX_TAKEN, parseTakenSurebet, saveTakenSurebet } from "./takenSurebets";

// Mounted under /api after requireAuth: req.user is always set here. The body
// parser and the CSRF check are not global, so this router brings its own.
export function takenSurebetsRouter(auth: AuthContext): Router {
  const router = Router();

  router.use((_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });
  router.use(express.json({ limit: "4kb" }));
  router.use(sameSiteOnly(auth));

  router.get("/", (req, res) => {
    res.json({ taken: listTakenSurebets(auth.db, req.user!.id) });
  });

  // Marks a surebet taken, or changes its reminder.
  router.put("/", (req, res) => {
    const taken = parseTakenSurebet(req.body, auth.now());
    if (!taken) {
      res.status(400).json({ error: "invalid", message: "Ungültiger Surebet." });
      return;
    }
    if (!saveTakenSurebet(auth.db, req.user!.id, taken, auth.now())) {
      res.status(409).json({ error: "too_many", message: `Höchstens ${MAX_TAKEN} genommene Surebets.` });
      return;
    }
    res.status(204).end();
  });

  // Takes the mark off.
  router.delete("/", (req, res) => {
    const key = (req.body as { key?: unknown } | undefined)?.key;
    if (typeof key !== "string" || !key || key.length > MAX_KEY) {
      res.status(400).json({ error: "invalid", message: "Ungültiger Surebet." });
      return;
    }
    deleteTakenSurebet(auth.db, req.user!.id, key);
    res.status(204).end();
  });

  return router;
}
