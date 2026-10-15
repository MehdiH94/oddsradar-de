import { RawEvent, RawOdds } from "../types";
import { hasOutrights, isCompetitionWinnerTitle, MARKET_OUTRIGHT, OUTRIGHT_SPORTS } from "./canonical";

// The boundary between a bookmaker's API data and everything shared downstream.
// Both scrapers run every candidate event through this as their last step.
//
// Why it has to exist: matchEvents (src/matcher/match.ts) and
// upsertCanonicalEvents run over ALL bookmakers' events together, outside
// either scraper's own error isolation. So a single malformed event from one
// bookmaker -- a null participant name reaching normalizeName(), an undefined
// competition reaching a NOT NULL column -- throws there and loses every
// bookmaker's data for the cycle, not just the bad one. This is not
// hypothetical: Winamax's feed carries outright markets as "matches" with
// competitor1Name/competitor2Name = null and a 10-runner bet (see
// tests/scraper/fixtures/winamax-outright-snapshot.json, a real capture).
//
// "Exactly two participants" also protects the matcher from itself: its
// participant alignment tries every permutation, which is O(n!) -- ~1.5s at 9
// participants and effectively unbounded well before 20. A many-contestant
// event (an F1 grid, a cycling stage, a tournament-winner market) is not a
// head-to-head event this project compares at all, so it must never reach it.
// If it did, the worker's scheduler would sit behind its overlap guard
// forever, silently freezing every bookmaker's odds.
//
// The one exception is the main bet of a sport without head-to-heads
// (OUTRIGHT_SPORTS: a race, a golf tournament): who wins among N. Its single
// "participant" is the market's title and its competitors are selections of
// MARKET_OUTRIGHT, so the matcher never permutes them (it compares competitor
// lists instead, see src/matcher/match.ts). The same goes for the winner of a
// competition of a sport with head-to-heads (COMPETITION_WINNER_SPORTS: Ligue 1,
// Roland-Garros), provided its title is a winner market's and not another bet's.

export type RawEventCheck = { ok: true; event: RawEvent } | { ok: false; reason: string };

// A golf tournament lists about 160 players; far more is not a real field.
const MAX_OUTRIGHT_COMPETITORS = 400;

// What a winner market's implied probabilities (1 / price) add up to: 1 plus
// the margin, from 1.08 to 2.34 over the outrights of 6/10/2026 (NetBet's
// golf winners 1.9 to 2.3, the widest), and less when only the favourites are
// priced. A golf tournament's Top 5 read as its winner adds up to 5 even at
// its fair prices (Betclic's added up to 6.7 to 7.0 that day), a Top 20 to 20.
const MAX_OUTRIGHT_IMPLIED_TOTAL = 4;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

// A decimal price is the total return per unit staked, so anything <= 1 (or
// non-finite) cannot be a real offered price -- it's a suspended/placeholder
// value or a parse artefact.
function isValidOdds(o: unknown): o is RawOdds {
  if (typeof o !== "object" || o === null) return false;
  const { market, selection, price } = o as Record<string, unknown>;
  return (
    isNonEmptyString(market) &&
    isNonEmptyString(selection) &&
    typeof price === "number" &&
    Number.isFinite(price) &&
    price > 1
  );
}

// Pure check. On success, returns a cleaned copy: odds entries that are not
// real prices are dropped (a suspended outcome among live ones is normal and
// not a reason to lose the event), and startTime is normalized to
// toISOString() form, which the repository's freshness filter relies on when
// it compares start_time as text.
export function checkRawEvent(candidate: RawEvent): RawEventCheck {
  const { sport, competition, startTime, participants, odds } = candidate as unknown as Record<string, unknown>;

  if (!isNonEmptyString(sport)) return { ok: false, reason: "missing sport" };
  if (typeof competition !== "string") return { ok: false, reason: "missing competition" };

  const outright = Array.isArray(participants) && participants.length === 1;
  if (outright && !hasOutrights(sport)) {
    return { ok: false, reason: `winner-among-N market in "${sport}", a sport with no winners among N` };
  }
  if (!outright && (!Array.isArray(participants) || participants.length !== 2)) {
    const count = Array.isArray(participants) ? participants.length : "no";
    return { ok: false, reason: `expected exactly 2 participants, got ${count}` };
  }
  if (!participants.every(isNonEmptyString)) {
    return { ok: false, reason: "participant name missing or not a non-empty string" };
  }
  if (outright && !OUTRIGHT_SPORTS.has(sport) && !isCompetitionWinnerTitle(participants[0])) {
    return { ok: false, reason: `"${participants[0]}" is another bet on a competition, not its winner` };
  }

  if (typeof startTime !== "string") return { ok: false, reason: "missing start time" };
  const start = new Date(startTime);
  if (Number.isNaN(start.getTime())) return { ok: false, reason: `invalid start time "${startTime}"` };

  const validOdds = Array.isArray(odds) ? odds.filter(isValidOdds) : [];
  if (validOdds.length === 0) return { ok: false, reason: "no odds entry with a finite price > 1" };
  if (outright) {
    if (validOdds.some((o) => o.market !== MARKET_OUTRIGHT)) {
      return { ok: false, reason: `winner-among-N odds outside the "${MARKET_OUTRIGHT}" market` };
    }
    if (validOdds.length < 2) return { ok: false, reason: "winner-among-N market with fewer than 2 priced competitors" };
    if (validOdds.length > MAX_OUTRIGHT_COMPETITORS) {
      return { ok: false, reason: `winner-among-N market with ${validOdds.length} competitors` };
    }
    const impliedTotal = validOdds.reduce((sum, o) => sum + 1 / o.price, 0);
    if (impliedTotal > MAX_OUTRIGHT_IMPLIED_TOTAL) {
      return {
        ok: false,
        reason: `winner-among-N market whose implied probabilities add up to ${impliedTotal.toFixed(1)}, another market read as the winner's`,
      };
    }
  }

  return {
    ok: true,
    event: {
      sport,
      competition,
      startTime: start.toISOString(),
      participants: [...participants],
      odds: validOdds,
      ...(isNonEmptyString(candidate.sourceId) ? { sourceId: candidate.sourceId } : {}),
    },
  };
}

const warnedRejections = new Set<string>();

// Returns the cleaned event, or null (after a console.warn) if it must not
// reach the matcher. Never throws.
export function validateRawEvent(candidate: RawEvent, source: string): RawEvent | null {
  const result = checkRawEvent(candidate);
  if (result.ok) return result.event;

  // Warn once per distinct rejected event per process: an outright market
  // stays in a bookmaker's feed for days, and the worker re-fetches it every
  // POLL_INTERVAL_MINUTES.
  let description: string;
  try {
    description = JSON.stringify({
      competition: candidate.competition,
      startTime: candidate.startTime,
      participants: candidate.participants,
    });
  } catch {
    description = "<unserializable event>";
  }
  const warnKey = `${source}|${result.reason}|${description}`;
  if (!warnedRejections.has(warnKey)) {
    warnedRejections.add(warnKey);
    console.warn(`[scraper:${source}] skipping event (${result.reason}): ${description}`);
  }
  return null;
}
