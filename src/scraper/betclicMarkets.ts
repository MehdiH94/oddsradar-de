import { decodeFields, fieldDouble, fieldMessage, fieldString, ProtoField } from "./protoWire";
import { fetchBetclicMatchFrame } from "./betclic";
import { RawOdds } from "../types";
import { golfBestOf, marketKey, playerMarketKey, unrecognizedMarketKey } from "../markets/catalog";
import { normalizeName } from "../matcher/normalize";
import { MARKET_1X2 } from "./canonical";

// Every market of a football, tennis or basketball match at Betclic, mapped onto the shared catalog
// (src/markets/catalog.ts). Betclic's match page comes in tabs (Match.categories
// .10: "Le Top", "Résultats", "Joueurs", "Buts", "Score exact"...), each one
// request to GetMatchWithNotification with its id in GetMatchRequest.category_id
// (.3); GetMatchSnapshot, which would return them all, answers "unimplemented"
// (2026-09-29). Captured: tests/scraper/fixtures/markets/betclic-dortmund-werder-*.
//
// Betclic names its markets and outcomes only in French, with the teams'
// names in them ("Total de buts (t. rég) - Borussia Dortmund", "Borussia
// Dortmund ou Nul"), so both are read with the match's own team names: its
// contestants (Match.contestants .12 { name .3, short_name .4 }), in Betclic's
// order. The markets cycle turns them round when the event lists the teams
// the other way.
//
// A market (Market { id .1, name .2, layout .9 }) holds its outcomes one of
// three ways, which its layout tells:
// - a grid, selection_matrix .10 [{ .1 [{ selection .1 }] }] (layout 1, 4);
// - cards by team, split_card_groups .11 [{ name .1, selections .2 }] (2);
// - sub-markets, group_markets .13 [Market], each with its own name ("Match",
//   "1ère MT (seule)", "Équipe à domicile"...) and id (3).
// The listing's main market keeps its first selections in main_selections .16
// (layout 8). Layout 6 splits a market into 10- or 15-minute slices, dozens of
// sub-markets of hundreds of outcomes: left out.

export interface BetclicSelection {
  name: string;
  price: number;
}

// A market with its outcomes: a sub-market's name is its market's and its own.
export interface BetclicLeafMarket {
  id: string;
  name: string;
  selections: BetclicSelection[];
}

export interface BetclicMatchPage {
  contestants: { name: string; shortName: string }[];
  categories: { id: string; name: string }[];
  markets: BetclicLeafMarket[];
}

const find = (fields: ProtoField[], n: number) => fields.find((f) => f.fieldNumber === n);
const all = (fields: ProtoField[], n: number) => fields.filter((f) => f.fieldNumber === n);
const text = (f: ProtoField | undefined) => (f ? fieldString(f) : "");

const LAYOUT_PERIOD_SLICES = 6n;
// Selection.status: 1 is open to bets.
const OPEN = 1n;

// Selection { name .10, odds .12, status .14 }.
function readSelection(fields: ProtoField[]): BetclicSelection | null {
  const name = find(fields, 10);
  const odds = find(fields, 12);
  const status = find(fields, 14);
  if (!name || !odds || (status && status.varint !== OPEN)) return null;
  const price = fieldDouble(odds);
  return price > 1 ? { name: fieldString(name).replace(/\s+/g, " ").trim(), price } : null;
}

// A ladder market's cards, one a player (layout 7, "Nombre de points du
// joueur (paliers)"): .15 { name .1, one .3 { line .1, .2 { selection .1 } } a
// line }. A selection is named by the player and its own, "Kevin Punter + de 9,5".
function readPlayerCards(market: ProtoField[]): BetclicSelection[] {
  return all(market, 15).flatMap((card) => {
    const fields = fieldMessage(card);
    const player = text(find(fields, 1)).replace(/\s+/g, " ").trim();
    return all(fields, 3).flatMap((lineCard) =>
      all(fieldMessage(lineCard), 2).flatMap((row) =>
        all(fieldMessage(row), 1).flatMap((cell) => {
          const selection = readSelection(fieldMessage(cell));
          return selection && player ? [{ ...selection, name: `${player} ${selection.name}` }] : [];
        })
      )
    );
  });
}

function readSelections(market: ProtoField[]): BetclicSelection[] {
  const players = readPlayerCards(market);
  if (players.length > 0) return players;
  const grid = all(market, 10)
    .flatMap((row) => all(fieldMessage(row), 1))
    .map((cell) => find(fieldMessage(cell), 1))
    .filter((f): f is ProtoField => f !== undefined);
  const cards = all(market, 11).flatMap((card) => all(fieldMessage(card), 2));
  const main = all(market, 16);
  const source = grid.length > 0 ? grid : cards.length > 0 ? cards : main;
  return source.map((f) => readSelection(fieldMessage(f))).filter((s): s is BetclicSelection => s !== null);
}

function readLeaves(market: ProtoField[]): BetclicLeafMarket[] {
  const id = find(market, 1)?.varint;
  const name = text(find(market, 2)).replace(/\s+/g, " ").trim();
  if (id === undefined || find(market, 9)?.varint === LAYOUT_PERIOD_SLICES) return [];
  const groups = all(market, 13);
  if (groups.length > 0) {
    return groups.flatMap((g) =>
      readLeaves(fieldMessage(g)).map((leaf) => ({ ...leaf, name: `${name} – ${leaf.name}` }))
    );
  }
  return [{ id: id.toString(), name, selections: readSelections(market) }];
}

// GetMatchResponse { payload .1 { match .1 Match } }.
export function readBetclicMatchPage(frame: Buffer): BetclicMatchPage {
  const payload = find(decodeFields(frame), 1);
  const matchField = payload && find(fieldMessage(payload), 1);
  if (!matchField) return { contestants: [], categories: [], markets: [] };
  const match = fieldMessage(matchField);
  const contestants = all(match, 12).map((c) => {
    const fields = fieldMessage(c);
    return { name: text(find(fields, 3)), shortName: text(find(fields, 4)) };
  });
  const categories = all(match, 10).map((c) => {
    const fields = fieldMessage(c);
    return { id: text(find(fields, 2)), name: text(find(fields, 3)) };
  });
  const markets = [
    ...all(match, 9),
    ...all(match, 11).flatMap((sub) => all(fieldMessage(sub), 3)),
    ...all(match, 25),
  ].flatMap((m) => readLeaves(fieldMessage(m)));
  return { contestants, categories, markets };
}

// --- reading outcomes --------------------------------------------------------

type Team = "1" | "2";

// Which team a name in a market or an outcome is: Betclic writes its own
// name or its short name for it ("Borussia Dortmund", "Dortmund").
class Teams {
  private readonly names: [string, Team][];

  constructor(contestants: { name: string; shortName: string }[]) {
    this.names = contestants
      .slice(0, 2)
      .flatMap((c, i): [string, Team][] => {
        const team = String(i + 1) as Team;
        return [c.name, c.shortName].filter(Boolean).map((n): [string, Team] => [n, team]);
      })
      // Longest first, so a name is never matched by a part of it.
      .sort((a, b) => b[0].length - a[0].length);
  }

  // "Borussia Dortmund" -> "1".
  team(name: string): Team | undefined {
    const n = normalizeName(name);
    return this.names.find(([candidate]) => normalizeName(candidate) === n)?.[1];
  }

  // "1", "2" or "X" for a team or a draw.
  result(name: string): string | undefined {
    return /^(nul|match nul)$/i.test(name.trim()) ? "X" : this.team(name);
  }

  // "Total de buts (t. rég) - Borussia Dortmund" -> "Total de buts (t. rég) - {1}".
  template(marketName: string): string {
    let out = marketName;
    for (const [name, team] of this.names) out = out.split(name).join(`{${team}}`);
    return out;
  }
}

// "1X", "12" or "X2" for "Borussia Dortmund ou Nul", "Dortmund / Werder Brême".
function doubleChance(teams: Teams, a: string, b: string): string | undefined {
  const pair = [teams.result(a), teams.result(b)];
  if (pair.includes(undefined) || pair[0] === pair[1]) return undefined;
  const set = new Set(pair);
  return set.has("X") ? (set.has("1") ? "1X" : "X2") : "12";
}

function number(raw: string): number {
  return Number(raw.replace(",", "."));
}

// "+ de 2,5" -> over 2.5.
function overUnder(name: string): { side: string; line: number } | undefined {
  const m = /^([+-]) de (\d+(?:,\d+)?)$/.exec(name.trim());
  return m ? { side: m[1] === "+" ? "over" : "under", line: number(m[2]) } : undefined;
}

const YES_NO: Record<string, string> = { oui: "yes", non: "no" };

// One market's outcomes: [line when the family has one, canonical outcome].
// (`player` when the market is a player's: his name goes in the key.)
type OutcomeReader = (name: string, teams: Teams) => { line?: number; outcome: string; player?: string } | undefined;

const plain =
  (read: (name: string, teams: Teams) => string | undefined): OutcomeReader =>
  (name, teams) => {
    const outcome = read(name, teams);
    return outcome === undefined ? undefined : { outcome };
  };

const yesNo = plain((name) => YES_NO[name.trim().toLowerCase()]);
const result = plain((name, teams) => teams.result(name));
const team = plain((name, teams) => teams.team(name));
const dc = plain((name, teams) => {
  const [a, b] = name.split(/ ou | \/ /);
  return b === undefined ? undefined : doubleChance(teams, a, b);
});
const overUnderLine: OutcomeReader = (name) => {
  const ou = overUnder(name);
  return ou && { line: ou.line, outcome: ou.side };
};
const firstTeam = plain((name, teams) => (/^pas de but$/i.test(name.trim()) ? "none" : teams.team(name)));
const halves = plain(
  (name) => ({ "1ère mi-temps": "1st", nul: "equal", "2ème mi-temps": "2nd" })[name.trim().toLowerCase()]
);
// "0", "6+".
const goalCount = plain((name) => (/^\d+\+?$/.test(name.trim()) ? name.trim() : undefined));
// A number of sets: "2", "3".
const setCount = plain((name) => (/^\d$/.test(name.trim()) ? name.trim() : undefined));
// "1 - 2", "4+", "Pas de but".
const goalBand = plain((name) => {
  const n = name.trim();
  if (/^pas de but$/i.test(n)) return "0";
  if (/^\d+\+$/.test(n)) return n;
  const m = /^(\d+) - (\d+)$/.exec(n);
  return m ? `${m[1]}-${m[2]}` : undefined;
});
const htFt = plain((name, teams) => {
  const [ht, ft] = name.split(" / ");
  const a = ht && teams.result(ht);
  const b = ft && teams.result(ft);
  return a && b ? `${a}/${b}` : undefined;
});
// "Borussia Dortmund par 2 buts", "... par 3 buts ou +", "Nul".
const margin = plain((name, teams) => {
  if (/^nul$/i.test(name.trim())) return "X";
  const m = /^(.*) par (\d+) buts?( ou \+)?$/.exec(name.trim());
  const t = m && teams.team(m[1]);
  return t ? `${t}:${m[2]}${m[3] ? "+" : ""}` : undefined;
});
// "1 - 0", "Autre".
const score = plain((name) => {
  if (/^autre$/i.test(name.trim())) return "other";
  const m = /^(\d+) - (\d+)$/.exec(name.trim());
  return m ? `${m[1]}-${m[2]}` : undefined;
});
// "1 - 0, 2 - 0 ou 3 - 0", "Borussia Dortmund - Tout autre score", "Nul".
const multiScore = plain((name, teams) => {
  const n = name.trim();
  if (/^nul$/i.test(n)) return "X";
  const other = /^(.*) - Tout autre score$/i.exec(n);
  if (other) {
    const t = teams.team(other[1]);
    return t && `other@${t}`;
  }
  const scores = [...n.matchAll(/(\d+) - (\d+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
  return scores.length > 1
    ? scores
        .sort((a, b) => a[0] - b[0] || a[1] - b[1])
        .map(([h, a]) => `${h}-${a}`)
        .join(",")
    : undefined;
});
// "Borussia Dortmund / Oui".
const resultBtts = plain((name, teams) => {
  const [r, yn] = name.split(" / ");
  const a = r && teams.result(r);
  const b = yn && YES_NO[yn.trim().toLowerCase()];
  return a && b ? `${a}&${b}` : undefined;
});
// "Borussia Dortmund & + de 1,5".
const resultTotal: OutcomeReader = (name, teams) => {
  const [r, total] = name.split(" & ");
  const a = r && teams.result(r);
  const ou = total && overUnder(total);
  return a && ou ? { line: ou.line, outcome: `${a}&${ou.side}` } : undefined;
};
// "Borussia Dortmund / Nul & Oui".
const dcBtts = plain((name, teams) => {
  const [pair, yn] = name.split(" & ");
  const [a, b] = (pair ?? "").split(" / ");
  const d = b === undefined ? undefined : doubleChance(teams, a, b);
  const y = yn && YES_NO[yn.trim().toLowerCase()];
  return d && y ? `${d}&${y}` : undefined;
});
// "Borussia Dortmund / Nul & + de 1,5".
const dcTotal: OutcomeReader = (name, teams) => {
  const [pair, total] = name.split(" & ");
  const [a, b] = (pair ?? "").split(" / ");
  const d = b === undefined ? undefined : doubleChance(teams, a, b);
  const ou = total && overUnder(total);
  return d && ou ? { line: ou.line, outcome: `${d}&${ou.side}` } : undefined;
};
// "Dortmund / Werder Brême marque le premier but", "Nul / Aucune équipe ne marque".
const firstGoalResult = plain((name, teams) => {
  const [r, rest] = name.split(" / ");
  if (rest && /^aucune équipe ne marque$/i.test(rest.trim())) return "none";
  const m = rest && /^(.*) marque le premier but$/i.exec(rest.trim());
  const res = r && teams.result(r);
  const scorer = m && teams.team(m[1]);
  return res && scorer ? `${scorer}>${res}` : undefined;
});
const player = plain((name) => name || undefined);
// "D. Downs / J. Hall", "D. Downs & J. Hall" -> "D. Downs / J. Hall".
const players = plain((name) => {
  const names = name.split(/ [/&] /).map((n) => n.trim());
  return names.length > 1 && names.every(Boolean) ? names.join(" / ") : undefined;
});

// A team's half-goal handicap, as the first team's line:
// "Dortmund gagne de 2 buts ou +" is Dortmund -1.5, "Werder ne perd pas ou
// perd de 1 but exactement" Werder +1.5, "Werder ne perd pas" Werder +0.5.
// "... gagne de 2 buts exactement" is no handicap: it doesn't read. A tennis
// player's games or sets come without their unit: "Alcaraz gagne de 4 ou +".
const handicap: OutcomeReader = (name, teams) => {
  const n = name.trim();
  const wins = /^(.*) gagne de (\d+)(?: buts?)? ou \+$/.exec(n);
  const holds = /^(.*) ne perd pas ou perd de (\d+)(?: buts?)? (?:exactement|ou -)$/.exec(n);
  const draws = /^(.*) ne perd pas$/.exec(n);
  const [team, own] = wins
    ? [teams.team(wins[1]), 0.5 - Number(wins[2])]
    : holds
      ? [teams.team(holds[1]), Number(holds[2]) + 0.5]
      : draws
        ? [teams.team(draws[1]), 0.5]
        : [undefined, 0];
  return team && { line: team === "1" ? own : -own, outcome: team };
};

// A line of a whole number (a total of 174) refunds a push, a market the other
// bookmakers do not offer: it keeps Betclic's name for it.
const halfLines =
  (read: OutcomeReader): OutcomeReader =>
  (name, teams) => {
    const out = read(name, teams);
    return out && (out.line === undefined || !Number.isInteger(out.line)) ? out : undefined;
  };

// The quarter with the most points: "1er QT", "2è QT"..., or "Egalité".
const quarterToken = plain((name) => {
  const quarter = /^([1-4])(?:er|è|e|ème) QT$/i.exec(name.trim());
  return quarter ? `q${quarter[1]}` : /^[ée]galit[ée]$/i.test(name.trim()) ? "tie" : undefined;
});

// "Kevin Punter + de 9,5" / "Kevin Punter - de 9,5": a player's over and under a
// line, in a market for all the players (the ladders have the over alone).
const playerOverUnder: OutcomeReader = (name) => {
  const parsed = /^(.+) ([+-]) de (\d+(?:,\d+)?)$/.exec(name.trim());
  const line = parsed ? number(parsed[3]) : NaN;
  return parsed && !Number.isInteger(line) ? { player: parsed[1].trim(), line, outcome: parsed[2] === "+" ? "over" : "under" } : undefined;
};

// "Barcelone gagne & + de 174,5": the winner and the match's points over a line.
const winnerAndTotalPoints: OutcomeReader = (name, teams) => {
  const [winner, total] = name.split(" & ");
  const won = /^(.*) gagne$/.exec((winner ?? "").trim());
  const team = won && teams.team(won[1]);
  const ou = total && overUnder(total);
  return team && ou && !Number.isInteger(ou.line) ? { line: ou.line, outcome: `${team}&${ou.side}` } : undefined;
};

// "00:00 - 09:59" -> "1-10", "30:00 - MT" -> "31-45", "MT - 59:59" -> "46-60",
// "80:00 - Fin du match" -> "81-90", in bands of `width` minutes only.
const minutes = (width: number) =>
  plain((name) => {
    const n = name.trim();
    if (/^pas de but$/i.test(n)) return "none";
    const [from, to] = n.split(" - ");
    const start = from === "MT" ? 45 : Number(/^(\d+):00$/.exec(from ?? "")?.[1] ?? NaN);
    const end = to === "MT" ? 45 : /^fin du match$/i.test(to ?? "") ? 90 : Number(/^(\d+):59$/.exec(to ?? "")?.[1] ?? NaN) + 1;
    return end - start === width ? `${start + 1}-${end}` : undefined;
  });

// Who scores a penalty: "Dortmund marque un pénalty", "Une des 2 équipes
// marque un pénalty".
const penaltyTeam = plain((name, teams) => {
  const n = name.trim();
  if (/^une des 2 équipes/i.test(n)) return "any";
  const m = /^(.*) marque un pénalty$/i.exec(n);
  return m ? teams.team(m[1]) : undefined;
});
// "Oui" to "a goal of that kind in the match", "both teams score one", "the
// first team does".
const anyYesNo = plain((name) => ({ oui: "any", non: "none" })[name.trim().toLowerCase()]);
const bothYes = plain((name) => (/^oui$/i.test(name.trim()) ? "both" : undefined));
const teamYesNo = (team: Team) => plain((name) => ({ oui: team, non: `no@${team}` })[name.trim().toLowerCase()]);

interface BetclicMapping {
  family: string;
  read: OutcomeReader;
  // The line of a family that has one but whose outcomes don't carry it.
  line?: number;
  // Some of its outcomes belong to the family, the others keep the market's
  // own name: a goal margin's "wins by exactly 2" is no handicap.
  partial?: boolean;
  // Betclic gives this name to two markets: the other one's mapping, tried
  // when this one doesn't read every outcome.
  or?: BetclicMapping;
}

// Betclic market name, teams replaced by {1} and {2} -> catalog family.
// Verified on the Dortmund - Werder Brême capture (tests/scraper/fixtures/markets):
// each maps to the market of the same meaning at Winamax.
const MARKETS: Record<string, BetclicMapping> = {
  "Double chance (t. rég)": { family: "double_chance", read: dc },
  "Double Chance – Match": { family: "double_chance", read: dc },
  "Résultat du match (remboursé si match nul)": { family: "draw_no_bet", read: team },
  "Écart de buts (t. rég)": { family: "handicap", read: handicap, partial: true },
  "Mi-temps / Fin de match": { family: "ht_ft", read: htFt },
  "Marge du Vainqueur": { family: "winning_margin", read: margin },
  "Équipe qui gagne sans prendre de but – Équipe à domicile": { family: "win_to_nil@1", read: yesNo },
  "Équipe qui gagne sans prendre de but – Équipe à l'extérieur": { family: "win_to_nil@2", read: yesNo },
  "{1} gagne chaque mi-temps": { family: "win_both_halves@1", read: yesNo },
  "{2} gagne chaque mi-temps": { family: "win_both_halves@2", read: yesNo },
  "{1} gagne au moins 1 mi-temps": { family: "win_either_half@1", read: yesNo },
  "{2} gagne au moins 1 mi-temps": { family: "win_either_half@2", read: yesNo },

  "Nombre total de buts (t. rég)": { family: "total_goals", read: overUnderLine },
  "Total de buts (t. rég) - {1}": { family: "team_goals@1", read: overUnderLine },
  "Total de buts (t. rég) - {2}": { family: "team_goals@2", read: overUnderLine },
  "Les 2 équipes marquent (t. rég)": { family: "btts", read: yesNo },
  "Nombre exact de buts": { family: "exact_goals", read: goalCount },
  "Nombre exact de but de {1}": { family: "team_exact_goals@1", read: goalCount },
  "Nombre exact de but de {2}": { family: "team_exact_goals@2", read: goalCount },
  "Équipe qui marque (t. rég) – 1er but": { family: "first_team_to_score", read: firstTeam },
  "Équipe qui marque (t. rég) – Dernier but": { family: "last_team_to_score", read: firstTeam },
  "Cage inviolée pour l'équipe – Équipe à domicile": { family: "clean_sheet@1", read: yesNo },
  "Cage inviolée pour l'équipe – Équipe à l'extérieur": { family: "clean_sheet@2", read: yesNo },
  "{1} marque dans chaque mi-temps": { family: "score_both_halves@1", read: yesNo },
  "{2} marque dans chaque mi-temps": { family: "score_both_halves@2", read: yesNo },
  "Mi-temps avec le plus de buts": { family: "highest_scoring_half", read: halves },
  "Nombre total de buts (intervalle 4 choix)": { family: "goal_bands", read: goalBand },
  // Two markets of this name: bands of 10 minutes, and of 15.
  "Minute du premier but": {
    family: "first_goal_minute_10",
    read: minutes(10),
    or: { family: "first_goal_minute_15", read: minutes(15) },
  },
  "But marqué sur penalty": { family: "penalty_goal", read: penaltyTeam, partial: true },
  "Les 2 équipes marquent un pénalty": { family: "penalty_goal", read: bothYes, partial: true },
  "But marqué de la tête dans le match": { family: "header_goal", read: anyYesNo },
  "{1} marque un but de la tête": { family: "header_goal", read: teamYesNo("1") },
  "{2} marque un but de la tête": { family: "header_goal", read: teamYesNo("2") },
  "Les deux équipes marquent un but de la tête": { family: "header_goal", read: bothYes, partial: true },
  "But marqué sur coup-franc direct au cours du match": { family: "free_kick_goal", read: anyYesNo },
  "{1} marque un but sur coup franc direct": { family: "free_kick_goal", read: teamYesNo("1") },
  "{2} marque un but sur coup franc direct": { family: "free_kick_goal", read: teamYesNo("2") },
  "Les deux équipes marquent un but sur coup franc direct": { family: "free_kick_goal", read: bothYes, partial: true },
  "Un remplaçant marque un but (t. rég)": { family: "sub_scores", read: yesNo },

  "Résultat – 1ère MT (seule)": { family: "ht_1X2", read: result },
  "Double Chance – 1ère MT (seule)": { family: "ht_double_chance", read: dc },
  "Résultat du match (remboursé si match nul) – 1ère MT (seule)": { family: "ht_draw_no_bet", read: team },
  "1ère mi-temps (seule) - Écart de buts": { family: "ht_handicap", read: handicap, partial: true },
  // Two markets of this name: over/under lines, and goal bands.
  "1ère mi-temps (seule) - Nombre total de buts": {
    family: "ht_total_goals",
    read: overUnderLine,
    or: { family: "ht_goal_bands", read: goalBand },
  },
  "1ère mi-temps (seule) - Nombre total de buts - {1}": { family: "ht_team_goals@1", read: overUnderLine },
  "1ère mi-temps (seule) - Nombre total de buts - {2}": { family: "ht_team_goals@2", read: overUnderLine },
  "Les 2 équipes marquent – 1ère MT (seule)": { family: "ht_btts", read: yesNo },
  "Nombre exact de buts – 1ère MT (seule)": { family: "ht_exact_goals", read: goalCount },
  "1ère mi-temps (seule) - Cage inviolée pour {1}": { family: "ht_clean_sheet@1", read: yesNo },
  "1ère mi-temps (seule) - Cage inviolée pour {2}": { family: "ht_clean_sheet@2", read: yesNo },
  "1ère mi-temps (seule) - Résultat & Nombre total de buts": { family: "ht_result_total", read: resultTotal },
  "1ère mi-temps (seule) - Double chance & Les 2 équipes marquent": { family: "ht_dc_btts", read: dcBtts },
  "1ère mi-temps (seule) - Résultat & Les 2 équipes marquent": { family: "ht_result_btts", read: resultBtts },
  "1ère équipe à marquer – 1ère MT (seule)": { family: "ht_first_team_to_score", read: firstTeam },
  "Buteur – 1ère MT (seule)": { family: "ht_scorer", read: player },
  "1ère mi-temps - Double Chance Buteur": { family: "ht_scorer_double_chance", read: players },
  "1ère mi-temps - Triple Chance Buteur": { family: "ht_scorer_triple_chance", read: players },
  "1ère mi-temps - les 2 joueurs marquent": { family: "ht_scorers_both", read: players },
  "1ère mi-temps - But de la tête": { family: "ht_header_goal", read: anyYesNo },

  "Résultat – 2ème MT (seule)": { family: "2h_1X2", read: result },
  "Double Chance – 2ème MT (seule)": { family: "2h_double_chance", read: dc },
  "Résultat du match (remboursé si match nul) – 2ème MT (seule)": { family: "2h_draw_no_bet", read: team },
  "2ème mi-temps (seule) - Écart de buts": { family: "2h_handicap", read: handicap, partial: true },
  // Two markets of this name, as in the first half.
  "2ème mi-temps (seule) - Nombre total de buts": {
    family: "2h_total_goals",
    read: overUnderLine,
    or: { family: "2h_goal_bands", read: goalBand },
  },
  "2ème mi-temps (seule) - Nombre total de buts - {1}": { family: "2h_team_goals@1", read: overUnderLine },
  "2ème mi-temps (seule) - Nombre total de buts - {2}": { family: "2h_team_goals@2", read: overUnderLine },
  "Les 2 équipes marquent – 2ème MT (seule)": { family: "2h_btts", read: yesNo },
  "Nombre exact de buts – 2ème MT (seule)": { family: "2h_exact_goals", read: goalCount },
  "2ème mi-temps (seule) - Cage inviolée pour {1}": { family: "2h_clean_sheet@1", read: yesNo },
  "2ème mi-temps (seule) - Cage inviolée pour {2}": { family: "2h_clean_sheet@2", read: yesNo },
  "1ère équipe à marquer – 2ème MT (seule)": { family: "2h_first_team_to_score", read: firstTeam },
  "2ème mi-temps (seule) - Résultat & Nombre total de buts": { family: "2h_result_total", read: resultTotal },
  "2ème mi-temps (seule) - Résultat & Les 2 équipes marquent": { family: "2h_result_btts", read: resultBtts },
  "2ème mi-temps (seule) - Score exact": { family: "2h_correct_score", read: score },
  "Buteur – 2ème MT (seule)": { family: "2h_scorer", read: player },
  "2ème mi-temps - Double Chance Buteur": { family: "2h_scorer_double_chance", read: players },
  "2ème mi-temps - Triple Chance Buteur": { family: "2h_scorer_triple_chance", read: players },
  "2ème mi-temps - les 2 joueurs marquent": { family: "2h_scorers_both", read: players },
  "2ème mi-temps - But de la tête": { family: "2h_header_goal", read: anyYesNo },

  "Score exact (t. rég)": { family: "correct_score", read: score },
  "Score Exact - Multichoix": { family: "multi_score", read: multiScore },
  "1ère mi-temps (seule) - Score exact": { family: "ht_correct_score", read: score },

  "Buteur (t. rég)": { family: "anytime_scorer", read: player },
  "Buteur (tps. rég.) – Premier": { family: "first_scorer", read: player },
  "Buteur (tps. rég.) – Dernier": { family: "last_scorer", read: player },
  "Buteur (t. rég) – 2 buts ou +": { family: "scorer_goals", read: player, line: 2 },
  "Buteur (t. rég) – 3 buts ou +": { family: "scorer_goals", read: player, line: 3 },
  "Buteur (t. rég) – 4 buts ou +": { family: "scorer_goals", read: player, line: 4 },
  "Buteur (t. rég) – & son équipe gagne": { family: "scorer_team_wins", read: player },
  "Buteur – Chaque MT": { family: "scorer_both_halves", read: player },
  "Double chance buteur (t. rég)": { family: "scorer_double_chance", read: players },
  "Triple chance buteur (t. rég)": { family: "scorer_triple_chance", read: players },
  "Les deux joueurs marquent": { family: "scorers_both", read: players },
  "Le duo marque + de 1,5 buts": { family: "duo_goals", read: players, line: 1.5 },
  "Le duo marque + de 2,5 buts": { family: "duo_goals", read: players, line: 2.5 },
  "Le duo marque + de 3,5 buts": { family: "duo_goals", read: players, line: 3.5 },
  "Le trio marque + de 1,5 buts": { family: "trio_goals", read: players, line: 1.5 },
  "Le trio marque + de 2,5 buts": { family: "trio_goals", read: players, line: 2.5 },
  "Le trio marque + de 3,5 buts": { family: "trio_goals", read: players, line: 3.5 },
  "Buteur (t. rég) - Extra gains à chaque but du joueur": { family: "scorer_each_goal", read: player },
  "Décisif (buteur ou passeur dans le t. rég) - Extra gains à chaque action décisive du joueur": {
    family: "decisive_each_action",
    read: player,
  },
  "Passeur décisif (t. rég) - Extra gains à chaque passe décisive du joueur": { family: "assist_each", read: player },
  "Joueur décisif (buteur ou passeur décisif dans le t. rég) – 1 fois ou +": { family: "decisive_player", read: player },
  "Joueur décisif (buteur ou passeur décisif dans le t. rég) – 2 fois ou +": {
    family: "decisive_player_times",
    read: player,
    line: 2,
  },
  "Joueur décisif (buteur ou passeur décisif dans le t. rég) – 3 fois ou +": {
    family: "decisive_player_times",
    read: player,
    line: 3,
  },
  "Double chance décisif (Buteur ou passeur décisif dans le t. rég)": { family: "decisive_double_chance", read: players },
  "Double chance - Passeur décisif": { family: "assist_double_chance", read: players },
  "Triple chance - Passeur décisif": { family: "assist_triple_chance", read: players },

  "Résultat & les 2 équipes marquent": { family: "result_btts", read: resultBtts },
  "Résultat & Nombre total de buts": { family: "result_total", read: resultTotal },
  "Double chance & les deux équipes marquent": { family: "dc_btts", read: dcBtts },
  "Double chance & nombre de buts": { family: "dc_total", read: dcTotal },
  "Résultat & 1ère équipe à marquer": { family: "first_goal_result", read: firstGoalResult },

  // Tennis, the players for {1} and {2}. Verified on the De Minaur -
  // Hurkacz, Alcaraz - Munar and Lehecka - Vacherot captures (4/10/2026,
  // tests/scraper/fixtures/markets/betclic-tennis-*). Betclic's aces are
  // "+ de" only.
  "Écart de jeux": { family: "games_handicap", read: handicap, partial: true },
  "Écart de sets": { family: "set_handicap", read: handicap, partial: true },
  "Vainqueur du 1er set / Vainqueur du match": { family: "set1_match", read: htFt },
  "Résultat du match & Nombre total de jeux": { family: "winner_total_games", read: resultTotal },
  "Score final (sets)": { family: "set_betting", read: score },
  "Nombre de sets": { family: "total_sets", read: overUnderLine },
  "Nombre total de sets": { family: "exact_sets", read: setCount },
  "{1} gagne au moins 1 set": { family: "win_a_set@1", read: yesNo },
  "{2} gagne au moins 1 set": { family: "win_a_set@2", read: yesNo },
  "Tie-break dans le match": { family: "tiebreak", read: yesNo },
  "Une bulle dans le match (6-0 ou 0-6)": { family: "bagel", read: yesNo },
  "Nombre total de jeux": { family: "total_games", read: overUnderLine },
  "{1} - Nombre total de jeux gagnés": { family: "player_games@1", read: overUnderLine },
  "{2} - Nombre total de jeux gagnés": { family: "player_games@2", read: overUnderLine },
  "Vainqueur du set – 1er set": { family: "set1_winner", read: team },
  "Vainqueur du set – 2ème set": { family: "set2_winner", read: team },
  "1er set - Écart de jeux": { family: "set1_games_handicap", read: handicap, partial: true },
  "1er set - Nombre total de jeux": { family: "set1_total_games", read: overUnderLine },
  "1er set - Score exact": { family: "set1_correct_score", read: score },
  "Nombre total d'aces dans le match": { family: "total_aces", read: overUnderLine },
  "{1} - Nombre total d'aces": { family: "player_aces@1", read: overUnderLine },
  "{2} - Nombre total d'aces": { family: "player_aces@2", read: overUnderLine },
  "Qui inscrira le plus d'aces ?": { family: "most_aces", read: result },
  "Premier joueur à réussir un break": { family: "first_break", read: team },
  "Nombre total de breaks": { family: "total_breaks", read: overUnderLine },
  "{1} - Nombre total de breaks": { family: "player_breaks@1", read: overUnderLine },
  "{2} - Nombre total de breaks": { family: "player_breaks@2", read: overUnderLine },

  // Basketball, the teams for {1} and {2}. Verified on the Barcelone - Zalgiris
  // Kaunas capture (9/10/2026, tests/scraper/fixtures/markets/betclic-barcelone-zalgiris-*).
  // The result in regular time, a draw possible; the winner, overtime
  // included, is the listing's. A title says when it is regular time ("tps
  // reg.") or leaves overtime out ("prolong. non incluses"): none of the
  // others does, a match's own markets are overtime included.
  "Résultat du match (tps reg.)": { family: MARKET_1X2, read: result },
  // "Barcelone gagne de 13 ou +" is Barcelone -12.5, "Zalgiris ne perd pas ou
  // perd de 12 ou -" Zalgiris +12.5: the margin as a handicap.
  "Écart de points entre les équipes": { family: "spread", read: handicap, partial: true },
  "Nombre total de points": { family: "total_points", read: halfLines(overUnderLine) },
  "Nombre total de points - {1}": { family: "team_points@1", read: halfLines(overUnderLine) },
  "Nombre total de points - {2}": { family: "team_points@2", read: halfLines(overUnderLine) },
  "Vainqueur du match & Nombre total de points": { family: "winner_total", read: winnerAndTotalPoints },
  "Prolongations (Oui/Non)": { family: "overtime", read: yesNo },
  "Mi-temps / Fin match": { family: "ht_ft", read: htFt },
  "Quart-temps le plus prolifique": { family: "highest_quarter", read: quarterToken },

  // The players': a market for all of them, "Nom + de 9,5" and "Nom - de 9,5".
  "Nombre de points du joueur (plus/moins)": { family: "player_points", read: playerOverUnder },
  "Nombre de points du joueur (paliers)": { family: "player_points", read: playerOverUnder },
  "Nombre de passes décisives du joueur (paliers)": { family: "player_assists", read: playerOverUnder },
  "Nombre de rebonds du joueur (paliers)": { family: "player_rebounds", read: playerOverUnder },
  "Nombre de paniers à 3 points du joueur": { family: "player_threes", read: playerOverUnder },
  "Nombre total de points + rebonds": { family: "player_pr", read: playerOverUnder },
  "Nombre total de points + passes": { family: "player_pa", read: playerOverUnder },
  "Nombre total de passes + rebonds": { family: "player_ra", read: playerOverUnder },
  "Meilleur marqueur du match": { family: "top_scorer", read: player },
  "Joueur - Double Double": { family: "double_double", read: player },

  // A half's and a quarter's. "Vainqueur" is the refund on a draw: the result
  // beside it has the draw.
  "1ère mi-temps - Résultat": { family: "ht_1X2", read: result },
  "1ère mi-temps - Vainqueur": { family: "ht_draw_no_bet", read: team },
  "1ère mi-temps - Écart de points": { family: "ht_spread", read: handicap, partial: true },
  "1ère mi-temps - Nombre total de points": { family: "ht_total_points", read: halfLines(overUnderLine) },
  "1ère mi-temps - Nombre total de Points - {1}": { family: "ht_team_points@1", read: halfLines(overUnderLine) },
  "1ère mi-temps - Nombre total de Points - {2}": { family: "ht_team_points@2", read: halfLines(overUnderLine) },
  "2ème mi-temps - Résultat": { family: "2h_1X2", read: result },
  "2ème mi-temps - Vainqueur": { family: "2h_draw_no_bet", read: team },
  "2ème mi-temps - Écart de points": { family: "2h_spread", read: handicap, partial: true },
  "2ème mi-temps - Nombre total de points": { family: "2h_total_points", read: halfLines(overUnderLine) },
  "2ème mi-temps - Nombre total de Points - {1}": { family: "2h_team_points@1", read: halfLines(overUnderLine) },
  "2ème mi-temps - Nombre total de Points - {2}": { family: "2h_team_points@2", read: halfLines(overUnderLine) },
  ...Object.fromEntries(
    (["1er", "2è", "3è", "4è"] as const).flatMap((ordinal, i): [string, BetclicMapping][] => {
      const q = `q${i + 1}_`;
      return [
        [`${ordinal} QT - Résultat`, { family: `${q}1X2`, read: result }],
        [`${ordinal} QT - Vainqueur`, { family: `${q}draw_no_bet`, read: team }],
        [`${ordinal} QT - Écart de points`, { family: `${q}spread`, read: handicap, partial: true }],
        [`${ordinal} QT - Nombre total de points`, { family: `${q}total_points`, read: halfLines(overUnderLine) }],
        [`${ordinal} QT - Nombre total de Points - {1}`, { family: `${q}team_points@1`, read: halfLines(overUnderLine) }],
        [`${ordinal} QT - Nombre total de Points - {2}`, { family: `${q}team_points@2`, read: halfLines(overUnderLine) }],
      ];
    })
  ),
};

// The match result, a tennis match's winner: the listing's own cycle keeps
// it fresh (./betclic.ts).
const LEFT_TO_THE_LISTING = new Set(["Résultat du match (t. rég)", "Vainqueur du match", "Vainqueur Compétition"]);

// A golf tournament's page has no contestants, and a market of several
// winners per title: "Top 5", "Leader après la manche 1", "Meilleur athlète
// Américain" (6/10/2026,
// tests/scraper/fixtures/markets/betclic-golf-*).
function golfMarketOf(title: string): string | undefined {
  const top = /^top (\d+)$/i.exec(title.trim());
  if (top) return marketKey("golf_top", Number(top[1]));
  const round = /^leader apr[èe]s la manche (\d+)$/i.exec(title.trim());
  return round ? marketKey("golf_round_leader", Number(round[1])) : golfBestOf(title);
}

const MAPPINGS = new Map(Object.entries(MARKETS).map(([name, m]) => [name.toLowerCase(), m]));

// A combination of three bets at a boosted price, on a tennis match's top
// page, under the name of a real market ("Tie-break dans le match": "Au moins
// un tie-break / Les 2 joueurs gagnent 1 set / J. Lehecka gagne 6-3 ou 6-4
// dans le 1er set", 4/10/2026): left out, it is no market.
const BOOSTED_COMBO_ID = "1";

// Every open price of the match's markets, in Betclic's team order, from the
// pages of its tabs. A market in several tabs counts once, and so does one
// Betclic lists twice under two ids with the same prices ("Écart de buts" on
// the default page and in "Résultats"); one no family covers keeps Betclic's
// names for it and its outcomes.
export function readBetclicMarkets(pages: readonly BetclicMatchPage[]): RawOdds[] {
  const contestants = pages.find((p) => p.contestants.length >= 2)?.contestants ?? [];
  const teams = new Teams(contestants);
  const seen = new Set<string>();
  const unrecognizedNames = new Set<string>();
  const odds: RawOdds[] = [];

  for (const leaf of pages.flatMap((p) => p.markets)) {
    const content = `${leaf.name}|${leaf.selections.map((s) => `${s.name}=${s.price}`).join("|")}`;
    if (seen.has(leaf.id) || seen.has(content) || LEFT_TO_THE_LISTING.has(leaf.name) || leaf.id === BOOSTED_COMBO_ID) continue;
    seen.add(leaf.id);
    seen.add(content);
    if (leaf.selections.length === 0) continue;

    const golf = contestants.length === 0 ? golfMarketOf(leaf.name) : undefined;
    if (golf) {
      for (const s of leaf.selections) odds.push({ market: golf, selection: s.name, price: s.price });
      continue;
    }

    const { mapped, rest } = readLeaf(MAPPINGS.get(teams.template(leaf.name).toLowerCase()), leaf.selections, teams);
    odds.push(...mapped);
    if (rest.length === 0) continue;
    // Two markets can share a name (Betclic's second "Minute du premier but"
    // if its bands ever changed): the second one is numbered rather than
    // merged into the first.
    let name = leaf.name;
    for (let n = 2; unrecognizedNames.has(name.toLowerCase()); n++) name = `${leaf.name} (${n})`;
    unrecognizedNames.add(name.toLowerCase());
    const market = unrecognizedMarketKey("betclic", name);
    for (const s of rest) odds.push({ market, selection: s.name, price: s.price });
  }
  return odds;
}

// A market's outcomes read with the first of its mappings that fits, and
// those left for its own name. A mapping fits when every outcome reads: a
// market whose outcomes don't all match the expected shape is not the one
// the mapping is about. A partial one fits when some do.
function readLeaf(
  mapping: BetclicMapping | undefined,
  selections: BetclicSelection[],
  teams: Teams
): { mapped: RawOdds[]; rest: BetclicSelection[] } {
  for (let m = mapping; m; m = m.or) {
    const read = selections.map((s) => ({ s, r: m.read(s.name, teams) }));
    const fits = read.filter(({ r }) => r !== undefined);
    if (fits.length === read.length || (m.partial && fits.length > 0)) {
      return {
        mapped: fits.map(({ s, r }) => ({
          market:
            r!.player === undefined ? marketKey(m.family, r!.line ?? m.line) : playerMarketKey(m.family, r!.player, r!.line ?? m.line),
          selection: r!.outcome,
          price: s.price,
        })),
        rest: read.filter(({ r }) => r === undefined).map(({ s }) => s),
      };
    }
  }
  return { mapped: [], rest: selections };
}

// The tabs worth reading: "Le Top" repeats the others' main markets and is the
// page every request returns first anyway; "⚡ Fast" holds 10- and
// 15-minute slices only (layout 6, left out), 250 KB of them.
const SKIPPED_TABS = new Set(["ca_ftb_top", "ca_ftb_ft", "ca_ten_top"]);

// One Betclic match's markets: its default page, which lists its tabs, then
// each tab. A tab that fails fails the match: its prices replace the
// previous ones (saveMarketOdds), and a tab missing would drop its markets.
async function fetchBetclicMatchMarkets(matchId: string): Promise<RawOdds[]> {
  const first = readBetclicMatchPage(await fetchBetclicMatchFrame(BigInt(matchId)));
  const pages = [first];
  for (const tab of first.categories) {
    if (SKIPPED_TABS.has(tab.id)) continue;
    pages.push(readBetclicMatchPage(await fetchBetclicMatchFrame(BigInt(matchId), tab.id)));
  }
  return readBetclicMarkets(pages);
}

// Matches asked at the same time: about 5 requests of 0.4 s each per match
// (2026-09-29), so 250 matches take about 3 minutes.
const CONCURRENT_MATCHES = 3;

// The markets of the given Betclic matches. A match that fails costs only
// that match.
export async function fetchBetclicMarkets(matchIds: readonly string[]): Promise<Map<string, RawOdds[]>> {
  const byMatch = new Map<string, RawOdds[]>();
  let next = 0;
  async function worker() {
    while (next < matchIds.length) {
      const matchId = matchIds[next++];
      try {
        byMatch.set(matchId, await fetchBetclicMatchMarkets(matchId));
      } catch (err) {
        console.warn(`[markets:betclic] no markets for match ${matchId}:`, err);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENT_MATCHES, matchIds.length) }, worker));
  return byMatch;
}
