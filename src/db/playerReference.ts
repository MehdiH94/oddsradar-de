import { DatabaseSync } from "node:sqlite";
import { ExchangePlayerMarket, PLAYER_MARKETS, playerReliability } from "../reference/exchange";
import { ExchangePlayer } from "./playerValue";

// The exchange's players' markets of each match and their latest prices
// (src/reference/players.ts): where they are, the fair odds of those
// reliable enough to show next to the bookmakers' prices, their best lays.

const OUR_PLAYER_MARKETS = Object.values(PLAYER_MARKETS);

// A match's players' markets as the exchange lists them now, replacing those
// it listed before: a market it closed goes.
export function savePlayerMarkets(
  db: DatabaseSync,
  eventId: string,
  markets: readonly ExchangePlayerMarket[],
  seenAt: string
): void {
  const insert = db.prepare(
    `INSERT INTO reference_player_markets (event_id, market, market_id, runners, seen_at)
     VALUES (@eventId, @market, @marketId, @runners, @seenAt)`
  );
  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM reference_player_markets WHERE event_id = @eventId").run({ eventId });
    for (const m of markets) {
      insert.run({ eventId, market: m.market, marketId: m.marketId, runners: JSON.stringify(m.runners), seenAt });
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

export function loadPlayerMarkets(db: DatabaseSync, eventIds: readonly string[]): Map<string, ExchangePlayerMarket[]> {
  const byEvent = new Map<string, ExchangePlayerMarket[]>();
  const rows = inChunks(
    db,
    eventIds,
    "SELECT event_id AS eventId, market, market_id AS marketId, runners FROM reference_player_markets WHERE event_id IN",
    {},
    "ORDER BY event_id, market"
  ) as { eventId: string; market: string; marketId: string; runners: string }[];
  for (const row of rows) {
    if (!byEvent.has(row.eventId)) byEvent.set(row.eventId, []);
    byEvent.get(row.eventId)!.push({ market: row.market, marketId: row.marketId, runners: JSON.parse(row.runners) });
  }
  return byEvent;
}

// The players the bookmakers price in a match's players' markets, by our
// spelling (the seed bookmaker's, src/scraper/marketsRun.ts).
export function bookmakerPlayers(db: DatabaseSync, eventId: string): string[] {
  const params: Record<string, string> = { eventId };
  const markets = OUR_PLAYER_MARKETS.map((market, i) => {
    params[`market${i}`] = market;
    return `@market${i}`;
  });
  const rows = db
    .prepare(
      `SELECT DISTINCT selection FROM event_market_odds WHERE event_id = @eventId AND market IN (${markets.join(", ")})
       ORDER BY selection`
    )
    .all(params) as { selection: string }[];
  return rows.map((r) => r.selection);
}

// One runner's prices as read, and what came of them.
export interface PlayerOddsRow {
  runner: string;
  player: string | null;
  back?: number;
  lay?: number;
  backSize?: number;
  laySize?: number;
  fair: number | null;
}

// A players' market's prices, replacing those read before. Inside the
// caller's transaction: a match's markets and their stats are saved at once
// (src/reference/players.ts).
export function savePlayerOdds(
  db: DatabaseSync,
  eventId: string,
  market: string,
  rows: readonly PlayerOddsRow[],
  matched: number,
  scrapedAt: string
): void {
  const insert = db.prepare(
    `INSERT INTO reference_player_odds
       (event_id, market, runner, player, back, lay, back_size, lay_size, fair, matched, scraped_at)
     VALUES (@eventId, @market, @runner, @player, @back, @lay, @backSize, @laySize, @fair, @matched, @scrapedAt)`
  );
  db.prepare("DELETE FROM reference_player_odds WHERE event_id = @eventId AND market = @market").run({ eventId, market });
  for (const r of rows) {
    insert.run({
      eventId,
      market,
      runner: r.runner,
      player: r.player,
      back: r.back ?? null,
      lay: r.lay ?? null,
      backSize: r.backSize ?? null,
      laySize: r.laySize ?? null,
      fair: r.fair,
      matched,
      scrapedAt,
    });
  }
}

export interface PlayerExchangePrices extends ExchangePlayer {
  // Amount matched on the exchange's market, in euros.
  matched: number;
}

// The given events' current exchange prices of their players, as the
// players' value bets use them (src/db/playerValue.ts): their fair odds when
// reliable, their best lay when it has money. Event -> market -> player.
export function loadPlayerExchange(
  db: DatabaseSync,
  eventIds: readonly string[],
  since: string
): Map<string, Map<string, Map<string, PlayerExchangePrices>>> {
  const rows = inChunks(
    db,
    eventIds,
    "SELECT event_id AS eventId, market, player, fair, lay, matched FROM reference_player_odds WHERE event_id IN",
    { since },
    "AND player IS NOT NULL AND scraped_at >= @since"
  ) as { eventId: string; market: string; player: string; fair: number | null; lay: number | null; matched: number }[];
  const byEvent = new Map<string, Map<string, Map<string, PlayerExchangePrices>>>();
  for (const row of rows) {
    if (!byEvent.has(row.eventId)) byEvent.set(row.eventId, new Map());
    const byMarket = byEvent.get(row.eventId)!;
    if (!byMarket.has(row.market)) byMarket.set(row.market, new Map());
    byMarket.get(row.market)!.set(row.player, {
      ...(row.fair !== null ? { fair: row.fair } : {}),
      // (Always with money on it: parsePriceFrames drops empty offers.)
      ...(row.lay !== null ? { lay: row.lay } : {}),
      matched: row.matched,
    });
  }
  return byEvent;
}

// The given events' players whose current exchange prices are as tight as a
// 1X2's (src/reference/exchange.ts, "strict"): event -> market -> players.
export function loadPlayerExchangeLevels(
  db: DatabaseSync,
  eventIds: readonly string[],
  since: string
): Map<string, Map<string, Set<string>>> {
  const rows = inChunks(
    db,
    eventIds,
    `SELECT event_id AS eventId, market, player, back, lay, back_size AS backSize, lay_size AS laySize
     FROM reference_player_odds WHERE event_id IN`,
    { since },
    "AND player IS NOT NULL AND scraped_at >= @since"
  ) as { eventId: string; market: string; player: string; back: number | null; lay: number | null; backSize: number | null; laySize: number | null }[];
  const byEvent = new Map<string, Map<string, Set<string>>>();
  for (const row of rows) {
    const reliability = playerReliability({
      back: row.back ?? undefined,
      lay: row.lay ?? undefined,
      backSize: row.backSize ?? undefined,
      laySize: row.laySize ?? undefined,
    });
    if (!reliability.strict) continue;
    if (!byEvent.has(row.eventId)) byEvent.set(row.eventId, new Map());
    const byMarket = byEvent.get(row.eventId)!;
    if (!byMarket.has(row.market)) byMarket.set(row.market, new Set());
    byMarket.get(row.market)!.add(row.player);
  }
  return byEvent;
}

// The given events' current bookmaker prices in the players' markets: event
// -> market -> bookmaker -> player -> price.
export function loadBookmakerPlayerPrices(
  db: DatabaseSync,
  eventIds: readonly string[],
  since: string
): Map<string, Map<string, Map<string, Map<string, number>>>> {
  const params: Record<string, string> = { since };
  const markets = OUR_PLAYER_MARKETS.map((market, i) => {
    params[`market${i}`] = market;
    return `@market${i}`;
  });
  const rows = inChunks(
    db,
    eventIds,
    "SELECT event_id AS eventId, bookmaker_id AS bookmaker, market, selection, price FROM event_market_odds WHERE event_id IN",
    params,
    `AND market IN (${markets.join(", ")}) AND scraped_at >= @since`
  ) as { eventId: string; bookmaker: string; market: string; selection: string; price: number }[];
  const byEvent = new Map<string, Map<string, Map<string, Map<string, number>>>>();
  for (const row of rows) {
    if (!byEvent.has(row.eventId)) byEvent.set(row.eventId, new Map());
    const byMarket = byEvent.get(row.eventId)!;
    if (!byMarket.has(row.market)) byMarket.set(row.market, new Map());
    const byBookmaker = byMarket.get(row.market)!;
    if (!byBookmaker.has(row.bookmaker)) byBookmaker.set(row.bookmaker, new Map());
    byBookmaker.get(row.bookmaker)!.set(row.selection, row.price);
  }
  return byEvent;
}

// A query's rows over many event ids: SQLite caps a statement's parameters,
// so 500 ids at a time, like countMarkets.
export function inChunks(db: DatabaseSync, ids: readonly string[], select: string, params: Record<string, string>, after = ""): unknown[] {
  const rows: unknown[] = [];
  for (let start = 0; start < ids.length; start += 500) {
    const chunk: Record<string, string> = { ...params };
    const placeholders = ids.slice(start, start + 500).map((id, i) => {
      chunk[`id${i}`] = id;
      return `@id${i}`;
    });
    // One by one: spreading a statement's rows into push's arguments
    // overflows the stack past ~120,000 of them.
    for (const row of db.prepare(`${select} (${placeholders.join(", ")}) ${after}`).all(chunk)) rows.push(row);
  }
  return rows;
}
