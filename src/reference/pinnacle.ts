import type { OddsApiEvent } from "../scraper/oddsApi";
import { marginProportionalFair } from "./pinnacleFair";

// Pinnacle's prices, the reference of the football 1X2's fair odds (the
// owner's choice, 28/10/2026: "suivre la cote de Pinnacle"): the bookmaker
// that takes winning bettors and the smallest margins, whose prices are the
// market's best guess of each outcome's chances. Read through The Odds API
// (src/scraper/oddsApi.ts), in the same requests as Tipico's and Winamax's,
// at no extra credit: Pinnacle's own site answers the VPS with Cloudflare's
// challenge (`vps-report pinnacle`, 28/10/2026), which is not worked around,
// and its official API refuses Germany (451).

export const ODDS_API_PINNACLE = "pinnacle";

// A football match on Pinnacle, with its full-time 1X2.
export interface PinnacleMatch {
  id: string;
  // Home first: "Bayern Munich", "Borussia Dortmund".
  participants: [string, string];
  startTime: string;
  prices: { home: number; draw: number; away: number };
}

// The Odds API's football events as Pinnacle prices them: its head-to-head
// market, by the teams' names and "Draw". Events of other sports, or without
// Pinnacle's three prices, are left out.
export function pinnacleMatchesOf(events: readonly OddsApiEvent[]): PinnacleMatch[] {
  const matches: PinnacleMatch[] = [];
  for (const event of events) {
    const home = event.home_team?.trim();
    const away = event.away_team?.trim();
    if (!event.id || !home || !away || !event.commence_time || !event.sport_key?.startsWith("soccer_")) continue;
    const h2h = event.bookmakers?.find((b) => b.key === ODDS_API_PINNACLE)?.markets?.find((m) => m.key === "h2h");
    const price = (name: string) => {
      const odds = h2h?.outcomes?.find((o) => o.name?.trim() === name)?.price;
      return typeof odds === "number" && odds > 1 ? odds : undefined;
    };
    const [homePrice, draw, awayPrice] = [price(home), price("Draw"), price(away)];
    if (!homePrice || !draw || !awayPrice) continue;
    matches.push({ id: event.id, participants: [home, away], startTime: event.commence_time, prices: { home: homePrice, draw, away: awayPrice } });
  }
  return matches;
}

// A match's fair odds by PasBet's method (./pinnacleFair.ts), home, draw, away.
export function pinnacleFair({ prices }: PinnacleMatch): { home: number; draw: number; away: number } | null {
  const fair = marginProportionalFair([prices.home, prices.draw, prices.away]);
  return fair ? { home: fair[0], draw: fair[1], away: fair[2] } : null;
}
