import { describe, expect, it } from "vitest";
import { pinnacleFair, pinnacleMatchesOf } from "../../src/reference/pinnacle";
import { OddsApiEvent } from "../../src/scraper/oddsApi";

// The Odds API's answer as its documentation shapes it (the-odds-api.com,
// v4 /odds, h2h, decimal), with the prices Pinnacle's site gave Bayern -
// Dortmund on 28/10/2026 (-269, +451, +683).
const BAYERN_DORTMUND: OddsApiEvent = {
  id: "a1b2",
  sport_key: "soccer_germany_bundesliga",
  commence_time: "2026-10-31T17:30:00Z",
  home_team: "Bayern Munich",
  away_team: "Borussia Dortmund",
  bookmakers: [
    {
      key: "tipico_de",
      markets: [{ key: "h2h", outcomes: [{ name: "Bayern Munich", price: 1.33 }, { name: "Borussia Dortmund", price: 7 }, { name: "Draw", price: 5.2 }] }],
    },
    {
      key: "pinnacle",
      markets: [{ key: "h2h", outcomes: [{ name: "Bayern Munich", price: 1.37 }, { name: "Borussia Dortmund", price: 7.83 }, { name: "Draw", price: 5.51 }] }],
    },
  ],
};

describe("Pinnacle's football", () => {
  it("reads Pinnacle's 1X2 of each match out of The Odds API's answer, not the other bookmakers'", () => {
    expect(pinnacleMatchesOf([BAYERN_DORTMUND])).toEqual([
      {
        id: "a1b2",
        participants: ["Bayern Munich", "Borussia Dortmund"],
        startTime: "2026-10-31T17:30:00Z",
        prices: { home: 1.37, draw: 5.51, away: 7.83 },
      },
    ]);
  });

  it("leaves out a match Pinnacle doesn't price fully, and other sports", () => {
    const noDraw: OddsApiEvent = {
      ...BAYERN_DORTMUND,
      bookmakers: [{ key: "pinnacle", markets: [{ key: "h2h", outcomes: [{ name: "Bayern Munich", price: 1.37 }, { name: "Borussia Dortmund", price: 7.83 }] }] }],
    };
    const tipicoOnly: OddsApiEvent = { ...BAYERN_DORTMUND, bookmakers: [BAYERN_DORTMUND.bookmakers![0]] };
    const tennis: OddsApiEvent = { ...BAYERN_DORTMUND, sport_key: "tennis_atp_paris" };
    expect(pinnacleMatchesOf([noDraw, tipicoOnly, tennis])).toEqual([]);
  });

  it("gives a match's fair odds without its margin, the longshot's raised the most", () => {
    const [bayern] = pinnacleMatchesOf([BAYERN_DORTMUND]);
    const fair = pinnacleFair(bayern)!;
    expect(1 / fair.home + 1 / fair.draw + 1 / fair.away).toBeCloseTo(1, 12);
    expect(fair.away / bayern.prices.away).toBeGreaterThan(fair.draw / bayern.prices.draw);
    expect(fair.draw / bayern.prices.draw).toBeGreaterThan(fair.home / bayern.prices.home);
  });
});
