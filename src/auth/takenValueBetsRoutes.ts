import express, { Router } from "express";
import { DatabaseSync } from "node:sqlite";
import { closingPrice } from "../db/closingPrices";
import { AuthContext } from "./context";
import { sameSiteOnly } from "./middleware";
import { MAX_KEY } from "./takenSurebets";
import { deleteTakenValueBet, listTakenValueBets, MAX_TAKEN_VALUE_BETS, parseTakenValueBet, saveTakenValueBet } from "./takenValueBets";

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
    res.json({ taken });
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
