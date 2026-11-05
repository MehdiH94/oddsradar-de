import { DatabaseSync } from "node:sqlite";
import { lugasMonth } from "../deposits/deposits";

// How the testers use the bet tracker, for the administration's "Usage" tab:
// counts only, never anyone's bets or amounts. The taken surebets and value
// bets held now (forgotten two days after their match), how many accounts
// hold some and how many have stakes written down, and this month's kept
// results (src/auth/takenSurebets.ts, src/auth/takenValueBets.ts).

export interface TrackerCounts {
  accounts: number;
  held: number;
  withStakes: number;
  // Played this month (Berlin) and kept once forgotten, and by how many accounts.
  monthResults: number;
  monthAccounts: number;
}

export interface TrackerUsage {
  month: string;
  surebets: TrackerCounts;
  valueBets: TrackerCounts;
}

const count = (db: DatabaseSync, sql: string, ...args: string[]) => (db.prepare(sql).get(...args) as { n: number }).n;

export function trackerUsage(db: DatabaseSync, now = new Date()): TrackerUsage {
  const month = lugasMonth(now);
  return {
    month,
    surebets: {
      accounts: count(db, "SELECT COUNT(DISTINCT user_id) AS n FROM user_taken_surebets"),
      held: count(db, "SELECT COUNT(*) AS n FROM user_taken_surebets"),
      withStakes: count(db, "SELECT COUNT(*) AS n FROM user_taken_surebets WHERE stakes IS NOT NULL"),
      monthResults: count(db, "SELECT COUNT(*) AS n FROM user_surebet_results WHERE month = ?", month),
      monthAccounts: count(db, "SELECT COUNT(DISTINCT user_id) AS n FROM user_surebet_results WHERE month = ?", month),
    },
    valueBets: {
      accounts: count(db, "SELECT COUNT(DISTINCT user_id) AS n FROM user_taken_value_bets"),
      held: count(db, "SELECT COUNT(*) AS n FROM user_taken_value_bets"),
      withStakes: count(db, "SELECT COUNT(*) AS n FROM user_taken_value_bets WHERE stake > 0"),
      monthResults: count(db, "SELECT COUNT(*) AS n FROM user_value_bet_results WHERE month = ?", month),
      monthAccounts: count(db, "SELECT COUNT(DISTINCT user_id) AS n FROM user_value_bet_results WHERE month = ?", month),
    },
  };
}
