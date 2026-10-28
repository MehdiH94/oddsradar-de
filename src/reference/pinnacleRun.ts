import { DatabaseSync } from "node:sqlite";
import { getReferenceTargets } from "../db/reference";
import { savePinnacleOdds } from "../db/pinnacle";
import { DEFAULT_ODDS_MAX_AGE_MS } from "../db/repository";
import { REFERENCE_HORIZON_MS } from "./horizon";
import { placeOnExchange } from "./match";
import { PinnacleMatch, pinnacleFair } from "./pinnacle";

// Pinnacle's 1X2 of the football matches of the next 7 days, every reference
// cycle: its matches as The Odds API last gave them (./pinnacle.ts), each of our
// matches found among its matches by the exchange's matcher (./match.ts,
// placeOnExchange: the same team names in English, the same kick-off), and
// the fair odds made of its prices the way PasBet makes them
// (./pinnacleFair.ts). They are the site's fair odds where they are
// fresh (src/db/reference.ts, loadReferences), the exchange's otherwise.

// Pinnacle's matches compared to one of ours: those starting within the
// matcher's widest tolerance of it (an hour), not the thousand others.
const CANDIDATE_WINDOW_MS = 60 * 60 * 1000;

export interface PinnacleCycleOptions {
  matches: () => Promise<PinnacleMatch[]>;
  now?: Date;
  oddsMaxAgeMs?: number;
}

export async function runPinnacleCycle(db: DatabaseSync, opts: PinnacleCycleOptions): Promise<{ targets: number; placed: number }> {
  const now = (opts.now ?? new Date()).getTime();
  const targets = getReferenceTargets(db, {
    from: new Date(now).toISOString(),
    to: new Date(now + REFERENCE_HORIZON_MS).toISOString(),
    oddsSince: new Date(now - (opts.oddsMaxAgeMs ?? DEFAULT_ODDS_MAX_AGE_MS)).toISOString(),
  });
  if (targets.length === 0) return { targets: 0, placed: 0 };
  const matches = await opts.matches();
  if (matches.length === 0) return { targets: targets.length, placed: 0 };
  const scrapedAt = new Date().toISOString();
  // One of Pinnacle's matches is one of ours only.
  const taken = new Set<string>();
  let placed = 0;
  for (const target of targets) {
    const start = Date.parse(target.startTime);
    const candidates = matches.filter((m) => !taken.has(m.id) && Math.abs(Date.parse(m.startTime) - start) <= CANDIDATE_WINDOW_MS);
    const found = placeOnExchange("football", target, candidates);
    if (!found) continue;
    const fair = pinnacleFair(found.match);
    if (!fair) continue;
    const { prices } = found.match;
    const [one, two] = found.homeFirst ? (["home", "away"] as const) : (["away", "home"] as const);
    savePinnacleOdds(
      db,
      target.eventId,
      {
        pinnacleId: found.match.id,
        participants: target.participants,
        price: { "1": prices[one], X: prices.draw, "2": prices[two] },
        fair: { "1": fair[one], X: fair.draw, "2": fair[two] },
      },
      scrapedAt
    );
    taken.add(found.match.id);
    placed++;
  }
  console.log(`[reference:pinnacle] ${targets.length} matches within 7 days, ${matches.length} on Pinnacle, ${placed} priced`);
  return { targets: targets.length, placed };
}
