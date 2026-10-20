import type { BookmakersAnswer, ChainView, ExchangeAnswer, MatchView, PlanView } from "./freebetsApi";

// Answers of GET /api/freebets/conversions as the tests of the page stub them: invented, but shaped as the
// server's (src/freebets/conversions.ts).

const match = (id: string, home: string, away: string, prices: MatchView["prices"], sport = "football"): MatchView => ({
  eventId: id,
  sport,
  competition: "Ligue 1",
  startTime: "2099-01-02T19:00:00.000Z",
  participants: [home, away],
  market: "1X2",
  outcomes: [
    { key: "1", label: home },
    { key: "X", label: "Unentschieden" },
    { key: "2", label: away },
  ],
  prices,
});

const bet = (label: string, odds: number, stake: number) => ({ outcomes: label.split(" + "), label, odds, stake, gain: Math.round(stake * (odds - 1) * 100) / 100 });

export const PLAN_ONE: PlanView = {
  rank: 1,
  cash: 31.2,
  used: 52.4,
  rate: 0.5954,
  left: 3.1,
  exact: true,
  oddsAt: "2099-01-01T07:12:00.000Z",
  matches: [match("psg-om", "Paris SG", "Marseille", { leovegas: [2.2, 3.1, 3.5], merkurbets: [2.0, 3.3, 3.7] })],
  bookmakers: [
    { bookmaker: "leovegas", fb: 30, used: 28.4, bets: [bet("Paris SG", 2.2, 12.4), bet("Marseille", 3.5, 16)] },
    { bookmaker: "merkurbets", fb: 25.5, used: 24, bets: [bet("Unentschieden", 3.3, 24)] },
  ],
};

export const PLAN_TWO: PlanView = {
  ...PLAN_ONE,
  rank: 2,
  cash: 28.9,
  used: 55.5,
  rate: 0.5207,
  left: 0,
  exact: false,
  matches: [match("lyon-lille", "Lyon", "Lille", { leovegas: [2.6, 3.0, 2.8], merkurbets: [2.2, 3.8, 3.0] })],
};

export const PLAN_THREE: PlanView = {
  ...PLAN_ONE,
  rank: 3,
  cash: 20.1,
  used: 40,
  rate: 0.503,
  left: 15.5,
  matches: [match("nice-lens", "Nice", "Lens", { leovegas: [2.1, 3.2, 3.9], merkurbets: [2.0, 3.3, 3.8] })],
};

export const BOOKMAKERS_ANSWER: BookmakersAnswer = {
  mode: "bookmakers",
  legs: 1,
  bookmakers: ["leovegas", "merkurbets"],
  total: 55.5,
  eligibleSports: ["football", "tennis"],
  plans: [PLAN_ONE, PLAN_TWO, PLAN_THREE],
  reason: null,
  partial: false,
  computedAt: "2099-01-01T07:12:30.000Z",
};

const step = (rank: number, over: Partial<ChainView["steps"][number]>): ChainView["steps"][number] => ({
  rank,
  eventId: `m${rank}`,
  sport: "football",
  competition: "Ligue 1",
  startTime: "2099-01-02T19:00:00.000Z",
  participants: ["Brest", "Auxerre"],
  market: "1X2",
  selection: "2",
  label: "Auxerre",
  back: 4.6,
  lay: 4.65,
  laySize: 11,
  fb: 14.12,
  layStake: 11,
  cash: 10.67,
  rate: 0.7557,
  liability: 40.15,
  ifWins: { gain: 50.83, pays: 40.15, net: 10.68 },
  ifLoses: { net: 10.67 },
  limited: true,
  oddsAt: "2099-01-01T07:12:00.000Z",
  ...over,
});

export const CHAIN: ChainView = {
  converted: 30,
  leftover: 0,
  cash: 22.05,
  liability: 74.62,
  steps: [
    step(1, {}),
    step(2, { participants: ["Augsbourg", "Hambourg"], selection: "X", label: "Unentschieden", back: 3.9, lay: 3.95, laySize: 9, fb: 12.17, layStake: 9, cash: 8.73, rate: 0.7173, liability: 26.55, ifWins: { gain: 35.29, pays: 26.55, net: 8.74 }, ifLoses: { net: 8.73 } }),
    step(3, { participants: ["Lille", "Lens"], label: "Lens", back: 3.85, lay: 3.9, laySize: 120, fb: 3.71, layStake: 2.73, cash: 2.65, rate: 0.7143, liability: 7.92, ifWins: { gain: 10.57, pays: 7.92, net: 2.65 }, ifLoses: { net: 2.65 }, limited: false }),
  ],
};

export const EXCHANGE_ANSWER: ExchangeAnswer = {
  mode: "exchange",
  bookmaker: "merkurbets",
  fb: 30,
  commission: 0.03,
  eligibleSports: ["football"],
  chain: CHAIN,
  reason: null,
  computedAt: "2099-01-01T07:12:30.000Z",
};
