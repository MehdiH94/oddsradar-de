import { RawOdds } from "../types";
import { marketKey, playerMarketKey } from "../markets/catalog";
import { MARKET_1X2 } from "./canonical";
import { componentData, componentRequest, GENYBET, NETBET, post, SportncoSite } from "./sportnco";
import { pool } from "./pool";

// Every market of a football or a tennis match at NetBet, mapped onto the
// shared catalog (src/markets/catalog.ts). The match's own page
// (`/evenement/<id>`, its id the listing's) answers the "event_market_list"
// component with all its markets: 69 for a Bundesliga match, 21 for an ATP one
// (real captures of 8/10/2026, tests/scraper/fixtures/sportnco-netbet-event-*.
// json.gz). A market has a type and one bet per line, a bet its title ("Plus ou
// moins de 2.5 buts ?", "... en 1ère mi-temps ?") and its selections, whose
// labels name the teams and the lines: the title says which family it is.
//
// Only half-goal and half-game lines are read ("2.5"): a whole line refunds a
// push, a market the other bookmakers do not offer. A price of 1 is a market
// left open without one. A bet of no family, the three-way handicaps, the
// shots', and the main market (the listing's own) are left out.

const CONCURRENCY = 3;

interface Selection {
  // A suspended outcome of a long list (a score) is a bare {"odds": -1}.
  label?: string;
  odds: number;
}
interface Bet {
  label: string;
  selections: Selection[];
}
interface Context {
  home: string;
  away: string;
}
type Reader = (match: RegExpExecArray, bet: Bet, ctx: Context) => RawOdds[];
type Rule = readonly [label: RegExp, read: Reader];

const isHalfLine = (line: number) => Math.abs(line % 1) === 0.5;
const LINE = "(\\d+(?:\\.\\d+)?)";
const SIGNED = "([+-]?\\d+(?:\\.\\d+)?)";
const HALF = "(?: en (1ère|2ème) mi-temps)?";

// "1ère" is the first half's families ("ht_"), "2ème" the second's ("2h_").
const periodOf = (word: string | undefined) => (word === "1ère" ? "ht_" : word === "2ème" ? "2h_" : "");

// "Borussia Dortmund" is the first team, "Werder Brême" the second, "Nul" the draw.
function sideOf(text: string, ctx: Context): "1" | "2" | "X" | undefined {
  const t = text.trim();
  if (/^nul$/i.test(t)) return "X";
  return t === ctx.home ? "1" : t === ctx.away ? "2" : undefined;
}

const pick = (key: string, bet: Bet, token: (label: string) => string | undefined): RawOdds[] =>
  bet.selections.flatMap((s): RawOdds[] => {
    const selection = typeof s.label === "string" ? token(s.label.trim()) : undefined;
    return selection !== undefined && s.odds > 1 ? [{ market: key, selection, price: s.odds }] : [];
  });

const YES_NO = (label: string) => ({ oui: "yes", non: "no" })[label.toLowerCase() as "oui" | "non"];

// "Plus de 2.5" / "Moins de 2.5" on the line the title gave.
const overUnder = (family: string, line: number, bet: Bet): RawOdds[] =>
  isHalfLine(line)
    ? pick(marketKey(family, line), bet, (label) =>
        /^plus de /i.test(label) ? "over" : /^moins de /i.test(label) ? "under" : undefined
      )
    : [];

// "(-4.5) Borussia Dortmund" / "(+4.5) Werder Brême": a handicap with two
// outcomes, the line the first team's.
function handicapOf(family: string, bet: Bet, ctx: Context): RawOdds[] {
  const parsed = bet.selections.map((s) => {
    const m = /^\(([+-]?\d+(?:\.\d+)?)\) (.+)$/.exec((s.label ?? "").trim());
    return { s, side: m ? sideOf(m[2], ctx) : undefined, line: m ? Number(m[1]) : NaN };
  });
  const home = parsed.find((p) => p.side === "1");
  if (!home || !isHalfLine(home.line)) return [];
  return parsed.flatMap(({ s, side }): RawOdds[] =>
    (side === "1" || side === "2") && s.odds > 1 ? [{ market: marketKey(family, home.line), selection: side, price: s.odds }] : []
  );
}

// "Borussia Dortmund ou Nul": a double chance of two of the three results.
function doubleChanceOf(a: string, b: string, ctx: Context): string | undefined {
  const [x, y] = [sideOf(a, ctx), sideOf(b, ctx)];
  if (!x || !y || x === y) return undefined;
  return ({ "1X": "1X", "12": "12", "2X": "X2" } as Record<string, string>)[[x, y].sort().join("")];
}

// A number of goals: "Pas de but" and "Aucun" are 0, "3 ou +" is "3+".
const countToken = (label: string): string | undefined => {
  if (/^(pas de but|aucun)$/i.test(label)) return "0";
  const more = /^(\d+) ou \+$/.exec(label);
  return more ? `${more[1]}+` : /^\d+$/.test(label) ? label : undefined;
};

const side = (name: string, ctx: Context) => {
  const s = sideOf(name, ctx);
  return s === "1" || s === "2" ? s : undefined;
};

const FOOTBALL: readonly Rule[] = [
  [new RegExp(`^Plus ou moins de ${LINE} buts${HALF} \\?$`), (m, bet) => overUnder(`${periodOf(m[2])}total_goals`, Number(m[1]), bet)],
  [
    new RegExp(`^Plus ou moins de ${LINE} buts pour (.+?)${HALF} \\?`),
    (m, bet, ctx) => {
      const team = side(m[2], ctx);
      return team ? overUnder(`${periodOf(m[3])}team_goals@${team}`, Number(m[1]), bet) : [];
    },
  ],
  [
    new RegExp(`^Handicap \\(${SIGNED}\\) - Qui va gagner (?:le match|la (1ère|2ème) mi-temps) \\?$`),
    (m, bet, ctx) => handicapOf(`${periodOf(m[2])}handicap`, bet, ctx),
  ],
  [
    /^Double Chance(?: - (1ère|2ème) mi-temps)?$/,
    (m, bet, ctx) =>
      pick(`${periodOf(m[1])}double_chance`, bet, (label) => {
        const [a, b] = label.split(" ou ");
        return b === undefined ? undefined : doubleChanceOf(a, b, ctx);
      }),
  ],
  [
    /^Qui va gagner (?:le match|la (1ère|2ème) mi-temps) \? \(remboursé si (?:match )?nul\)$/,
    (m, bet, ctx) => pick(`${periodOf(m[1])}draw_no_bet`, bet, (label) => side(label, ctx)),
  ],
  [
    /^Qui va gagner la (1ère|2ème) mi-temps \?$/,
    (m, bet, ctx) => pick(`${periodOf(m[1])}1X2`, bet, (label) => sideOf(label, ctx)),
  ],
  [new RegExp(`^Les 2 équipes marquent${HALF} \\?$`), (m, bet) => pick(`${periodOf(m[1])}btts`, bet, YES_NO)],
  [
    /^(.+) gagne sans encaisser de but \?$/,
    (m, bet, ctx) => {
      const team = side(m[1], ctx);
      return team ? pick(`win_to_nil@${team}`, bet, YES_NO) : [];
    },
  ],
  [
    new RegExp(`^(.+) n'encaisse pas de but${HALF} \\?$`),
    (m, bet, ctx) => {
      const team = side(m[1], ctx);
      return team ? pick(`${periodOf(m[2])}clean_sheet@${team}`, bet, YES_NO) : [];
    },
  ],
  [
    new RegExp(`^Résultat et plus ou moins de ${LINE} buts$`),
    (m, bet, ctx) => {
      const line = Number(m[1]);
      return isHalfLine(line)
        ? pick(marketKey("result_total", line), bet, (label) => {
            const [team, rest] = label.split(" / ");
            const result = sideOf(team, ctx);
            return result && /^(plus|moins) de /i.test(rest ?? "") ? `${result}&${/^plus/i.test(rest) ? "over" : "under"}` : undefined;
          })
        : [];
    },
  ],
  [
    /^Résultat et les 2 équipes marquent$/,
    (_m, bet, ctx) =>
      pick("result_btts", bet, (label) => {
        const [team, rest] = label.split(" / ");
        const result = sideOf(team, ctx);
        const yn = YES_NO(rest ?? "");
        return result && yn ? `${result}&${yn}` : undefined;
      }),
  ],
  [
    new RegExp(`^Double chance et plus ou moins de ${LINE} buts \\?$`),
    (m, bet, ctx) => {
      const line = Number(m[1]);
      return isHalfLine(line)
        ? pick(marketKey("dc_total", line), bet, (label) => {
            const match = /^(.+) - (.+) \/ (Plus|Moins) de /i.exec(label);
            const chance = match ? doubleChanceOf(match[1], match[2], ctx) : undefined;
            return chance ? `${chance}&${match![3].toLowerCase() === "plus" ? "over" : "under"}` : undefined;
          })
        : [];
    },
  ],
  [
    /^Mi-temps\/Résultat final$/,
    (_m, bet, ctx) =>
      pick("ht_ft", bet, (label) => {
        const [a, b] = label.split(" / ").map((t) => sideOf(t, ctx));
        return a && b ? `${a}/${b}` : undefined;
      }),
  ],
  [
    /^Score(?: de la (1ère|2ème) mi-temps)?$/,
    (m, bet) =>
      pick(`${periodOf(m[1])}correct_score`, bet, (label) => {
        const score = /(\d+)-(\d+)/.exec(label);
        return score ? `${score[1]}-${score[2]}` : /^autres?\b/i.test(label) ? "other" : undefined;
      }),
  ],
  [
    /^Première équipe à marquer \?$/,
    (_m, bet, ctx) => pick("first_team_to_score", bet, (label) => (/^pas de but$/i.test(label) ? "none" : side(label, ctx))),
  ],
  [
    /^Dernière équipe à marquer$/,
    (_m, bet, ctx) => pick("last_team_to_score", bet, (label) => (/^pas de but$/i.test(label) ? "none" : side(label, ctx))),
  ],
  [
    /^Mi-temps avec le plus de buts \?$/,
    (_m, bet) => pick("highest_scoring_half", bet, (label) => ({ "1ère": "1st", "2ème": "2nd", nul: "equal" })[label.toLowerCase() as "nul"]),
  ],
  [/^Nombre de buts marqués \?$/, (_m, bet) => pick("exact_goals", bet, countToken)],
  [/^Nombre de buts marqués en (1ère|2ème) mi-temps \?$/, (m, bet) => pick(`${periodOf(m[1])}exact_goals`, bet, countToken)],
  [
    /^Nombre de buts marqués par (.+) \?$/,
    (m, bet, ctx) => {
      const team = side(m[1], ctx);
      return team ? pick(`team_exact_goals@${team}`, bet, countToken) : [];
    },
  ],
];

const TENNIS: readonly Rule[] = [
  [new RegExp(`^Plus ou moins de ${LINE} jeux \\?$`), (m, bet) => overUnder("total_games", Number(m[1]), bet)],
  [new RegExp(`^Plus ou moins de ${LINE} sets \\?$`), (m, bet) => overUnder("total_sets", Number(m[1]), bet)],
  [new RegExp(`^Set 1 - Plus ou moins de ${LINE} jeux \\?$`), (m, bet) => overUnder("set1_total_games", Number(m[1]), bet)],
  [
    new RegExp(`^Plus ou moins de ${LINE} jeux pour (.+) \\?$`),
    (m, bet, ctx) => {
      const player = side(m[2], ctx);
      return player ? overUnder(`player_games@${player}`, Number(m[1]), bet) : [];
    },
  ],
  [/^Nombre de sets joués \?$/, (_m, bet) => pick("exact_sets", bet, (label) => /^(\d+) sets?$/.exec(label)?.[1])],
  [
    /^Score$/,
    (_m, bet) =>
      pick("set_betting", bet, (label) => {
        const score = /(\d+)-(\d+)/.exec(label);
        return score ? `${score[1]}-${score[2]}` : undefined;
      }),
  ],
  [/^Set ([12]) - Qui va gagner le set \?$/, (m, bet, ctx) => pick(`set${m[1]}_winner`, bet, (label) => side(label, ctx))],
  [
    new RegExp(`^Set 1 - Handicap \\(${SIGNED}\\) - Qui va gagner le plus de jeux \\?$`),
    (_m, bet, ctx) => handicapOf("set1_games_handicap", bet, ctx),
  ],
  [
    new RegExp(`^Handicap Jeux \\(${SIGNED}\\) - Qui va gagner le plus de jeux \\?$`),
    (_m, bet, ctx) => handicapOf("games_handicap", bet, ctx),
  ],
  [new RegExp(`^Handicap Set \\(${SIGNED}\\) - Qui va gagner le match \\?$`), (_m, bet, ctx) => handicapOf("set_handicap", bet, ctx)],
  [
    /^(.+) gagne au moins un set \?$/,
    (m, bet, ctx) => {
      const player = side(m[1], ctx);
      return player ? pick(`win_a_set@${player}`, bet, YES_NO) : [];
    },
  ],
  [
    new RegExp(`^Résultat et plus ou moins de ${LINE} jeux \\?$`),
    (m, bet, ctx) => {
      const line = Number(m[1]);
      return isHalfLine(line)
        ? pick(marketKey("winner_total_games", line), bet, (label) => {
            const [name, rest] = label.split(" / ");
            const player = side(name, ctx);
            return player && /^(plus|moins) de /i.test(rest ?? "") ? `${player}&${/^plus/i.test(rest) ? "over" : "under"}` : undefined;
          })
        : [];
    },
  ],
];

// Basketball (a Euroleague match: 35 markets, 9/10/2026,
// tests/scraper/fixtures/sportnco-netbet-event-basketball.json.gz). The winner,
// overtime included ("Qui va gagner le match ? (prolongations incluses)"), is
// the listing's; "Qui va gagner le match ?" alone is the result in regular
// time, a draw possible. A match's own markets say "(prolongations
// incluses)"; a half's and a quarter's, which leave it out, say nothing.
const OVERTIME = " \\? \\(prolongations incluses\\)$";
// "Azuolas Tubelis - Plus de 13.5": a player's over and under one line.
const playerOverUnder = (family: string, player: string, line: number, bet: Bet): RawOdds[] =>
  isHalfLine(line)
    ? pick(playerMarketKey(family, player, line), bet, (label) => {
        const side = /- (plus|moins) de /i.exec(label)?.[1].toLowerCase();
        return side === "plus" ? "over" : side === "moins" ? "under" : undefined;
      })
    : [];
const HALF_OF = "(1ère|2ème) mi-temps";
// A quarter's, "Quart-temps 1" to "Quart-temps 4": a basketball match's and an
// American football one's alike (no overtime in a quarter).
const QUARTERS: readonly Rule[] = [
  [/^Quart-temps ([1-4]) - Qui va gagner le quart-temps \?$/, (m, bet, ctx) => pick(`q${m[1]}_1X2`, bet, (label) => sideOf(label, ctx))],
  [
    /^Quart-temps ([1-4]) - Qui va gagner le quart-temps \? \(remboursé si (?:match )?nul\)$/,
    (m, bet, ctx) => pick(`q${m[1]}_draw_no_bet`, bet, (label) => side(label, ctx)),
  ],
  [
    new RegExp(`^Quart-temps ([1-4]) - Handicap \\(${SIGNED}\\) - Qui va gagner le quart-temps \\?$`),
    (m, bet, ctx) => handicapOf(`q${m[1]}_spread`, bet, ctx),
  ],
  [new RegExp(`^Quart-temps ([1-4]) - Plus ou moins de ${LINE} points \\?$`), (m, bet) => overUnder(`q${m[1]}_total_points`, Number(m[2]), bet)],
  [
    new RegExp(`^Quart-temps ([1-4]) - Plus ou moins de ${LINE} points pour (.+?) \\?$`),
    (m, bet, ctx) => {
      const team = side(m[3], ctx);
      return team ? overUnder(`q${m[1]}_team_points@${team}`, Number(m[2]), bet) : [];
    },
  ],
];

const BASKETBALL: readonly Rule[] = [
  [/^Qui va gagner le match \?$/, (_m, bet, ctx) => pick(MARKET_1X2, bet, (label) => sideOf(label, ctx))],
  [new RegExp(`^Handicap \\(${SIGNED}\\) - Qui va gagner le match${OVERTIME}`), (_m, bet, ctx) => handicapOf("spread", bet, ctx)],
  [new RegExp(`^Plus ou moins de ${LINE} points${OVERTIME}`), (m, bet) => overUnder("total_points", Number(m[1]), bet)],
  [
    // A team's points, or a player's.
    new RegExp(`^Plus ou moins de ${LINE} points pour (.+?)${OVERTIME}`),
    (m, bet, ctx) => {
      const team = side(m[2], ctx);
      return team ? overUnder(`team_points@${team}`, Number(m[1]), bet) : playerOverUnder("player_points", m[2], Number(m[1]), bet);
    },
  ],
  [
    new RegExp(`^Plus ou moins de ${LINE} passes décisives pour (.+?)${OVERTIME}`),
    (m, bet) => playerOverUnder("player_assists", m[2], Number(m[1]), bet),
  ],
  [
    new RegExp(`^Plus ou moins de ${LINE} rebonds pour (.+?)${OVERTIME}`),
    (m, bet) => playerOverUnder("player_rebounds", m[2], Number(m[1]), bet),
  ],
  [/^Y aura-t-il une prolongation \?$/, (_m, bet) => pick("overtime", bet, YES_NO)],
  // "1ère", "2ème", "3ème", "4ème" or "Nul".
  [
    /^Quart-temps avec le plus de points \?$/,
    (_m, bet) =>
      pick("highest_quarter", bet, (label) => {
        const quarter = /^([1-4])(?:ère|ème)$/.exec(label);
        return quarter ? `q${quarter[1]}` : /^nul$/i.test(label) ? "tie" : undefined;
      }),
  ],
  [
    /^Mi-temps avec le plus de points \?$/,
    (_m, bet) => pick("highest_half", bet, (label) => ({ "1ère": "1st", "2ème": "2nd", nul: "tie" })[label.toLowerCase() as "nul"]),
  ],

  // A half's, "1ère" or "2ème".
  [new RegExp(`^Qui va gagner la ${HALF_OF} \\?$`), (m, bet, ctx) => pick(`${periodOf(m[1])}1X2`, bet, (label) => sideOf(label, ctx))],
  [
    new RegExp(`^Qui va gagner la ${HALF_OF} \\? \\(remboursé si (?:match )?nul\\)$`),
    (m, bet, ctx) => pick(`${periodOf(m[1])}draw_no_bet`, bet, (label) => side(label, ctx)),
  ],
  [
    new RegExp(`^Handicap \\(${SIGNED}\\) - Qui va gagner la ${HALF_OF} \\?$`),
    (m, bet, ctx) => handicapOf(`${periodOf(m[2])}spread`, bet, ctx),
  ],
  [new RegExp(`^Plus ou moins de ${LINE} points en ${HALF_OF} \\?$`), (m, bet) => overUnder(`${periodOf(m[2])}total_points`, Number(m[1]), bet)],
  [
    new RegExp(`^Plus ou moins de ${LINE} points pour (.+?) en ${HALF_OF} \\?$`),
    (m, bet, ctx) => {
      const team = side(m[2], ctx);
      return team ? overUnder(`${periodOf(m[3])}team_points@${team}`, Number(m[1]), bet) : [];
    },
  ],

  ...QUARTERS,
];

// Ice hockey (a DEL match: 28 markets, 14/10/2026,
// tests/scraper/fixtures/sportnco-netbet-event-hockey.json.gz). Every bet says which
// time it is about: "(temps réglementaire)", or "(prolongations incluses)" /
// "(prolongations et TAB inclus)" for the overtime and the shootout. Regular time
// is the plain families, the overtime's are "ot_". A bet that says neither is
// left out. The result of the match is the listing's; its refund on a draw is
// regular time's (its prices are the 1X2's, margin kept).
const HOCKEY_TIME = "\\((temps réglementaire|prolongations(?: et TAB)? inclus(?:es)?)\\)";
const hockeyPrefix = (time: string) => (time.startsWith("prolongations") ? "ot_" : "");
const PERIOD = "Période ([1-3])";

const HOCKEY: readonly Rule[] = [
  [/^Qui va gagner le match \? \(remboursé si (?:match )?nul\)$/, (_m, bet, ctx) => pick("draw_no_bet", bet, (label) => side(label, ctx))],
  [
    /^Double Chance \(temps réglementaire\)$/,
    (_m, bet, ctx) =>
      pick("double_chance", bet, (label) => {
        const [a, b] = label.split(" ou ");
        return b === undefined ? undefined : doubleChanceOf(a, b, ctx);
      }),
  ],
  [
    new RegExp(`^Handicap \\(${SIGNED}\\) - Qui va gagner le match \\? ${HOCKEY_TIME}$`),
    (m, bet, ctx) => handicapOf(`${hockeyPrefix(m[2])}handicap`, bet, ctx),
  ],
  [new RegExp(`^Plus ou moins de ${LINE} buts \\? ${HOCKEY_TIME}$`), (m, bet) => overUnder(`${hockeyPrefix(m[2])}total_goals`, Number(m[1]), bet)],
  [
    // A team's goals, which NetBet words "points" in hockey.
    new RegExp(`^Plus ou moins de ${LINE} (?:buts|points) pour (.+?) \\? ${HOCKEY_TIME}$`),
    (m, bet, ctx) => {
      const team = side(m[2], ctx);
      return team ? overUnder(`${hockeyPrefix(m[3])}team_goals@${team}`, Number(m[1]), bet) : [];
    },
  ],
  [new RegExp(`^${PERIOD} - Qui va gagner la période \\?$`), (m, bet, ctx) => pick(`p${m[1]}_1X2`, bet, (label) => sideOf(label, ctx))],
  [
    new RegExp(`^${PERIOD} - Qui va gagner la période \\? \\(remboursé si (?:match )?nul\\)$`),
    (m, bet, ctx) => pick(`p${m[1]}_draw_no_bet`, bet, (label) => side(label, ctx)),
  ],
  [
    new RegExp(`^${PERIOD} - Handicap \\(${SIGNED}\\) - Qui va gagner la période \\?$`),
    (m, bet, ctx) => handicapOf(`p${m[1]}_handicap`, bet, ctx),
  ],
  [new RegExp(`^${PERIOD} - Plus ou moins de ${LINE} buts \\?$`), (m, bet) => overUnder(`p${m[1]}_total_goals`, Number(m[2]), bet)],
];

// Rugby union (a Champions Cup match: 2 markets, 14/10/2026,
// tests/scraper/fixtures/sportnco-netbet-event-rugby.json.gz): the match's result
// is the listing's, the first half's the only other.
const RUGBY: readonly Rule[] = [
  [/^Qui va gagner la 1ère mi-temps \?$/, (_m, bet, ctx) => pick("ht_1X2", bet, (label) => sideOf(label, ctx))],
];

// American football (an NFL match: 121 markets, 14/10/2026,
// tests/scraper/fixtures/sportnco-netbet-event-american-football.json.gz). A match's
// own bets say "(prolongations incluses)", like basketball's, and so does its second
// half's when it does: the second half is read there only, as the PMU's is (the
// others leave the overtime out, a draw possible). Its touchdowns, field goals and
// players' yards are no family.
const AMERICAN_FOOTBALL: readonly Rule[] = [
  [new RegExp(`^Handicap \\(${SIGNED}\\) - Qui va gagner le match${OVERTIME}`), (_m, bet, ctx) => handicapOf("spread", bet, ctx)],
  [new RegExp(`^Plus ou moins de ${LINE} points${OVERTIME}`), (m, bet) => overUnder("total_points", Number(m[1]), bet)],
  [
    new RegExp(`^Plus ou moins de ${LINE} points pour (.+?)${OVERTIME}`),
    (m, bet, ctx) => {
      const team = side(m[2], ctx);
      return team ? overUnder(`team_points@${team}`, Number(m[1]), bet) : [];
    },
  ],
  [/^Y aura-t-il une prolongation \?$/, (_m, bet) => pick("overtime", bet, YES_NO)],
  ...QUARTERS,
  [
    /^Quart-temps avec le plus de points \?$/,
    (_m, bet) =>
      pick("highest_quarter", bet, (label) => {
        const quarter = /^([1-4])(?:ère|ème)$/.exec(label);
        return quarter ? `q${quarter[1]}` : /^nul$/i.test(label) ? "tie" : undefined;
      }),
  ],

  // The first half's.
  [/^Qui va gagner la 1ère mi-temps \?$/, (_m, bet, ctx) => pick("ht_1X2", bet, (label) => sideOf(label, ctx))],
  [/^Qui va gagner la 1ère mi-temps \? \(remboursé si (?:match )?nul\)$/, (_m, bet, ctx) => pick("ht_draw_no_bet", bet, (label) => side(label, ctx))],
  [new RegExp(`^Handicap \\(${SIGNED}\\) - Qui va gagner la 1ère mi-temps \\?$`), (_m, bet, ctx) => handicapOf("ht_spread", bet, ctx)],
  [new RegExp(`^Plus ou moins de ${LINE} points en 1ère mi-temps \\?$`), (m, bet) => overUnder("ht_total_points", Number(m[1]), bet)],
  [
    new RegExp(`^Plus ou moins de ${LINE} points pour (.+?) en 1ère mi-temps \\?$`),
    (m, bet, ctx) => {
      const team = side(m[2], ctx);
      return team ? overUnder(`ht_team_points@${team}`, Number(m[1]), bet) : [];
    },
  ],

  // The second half's, overtime included.
  [
    /^Qui va gagner la 2ème mi-temps \? \(prolongations incluses, remboursé si (?:match )?nul\)$/,
    (_m, bet, ctx) => pick("2h_draw_no_bet", bet, (label) => side(label, ctx)),
  ],
  [
    new RegExp(`^Handicap \\(${SIGNED}\\) - Qui va gagner la 2ème mi-temps${OVERTIME}`),
    (_m, bet, ctx) => handicapOf("2h_spread", bet, ctx),
  ],
];

interface EventData {
  event?: {
    sport?: { label?: string };
    actors?: { type: string; label: string }[];
    markets?: { bets?: Bet[] }[];
  };
}

// NetBet's name of each sport (the event's `sport.label`, lowercased), and the
// rules for its bets. Handball's titles are football's. The others' (and an answer
// without an event) read nothing.
const RULES_BY_SPORT: Readonly<Record<string, readonly Rule[]>> = {
  football: FOOTBALL,
  basketball: BASKETBALL,
  tennis: TENNIS,
  handball: FOOTBALL,
  "hockey/glace": HOCKEY,
  rugby: RUGBY,
  "foot us": AMERICAN_FOOTBALL,
};

// One match's markets, from the answer to its "event_market_list".
export function readNetbetMarkets(reply: unknown): RawOdds[] {
  const event = (componentData(reply, "event_market_list") as EventData | undefined)?.event;
  const sport = event?.sport?.label?.trim().toLowerCase();
  const rules = sport === undefined ? undefined : RULES_BY_SPORT[sport];
  const home = event?.actors?.find((a) => a.type === "home")?.label.trim();
  const away = event?.actors?.find((a) => a.type === "away")?.label.trim();
  if (!rules || !home || !away) return [];
  const ctx = { home, away };
  return (event?.markets ?? []).flatMap((market) =>
    (market.bets ?? []).flatMap((bet) => {
      try {
        for (const [label, read] of rules) {
          const match = label.exec(bet.label.trim());
          if (match) return read(match, bet, ctx);
        }
      } catch (err) {
        // One malformed bet must not take down the match's other markets.
        console.warn(`[markets:netbet] failed to read "${bet?.label}", skipping it:`, err);
      }
      return [];
    })
  );
}

// The markets of the given matches of a SportNCo site (NetBet, Genybet), by
// their ids: one request each, a few at a time. A match that fails costs only
// its own markets; all of them failing is the bookmaker failing.
export const fetchSportncoMarkets =
  (site: SportncoSite) =>
  async (ids: readonly string[]): Promise<Map<string, RawOdds[]>> => {
    const markets = new Map<string, RawOdds[]>();
    if (ids.length === 0) return markets;
    const read = await pool(ids, CONCURRENCY, async (id) =>
      readNetbetMarkets(await post(site, "component/data", componentRequest(`/evenement/${id}`, "event_market_list")))
    );
    read.forEach((r, i) => {
      if (r.status === "fulfilled") markets.set(ids[i], r.value);
      else console.warn(`[markets:${site.id}] match ${ids[i]} failed, skipping it:`, r.reason);
    });
    if (read.every((r) => r.status === "rejected")) throw new Error(`every ${site.id} match failed`);
    return markets;
  };

export const fetchNetbetMarkets = fetchSportncoMarkets(NETBET);
// Genybet's match pages are NetBet's (same platform, same prices); no capture
// of one exists yet, so its markets are read with NetBet's reader.
export const fetchGenybetMarkets = fetchSportncoMarkets(GENYBET);
