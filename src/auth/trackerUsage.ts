import { DatabaseSync } from "node:sqlite";
import { lugasMonth } from "../deposits/deposits";

// How the testers use the site and its bet tracker, for the administration's "Usage" tab:
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

// The testers' activity: accounts seen in the last 24 hours and 7 days (from
// their sessions' last request; a signed-out session is no longer counted),
// accounts created in the last 7 days, and the feedback messages still open.
export interface TesterActivity {
  seenDay: number;
  seenWeek: number;
  newWeek: number;
  openFeedback: number;
}

export interface TrackerUsage {
  month: string;
  surebets: TrackerCounts;
  valueBets: TrackerCounts;
  activity: TesterActivity;
}

const DAY_MS = 24 * 60 * 60 * 1000;

const count = (db: DatabaseSync, sql: string, ...args: string[]) => (db.prepare(sql).get(...args) as { n: number }).n;

export function trackerUsage(db: DatabaseSync, now = new Date()): TrackerUsage {
  const month = lugasMonth(now);
  const since = (days: number) => new Date(now.getTime() - days * DAY_MS).toISOString();
  return {
    month,
    activity: {
      seenDay: count(db, "SELECT COUNT(DISTINCT user_id) AS n FROM sessions WHERE last_seen_at >= ?", since(1)),
      seenWeek: count(db, "SELECT COUNT(DISTINCT user_id) AS n FROM sessions WHERE last_seen_at >= ?", since(7)),
      newWeek: count(db, "SELECT COUNT(*) AS n FROM users WHERE created_at >= ?", since(7)),
      openFeedback: count(db, "SELECT COUNT(*) AS n FROM feedback WHERE done_at IS NULL"),
    },
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

// The usage as lines, for the admins' weekly report (src/alerts/weeklyReport.ts):
// "Activity: 4 seen in 24 h, 9 in 7 days, 2 new in 7 days, 3 feedback open".
export function formatTrackerUsage(u: TrackerUsage): string {
  const counts = (label: string, c: TrackerCounts) =>
    `${label}: ${c.accounts} account${c.accounts === 1 ? "" : "s"}, ${c.held} held, ${c.withStakes} with stakes, ${c.monthResults} results kept in ${u.month}` +
    (c.monthResults > 0 ? ` (${c.monthAccounts} account${c.monthAccounts === 1 ? "" : "s"})` : "");
  const a = u.activity;
  return [
    `Activity: ${a.seenDay} seen in 24 h, ${a.seenWeek} in 7 days, ${a.newWeek} new in 7 days, ${a.openFeedback} feedback open`,
    counts("Surebets", u.surebets),
    counts("Value bets", u.valueBets),
  ].join("\n");
}
