import { marketKey } from "../markets/catalog";
import { fetchEventDetails } from "./exchange";
import { TennisPoint } from "./tennis";

// The reference for a basketball match's handicap and total points, after its
// moneyline (./sports.ts, which the sports cycle prices): the exchange's
// "Handicap" and "Total Points", overtime included like its Moneyline and the
// bookmakers' own, priced like a tennis match's games handicap and total
// (./tennis.ts). Checked on FC Barcelona v BC Zalgiris Kaunas (9/10/2026,
// tests/reference/fixtures/exchange-basketball-*): the exchange lists no other
// market of a basketball match, a Handicap of 72 lines (-35.5 to 35.5) and a
// Total Points of 141 (120.5 to 260.5), each line a runner of its own.

export interface BasketballRunner {
  selectionId: number;
  // The runner's line: a team's own handicap ("FC Barcelona -35.5"), a total's.
  handicap: number;
  side?: "OVER" | "UNDER";
}

export interface BasketballMarket {
  marketId: string;
  type: "HANDICAP" | "COMBINED_TOTAL";
  runners: BasketballRunner[];
}

// The handicap and the total points of an event/details answer.
export function parseBasketballMarkets(body: unknown): BasketballMarket[] {
  const catalogues = (body as { marketCatalogues?: unknown })?.marketCatalogues;
  if (!Array.isArray(catalogues)) return [];
  return catalogues.flatMap((m): BasketballMarket[] => {
    const type = m?.description?.marketType;
    if ((type !== "HANDICAP" && type !== "COMBINED_TOTAL") || typeof m.marketId !== "string" || !Array.isArray(m.runners)) return [];
    const runners = m.runners.flatMap((r: Record<string, unknown>): BasketballRunner[] =>
      typeof r?.selectionId === "number" && typeof r.handicap === "number"
        ? [
            {
              selectionId: r.selectionId,
              handicap: r.handicap,
              ...(r.lineSide === "OVER" || r.lineSide === "UNDER" ? { side: r.lineSide } : {}),
            },
          ]
        : []
    );
    return runners.length > 0 ? [{ marketId: m.marketId, type, runners }] : [];
  });
}

export async function fetchBasketballMarkets(eventId: string): Promise<BasketballMarket[]> {
  return parseBasketballMarkets(await fetchEventDetails(eventId));
}

const isHalf = (line: number) => Number.isFinite(line) && Math.abs(line % 1) === 0.5;

// Each of our outcomes the exchange prices, in our teams' order. `selections`
// are the runners of our "1" and "2" in the moneyline (src/reference/sports.ts,
// placeSportEvent): the handicap's runners have the same ids, whichever side
// the exchange lists the teams on. `only` keeps the lines asked for: the
// exchange lists 72 handicap lines and 141 totals, of which a bookmaker lists
// a dozen.
export function basketballPoints(
  markets: readonly BasketballMarket[],
  selections: Readonly<Record<string, number>>,
  only?: ReadonlySet<string>
): TennisPoint[] {
  const points: TennisPoint[] = [];
  for (const m of markets) {
    for (const r of m.runners) {
      if (!isHalf(r.handicap)) continue;
      let market: string;
      let selection: string;
      if (m.type === "HANDICAP") {
        const team = r.selectionId === selections["1"] ? "1" : r.selectionId === selections["2"] ? "2" : undefined;
        if (!team) continue;
        // The runner's own handicap; ours is the first team's.
        market = marketKey("spread", team === "1" ? r.handicap : -r.handicap);
        selection = team;
      } else if (r.side) {
        market = marketKey("total_points", r.handicap);
        selection = r.side.toLowerCase();
      } else continue;
      if (only && !only.has(market)) continue;
      points.push({ market, selection, marketId: m.marketId, selectionId: r.selectionId, line: r.handicap });
    }
  }
  return points;
}
