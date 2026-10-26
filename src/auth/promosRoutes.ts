import express, { Router } from "express";
import { AuthContext } from "./context";
import { sameSiteOnly } from "./middleware";
import { addPromo, deletePromo, listPromos, MAX_OWN, parseNewPromo, setPromoTaken } from "./promos";

// Mounted under /api after requireAuth: req.user is always set here. The body
// parser and the CSRF check are not global, so this router brings its own.
export function promosRouter(auth: AuthContext): Router {
  const router = Router();

  router.use((_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });
  router.use(express.json({ limit: "8kb" }));
  router.use(sameSiteOnly(auth));

  const idOf = (value: string): number | null => (/^\d{1,12}$/.test(value) ? Number(value) : null);

  router.get("/", (req, res) => {
    res.json({ promos: listPromos(auth.db, req.user!.id) });
  });

  router.post("/", (req, res) => {
    const promo = parseNewPromo(req.body);
    if (!promo) {
      res.status(400).json({ error: "invalid", message: "Buchmacher und Titel angeben; der Link muss mit https:// beginnen." });
      return;
    }
    const id = addPromo(auth.db, req.user!.id, promo, auth.now());
    if (id === null) {
      res.status(409).json({ error: "too_many", message: `Höchstens ${MAX_OWN} eigene Aktionen.` });
      return;
    }
    res.status(201).json({ id });
  });

  router.delete("/:id", (req, res) => {
    const id = idOf(req.params.id);
    if (id === null || !deletePromo(auth.db, req.user!.id, id)) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    res.status(204).end();
  });

  // { taken: true } marks it taken, { taken: false } takes the mark off.
  router.put("/:id/taken", (req, res) => {
    const id = idOf(req.params.id);
    const taken = (req.body as { taken?: unknown } | undefined)?.taken;
    if (id === null || typeof taken !== "boolean") {
      res.status(400).json({ error: "invalid" });
      return;
    }
    if (!setPromoTaken(auth.db, req.user!.id, id, taken, auth.now())) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    res.status(204).end();
  });

  return router;
}
