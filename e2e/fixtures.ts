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

// Ligue 1, in 3 hours. LeoVegas's 2.2 on the home side beats the exchange's fair
// odds (2.0) by 10%: the one value bet. Its three prices (2.2, 3.1, 3.5) add up
// to a TRJ under 100%: no surebet.
export const VALUE_MATCH = {
  id: "e2e-paris-marseille",
  participants: ["Paris SG", "Marseille"],
  competition: "Ligue 1",
  leovegas: { "1": 2.2, X: 3.1, "2": 3.5 },
  fair: { "1": 2.0, X: 3.4, "2": 4.0 },
  // Goals over / under 2.5: the match has more than its main market, so its
  // page opens.
  totals: { leovegas: { over: 1.9, under: 1.9 } },
};

// Ligue 1, in 5 hours. LeoVegas's 2.6 on the home side, the exchange's 3.8 on
// the draw and 3.0 on the away side (3.716 and 2.94 net of its 3% commission)
// add up to 99.4%: a surebet, 0.62 EUR on 100. Its fair odds are no lower than
// LeoVegas's prices (no value bet), its lay prices too high to lay LeoVegas's.
export const SUREBET_MATCH = {
  id: "e2e-lyon-lille",
  participants: ["Lyon", "Lille"],
  competition: "Ligue 1",
  leovegas: { "1": 2.6, X: 3.0, "2": 2.8 },
  fair: { "1": 2.65, X: 3.85, "2": 3.05 },
  back: { "1": 2.5, X: 3.8, "2": 3.0 },
  lay: { "1": 2.7, X: 3.9, "2": 3.1 },
  // The money offered at those prices, in EUR.
  backSize: { "1": 100, X: 100, "2": 100 },
  laySize: { "1": 100, X: 100, "2": 100 },
};

// A tennis match: the sport filter has something to filter out.
export const TENNIS_MATCH = {
  id: "e2e-weber-ruiz",
  participants: ["Jonas Weber", "Mateo Ruiz"],
  competition: "ATP Paris",
  leovegas: { "1": 1.8, "2": 2.0 },
};

// Ligue 1, in 6 hours. LeoVegas's 2.1 on the home side beats the fair odds (2.0)
// by 5%: a smaller value bet than the first, so that the list has an order.
export const SECOND_VALUE_MATCH = {
  id: "e2e-nice-lens",
  participants: ["Nice", "Lens"],
  competition: "Ligue 1",
  leovegas: { "1": 2.1, X: 3.2, "2": 3.9 },
  fair: { "1": 2.0, X: 3.5, "2": 4.2 },
};

// The winner of a league, which LeoVegas prices: a competition, listed with the
// football matches. Its three clubs' prices leave it a TRJ of 81%.
export const COMPETITION_WINNER = {
  id: "e2e-ligue-1-winner",
  title: "Ligue 1 2026/2027",
  competition: "Ligue 1 McDonald's®",
  leovegas: { "Paris Saint-Germain": 1.5, "Olympique de Marseille": 3.2, "AS Monaco": 4 },
};

// Ligue 1, in 8 hours: the match the freebets spec converts against the exchange.
// The exchange lays every outcome above LeoVegas's price (2.0, 3.2,
// 3.6) with money to take, and prices none of them to back: no surebet, and no
// value bet since the fair odds are no lower than those prices. The one
// seeded match with lay money, so that the exchange mode has something to offer.
export const EXCHANGE_MATCH = {
  id: "e2e-toulouse-nantes",
  participants: ["Toulouse", "Nantes"],
  competition: "Ligue 1",
  leovegas: { "1": 2.0, X: 3.2, "2": 3.6 },
  fair: { "1": 2.05, X: 3.45, "2": 3.7 },
  lay: { "1": 2.06, X: 3.4, "2": 3.7 },
  // The money offered at those lay prices, in EUR.
  laySize: { "1": 30, X: 20, "2": 25 },
};
