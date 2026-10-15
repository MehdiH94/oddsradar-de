import { marketKey } from "../markets/catalog";
import { exchangeFetch } from "./exchangeProxy";
import { TennisMarket, TennisPoint, TennisRunner } from "./tennis";

// The reference for a football match's other markets than its 1X2 (./run.ts)
// and its players' (./players.ts): the exchange's totals, handicaps, both
// teams to score, double chances, scores... read like the tennis markets
// (./tennis.ts): the same points, the same fair odds (tennisPrices). Captured
// on FC Heidenheim v Kaiserslautern, 20 hours before its kick-off (8/10/2026,
// tests/reference/fixtures/exchange-football-*): 33 markets of 28 types, 20
// of them with a family of src/markets/catalog.ts.

const SITE = "https://exch.piwi247.com/customer/";
const API = `${SITE}api/`;
const HEADERS = {
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
  accept: "application/json, text/plain, */*",
  origin: "https://exch.piwi247.com",
  referer: SITE,
};

// The exchange's market types we have a family for. The totals' types carry
// their line: OVER_UNDER_25 is 2.5 goals (the cards' and the corners' end
// otherwise: OVER_UNDER_25_CARDS). A three-way handicap (TEAM_A_1: "Heidenheim
// +1, Kaiserslautern -1, Draw"), the odd or even and the "goal lines" (the
// totals again, at every quarter) are not read; nor is MATCH_ODDS, the
// listing's own market, but for its home runner (homeSelectionId).
const TYPE =
  /^(?:ASIAN_HANDICAP|BOTH_TEAMS_TO_SCORE|CORRECT_SCORE|DOUBLE_CHANCE|DRAW_NO_BET|HALF_TIME|HALF_TIME_SCORE|HALF_TIME_FULL_TIME|MATCH_ODDS_AND_BTTS|MATCH_ODDS_AND_OU_(?:25|35)|OVER_UNDER_\d\d|FIRST_HALF_GOALS_\d\d|TEAM_[AB]_OVER_UNDER_\d\d|TEAM_[AB]_WIN_TO_NIL)$/;

export interface FootballMarkets {
  // The exchange's own names of its teams, the home side first ("FC Heidenheim").
  teams: [string, string];
  // The home side's runner in the match odds: which of our teams it is is told by it.
  homeSelectionId?: number;
  markets: TennisMarket[];
}

export function parseFootballMarkets(body: unknown): FootballMarkets | undefined {
  const b = body as { eventInfo?: { name?: unknown }; marketCatalogues?: unknown };
  const teams = typeof b?.eventInfo?.name === "string" ? b.eventInfo.name.split(" v ").map((t) => t.trim()) : [];
  if (teams.length !== 2 || !Array.isArray(b.marketCatalogues)) return undefined;
  const runnersOf = (m: { runners?: unknown }): TennisRunner[] =>
    (Array.isArray(m.runners) ? m.runners : []).flatMap((r: Record<string, unknown>): TennisRunner[] =>
      typeof r?.selectionId === "number" && typeof r.runnerName === "string"
        ? [
            {
              selectionId: r.selectionId,
              name: r.runnerName,
              handicap: typeof r.handicap === "number" ? r.handicap : 0,
              ...(r.lineSide === "OVER" || r.lineSide === "UNDER" ? { side: r.lineSide } : {}),
            },
          ]
        : []
    );
  let homeSelectionId: number | undefined;
  const markets = b.marketCatalogues.flatMap((m): TennisMarket[] => {
    const type = m?.description?.marketType;
    if (typeof type !== "string" || typeof m.marketId !== "string") return [];
    if (type === "MATCH_ODDS") {
      homeSelectionId = runnersOf(m).find((r) => r.name.trim() === teams[0])?.selectionId;
      return [];
    }
    if (!TYPE.test(type)) return [];
    return [{ marketId: m.marketId, type, name: String(m.marketName ?? ""), runners: runnersOf(m) }];
  });
  return { teams: [teams[0], teams[1]], ...(homeSelectionId === undefined ? {} : { homeSelectionId }), markets };
}

export async function fetchFootballMarkets(eventId: string): Promise<FootballMarkets | undefined> {
  const res = await exchangeFetch(`${API}event/details/${encodeURIComponent(eventId)}`, {
    headers: HEADERS,
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`exchange event ${eventId}: HTTP ${res.status}`);
  return parseFootballMarkets(await res.json());
}

const isHalf = (line: number) => Number.isFinite(line) && Math.abs(line % 1) === 0.5;

// Each of our outcomes the exchange prices, in our teams' order: "1" is the
// event's first team, the exchange's away side when `reversed`.
export function footballPoints(markets: FootballMarkets, reversed: boolean): TennisPoint[] {
  const [home, away] = markets.teams;
  const ours = (side: "A" | "B") => ((side === "A") !== reversed ? "1" : "2");
  // A team's name, whole or cut short (the combinations' runners are cut at 14
  // letters: "Athletic Bilba/Yes"), the draw, as a side.
  const sideOf = (name: string): "A" | "B" | "D" | undefined => {
    const t = name.trim();
    if (/^(the )?draw$/i.test(t)) return "D";
    if (t === home) return "A";
    if (t === away) return "B";
    if (t.length >= 8 && home.startsWith(t) !== away.startsWith(t)) return home.startsWith(t) ? "A" : "B";
    return undefined;
  };
  // A result as our token: "1", "X", "2".
  const result = (side: "A" | "B" | "D" | undefined) => (side === "D" ? "X" : side ? ours(side) : undefined);

  const points: TennisPoint[] = [];
  const add = (market: string, selection: string | undefined, m: TennisMarket, r: TennisRunner, line?: number) => {
    if (selection !== undefined) {
      points.push({ market, selection, marketId: m.marketId, selectionId: r.selectionId, ...(line === undefined ? {} : { line }) });
    }
  };
  const lineOf = (digits: string) => Number(`${digits[0]}.${digits[1]}`);

  for (const m of markets.markets) {
    const total = /^OVER_UNDER_(\d\d)$/.exec(m.type) ?? /^FIRST_HALF_GOALS_(\d\d)$/.exec(m.type);
    const team = /^TEAM_([AB])_OVER_UNDER_(\d\d)$/.exec(m.type);
    const toNil = /^TEAM_([AB])_WIN_TO_NIL$/.exec(m.type);
    const comboTotal = /^MATCH_ODDS_AND_OU_(\d\d)$/.exec(m.type);
    for (const r of m.runners) {
      const name = r.name.trim();
      if (total || team) {
        const [digits, family] = total
          ? [total[1], m.type.startsWith("FIRST_HALF") ? "ht_total_goals" : "total_goals"]
          : [team![2], `team_goals@${ours(team![1] as "A" | "B")}`];
        const side = /^(under|over)\b/i.exec(name)?.[1].toLowerCase();
        add(marketKey(family, lineOf(digits)), side, m, r);
        continue;
      }
      if (toNil) {
        add(`win_to_nil@${ours(toNil[1] as "A" | "B")}`, { yes: "yes", no: "no" }[name.toLowerCase() as "yes" | "no"], m, r);
        continue;
      }
      if (comboTotal) {
        const [who, rest] = name.split("/");
        const token = result(sideOf(who ?? ""));
        const ou = /^(under|over)\b/i.exec(rest ?? "")?.[1].toLowerCase();
        add(marketKey("result_total", lineOf(comboTotal[1])), token && ou ? `${token}&${ou}` : undefined, m, r);
        continue;
      }
      switch (m.type) {
        case "ASIAN_HANDICAP": {
          // The runner's own handicap; ours is the first team's.
          const side = sideOf(name.replace(/\s+[+-]?\d+(\.\d+)?(\s*&\s*[+-]?\d+(\.\d+)?)?$/, ""));
          if ((side !== "A" && side !== "B") || !isHalf(r.handicap)) break;
          const team = ours(side);
          add(marketKey("handicap", team === "1" ? r.handicap : -r.handicap), team, m, r, r.handicap);
          break;
        }
        case "BOTH_TEAMS_TO_SCORE":
          add("btts", { yes: "yes", no: "no" }[name.toLowerCase() as "yes" | "no"], m, r);
          break;
        case "DRAW_NO_BET":
          add("draw_no_bet", result(sideOf(name)), m, r);
          break;
        case "HALF_TIME":
          add("ht_1X2", result(sideOf(name)), m, r);
          break;
        case "DOUBLE_CHANCE": {
          // "Home or Draw" is the exchange's home side and the draw, whoever ours is.
          const chance = { "home or draw": ["A", "D"], "draw or away": ["D", "B"], "home or away": ["A", "B"] }[name.toLowerCase()] as
            | ["A" | "B" | "D", "A" | "B" | "D"]
            | undefined;
          const tokens = chance?.map((s) => result(s));
          const token = tokens ? ({ "1X": "1X", "12": "12", "2X": "X2" } as Record<string, string>)[tokens.sort().join("")] : undefined;
          add("double_chance", token, m, r);
          break;
        }
        case "CORRECT_SCORE":
        case "HALF_TIME_SCORE": {
          const score = /^(\d+)\s*-\s*(\d+)$/.exec(name);
          const family = m.type === "CORRECT_SCORE" ? "correct_score" : "ht_correct_score";
          if (score) add(family, reversed ? `${score[2]}-${score[1]}` : `${score[1]}-${score[2]}`, m, r);
          else if (m.type === "HALF_TIME_SCORE" && /^any unquoted$/i.test(name)) add(family, "other", m, r);
          break;
        }
        case "HALF_TIME_FULL_TIME": {
          const [a, b] = name.split("/").map((t) => result(sideOf(t)));
          add("ht_ft", a && b ? `${a}/${b}` : undefined, m, r);
          break;
        }
        case "MATCH_ODDS_AND_BTTS": {
          const [who, rest] = name.split("/");
          const token = result(sideOf(who ?? ""));
          const yn = { yes: "yes", no: "no" }[(rest ?? "").trim().toLowerCase() as "yes" | "no"];
          add("result_btts", token && yn ? `${token}&${yn}` : undefined, m, r);
          break;
        }
      }
    }
  }
  return points;
}
