import { Router } from "express";
import { ttlPromiseCache } from "../api/cache";
import { AuthContext } from "../auth/context";
import { ConversionAnswer, ConversionsService, parseRequest } from "./conversions";
import { ComputeError } from "./pool";
import { getWallet } from "./wallet";

// How many requests an account may make in a minute. The page asks again when
// one of its settings changes (a debounced click), a few times a minute at most.
const MAX_PER_MINUTE = 60;
// How many different calculations of one account may run at once: the ones past
// it would only wait in the worker's queue, ahead of other accounts' requests.
const MAX_RUNNING = 2;

class TooManyRunning extends Error {}

export interface ConversionsRouterOptions {
  auth: AuthContext;
  service: ConversionsService;
  // How long an answer is reused for the same wallet and settings (ms); 0 keeps none.
  cacheMs: number;
}

// GET /api/freebets/conversions, mounted under /api after requireAuth: req.user
// is always set, and the wallet is always that account's own, read here and
// never taken from the request.
export function conversionsRouter({ auth, service, cacheMs }: ConversionsRouterOptions): Router {
  const router = Router();
  const cached = ttlPromiseCache<ConversionAnswer>(cacheMs);
  const running = new Map<string, number>();

  router.use((_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });

  router.get("/", async (req, res, next) => {
    const request = parseRequest(req.query);
    if ("error" in request) {
      res.status(400).json({ error: "invalid", message: request.error });
      return;
    }
    const userId = req.user!.id;
    const wait = auth.limiter.hit(`freebets:${userId}`, MAX_PER_MINUTE, 60_000);
    if (wait > 0) {
      res.set("Retry-After", String(wait));
      res.status(429).json({ error: "rate_limited", message: "Zu viele Anfragen. Versuch es gleich noch einmal." });
      return;
    }

    const wallet = getWallet(auth.db, userId);
    const compute = async () => {
      const count = running.get(userId) ?? 0;
      if (count >= MAX_RUNNING) throw new TooManyRunning();
      running.set(userId, count + 1);
      try {
        return await service.compute(wallet, request);
      } finally {
        const left = (running.get(userId) ?? 1) - 1;
        if (left > 0) running.set(userId, left);
        else running.delete(userId);
      }
    };
    try {
      // The answer depends on the wallet and the settings only: accounts that hold the same share it.
      res.json(await cached(JSON.stringify([wallet, request]), compute));
    } catch (err) {
      if (err instanceof TooManyRunning) {
        res.set("Retry-After", "2");
        res.status(429).json({ error: "rate_limited", message: "Zu viele Berechnungen gleichzeitig. Versuch es gleich noch einmal." });
      } else if (err instanceof ComputeError && err.code === "busy") {
        res.set("Retry-After", "2");
        res.status(503).json({ error: "busy", message: "Die Berechnung ist gerade stark ausgelastet. Versuch es gleich noch einmal." });
      } else if (err instanceof ComputeError) {
        console.error("[freebets]", err);
        res.status(503).json({ error: "unavailable", message: "Die Berechnung wurde nicht abgeschlossen. Versuch es gleich noch einmal." });
      } else {
        next(err);
      }
    }
  });

  return router;
}
