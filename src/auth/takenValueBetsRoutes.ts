import express, { Router } from "express";
import { DatabaseSync } from "node:sqlite";
import { closingPrice } from "../db/closingPrices";
import { AuthContext } from "./context";
import { sameSiteOnly } from "./middleware";
import { MAX_KEY } from "./takenSurebets";
import { deleteTakenValueBet, listTakenValueBets, MAX_TAKEN_VALUE_BETS, monthValueBetResults, parseStake, parseTakenValueBet, saveTakenValueBet, saveValueBetStake } from "./takenValueBets";

// Mounted under /api after requireAuth: req.user is always set here. `odds`,
// the odds' database, gives each started value bet its closing price.
export function takenValueBetsRouter(auth: AuthContext, odds?: DatabaseSync): Router {
  const router = Router();

  router.use((_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });
  router.use(express.json({ limit: "4kb" }));
  router.use(sameSiteOnly(auth));

  router.get("/", (req, res) => {
    const now = auth.now().getTime();
    const taken = listTakenValueBets(auth.db, req.user!.id).map((bet) =>
      odds && Date.parse(bet.startTime) <= now
        ? {
            ...bet,
            closing: closingPrice(odds, bet.eventId, bet.startTime, {
              market: bet.market,
              selection: bet.selection,
              source: bet.bookmaker,
              side: "back",
            }),
          }
        : bet
    );
    // The month's results of the value bets already forgotten: the dashboard
    // adds the played ones it still holds.
    res.json({ taken, results: monthValueBetResults(auth.db, req.user!.id, auth.now()) });
  });

  router.put("/", (req, res) => {
    const bet = parseTakenValueBet(req.body, auth.now());
    if (!bet) {
      res.status(400).json({ error: "invalid", message: "Ungültige Value Bet." });
      return;
    }
    if (!saveTakenValueBet(auth.db, req.user!.id, bet, auth.now())) {
      res.status(409).json({ error: "too_many", message: `Höchstens ${MAX_TAKEN_VALUE_BETS} genommene Value Bets.` });
      return;
    }
    res.status(204).end();
  });

  // Writes down the stake actually placed on a taken value bet.
  router.put("/stake", (req, res) => {
    const body = (req.body ?? {}) as { key?: unknown; stake?: unknown };
    const stake = parseStake(body.stake);
    if (typeof body.key !== "string" || !body.key || body.key.length > MAX_KEY || stake === undefined) {
      res.status(400).json({ error: "invalid", message: "Ungültiger Einsatz." });
      return;
    }
    if (!saveValueBetStake(auth.db, req.user!.id, body.key, stake)) {
      res.status(404).json({ error: "not_found", message: "Diese Value Bet ist nicht genommen." });
      return;
    }
    res.status(204).end();
  });

  router.delete("/", (req, res) => {
    const key = (req.body as { key?: unknown } | undefined)?.key;
    if (typeof key !== "string" || !key || key.length > MAX_KEY) {
      res.status(400).json({ error: "invalid", message: "Ungültige Value Bet." });
      return;
    }
    deleteTakenValueBet(auth.db, req.user!.id, key);
    res.status(204).end();
  });

  return router;
}
