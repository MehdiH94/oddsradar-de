import express, { Router } from "express";
import { AuthContext } from "./context";
import { sameSiteOnly } from "./middleware";
import { parseFeedback, saveFeedback } from "./feedback";

// A tester's message, at most this many an hour per account: enough to say
// everything, not enough to fill the table.
const MAX_PER_HOUR = 10;

// Mounted under /api after requireAuth: req.user is always set here. The body
// parser and the CSRF check are not global, so this router brings its own.
export function feedbackRouter(auth: AuthContext): Router {
  const router = Router();

  router.use(express.json({ limit: "8kb" }));
  router.use(sameSiteOnly(auth));

  router.post("/", (req, res) => {
    const feedback = parseFeedback(req.body);
    if (!feedback) {
      res.status(400).json({ error: "invalid", message: "Write a message of 2000 characters at most." });
      return;
    }
    const wait = auth.limiter.hit(`feedback:${req.user!.id}`, MAX_PER_HOUR, 60 * 60 * 1000);
    if (wait > 0) {
      res.set("Retry-After", String(wait));
      res.status(429).json({ error: "rate_limited", message: "Too many messages. Try again later." });
      return;
    }
    saveFeedback(auth.db, req.user!.id, feedback, auth.now());
    res.status(201).json({ ok: true });
  });

  return router;
}
