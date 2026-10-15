// What the seeded database holds (seed.ts) and the account the specs sign in
// with, in one place so that a spec reads the same names and prices the seed
// writes. Plain constants: no import from src/, so a spec stays light.

import path from "node:path";

export const PORT = Number(process.env.E2E_PORT ?? "3100");
export const BASE_URL = `http://localhost:${PORT}`;

// The account the server creates before the specs run, already confirmed.
export const SEEDED_USER = { email: "e2e@example.com", password: "correct horse battery" };

// The admin the server creates the same way, for the administration spec.
export const SEEDED_ADMIN = { email: "admin-e2e@example.com", password: "correct horse battery" };

// The session of the seeded account (auth.setup.ts), which the specs about
// the data start from. The accounts' and the access specs start signed out.
export const SESSION = path.join(__dirname, ".tmp", "session.json");

// A password for the accounts the specs create themselves (12 characters or more).
export const NEW_PASSWORD = "another long passphrase";

// Ligue 1, in 3 hours. Winamax's 2.2 on the home side beats the exchange's fair
// odds (2.0) by 10%: the one value bet. The best prices of the three outcomes
// (2.2, 3.3, 3.7) add up to a TRJ under 100%: no surebet.
export const VALUE_MATCH = {
  id: "e2e-paris-marseille",
  participants: ["Paris SG", "Marseille"],
  competition: "Ligue 1",
  winamax: { "1": 2.2, X: 3.1, "2": 3.5 },
  betclic: { "1": 2.0, X: 3.3, "2": 3.7 },
  unibet: { "1": 1.9, X: 3.2, "2": 3.6 },
  fair: { "1": 2.0, X: 3.4, "2": 4.0 },
  // Goals over / under 2.5, from two bookmakers: the match has more than its
  // main market, so its page opens.
  totals: { winamax: { over: 1.9, under: 1.9 }, betclic: { over: 1.95, under: 1.85 } },
};

// Ligue 1, in 5 hours. Winamax's 2.6 on the home side, Betclic's 3.8 on the draw
// and 3.0 on the away side add up to 98.1%: a surebet, 1.93 EUR on 100.
export const SUREBET_MATCH = {
  id: "e2e-lyon-lille",
  participants: ["Lyon", "Lille"],
  competition: "Ligue 1",
  winamax: { "1": 2.6, X: 3.0, "2": 2.8 },
  betclic: { "1": 2.2, X: 3.8, "2": 3.0 },
};

// A tennis match: the sport filter has something to filter out.
export const TENNIS_MATCH = {
  id: "e2e-weber-ruiz",
  participants: ["Jonas Weber", "Mateo Ruiz"],
  competition: "ATP Paris",
  winamax: { "1": 1.8, "2": 2.0 },
  betclic: { "1": 1.7, "2": 2.2 },
};

// Ligue 1, in 6 hours. Winamax's 2.1 on the home side beats the fair odds (2.0)
// by 5%: a smaller value bet than the first, so that the list has an order.
export const SECOND_VALUE_MATCH = {
  id: "e2e-nice-lens",
  participants: ["Nice", "Lens"],
  competition: "Ligue 1",
  winamax: { "1": 2.1, X: 3.2, "2": 3.9 },
  betclic: { "1": 2.0, X: 3.3, "2": 3.8 },
  fair: { "1": 2.0, X: 3.5, "2": 4.2 },
};

// The winner of a league, which Unibet and Vbet price: a competition, listed in the
// category of the winners and not among the football matches. Three clubs each
// price add up to over 100% at either bookmaker, and the best prices of the two
// (1.5 and 3.4, 4.2) leave it a TRJ of 83%.
export const COMPETITION_WINNER = {
  id: "e2e-ligue-1-winner",
  title: "Ligue 1 2026/2027",
  competition: "Ligue 1 McDonald's®",
  unibet: { "Paris Saint-Germain": 1.5, "Olympique de Marseille": 3.2, "AS Monaco": 4 },
  vbet: { "Paris Saint-Germain": 1.45, "Olympique de Marseille": 3.4, "AS Monaco": 4.2 },
};

// Ligue 1, in 8 hours: the match the freebets spec converts against the exchange.
// The exchange lays every outcome above the bookmakers' best price (2.0, 3.3,
// 3.6) with money to take, and prices none of them to back: no surebet, and no
// value bet since the fair odds are no lower than those best prices. The one
// seeded match with lay money, so that the exchange mode has something to offer.
export const EXCHANGE_MATCH = {
  id: "e2e-toulouse-nantes",
  participants: ["Toulouse", "Nantes"],
  competition: "Ligue 1",
  winamax: { "1": 2.0, X: 3.2, "2": 3.6 },
  betclic: { "1": 1.95, X: 3.3, "2": 3.5 },
  fair: { "1": 2.05, X: 3.45, "2": 3.7 },
  lay: { "1": 2.06, X: 3.4, "2": 3.7 },
  // The money offered at those lay prices, in EUR.
  laySize: { "1": 30, X: 20, "2": 25 },
};
