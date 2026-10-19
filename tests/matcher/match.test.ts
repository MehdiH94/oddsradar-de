import { describe, it, expect } from "vitest";
import { alignCompetitors, bySeedOrder, keepsSidesOrder, matchEvents } from "../../src/matcher/match";
import { RawEvent } from "../../src/types";

function event(overrides: Partial<RawEvent>): RawEvent {
  return {
    sport: "football",
    competition: "Ligue 1",
    startTime: "2026-09-21T19:00:00.000Z",
    participants: ["Olympique de Marseille", "AS Monaco"],
    odds: [{ market: "1X2", selection: "1", price: 2.1 }],
    ...overrides,
  };
}

describe("matchEvents", () => {
  it("merges the same event across bookmakers despite minor spelling differences", () => {
    const result = matchEvents({
      winamax: [event({ participants: ["Olympique de Marseille", "AS Monaco"] })],
      betclic: [event({ participants: ["Olympique Marseille", "Monaco"] })],
    });

    expect(result).toHaveLength(1);
    expect(Object.keys(result[0].byBookmaker).sort()).toEqual(["betclic", "winamax"]);
  });

  it("merges German names written with their umlauts and with the digraphs that stand for them", () => {
    const result = matchEvents({
      winamax: [event({ competition: "Bundesliga 2", participants: ["1. FC Köln", "SpVgg Greuther Fürth"] })],
      betclic: [event({ competition: "2. Bundesliga", participants: ["Koeln", "Greuther Fuerth"] })],
    });

    expect(result).toHaveLength(1);
    expect(Object.keys(result[0].byBookmaker).sort()).toEqual(["betclic", "winamax"]);
  });

  it("keeps genuinely different events separate", () => {
    const result = matchEvents({
      winamax: [event({ participants: ["Real Madrid", "Real Sociedad"] })],
      betclic: [event({ participants: ["Real Madrid", "Barcelona"] })],
    });

    expect(result).toHaveLength(2);
  });

  it("does not merge events at different start times", () => {
    const result = matchEvents({
      winamax: [event({ startTime: "2026-09-21T19:00:00.000Z" })],
      betclic: [event({ startTime: "2026-09-22T19:00:00.000Z" })],
    });

    expect(result).toHaveLength(2);
  });

  it("produces a stable, deterministic id for the same event", () => {
    const a = matchEvents({ winamax: [event({})] })[0];
    const b = matchEvents({ winamax: [event({})] })[0];
    expect(a.id).toBe(b.id);
  });

  it("merges events even when bookmakers list participants in a different order", () => {
    const result = matchEvents({
      winamax: [event({ participants: ["Paris Saint-Germain", "Olympique de Marseille"] })],
      betclic: [event({ participants: ["Olympique de Marseille", "Paris Saint-Germain"] })],
    });

    expect(result).toHaveLength(1);
    expect(Object.keys(result[0].byBookmaker).sort()).toEqual(["betclic", "winamax"]);
  });

  it("produces the same id regardless of which bookmaker key comes first in the input", () => {
    const winamaxEvent = event({ participants: ["Olympique de Marseille", "AS Monaco"] });
    const betclicEvent = event({ participants: ["Olympique Marseille", "Monaco"] });
    const a = matchEvents({ winamax: [winamaxEvent], betclic: [betclicEvent] });
    const b = matchEvents({ betclic: [betclicEvent], winamax: [winamaxEvent] });
    expect(a[0].id).toBe(b[0].id);
  });

  // Real case found in production data: the two bookmakers disagree on which
  // club carries a "BC"/"FC" prefix. A whole-name comparison scored 0.69,
  // under the threshold, so the match was listed twice.
  it("keeps Betclic's then Winamax's spelling of an event before the other bookmakers'", () => {
    const vbet = event({ participants: ["Olympique Marseille", "Monaco"] });
    const winamax = event({ participants: ["Olympique de Marseille", "AS Monaco"] });
    const [alone] = matchEvents({ winamax: [winamax] });
    const [merged] = matchEvents({ vbet: [vbet], winamax: [winamax], netbet: [vbet] });
    expect(merged.participants).toEqual(["Olympique de Marseille", "AS Monaco"]);
    // The event keeps the id it had before Vbet and NetBet joined.
    expect(merged.id).toBe(alone.id);
    expect(Object.keys(merged.byBookmaker).sort()).toEqual(["netbet", "vbet", "winamax"]);
    // Betclic first, still.
    expect(matchEvents({ winamax: [winamax], betclic: [vbet] })[0].participants).toEqual(["Olympique Marseille", "Monaco"]);
    // Neither: the others, by name.
    expect(matchEvents({ vbet: [winamax], netbet: [vbet] })[0].participants).toEqual(["Olympique Marseille", "Monaco"]);
  });

  it("merges names that differ only by a club prefix", () => {
    const result = matchEvents({
      betclic: [event({ sport: "basketball", participants: ["BC Dubai", "Barcelone"] })],
      winamax: [event({ sport: "basketball", participants: ["Dubai", "FC Barcelone"] })],
    });

    expect(result).toHaveLength(1);
    expect(result[0].participants).toEqual(["BC Dubai", "Barcelone"]);
    expect(Object.keys(result[0].byBookmaker).sort()).toEqual(["betclic", "winamax"]);
  });

  // Real case found in production data: Winamax drops the city Betclic keeps
  // ("Club Olimpia" vs "Olimpia Asuncion", 0.19 on a whole-name comparison).
  it("merges a club name shortened by dropping its city", () => {
    const result = matchEvents({
      betclic: [event({ participants: ["Libertad Asuncion", "Olimpia Asuncion"] })],
      winamax: [event({ participants: ["Libertad Asuncion", "Club Olimpia"] })],
    });

    expect(result).toHaveLength(1);
    expect(Object.keys(result[0].byBookmaker).sort()).toEqual(["betclic", "winamax"]);
  });

  it("resolves the other bookmaker's selections on a shortened club name", () => {
    const result = matchEvents({
      betclic: [
        event({
          participants: ["Libertad Asuncion", "Olimpia Asuncion"],
          odds: [{ market: "1X2", selection: "Olimpia Asuncion", price: 2.5 }],
        }),
      ],
      winamax: [
        event({
          participants: ["Club Olimpia", "Libertad Asuncion"],
          odds: [{ market: "1X2", selection: "Club Olimpia", price: 2.6 }],
        }),
      ],
    });

    expect(result).toHaveLength(1);
    expect(result[0].byBookmaker.betclic[0].selection).toBe("2");
    expect(result[0].byBookmaker.winamax[0].selection).toBe("2");
  });

  // Real case found in production data: Winamax labels outcomes with the bare
  // club name while its participants carry a prefix or a hyphenated rest.
  it("canonicalizes outcomes labelled with the bare club name", () => {
    const result = matchEvents({
      winamax: [
        event({
          sport: "hockey sur glace",
          participants: ["HC Fribourg-Gottéron", "SC Bern"],
          odds: [
            { market: "1X2", selection: "Fribourg", price: 1.78 },
            { market: "1X2", selection: "Bern", price: 2.7 },
          ],
        }),
      ],
    });

    expect(result[0].byBookmaker.winamax.map((o) => o.selection)).toEqual(["1", "2"]);
  });

  it("merges hyphenated names and names differing by a local club prefix", () => {
    const result = matchEvents({
      betclic: [event({ sport: "hockey sur glace", participants: ["Rapperswil Jona Lakers", "Zug"] })],
      winamax: [event({ sport: "hockey sur glace", participants: ["SC Rapperswil-Jona Lakers", "EV Zug"] })],
    });

    expect(result).toHaveLength(1);
  });

  // Real cases found in production data: one participant is the same club on
  // both sides, the other only shares a word ("Efes") or a close spelling of
  // one ("Trento" / "Trentino").
  it("merges a match whose other participant only shares a distinctive word", () => {
    const result = matchEvents({
      betclic: [
        event({ sport: "basketball", participants: ["Efes Istanbul", "Real Madrid"] }),
        event({ sport: "basketball", participants: ["Neptunas", "Aquila Basket Trentino"] }),
      ],
      winamax: [
        event({ sport: "basketball", participants: ["Anadolu Efes", "Real Madrid"] }),
        event({ sport: "basketball", participants: ["Neptunas Klaipeda", "Trento"] }),
      ],
    });

    expect(result).toHaveLength(2);
    expect(result.every((e) => Object.keys(e.byBookmaker).length === 2)).toBe(true);
  });

  // Real cases found in production data: one bookmaker writes the city in
  // French, the other in the local language.
  it("merges city names written in French by one bookmaker and in the local language by the other", () => {
    const result = matchEvents({
      betclic: [
        event({ participants: ["Atalanta", "Venezia"] }),
        event({ startTime: "2026-09-22T19:00:00.000Z", participants: ["Westerlo", "Anvers"] }),
        event({ startTime: "2026-09-23T19:00:00.000Z", participants: ["Aris Thessaloniki", "Volos NPS"] }),
      ],
      winamax: [
        event({ participants: ["Atalanta Bergame", "Venise"] }),
        event({ startTime: "2026-09-22T19:00:00.000Z", participants: ["Westerlo", "Royal Antwerp FC"] }),
        event({ startTime: "2026-09-23T19:00:00.000Z", participants: ["Aris Thessalonique", "NFC Volos"] }),
      ],
    });

    expect(result).toHaveLength(3);
    expect(result.every((e) => Object.keys(e.byBookmaker).length === 2)).toBe(true);
  });

  // Real cases found in production data: an acronym, a nickname, a sponsor's
  // name or a translation that no spelling rule can pair.
  it("merges a team known under another name by the other bookmaker", () => {
    const pairs: Array<[string[], string[], string?]> = [
      [["USA", "Chili"], ["États-Unis", "Chili"]],
      [["West Ham", "QPR"], ["West Ham", "Queens Park Rangers"]],
      [["Steaua", "FC Otelul Galati"], ["FCSB ", "SC Otelul Galati"]],
      [["Feyenoord", "AZ"], ["Feyenoord", "AZ Alkmaar"]],
      [["Malines", "Sint-Truidense VV"], ["Malines", "Saint-Trond"]],
      [["Panathinaikos", "Lyon-Villeurbanne"], ["Panathinaikos", "ASVEL"], "basketball"],
      [["Tenerife", "Türk Telekom"], ["CB Canarias", "Turk Telekom"], "basketball"],
      [["Fehervar AV19", "EC VSV"], ["Hydro Fehervar AV19", "EC Villacher SV"], "hockey sur glace"],
      [["UBB", "LOU Rugby"], ["Bordeaux-Bègles", "Lyon OU"], "rugby à xv"],
    ];

    for (const [betclic, winamax, sport = "football"] of pairs) {
      const result = matchEvents({
        betclic: [event({ sport, participants: betclic })],
        winamax: [event({ sport, participants: winamax })],
      });
      expect(result, `${betclic.join(" - ")} / ${winamax.join(" - ")}`).toHaveLength(1);
    }
  });

  it("resolves outcomes labelled with the other name of a team", () => {
    const result = matchEvents({
      betclic: [
        event({
          participants: ["Feyenoord", "AZ"],
          odds: [
            { market: "1X2", selection: "Feyenoord", price: 1.9 },
            { market: "1X2", selection: "AZ", price: 3.8 },
          ],
        }),
      ],
      winamax: [
        event({
          participants: ["AZ Alkmaar", "Feyenoord"],
          odds: [
            { market: "1X2", selection: "AZ Alkmaar", price: 3.9 },
            { market: "1X2", selection: "Feyenoord", price: 1.85 },
          ],
        }),
      ],
    });

    expect(result).toHaveLength(1);
    expect(result[0].byBookmaker.betclic.map((o) => o.selection)).toEqual(["1", "2"]);
    expect(result[0].byBookmaker.winamax.map((o) => o.selection)).toEqual(["2", "1"]);
  });

  it("does not pair two different teams through their other names", () => {
    // ASVEL is Lyon-Villeurbanne (basketball), LOU is Lyon's rugby club.
    const result = matchEvents({
      betclic: [event({ participants: ["Lyon-Villeurbanne", "Monaco"] })],
      winamax: [event({ participants: ["LOU", "Monaco"] })],
    });

    expect(result).toHaveLength(2);
  });

  // Real cases found in production data: for tennis and fights the two
  // bookmakers' start times can be hours apart.
  describe("start times of tennis matches and fights", () => {
    const pair = (sport: string, betclic: [string, string[]], winamax: [string, string[]]) =>
      matchEvents({
        betclic: [event({ sport, startTime: betclic[0], participants: betclic[1] })],
        winamax: [event({ sport, startTime: winamax[0], participants: winamax[1] })],
      });

    it("merges the same opponents announced hours apart", () => {
      const tennis = pair(
        "tennis",
        ["2026-09-29T04:10:00.000Z", ["Aliaksandra Sasnovich", "Varvara Lepchenko"]],
        ["2026-09-29T05:00:00.000Z", ["Aliaksandra Sasnovich", "Varvara Lepchenko"]]
      );
      const boxing = pair(
        "boxe",
        ["2026-11-09T02:00:00.000Z", ["Ramla Ali", "Mikiah Kreps"]],
        ["2026-11-09T12:00:00.000Z", ["Ramla Ali", "Mikiah Kreps"]]
      );
      const mma = pair(
        "mma",
        ["2026-10-11T01:20:00.000Z", ["Brendan Allen", "Christian Leroy Duncan"]],
        ["2026-10-11T01:40:00.000Z", ["Brendan Allen", "Christian Duncan"]]
      );
      const shortened = pair(
        "boxe",
        ["2026-10-31T22:00:00.000Z", ["Saul Canelo Alvarez", "Christian Mbilli"]],
        ["2026-10-31T20:00:00.000Z", ["Canelo Alvarez", "Christian Mbilli"]]
      );

      // A darts session's matches follow one another: each bookmaker guesses
      // when (20bet's Modus Super Series, 18/10/2026).
      const darts = pair(
        "fléchettes",
        ["2026-10-19T09:15:00.000Z", ["Ricardo Ulrich", "Jack Aldridge"]],
        ["2026-10-19T09:55:00.000Z", ["Ricardo Ulrich", "Jack Aldridge"]]
      );

      for (const result of [tennis, boxing, mma, shortened, darts]) expect(result).toHaveLength(1);
      // The first bookmaker's time is kept, as for any merged event.
      expect(boxing[0].startTime).toBe("2026-11-09T02:00:00.000Z");
    });

    it("merges a name written the other way round", () => {
      const result = pair(
        "tennis",
        ["2026-09-29T04:10:00.000Z", ["Elvina Kalieva", "Shi Han"]],
        ["2026-09-29T04:10:00.000Z", ["Elvina Kalieva", "Han Shi"]]
      );

      expect(result).toHaveLength(1);
    });

    it("keeps other sports to a few minutes apart", () => {
      const result = pair(
        "football",
        ["2026-10-10T16:00:00.000Z", ["Feyenoord", "Ajax"]],
        ["2026-10-10T18:00:00.000Z", ["Feyenoord", "Ajax"]]
      );

      expect(result).toHaveLength(2);
    });

    it("does not merge hours apart on a single shared player, even against a namesake", () => {
      const result = pair(
        "tennis",
        ["2026-10-10T10:00:00.000Z", ["Iga Swiatek", "Karolina Pliskova"]],
        ["2026-10-10T13:00:00.000Z", ["Iga Swiatek", "Kristyna Pliskova"]]
      );

      expect(result).toHaveLength(2);
    });

    it("does not merge the same opponents more than 12 hours apart", () => {
      const result = pair(
        "tennis",
        ["2026-10-10T08:00:00.000Z", ["Iga Swiatek", "Coco Gauff"]],
        ["2026-10-10T21:00:00.000Z", ["Iga Swiatek", "Coco Gauff"]]
      );

      expect(result).toHaveLength(2);
    });
  });

  // Real cases found in production data (9/10/2026): Unibet writes the players
  // of a tennis match, a boxing bout or an MMA fight as their initials run into
  // the surname ("M.Kecmanovic", "JM.Cerundolo"), the other bookmakers write them
  // out. Each of those matches was listed twice, one line for Unibet alone.
  describe("players abbreviated to their initials", () => {
    const unibetAgainst = (
      sport: string,
      full: [string, string[]],
      unibet: [string, string[]],
      odds = [{ market: "Vainqueur du match", selection: "1", price: 2 }]
    ) =>
      matchEvents({
        betclic: [event({ sport, startTime: full[0], participants: full[1] })],
        unibet: [event({ sport, startTime: unibet[0], participants: unibet[1], odds })],
      });

    it("merges a tennis match, the start times ten minutes apart", () => {
      const result = unibetAgainst(
        "tennis",
        ["2026-10-09T08:00:00.000Z", ["Miomir Kecmanovic", "Jakub Mensik"]],
        ["2026-10-09T08:10:00.000Z", ["M.Kecmanovic", "J.Mensik"]]
      );

      expect(result).toHaveLength(1);
      expect(Object.keys(result[0].byBookmaker).sort()).toEqual(["betclic", "unibet"]);
    });

    it.each<[string, string[], string[]]>([
      ["a middle name's initial", ["Camilo Ugo Carabelli", "Tommy Paul"], ["U.Carabelli", "T.Paul"]],
      ["the initial of the second given name", ["Tommy Paul", "Adolfo Daniel Vallejo"], ["T.Paul", "D.Vallejo"]],
      ["two initials", ["Juan Manuel Cerundolo", "Carlos Alcaraz"], ["JM.Cerundolo", "C.Alcaraz"]],
      ["two initials, a hyphen in the first name", ["Jan-Lennard Struff", "Daniil Medvedev"], ["JL.Struff", "D.Medvedev"]],
      ["a surname with a particle", ["Alex De Minaur", "Alex Molcan"], ["A.De Minaur", "A.Molcan"]],
      ["a hyphen lost in the surname", ["Alejandro Tabilo", "Pablo Carreno-Busta"], ["A.Tabilo", "P.CarrenoBusta"]],
    ])("merges a tennis match with %s", (_case, full, unibet) => {
      const result = unibetAgainst(
        "tennis",
        ["2026-10-10T04:00:00.000Z", full],
        ["2026-10-10T04:00:00.000Z", unibet]
      );

      expect(result).toHaveLength(1);
    });

    it.each<[string, string, string[], string[]]>([
      ["Unibet's second surname dropped", "boxe", ["Sergio Mendoza Cordova", "Ricardo Rafael Sandoval"], ["S.Mendoza", "R.Sandoval"]],
      ["Unibet's second surname added", "boxe", ["Saul Canelo Alvarez", "Christian Mbilli"], ["C.Alvarez", "C.Mbilli Asso"]],
      ["a generational suffix", "mma", ["Andre Fili", "Kai Kamaka III"], ["A.Fili", "K.Kamaka III"]],
    ])("merges a fight when the start times are hours apart, with %s", (_case, sport, full, unibet) => {
      const result = unibetAgainst(
        sport,
        ["2026-10-10T23:00:00.000Z", full],
        ["2026-10-10T21:50:00.000Z", unibet]
      );

      expect(result).toHaveLength(1);
    });

    it("gives Unibet's prices to the player they belong to, whichever way round it lists them", () => {
      const result = unibetAgainst(
        "tennis",
        ["2026-10-09T08:00:00.000Z", ["Miomir Kecmanovic", "Jakub Mensik"]],
        ["2026-10-09T08:00:00.000Z", ["J.Mensik", "M.Kecmanovic"]],
        [
          { market: "Vainqueur du match", selection: "J.Mensik", price: 1.29 },
          { market: "Vainqueur du match", selection: "M.Kecmanovic", price: 3.05 },
        ]
      );

      expect(result).toHaveLength(1);
      expect(result[0].byBookmaker.unibet).toEqual([
        { market: "Vainqueur du match", selection: "2", price: 1.29 },
        { market: "Vainqueur du match", selection: "1", price: 3.05 },
      ]);
    });

    it("keeps apart players whose initial is not their namesake's", () => {
      const result = unibetAgainst(
        "tennis",
        ["2026-10-09T08:00:00.000Z", ["Matteo Berrettini", "Brandon Nakashima"]],
        ["2026-10-09T08:00:00.000Z", ["L.Berrettini", "C.Nakashima"]]
      );

      expect(result).toHaveLength(2);
    });

    it("keeps apart two matches that share a surname but not a player", () => {
      const result = unibetAgainst(
        "tennis",
        ["2026-10-09T08:00:00.000Z", ["Elina Svitolina", "Qinwen Zheng"]],
        ["2026-10-09T08:00:00.000Z", ["E.Mertens", "Q.Wang"]]
      );

      expect(result).toHaveLength(2);
    });
  });

  // Real cases found in production data (9/10/2026): the four ways the
  // bookmakers write a doubles team of tennis -- "Siniakova K / Zhang S"
  // (Betclic), "K.Siniakova / S.Zhang" (Winamax, NetBet), "Katerina
  // Siniakova/Shuai Zhang" (Vbet), "Siniakov/Zhang" (Unibet, which cuts its
  // names to 14 letters) -- were five listings of one match.
  describe("tennis doubles", () => {
    const BETCLIC = ["Siniakova K / Zhang S", "Hunter S / Mladenovic K"];
    const WINAMAX = ["K.Siniakova / S.Zhang", "S.Hunter / K.Mladenovic"];
    const VBET = ["Katerina Siniakova/Shuai Zhang", "Storm Hunter/Kristina Mladenovic"];
    const UNIBET = ["Siniakov/Zhang", "Hunt/Mladenov"];
    const doubles = (participants: string[], startTime = "2026-10-09T05:00:00.000Z") =>
      event({ sport: "tennis", startTime, participants });

    it("merges the five spellings of one match into one", () => {
      const result = matchEvents({
        betclic: [doubles(BETCLIC)],
        netbet: [doubles(WINAMAX)],
        unibet: [doubles(UNIBET)],
        vbet: [doubles(VBET)],
        winamax: [doubles(WINAMAX)],
      });

      expect(result).toHaveLength(1);
      expect(Object.keys(result[0].byBookmaker).sort()).toEqual(["betclic", "netbet", "unibet", "vbet", "winamax"]);
    });

    it("merges a match the bookmakers announce half an hour apart", () => {
      const result = matchEvents({
        betclic: [doubles(["Hsieh S / Ostapenko J", "Routliffe E / Sutjiadi A"], "2026-10-09T12:10:00.000Z")],
        vbet: [doubles(["Su-Wei Hsieh/Jelena Ostapenko", "Erin Routliffe/Aldila Sutjiadi"], "2026-10-09T12:30:00.000Z")],
        winamax: [doubles(["S.Hsieh / J.Ostapenko", "E.Routliffe / A.Sutjiadi"], "2026-10-09T13:00:00.000Z")],
      });

      expect(result).toHaveLength(1);
    });

    it("gives Unibet's prices to the team they belong to, whichever way round it lists them", () => {
      const result = matchEvents({
        betclic: [doubles(BETCLIC)],
        unibet: [
          event({
            sport: "tennis",
            startTime: "2026-10-09T05:00:00.000Z",
            participants: [UNIBET[1], UNIBET[0]],
            odds: [
              { market: "Vainqueur du match", selection: "Hunt/Mladenov", price: 1.7 },
              { market: "Vainqueur du match", selection: "Siniakov/Zhang", price: 2.1 },
            ],
          }),
        ],
      });

      expect(result).toHaveLength(1);
      expect(result[0].byBookmaker.unibet.map((o) => [o.selection, o.price])).toEqual([["2", 1.7], ["1", 2.1]]);
    });

    it("keeps apart two matches that share a player of each team, but not both", () => {
      const result = matchEvents({
        betclic: [doubles(BETCLIC)],
        winamax: [doubles(["K.Siniakova / E.Routliffe", "S.Hunter / A.Sutjiadi"])],
      });

      expect(result).toHaveLength(2);
    });

    it("does not read a cut name as a cut name outside of doubles", () => {
      const result = matchEvents({
        betclic: [event({ sport: "tennis", startTime: "2026-10-09T05:00:00.000Z", participants: ["Katerina Siniakova", "Storm Hunter"] })],
        unibet: [event({ sport: "tennis", startTime: "2026-10-09T05:00:00.000Z", participants: ["Siniakov", "Hunt"] })],
      });

      expect(result).toHaveLength(2);
    });
  });

  // Real cases found in production data (9/10/2026): Unibet writes the American
  // teams as a code of their city and their nickname, sometimes run together or
  // cut short ("OKC Thunder", "VEG GKnights", "CHI Wh.Sox"); the others write
  // the city and the nickname out. Each of those matches was listed twice.
  describe("American teams written as a city code and a nickname", () => {
    const unibetAgainst = (sport: string, full: string[], unibet: string[]) =>
      matchEvents({
        betclic: [event({ sport, startTime: "2026-10-22T23:00:00.000Z", participants: full })],
        unibet: [event({ sport, startTime: "2026-10-22T23:00:00.000Z", participants: unibet })],
      });

    it.each<[string, string, string[], string[]]>([
      ["basketball", "a code of three letters", "basketball", ["Orlando Magic", "Atlanta Hawks"], ["ORL Magic", "ATL Hawks"]],
      ["basketball", "a code that is not the city's first letters", "basketball", ["Oklahoma City Thunder", "Denver Nuggets"], ["OKC Thunder", "DEN Nuggets"]],
      ["basketball", "a nickname of several words, run together", "basketball", ["Portland Trail Blazers", "Phoenix Suns"], ["POR TBlazers", "PHX Suns"]],
      ["basketball", "a French name for the city", "basketball", ["Philadelphie 76ers", "Cleveland Cavaliers"], ["PHI 76ers", "CLE Cavaliers"]],
      ["hockey", "a nickname cut to its first word's initial", "hockey sur glace", ["Vegas Golden Knights", "Toronto Maple Leafs"], ["VEG GKnights", "TOR MapleLeafs"]],
      ["hockey", "Columbus' own code", "hockey sur glace", ["Columbus Blue Jackets", "Pittsburgh Penguins"], ["CLB BJackets", "PIT Penguins"]],
      ["hockey", "a nickname spelt as one word", "hockey sur glace", ["Providence Bruins", "Hartford Wolf Pack"], ["PRO Bruins", "HAR Wolfpack"]],
      ["hockey", "a city's abbreviation", "hockey sur glace", ["St. Louis Blues", "San Jose Sharks"], ["STL Blues", "SJ Sharks"]],
      ["American football", "a code that is no letters of its city", "football américain", ["Jacksonville Jaguars", "Houston Texans"], ["JAX Jaguars", "HOU Texans"]],
      ["baseball", "a nickname cut with a full stop", "baseball", ["Chicago White Sox", "Cleveland Guardians"], ["CHI Wh.Sox", "CLE Guardians"]],
      ["hockey", "a nickname cut to its first letters and its end, or at the 14th letter", "hockey sur glace", ["Tucson Roadrunners", "Springfield Thunderbirds"], ["TUC Roadrunner", "SPR ThBirds"]],
    ])("merges %s with %s", (_sport, _case, sport, full, unibet) => {
      expect(unibetAgainst(sport, full, unibet)).toHaveLength(1);
    });

    it("gives Unibet's prices to the team they belong to", () => {
      const result = matchEvents({
        betclic: [event({ sport: "basketball", participants: ["Oklahoma City Thunder", "Denver Nuggets"] })],
        unibet: [
          event({
            sport: "basketball",
            participants: ["DEN Nuggets", "OKC Thunder"],
            odds: [
              { market: "Vainqueur du match", selection: "DEN Nuggets", price: 3.4 },
              { market: "Vainqueur du match", selection: "OKC Thunder", price: 1.3 },
            ],
          }),
        ],
      });

      expect(result).toHaveLength(1);
      expect(result[0].byBookmaker.unibet.map((o) => [o.selection, o.price])).toEqual([["2", 3.4], ["1", 1.3]]);
    });

    it("keeps apart teams of one city whose nicknames differ", () => {
      const result = unibetAgainst(
        "hockey sur glace",
        ["Calgary Flames", "Colorado Avalanche"],
        ["CAL Wranglers", "COL Eagles"]
      );

      expect(result).toHaveLength(2);
    });

    it("keeps apart teams that share a code or a city but not a nickname", () => {
      const result = unibetAgainst(
        "football américain",
        ["New York Jets", "Cleveland Browns"],
        ["NY Giants", "CHI Bears"]
      );

      expect(result).toHaveLength(2);
    });

    it("keeps apart a nickname that starts like another but does not end like it", () => {
      const result = unibetAgainst("baseball", ["Minnesota Twins", "Tampa Bay Rays"], ["MIN TWolves", "TOR Raptors"]);

      expect(result).toHaveLength(2);
    });
  });

  // Real cases found in production data (9/10/2026): Unibet writes a team in 14
  // characters at most -- of the 130 or so team names of its listing none is
  // longer, 23 have exactly 14 -- and shortens a longer name: a word cut with a
  // full stop ("Hap.Tel Aviv"), words run together ("Newell OldBoys"), a
  // club-type word dropped ("Uni.Craiova" for "CS Universitatea Craiova"), a word
  // or the end of the name lost ("Gimnasia Y Esg"). The other bookmakers write
  // the whole name. Each of those matches was listed twice.
  describe("names Unibet cuts to 14 characters", () => {
    const unibetAgainst = (full: string[], unibet: string[]) =>
      matchEvents({
        betclic: [event({ participants: full })],
        unibet: [event({ participants: unibet })],
      });

    it.each<[string, string[], string[]]>([
      ["a word cut with a full stop, the space gone", ["Lokomotiv Sofia", "Lokomotiv Plovdiv"], ["Lokomo.Sofia", "Lokomo.Plovdiv"]],
      ["the first word of a club cut to three letters", ["Hapoel Tel-Aviv", "Maccabi Netanya"], ["Hap.Tel Aviv", "Mac.Netanya"]],
      ["a hyphenated name run together and cut", ["Hapoel Petach-Tikva", "Maccabi Netanya"], ["Hap.PetachTikv", "Mac.Netanya"]],
      ["a club-type word dropped", ["CS Universitatea Craiova", "Getafe"], ["Uni.Craiova", "Getafe"]],
      [
        "a long word cut without a full stop, beside its namesake's",
        ["Universitatea Cluj", "CS Universitatea Craiova"],
        ["Universit Cluj", "Uni.Craiova"],
      ],
      ["the end of a name lost, beside a name run together", ["Gimnasia y Esgrima Mendoza", "Newell's Old Boys"], ["Gimnasia Y Esg", "Newell OldBoys"]],
      ["a word cut inside a name", ["Liaoning Tieren", "Wuhan Three Towns"], ["Liaoning Sheny", "Wuhan Th.Towns"]],
      ["a long first word, beside an alias", ["Hamburger SV", "Eintracht Francfort"], ["Hambourg", "Ein.Francfort"]],
      ["two long words cut", ["Excelsior Rotterdam", "Eintracht Francfort"], ["Exce.Rotterdam", "Ein.Francfort"]],
    ])("merges %s", (_case, full, unibet) => {
      expect(unibetAgainst(full, unibet)).toHaveLength(1);
    });

    it("gives Unibet's prices to the team they belong to, whichever way round it lists them", () => {
      const result = matchEvents({
        betclic: [event({ participants: ["Lokomotiv Sofia", "Lokomotiv Plovdiv"] })],
        unibet: [
          event({
            participants: ["Lokomo.Plovdiv", "Lokomo.Sofia"],
            odds: [
              { market: "Vainqueur du match", selection: "Lokomo.Plovdiv", price: 2.6 },
              { market: "Vainqueur du match", selection: "Lokomo.Sofia", price: 2.4 },
            ],
          }),
        ],
      });

      expect(result).toHaveLength(1);
      expect(result[0].byBookmaker.unibet.map((o) => [o.selection, o.price])).toEqual([["2", 2.6], ["1", 2.4]]);
    });

    // A name whose end is lost fits several clubs ("Gimnasia Y Esg" is Mendoza's
    // or La Plata's): it is worth less than a spelling, and two of them in one
    // match are not enough.
    it("does not pair two names with their end lost on their own", () => {
      const result = unibetAgainst(["Hapoel Petach-Tikva", "Gimnasia y Esgrima Mendoza"], ["Hap.PetachTikv", "Gimnasia Y Esg"]);

      expect(result).toHaveLength(2);
    });

    it("keeps apart the clubs that share the start of their names", () => {
      const result = unibetAgainst(["Universitatea Craiova", "Hapoel Haifa"], ["Universit Cluj", "Hap.Tel Aviv"]);

      expect(result).toHaveLength(2);
    });

    // The women's marker ("F.") is a team of its own at the others, and Unibet
    // drops it: not read as a name cut short.
    it("does not read the women's marker as a lost end", () => {
      const result = unibetAgainst(["Millenium Brescia F.", "Chieri F."], ["Mille. Brescia", "Chieri '76"]);

      expect(result).toHaveLength(2);
    });
  });

  // Real cases found in production data (9/10/2026): the bookmakers' start
  // times for one match can be a quarter of an hour apart (Winamax's NHL, a
  // Mexican league match) or an hour (Vbet's German cup, the 27th of October).
  // Measured on a day's 789 football matches (and the other sports'): within two
  // hours, no two matches of one bookmaker are near-identical in their names;
  // four hours apart, two clubs ("Atlético San Luis" / "Santos Laguna") are.
  describe("start times up to an hour apart", () => {
    const pair = (sport: string, betclic: [string, string[]], other: [string, string[]]) =>
      matchEvents({
        betclic: [event({ sport, startTime: betclic[0], participants: betclic[1] })],
        winamax: [event({ sport, startTime: other[0], participants: other[1] })],
      });

    it("merges a match a quarter of an hour apart", () => {
      const result = pair(
        "hockey sur glace",
        ["2026-10-09T01:00:00.000Z", ["Calgary Flames", "Colorado Avalanche"]],
        ["2026-10-09T01:15:00.000Z", ["Calgary Flames", "Colorado Avalanche"]]
      );

      expect(result).toHaveLength(1);
      // The first bookmaker's time is kept, as for any merged event.
      expect(result[0].startTime).toBe("2026-10-09T01:00:00.000Z");
    });

    it("merges a football match an hour apart", () => {
      const result = pair(
        "football",
        ["2026-10-27T17:00:00.000Z", ["Bochum", "Mayence"]],
        ["2026-10-27T18:00:00.000Z", ["Bochum", "Mayence"]]
      );

      expect(result).toHaveLength(1);
    });

    // Real case (Vbet's "Bohemians Prague" against the others' "Bohemians 1905"):
    // names too far apart to pair across an hour, as hours apart in tennis, while
    // at the same time they do.
    it("needs near-identical names past ten minutes, as hours apart in tennis", () => {
      const names: [string, string] = ["Bohemians Prague", "Banik Ostrava"];
      const other: [string, string] = ["Bohemians 1905", "Banik Ostrava"];

      expect(pair("football", ["2026-10-10T13:00:00.000Z", names], ["2026-10-10T13:00:00.000Z", other])).toHaveLength(1);
      expect(pair("football", ["2026-10-10T13:00:00.000Z", names], ["2026-10-10T14:00:00.000Z", other])).toHaveLength(2);
    });

    it("keeps apart the same clubs more than an hour apart", () => {
      const result = pair(
        "football",
        ["2026-10-27T17:00:00.000Z", ["Bochum", "Mayence"]],
        ["2026-10-27T18:30:00.000Z", ["Bochum", "Mayence"]]
      );

      expect(result).toHaveLength(2);
    });
  });

  // Real cases found in production data (2026-09-29): the same race's title
  // differs between the bookmakers, its closing time too, and Betclic's
  // listing only carries its 3 favourites.
  describe("winner-among-N markets", () => {
    const race = (title: string, startTime: string, runners: Record<string, number>, sport = "formule 1"): RawEvent => ({
      sport,
      competition: "",
      startTime,
      participants: [title],
      odds: Object.entries(runners).map(([selection, price]) => ({ market: "Vainqueur", selection, price })),
    });
    const grid = { "Andrea Kimi Antonelli": 2.25, "George Russell": 4.25, "Max Verstappen": 7, "Lando Norris": 8 };

    it("merges the same race from its competitors, lining them up under the first bookmaker's names", () => {
      const result = matchEvents({
        betclic: [
          race("GP de Bahreïn", "2026-10-04T07:00:00.000Z", {
            "Kimi Antonelli": 2.5,
            "George Russell": 4.5,
            "Max Verstappen": 7,
          }),
        ],
        winamax: [race("Grand Prix de Bahreïn 2026 - Course", "2026-10-05T11:00:00.000Z", grid)],
      });

      expect(result).toHaveLength(1);
      expect(result[0].participants).toEqual(["GP de Bahreïn"]);
      expect(result[0].byBookmaker.winamax).toEqual([
        { market: "Vainqueur", selection: "Kimi Antonelli", price: 2.25 },
        { market: "Vainqueur", selection: "George Russell", price: 4.25 },
        { market: "Vainqueur", selection: "Max Verstappen", price: 7 },
        // Not in Betclic's listing: keeps its own name, and its own row.
        { market: "Vainqueur", selection: "Lando Norris", price: 8 },
      ]);
    });

    it("lines up a name written surname first", () => {
      const result = matchEvents({
        betclic: [race("Bank Of Utah Championship 2026", "2026-10-04T23:00:00.000Z", { "Jackson Koivun": 12, "Michael Brennan": 16, "Maverick McNealy": 18 }, "golf")],
        winamax: [race("PGA Tour 2026 - Bank of Utah Championship", "2026-10-05T00:00:00.000Z", { "Koivun, Jackson": 12, "Brennan, Michael": 17, "McNealy, Maverick": 18 }, "golf")],
      });

      expect(result).toHaveLength(1);
      expect(result[0].byBookmaker.winamax.map((o) => o.selection)).toEqual(["Jackson Koivun", "Michael Brennan", "Maverick McNealy"]);
    });

    it("keeps apart markets at the same time with different competitors", () => {
      const result = matchEvents({
        betclic: [race("Coupe du Monde H. - Classement général 2026/27", "2027-03-25T22:00:00.000Z", { "Marco Odermatt": 1.5, "Loic Meillard": 6 }, "ski alpin")],
        winamax: [race("Femmes - Classement Général 2026/27", "2027-03-25T22:00:00.000Z", { "Mikaela Shiffrin": 2.5, "Emma Aicher": 3 }, "ski alpin")],
      });

      expect(result).toHaveLength(2);
    });

    // Real case (7/10/2026): the biathlon relays, men's and women's, are the
    // same nations at the same date, so their competitors can't tell them
    // apart. Unibet's women's relay was merged with Winamax's men's, and a
    // surebet of 40% came out of Norway at 1.3 and 5 (prices of the feeds).
    describe("the men's and the women's of a sport whose competitors are nations", () => {
      const winamaxMen = { "Allemagne": 20, "Autriche": 1000, "Bulgarie": 1000, "Canada": 1000, "Estonie": 1000, "Finlande": 1000, "France": 3, "Italie": 50, "Kazakhstan": 1000, "Lettonie": 1000, "Lituanie": 1000, "Norvège": 1.3, "Pologne": 1000, "République Tchèque": 300, "Slovaquie": 1000, "Slovénie": 1000, "Suisse": 1000, "Suède": 10, "Ukraine": 1000, "États-Unis": 300 };
      const winamaxWomen = { "Allemagne": 10, "Autriche": 750, "Bulgarie": 1000, "Estonie": 1000, "Finlande": 400, "France": 1.25, "Italie": 100, "Norvège": 7.5, "Pologne": 1000, "République Tchèque": 100, "Slovaquie": 100, "Slovénie": 1000, "Suisse": 750, "Suède": 6, "Ukraine": 1000, "États-Unis": 1000 };
      const unibetMen = { "Norvège": 1.35, "Estonie": 500, "Slovaquie": 500, "Lettonie": 500, "Autriche": 500, "Kazakhstan": 500, "Finlande": 500, "Pologne": 500, "Ukraine": 500, "USA": 250, "Allemagne": 20, "Lituanie": 500, "Slovenie": 500, "Bulgarie": 500, "Canada": 500, "Italie": 50, "Suisse": 500, "France": 3, "Suède": 10, "Republique Tcheque": 250 };
      const unibetWomen = { "Belgique": 500, "USA": 500, "Canada": 500, "Kazakhstan": 500, "Norvège": 5, "Suisse": 500, "Republique Tcheque": 100, "Estonie": 500, "Autriche": 500, "Slovaquie": 500, "Pologne": 500, "Lettonie": 500, "Bulgarie": 500, "France": 1.35, "Italie": 100, "Allemagne": 10, "Slovenie": 500, "Finlande": 400, "Suède": 4, "Ukraine": 500 };
      const priceOf = (event: { byBookmaker: Record<string, { selection: string; price: number }[]> }, bookmaker: string, nation: string) =>
        event.byBookmaker[bookmaker]?.find((o) => o.selection === nation)?.price;

      it("pairs each relay with the one of its own sex", () => {
        const result = matchEvents({
          winamax: [
            race("Hommes - Classement Général Relais 2026/2027", "2027-03-07T13:00:00.000Z", winamaxMen, "biathlon"),
            race("Femmes - Classement Général Relais 2026/2027", "2027-03-07T14:30:00.000Z", winamaxWomen, "biathlon"),
          ],
          unibet: [
            race("Relais H / Classement Général 2026/2027", "2027-03-07T13:45:00.000Z", unibetMen, "biathlon"),
            race("Relais F / Classement Général 2026/2027", "2027-03-07T16:30:00.000Z", unibetWomen, "biathlon"),
          ],
        });

        expect(result).toHaveLength(2);
        const men = result.find((e) => e.participants[0].startsWith("Hommes"))!;
        const women = result.find((e) => e.participants[0].startsWith("Femmes"))!;
        expect(priceOf(men, "winamax", "Norvège")).toBe(1.3);
        expect(priceOf(men, "unibet", "Norvège")).toBe(1.35);
        expect(priceOf(women, "winamax", "France")).toBe(1.25);
        expect(priceOf(women, "unibet", "France")).toBe(1.35);
      });

      it("keeps them apart whichever way a bookmaker writes the sex: Hommes, H, (H), Messieurs", () => {
        const pairs: [string, string][] = [
          ["Hommes - Classement Général Relais", "Relais (F)"],
          ["Femmes - Classement Général Relais", "Relais H"],
          ["Relais Messieurs", "Relais Dames"],
          ["Sprint (F) 7.5 Km", "Sprint H. 10 Km"],
        ];
        for (const [a, b] of pairs) {
          const result = matchEvents({
            winamax: [race(a, "2027-03-07T13:00:00.000Z", winamaxMen, "biathlon")],
            unibet: [race(b, "2027-03-07T13:00:00.000Z", winamaxMen, "biathlon")],
          });
          expect(result, `${a} / ${b}`).toHaveLength(2);
        }
      });

      it("still pairs a title that names its sex on one side only", () => {
        const result = matchEvents({
          winamax: [race("Hommes - Classement Général Relais 2026/2027", "2027-03-07T13:00:00.000Z", winamaxMen, "biathlon")],
          unibet: [race("Classement Général Relais 2026/2027", "2027-03-07T13:45:00.000Z", unibetMen, "biathlon")],
        });

        expect(result).toHaveLength(1);
      });
    });

    // Real case (15/10/2026): Betify only lists the World Cup's overall standings, and dates
    // them on the first race (14/11), as Betclic and Vbet date their standings of the sprint.
    // The same biathletes at the same date: Betify's overall was merged with the sprint's, and
    // a surebet came out of Laegreid at 2.2 (overall) and 4 (sprint).
    describe("the biathlon's overall standings and its disciplines' standings", () => {
      const field = { "Sturla Holm Laegreid": 2.2, "Eric Perrot": 3.3, "Johan-Olav Botn": 5.5, "Tommaso Giacomel": 7 };
      const sprint = { "Sturla Holm Laegreid": 4, "Eric Perrot": 7, "Johan-Olav Botn": 6, "Tommaso Giacomel": 6 };

      it("keeps the overall apart from the sprint's, whoever dates them the same", () => {
        const result = matchEvents({
          betify: [race("World Cup Overall 2026/27", "2026-11-14T07:00:00.000Z", field, "biathlon")],
          betclic: [race("Coupe du Monde H. - Classement général - Sprint Hommes 2026/27", "2026-11-14T08:00:00.000Z", sprint, "biathlon")],
          vbet: [race("IBU Coupe du monde 2026/2027. Sprint. Général", "2026-11-14T08:00:00.000Z", sprint, "biathlon")],
        });

        expect(result).toHaveLength(2);
        const overall = result.find((e) => e.byBookmaker.betify)!;
        expect(Object.keys(overall.byBookmaker)).toEqual(["betify"]);
      });

      it("still pairs the sprint's standings from one bookmaker to the next, and an overall to an overall", () => {
        const sprintPair = matchEvents({
          betclic: [race("Coupe du Monde H. - Classement général - Sprint Hommes 2026/27", "2026-11-14T08:00:00.000Z", sprint, "biathlon")],
          vbet: [race("IBU Coupe du monde 2026/2027. Sprint. Général", "2026-11-14T08:00:00.000Z", sprint, "biathlon")],
        });
        expect(sprintPair).toHaveLength(1);

        const overallPair = matchEvents({
          betify: [race("World Cup Overall 2026/27", "2026-11-14T07:00:00.000Z", field, "biathlon")],
          unibet: [race("Classement Général Coupe du Monde 2026/27 (H)", "2026-11-14T08:00:00.000Z", field, "biathlon")],
        });
        expect(overallPair).toHaveLength(1);
      });

      it("keeps the relay, the pursuit and the sprint apart from one another", () => {
        const pairs: [string, string][] = [
          ["Hommes - Classement Général Sprint 2026/2027", "Hommes - Classement Général Relais 2026/2027"],
          ["Sprint Classement Hommes (Coupe du monde IBU 2026/2027)", "Poursuite Classement Hommes (Coupe du monde IBU 2026/2027)"],
          ["IBU Coupe du monde 2026/2027. Sprint. Général", "IBU Coupe du monde 2026/2027. Pursuit. Général"],
        ];
        for (const [a, b] of pairs) {
          const result = matchEvents({
            winamax: [race(a, "2027-03-18T15:30:00.000Z", sprint, "biathlon")],
            pmu: [race(b, "2027-03-18T15:30:00.000Z", sprint, "biathlon")],
          });
          expect(result, `${a} / ${b}`).toHaveLength(2);
        }
      });
    });

    // Real case (15/10/2026): the bookmakers date a biathlon season standings by
    // the first race (14/11), the relay's weekend (6/12), the season's end
    // (21/03/2027)... months apart, and name it five ways. None of them paired.
    describe("the biathlon's season standings, dated months apart", () => {
      const men = { "Sturla Holm Laegreid": 2.2, "Eric Perrot": 3.3, "Johan-Olav Botn": 5.5, "Tommaso Giacomel": 7 };
      const women = { "Lisa Vittozzi": 2.5, "Julia Simon": 3.3, "Justine Braisaz-Bouchet": 5.5, "Franziska Preuss": 7 };
      const nations = { "Norvège": 1.3, "France": 3, "Suède": 10, "Allemagne": 20 };
      const groups = (events: ReturnType<typeof matchEvents>) =>
        events.map((e) => Object.keys(e.byBookmaker).sort().join("+")).sort();

      it("pairs a standings whatever its date, with the title of each bookmaker", () => {
        const result = matchEvents({
          betclic: [race("Coupe du Monde H. - Classement général 2026/27", "2026-11-27T15:10:00.000Z", men, "biathlon")],
          winamax: [race("Hommes - Classement Général 2026/27", "2027-03-21T15:00:00.000Z", men, "biathlon")],
          betify: [race("World Cup Overall 2026/27", "2026-11-14T07:00:00.000Z", men, "biathlon")],
        });

        expect(groups(result)).toEqual(["betclic+betify+winamax"]);
      });

      it("pairs the women's the same way, and keeps them from the men's", () => {
        const result = matchEvents({
          betclic: [
            race("Coupe du Monde H. - Classement général 2026/27", "2026-11-27T15:10:00.000Z", men, "biathlon"),
            race("Coupe du Monde F. - Classement général 2026/27", "2026-11-27T15:10:00.000Z", women, "biathlon"),
          ],
          winamax: [
            race("Femmes - Classement Général 2026/27", "2027-03-21T17:00:00.000Z", women, "biathlon"),
            race("Hommes - Classement Général 2026/27", "2027-03-21T15:00:00.000Z", men, "biathlon"),
          ],
          betify: [
            race("World Cup Women Overall 2026/27", "2026-11-14T07:00:00.000Z", women, "biathlon"),
            race("World Cup Overall 2026/27", "2026-11-14T07:00:00.000Z", men, "biathlon"),
          ],
        });

        expect(groups(result)).toEqual(["betclic+betify+winamax", "betclic+betify+winamax"]);
        for (const e of result) {
          const first = e.byBookmaker.betclic[0].selection;
          expect(e.byBookmaker.winamax.map((o) => o.selection)).toContain(first);
        }
      });

      it("pairs a discipline's standings dated the first race and the season's end", () => {
        const result = matchEvents({
          betclic: [
            race("Coupe du Monde H. - Classement général - Sprint Hommes 2026/27", "2026-11-14T08:00:00.000Z", men, "biathlon"),
            race("Coupe du Monde F. - Classement général - Sprint Femmes 2026/27", "2026-11-14T08:00:00.000Z", women, "biathlon"),
          ],
          winamax: [
            race("Hommes - Classement Général Sprint 2026/2027", "2027-03-18T17:30:00.000Z", men, "biathlon"),
            race("Femmes - Classement Général Sprint 2026/2027", "2027-03-19T17:30:00.000Z", women, "biathlon"),
          ],
        });

        expect(groups(result)).toEqual(["betclic+winamax", "betclic+winamax"]);
      });

      it("pairs the relays, even Vbet's that only name their legs", () => {
        const result = matchEvents({
          betclic: [
            race("Coupe du Monde H. - Classement général - Relais Hommes 2026/27", "2026-12-06T13:15:00.000Z", nations, "biathlon"),
            race("Coupe du Monde F. - Classement général - Relais Femmes 2026/27", "2026-12-06T13:15:00.000Z", nations, "biathlon"),
          ],
          winamax: [
            race("Hommes - Classement Général Relais 2026/2027", "2027-03-07T13:00:00.000Z", nations, "biathlon"),
            race("Femmes - Classement Général Relais 2026/2027", "2027-03-07T14:30:00.000Z", nations, "biathlon"),
          ],
          circusbet: [
            race("IBU Coupe du monde 2026/2027. 4 x 6 km Relais. Général", "2026-11-14T08:00:00.000Z", { ...nations, "Norvège": 7.5 }, "biathlon"),
            race("IBU Coupe du monde 2026/2027. 4 x 7,5km Relais. Général", "2026-11-14T08:00:00.000Z", nations, "biathlon"),
          ],
        });

        expect(groups(result)).toEqual(["betclic+circusbet+winamax", "betclic+circusbet+winamax"]);
        const norway = (title: string) =>
          result.find((e) => e.participants[0].startsWith(title))!.byBookmaker.circusbet.find((o) => o.selection === "Norvège")!.price;
        expect(norway("Coupe du Monde F.")).toBe(7.5);
        expect(norway("Coupe du Monde H.")).toBe(1.3);
      });

      it("pairs NetBet's titles, which name the World Cup and a season but no \"classement\"", () => {
        const result = matchEvents({
          winamax: [
            race("Hommes - Classement Général Sprint 2026/2027", "2027-03-18T17:30:00.000Z", men, "biathlon"),
            race("Hommes - Classement Général 2026/27", "2027-03-21T15:00:00.000Z", men, "biathlon"),
            race("Femmes - Classement Général 2026/27", "2027-03-21T17:00:00.000Z", women, "biathlon"),
            race("Hommes - Classement Général Relais 2026/2027", "2027-03-07T13:00:00.000Z", nations, "biathlon"),
          ],
          netbet: [
            race("Coupe du Monde - Sprint Hommes 2026/2027", "2027-03-18T15:30:00.000Z", men, "biathlon"),
            race("Coupe du Monde 2026/2027", "2027-03-21T15:00:00.000Z", men, "biathlon"),
            race("Coupe du Monde (F) 2026/2027", "2027-03-21T15:00:00.000Z", women, "biathlon"),
            race("Coupe du Monde - Relais Hommes 2026/2027", "2027-03-07T11:45:00.000Z", nations, "biathlon"),
          ],
        });

        expect(groups(result)).toEqual(["netbet+winamax", "netbet+winamax", "netbet+winamax", "netbet+winamax"]);
      });

      it("does not take a race that names its distance for a standings, World Cup or not", () => {
        const result = matchEvents({
          winamax: [race("Hommes - Classement Général Sprint 2026/2027", "2027-02-12T15:30:00.000Z", men, "biathlon")],
          netbet: [race("Coupe du Monde 2026/2027 - 10 km Sprint Otepää H", "2027-02-12T15:30:00.000Z", men, "biathlon")],
        });

        expect(result).toHaveLength(2);
      });

      it("keeps a race apart from the standings, and from another race", () => {
        const result = matchEvents({
          betclic: [
            race("10 km Sprint Otepää H", "2027-02-12T15:30:00.000Z", men, "biathlon"),
            race("7.5 km Sprint Otepää F", "2027-02-13T16:00:00.000Z", women, "biathlon"),
          ],
          winamax: [
            race("Hommes - Classement Général Sprint 2026/2027", "2027-02-12T15:30:00.000Z", men, "biathlon"),
            race("Femmes - Classement Général Sprint 2026/2027", "2027-02-13T16:00:00.000Z", women, "biathlon"),
          ],
        });

        expect(result).toHaveLength(4);
      });

      it("keeps one season's standings apart from the next season's", () => {
        const result = matchEvents({
          betclic: [race("Coupe du Monde H. - Classement général 2026/27", "2026-11-27T15:10:00.000Z", men, "biathlon")],
          winamax: [race("Hommes - Classement Général 2027/28", "2028-03-21T15:00:00.000Z", men, "biathlon")],
        });

        expect(result).toHaveLength(2);
      });

      it("keeps a standings without a season apart when the dates are over a year apart", () => {
        const result = matchEvents({
          betclic: [race("Coupe du Monde H. - Classement général", "2026-11-27T15:10:00.000Z", men, "biathlon")],
          winamax: [race("Hommes - Classement Général", "2028-03-21T15:00:00.000Z", men, "biathlon")],
        });

        expect(result).toHaveLength(2);
      });

      it("keeps standings with other biathletes apart", () => {
        const result = matchEvents({
          betclic: [race("Coupe du Monde H. - Classement général 2026/27", "2026-11-27T15:10:00.000Z", men, "biathlon")],
          winamax: [race("Femmes - Classement Général 2026/27", "2027-03-21T15:00:00.000Z", women, "biathlon")],
        });

        expect(result).toHaveLength(2);
      });
    });

    it("pairs each race with its own counterpart when a sprint shares every driver a day earlier", () => {
      const result = matchEvents({
        betclic: [
          race("GP de Bahreïn - Sprint", "2026-10-03T11:00:00.000Z", grid),
          race("GP de Bahreïn", "2026-10-04T15:00:00.000Z", grid),
        ],
        winamax: [
          race("Grand Prix de Bahreïn 2026 - Course", "2026-10-04T15:00:00.000Z", grid),
          race("Grand Prix de Bahreïn 2026 - Sprint", "2026-10-03T11:00:00.000Z", grid),
        ],
      });

      expect(result).toHaveLength(2);
      const byTitle = Object.fromEntries(result.map((e) => [e.participants[0], e.startTime]));
      expect(byTitle).toEqual({
        "GP de Bahreïn - Sprint": "2026-10-03T11:00:00.000Z",
        "GP de Bahreïn": "2026-10-04T15:00:00.000Z",
      });
      expect(result.every((e) => Object.keys(e.byBookmaker).length === 2)).toBe(true);
      // Each merged with the Winamax market of its own day.
      const winamaxCount = (title: string) => result.find((e) => e.participants[0] === title)!.byBookmaker.winamax.length;
      expect(winamaxCount("GP de Bahreïn")).toBe(4);
    });

    it("pairs by closeness in time when neither competitors nor titles tell two races apart", () => {
      const result = matchEvents({
        betclic: [
          race("GP de Bahreïn", "2026-10-03T11:00:00.000Z", grid),
          race("GP de Bahreïn", "2026-10-04T15:00:00.000Z", grid),
        ],
        winamax: [
          race("Grand Prix de Bahreïn 2026", "2026-10-04T15:30:00.000Z", { ...grid, "Lando Norris": 8.5 }),
          race("Grand Prix de Bahreïn 2026", "2026-10-03T11:30:00.000Z", grid),
        ],
      });

      expect(result).toHaveLength(2);
      const race2 = result.find((e) => e.startTime === "2026-10-04T15:00:00.000Z")!;
      expect(race2.byBookmaker.winamax.find((o) => o.selection === "Lando Norris")!.price).toBe(8.5);
    });

    it("keeps apart the same competitors more than 48 hours apart", () => {
      const result = matchEvents({
        betclic: [race("Coupe du Monde H. - Classement général 2026/27", "2026-11-27T15:10:00.000Z", grid, "ski alpin")],
        winamax: [race("Hommes - Classement Général 2026/27", "2027-03-21T15:00:00.000Z", grid, "ski alpin")],
      });

      expect(result).toHaveLength(2);
    });

    it("pairs a multi-day event dated by its end on one side and its start on the other, when the titles agree", () => {
      const crews = { "Sébastien Ogier": 3, "Kalle Rovanperä": 3.5, "Elfyn Evans": 4 };
      const result = matchEvents({
        betclic: [race("Rallye d'Italie", "2026-10-04T18:00:00.000Z", crews, "automobile")],
        winamax: [race("WRC - Rallye d'Italie 2026", "2026-10-01T07:00:00.000Z", crews, "automobile")],
      });

      expect(result).toHaveLength(1);
      expect(Object.keys(result[0].byBookmaker).sort()).toEqual(["betclic", "winamax"]);
    });

    it("keeps apart the same competitors days apart when the titles name different events", () => {
      const crews = { "Sébastien Ogier": 3, "Kalle Rovanperä": 3.5, "Elfyn Evans": 4 };
      const result = matchEvents({
        betclic: [race("Rallye d'Italie", "2026-10-04T18:00:00.000Z", crews, "automobile")],
        winamax: [race("WRC - Rallye du Chili 2026", "2026-10-01T07:00:00.000Z", crews, "automobile")],
      });

      expect(result).toHaveLength(2);
    });

    it("keeps apart matching titles more than 5 days apart", () => {
      const crews = { "Sébastien Ogier": 3, "Kalle Rovanperä": 3.5, "Elfyn Evans": 4 };
      const result = matchEvents({
        betclic: [race("Rallye d'Italie", "2026-10-07T08:00:00.000Z", crews, "automobile")],
        winamax: [race("WRC - Rallye d'Italie 2026", "2026-10-01T07:00:00.000Z", crews, "automobile")],
      });

      expect(result).toHaveLength(2);
    });

    // Real cases (7/10/2026): a season or a tour one bookmaker dates by its
    // first day, another by its last, weeks apart. Their titles say the same
    // event once the year and the words around it are gone.
    describe("an event dated by its start on one side and its end on the other", () => {
      const riders = { "Marc Marquez": 1.3, "Jorge Martin": 4, "Marco Bezzecchi": 15, "Alex Marquez": 30 };

      it("pairs a championship 7 days apart across the three spellings of its title", () => {
        const result = matchEvents({
          winamax: [race("Moto GP - Championnat du Monde 2026", "2026-11-22T14:00:00.000Z", riders, "moto")],
          betclic: [race("Championnat du Monde MotoGP 2026", "2026-11-22T13:00:00.000Z", riders, "moto")],
          unibet: [race("Moto GP Saison 2026", "2026-11-29T14:00:00.000Z", riders, "moto")],
        });

        expect(result).toHaveLength(1);
        expect(Object.keys(result[0].byBookmaker).sort()).toEqual(["betclic", "unibet", "winamax"]);
      });

      it("pairs a number glued to its name or apart from it: Moto2 and Moto 2", () => {
        const result = matchEvents({
          winamax: [race("Moto2 - Championnat du Monde 2026", "2026-11-22T13:00:00.000Z", riders, "moto")],
          unibet: [race("Moto 2 Saison 2026", "2026-11-29T12:15:00.000Z", riders, "moto")],
        });

        expect(result).toHaveLength(1);
      });

      it("pairs a tour 22 days apart", () => {
        const peloton = { "Tadej Pogacar": 1.25, "Paul Seixas": 6, "Jonas Vingegaard": 6 };
        const result = matchEvents({
          winamax: [race("Tour de France 2027 - Compétition", "2027-07-26T00:00:00.000Z", peloton, "cyclisme")],
          unibet: [race("Tour de France 2027", "2027-07-04T23:59:00.000Z", peloton, "cyclisme")],
        });

        expect(result).toHaveLength(1);
      });

      it("pairs the Formula 2's championship, written Formule 2 or F2", () => {
        const drivers = { "Nikola Tsolov": 2.75, "Rafael Camara": 1.8, "Gabriele Mini": 35, "Alexander Dunne": 5 };
        const result = matchEvents({
          winamax: [race("Formule 2 - Ch. du Monde 2026", "2026-12-06T07:00:00.000Z", drivers, "automobile")],
          unibet: [race("Championnat du monde F2 2026", "2026-11-27T07:00:00.000Z", drivers, "automobile")],
        });

        expect(result).toHaveLength(1);
      });

      it("keeps apart a title's two editions, and an event more than 30 days from its namesake", () => {
        const peloton = { "Tadej Pogacar": 1.25, "Paul Seixas": 6, "Jonas Vingegaard": 6 };
        const tour = (start: string) => race("Tour de France 2027", start, peloton, "cyclisme");
        expect(matchEvents({ winamax: [tour("2027-07-26T00:00:00.000Z")], unibet: [tour("2026-07-04T00:00:00.000Z")] })).toHaveLength(2);
        expect(matchEvents({ winamax: [tour("2027-07-26T00:00:00.000Z")], unibet: [tour("2027-06-20T00:00:00.000Z")] })).toHaveLength(2);
      });

      it("keeps a race apart from the championship it counts for", () => {
        const result = matchEvents({
          winamax: [race("MotoGP - GP de Valence 2026 - Course", "2026-11-22T07:00:00.000Z", riders, "moto")],
          unibet: [race("Moto GP Saison 2026", "2026-11-29T14:00:00.000Z", riders, "moto")],
        });

        expect(result).toHaveLength(2);
      });

      it("keeps the men's and the women's apart", () => {
        const result = matchEvents({
          winamax: [race("Tournée des quatre tremplins - Hommes", "2026-12-29T00:00:00.000Z", riders, "saut à ski")],
          unibet: [race("Tournée des quatre tremplins - Femmes", "2027-01-05T00:00:00.000Z", riders, "saut à ski")],
        });

        expect(result).toHaveLength(2);
      });
    });

    it("never pairs a winner-among-N market with a head-to-head", () => {
      const result = matchEvents({
        betclic: [race("Duel", "2026-10-04T07:00:00.000Z", { "Max Verstappen": 1.8, "Lando Norris": 2 })],
        winamax: [event({ sport: "formule 1", startTime: "2026-10-04T07:00:00.000Z", participants: ["Max Verstappen", "Lando Norris"] })],
      });

      expect(result).toHaveLength(2);
    });
  });

  it("does not merge on shared words alone, without one participant matching exactly", () => {
    const result = matchEvents({
      betclic: [event({ participants: ["Alpha Lions", "Omega Tigers"] })],
      winamax: [event({ participants: ["Alpha Eagles", "Omega Wolves"] })],
    });

    expect(result).toHaveLength(2);
  });

  it("does not merge on a word common to many club names", () => {
    const result = matchEvents({
      betclic: [event({ participants: ["Nacional", "Racing Montevideo"] })],
      winamax: [event({ participants: ["Nacional", "Racing Avellaneda"] })],
    });

    expect(result).toHaveLength(2);
  });

  it("does not treat a club's women's or reserve side as a shortened name", () => {
    const result = matchEvents({
      betclic: [event({ participants: ["Olimpia Asuncion", "Libertad Asuncion"] })],
      winamax: [event({ participants: ["Olimpia Asuncion Femmes", "Libertad Asuncion Femmes"] })],
    });

    expect(result).toHaveLength(2);
  });

  it("pairs each event with its best counterpart, not the first one above the threshold", () => {
    const result = matchEvents({
      betclic: [
        event({ participants: ["Olympique Lyon", "Stade Rennes"] }),
        event({ participants: ["Olympique Lyonnais", "Stade Rennais"] }),
      ],
      winamax: [event({ participants: ["Olympique Lyonnais", "Stade Rennais"] })],
    });

    const merged = result.filter((e) => Object.keys(e.byBookmaker).length === 2);
    expect(merged).toHaveLength(1);
    expect(merged[0].participants).toEqual(["Olympique Lyonnais", "Stade Rennais"]);
  });

  it("gives one bookmaker's event to at most one event of the other", () => {
    const result = matchEvents({
      betclic: [event({ participants: ["Olympique Lyonnais", "Stade Rennais"] })],
      winamax: [
        event({ participants: ["Olympique Lyonnais", "Stade Rennais"], odds: [{ market: "1X2", selection: "1", price: 1.8 }] }),
        event({ participants: ["Olympique Lyon", "Stade Rennes"], odds: [{ market: "1X2", selection: "1", price: 9.9 }] }),
      ],
    });

    const merged = result.filter((e) => Object.keys(e.byBookmaker).length === 2);
    expect(merged).toHaveLength(1);
    expect(merged[0].byBookmaker.winamax[0].price).toBe(1.8);
    expect(result).toHaveLength(2);
  });

  // Real case found in production data: Winamax abbreviated "Seattle Sounders" to
  // just "Seattle" in its outcome label, which scores only 0.4375 similarity
  // against the full participant name -- well under NAME_SIMILARITY_THRESHOLD
  // (0.75), so the plain Levenshtein check alone can't canonicalize it.
  it("canonicalizes a club name abbreviated to its first word", () => {
    const result = matchEvents({
      winamax: [
        event({
          participants: ["Seattle Sounders", "Real Salt Lake"],
          odds: [{ market: "1X2", selection: "Seattle", price: 1.76 }],
        }),
      ],
    });

    expect(result[0].byBookmaker.winamax[0].selection).toBe("1");
  });

  // Real case found in production data: tennis outcomes are abbreviated to
  // "Initial. Lastname" (e.g. Winamax: "K. Quevedo" for "Kaitlin Quevedo"),
  // scoring only ~0.625 similarity -- also under threshold.
  it("canonicalizes an initial-plus-lastname tennis abbreviation", () => {
    const result = matchEvents({
      winamax: [
        event({
          sport: "tennis",
          participants: ["Kaitlin Quevedo", "Ana Bogdan"],
          odds: [{ market: "Vainqueur du match", selection: "K. Quevedo", price: 1.5 }],
        }),
      ],
    });

    expect(result[0].byBookmaker.winamax[0].selection).toBe("1");
  });

  // The realistic risk with an initial+lastname heuristic: two players sharing
  // a surname (e.g. tennis' Williams sisters). Their first initials still
  // differ, so this must resolve correctly, not just avoid a crash.
  it("disambiguates an initial-plus-lastname abbreviation between participants sharing a surname", () => {
    const result = matchEvents({
      winamax: [
        event({
          sport: "tennis",
          participants: ["Venus Williams", "Serena Williams"],
          odds: [
            { market: "Vainqueur du match", selection: "V. Williams", price: 1.9 },
            { market: "Vainqueur du match", selection: "S. Williams", price: 2.1 },
          ],
        }),
      ],
    });

    const odds = result[0].byBookmaker.winamax;
    expect(odds.find((o) => o.price === 1.9)?.selection).toBe("1");
    expect(odds.find((o) => o.price === 2.1)?.selection).toBe("2");
  });

  // The real risk the word-prefix/initial heuristics introduce: an abbreviation
  // that structurally matches BOTH participants (e.g. two clubs sharing a first
  // word). Must not guess -- picking either would be a wrong "best odds" signal,
  // worse than leaving it uncanonicalized.
  it("does not guess when an abbreviation structurally matches both participants", () => {
    const result = matchEvents({
      winamax: [
        event({
          participants: ["Real Madrid", "Real Sociedad"],
          odds: [{ market: "1X2", selection: "Real", price: 1.5 }],
        }),
      ],
    });

    expect(result[0].byBookmaker.winamax[0].selection).toBe("Real");
  });

  it("keeps where each bookmaker lists the event, in its own words and order", () => {
    const result = matchEvents({
      winamax: [event({ participants: ["AS Monaco", "Olympique de Marseille"], sourceId: "w1" })],
      betclic: [event({ participants: ["Olympique Marseille", "Monaco"], sourceId: "b1" }), event({ participants: ["Lyon", "Nice"] })],
    });

    expect(result).toHaveLength(2);
    expect(result[0].sources).toEqual({
      betclic: { sourceId: "b1", participants: ["Olympique Marseille", "Monaco"] },
      winamax: { sourceId: "w1", participants: ["AS Monaco", "Olympique de Marseille"] },
    });
    // No id given, none kept.
    expect(result[1].sources).toEqual({});
  });
});

// Real production case (2026-10-06): Unibet's "West. Sydney" abbreviates
// Betclic's "Western Sydney". "Sydney" is a shortened form of BOTH "Sydney FC"
// and "West. Sydney", so the swapped pairing scored as well as the right one
// and Unibet's 1.76 on Sydney landed on the away side: a surebet that did not
// exist.
describe("matchEvents with an abbreviated club name", () => {
  const betclic = event({
    participants: ["Sydney", "Western Sydney"],
    odds: [
      { market: "1X2", selection: "Sydney", price: 1.74 },
      { market: "1X2", selection: "Nul", price: 3.58 },
      { market: "1X2", selection: "Western Sydney", price: 3.27 },
    ],
  });
  const unibetOdds = [
    { market: "1X2", selection: "Sydney FC", price: 1.76 },
    { market: "1X2", selection: "N", price: 3.55 },
    { market: "1X2", selection: "West. Sydney", price: 3.25 },
  ];
  const priceOf = (result: ReturnType<typeof matchEvents>, selection: string) =>
    result[0].byBookmaker.unibet.find((o) => o.selection === selection)?.price;

  it("keeps each side's price on its own team, home team first", () => {
    const result = matchEvents({
      betclic: [betclic],
      unibet: [event({ participants: ["Sydney FC", "West. Sydney"], odds: unibetOdds })],
    });

    expect(result).toHaveLength(1);
    expect(priceOf(result, "1")).toBe(1.76);
    expect(priceOf(result, "X")).toBe(3.55);
    expect(priceOf(result, "2")).toBe(3.25);
  });

  it("keeps each side's price on its own team when Unibet lists the away team first", () => {
    const result = matchEvents({
      betclic: [betclic],
      unibet: [event({ participants: ["West. Sydney", "Sydney FC"], odds: [unibetOdds[2], unibetOdds[1], unibetOdds[0]] })],
    });

    expect(result).toHaveLength(1);
    expect(priceOf(result, "1")).toBe(1.76);
    expect(priceOf(result, "2")).toBe(3.25);
  });
});

// Real names of the Singapore Grand Prix's winner market (7/10/2026): Unibet
// abbreviates a driver's first names to their initials, Winamax and Betclic
// write them out.
describe("aligning a driver's abbreviated name across bookmakers", () => {
  it("reads two initials as the first name's: \"AK. Antonelli\" is \"Kimi Antonelli\" (Andrea Kimi)", () => {
    expect(alignCompetitors(["AK. Antonelli"], ["Kimi Antonelli"]).get("AK. Antonelli")).toBe("Kimi Antonelli");
    expect(alignCompetitors(["AK. Antonelli"], ["Andrea Kimi Antonelli"]).get("AK. Antonelli")).toBe("Andrea Kimi Antonelli");
  });

  it("leaves out a generational suffix", () => {
    expect(alignCompetitors(["C. Sainz Jr"], ["Carlos Sainz"]).get("C. Sainz Jr")).toBe("Carlos Sainz");
  });

  it("forgives a surname with two letters swapped, when the initial agrees", () => {
    // Winamax and Betclic write "Arvid Lindbald".
    expect(alignCompetitors(["A. Lindblad"], ["Arvid Lindbald"]).get("A. Lindblad")).toBe("Arvid Lindbald");
  });

  it("still keeps two drivers apart", () => {
    // Another first name, so another initial.
    expect(alignCompetitors(["AK. Antonelli"], ["Marco Antonelli"]).size).toBe(0);
    expect(alignCompetitors(["C. Sainz Jr"], ["Lando Sainz"]).size).toBe(0);
    // Another surname, close as it is.
    expect(alignCompetitors(["A. Albon"], ["Alexander Alonso"]).size).toBe(0);
  });

  it("puts a Grand Prix's drivers on one row, whichever way each bookmaker writes them", () => {
    const winners = (selections: string[], startTime: string, title: string): RawEvent =>
      event({
        sport: "formule 1",
        competition: "",
        startTime,
        participants: [title],
        odds: selections.map((selection) => ({ market: "Vainqueur", selection, price: 4 })),
      });
    const result = matchEvents({
      winamax: [
        winners(
          ["Max Verstappen", "Kimi Antonelli", "Carlos Sainz", "Arvid Lindbald", "Lando Norris"],
          "2026-10-11T12:00:00.000Z",
          "Grand Prix de Singapour 2026 - Course"
        ),
      ],
      unibet: [
        winners(
          ["M. Verstappen", "AK. Antonelli", "C. Sainz Jr", "A. Lindblad", "L. Norris"],
          "2026-10-11T12:00:00.000Z",
          "GP SIngapour - Course"
        ),
      ],
    });

    expect(result).toHaveLength(1);
    expect(result[0].byBookmaker.unibet.map((o) => o.selection)).toEqual(
      result[0].byBookmaker.winamax.map((o) => o.selection)
    );
  });
});

// Real matches of the Top 14 and the Pro D2 (9 to 11/10/2026): Winamax and
// Betclic write the clubs' full names, Unibet the city's.
describe("matchEvents with a rugby club written out or by its city", () => {
  const matches: Array<[start: string, written: [string, string], city: [string, string]]> = [
    ["2026-10-09T17:30:00.000Z", ["Stade Niçois", "USON Nevers"], ["Nice", "Nevers"]],
    ["2026-10-09T19:00:00.000Z", ["Stade Aurillacois", "Biarritz Olympique PB"], ["Aurillac", "Biarritz"]],
    ["2026-10-10T14:35:00.000Z", ["LOU Rugby", "Stade Rochelais"], ["Lyon", "La Rochelle"]],
    ["2026-10-10T14:35:00.000Z", ["Section Paloise", "Castres"], ["Pau", "Castres"]],
    ["2026-10-10T14:35:00.000Z", ["RC Toulonnais", "Racing 92"], ["Toulon", "Racing 92"]],
    ["2026-10-10T19:00:00.000Z", ["ASM Clermont", "UBB"], ["Clermont", "Bordeaux"]],
    ["2026-10-11T19:05:00.000Z", ["Stade Toulousain", "Aviron Bayonnais"], ["Toulouse", "Bayonne"]],
  ];

  it.each(matches)("pairs the match of %s, %j and %j", (startTime, written, city) => {
    const result = matchEvents({
      winamax: [event({ sport: "rugby à xv", competition: "Top 14", startTime, participants: written })],
      unibet: [event({ sport: "rugby à xv", competition: "TOP 14", startTime, participants: city })],
    });

    expect(result).toHaveLength(1);
    expect(Object.keys(result[0].byBookmaker).sort()).toEqual(["unibet", "winamax"]);
  });
});

// Real matches of 13 to 17/10/2026, in PMU's feed (11/10/2026): it writes "PSG"
// for Betclic's "Paris SG", "Wolves" for "Wolverhampton", and the clubs' local
// names where the others translate or shorten them.
describe("matchEvents with the names PMU gives a club", () => {
  const matches: Array<[start: string, others: [string, string], pmu: [string, string]]> = [
    ["2026-10-17T15:15:00.000Z", ["Strasbourg", "Paris SG"], ["Strasbourg", "PSG"]],
    ["2026-10-14T19:00:00.000Z", ["Manchester City", "Paris SG"], ["Manchester City", "PSG"]],
    ["2026-10-15T16:45:00.000Z", ["Lugano", "Étoile Rouge Belgrade"], ["Lugano", "Crvena Zvezda"]],
    ["2026-10-16T18:00:00.000Z", ["Laval", "Clermont"], ["Stade Lavallois", "Clermont"]],
    ["2026-10-17T14:15:00.000Z", ["Eibar", "Majorque"], ["Eibar", "Mallorca"]],
    ["2026-10-13T18:45:00.000Z", ["Wolverhampton", "Bolton"], ["Wolves", "Bolton"]],
    ["2026-10-16T19:00:00.000Z", ["Burnley", "Wolverhampton"], ["Burnley", "Wolves"]],
    ["2026-10-15T16:45:00.000Z", ["La Gantoise", "AGF Aarhus"], ["KAA Gent", "AGF Aarhus"]],
  ];

  it.each(matches)("pairs the match of %s, %j and %j", (startTime, others, pmu) => {
    const result = matchEvents({
      betclic: [event({ startTime, participants: others })],
      pmu: [event({ startTime, participants: pmu })],
    });

    expect(result).toHaveLength(1);
    expect(Object.keys(result[0].byBookmaker).sort()).toEqual(["betclic", "pmu"]);
  });
});

// Real matches of 9 to 10/10/2026, in Betsson's feed: it writes a club by its
// full legal name ("Fotbal Club FCSB"), by the French name of its city
// ("Brunswick" for Braunschweig) or in full ("FC Riga FS" for Rigas Futbola
// Skola), where Betclic and Winamax write another of them.
describe("matchEvents with the names Betsson gives a club", () => {
  const matches: Array<[start: string, others: Record<string, [string, string]>, betsson: [string, string]]> = [
    [
      "2026-10-10T18:30:00.000Z",
      { betclic: ["Steaua", "FC Otelul Galati"], winamax: ["FCSB ", "SC Otelul Galati"] },
      ["Fotbal Club FCSB", "ASC Otelul Galati"],
    ],
    [
      "2026-10-09T16:30:00.000Z",
      { betclic: ["Eintracht Braunschweig", "Holstein Kiel"], winamax: ["Eintracht Brunswick", "Holstein Kiel"] },
      ["Brunswick", "Holstein Kiel"],
    ],
    [
      "2026-10-11T13:00:00.000Z",
      { betclic: ["Rigas Futbola Skola", "Jelgava"], winamax: ["Rigas Futbola Skola", "Jelgava"] },
      ["FC Riga FS", "FK Jelgava"],
    ],
  ];

  it.each(matches)("pairs the match of %s with the other bookmakers', %j", (startTime, others, betsson) => {
    const result = matchEvents({
      ...Object.fromEntries(Object.entries(others).map(([id, participants]) => [id, [event({ startTime, participants })]])),
      betsson: [event({ startTime, participants: betsson })],
    });

    expect(result).toHaveLength(1);
    expect(Object.keys(result[0].byBookmaker)).toContain("betsson");
  });
});

describe("bySeedOrder", () => {
  it("puts Betclic, then Winamax first, the others after them in alphabetical order", () => {
    const sorted = ["vbet", "winamax", "betsson", "unibet", "betclic", "netbet"].sort(bySeedOrder);
    expect(sorted).toEqual(["betclic", "winamax", "betsson", "netbet", "unibet", "vbet"]);
  });
});

// Real matches of 9/10/2026 that listed twice because a club has two names no
// spelling rule can pair: a renamed club, a sponsor's name, a nickname, a
// translation. The second side of each is the other bookmaker's (Unibet's or
// Vbet's) spelling.
describe("matchEvents with the aliases of 9/10/2026", () => {
  const matches: Array<[sport: string, full: [string, string], other: [string, string]]> = [
    ["football", ["Penafiel", "AVS Futebol SAD"], ["Penafiel", "AVS Vila das Aves"]],
    ["football", ["Sepsi OSK Sfantu Gheorghe", "Dinamo Bucarest"], ["ACS Sepsi", "DinamoBucarest"]],
    ["football", ["Jalgpallikool Tammeka", "FC Nõmme United"], ["Tammeka Tartu", "FC Nomme Unite"]],
    ["football", ["Botosani", "UTA Arad"], ["Botosani", "ACS UTA Batrana Doamna"]],
    ["football", ["Ironi Kiryat Shmona", "Hapoel Tel-Aviv"], ["Hapoel Kiryat", "Hap.Tel Aviv"]],
    ["football", ["Qingdao West Coast", "Dalian Zhixing"], ["Qingdao Youth Island", "Dalian Yingbo"]],
    ["football", ["FC Arges", "CFR Cluj"], ["Argesul Pitesti", "CFR Cluj"]],
    ["football", ["Universitatea Cluj", "FC Rapid 1923"], ["Universit Cluj", "Rapid Bucarest"]],
    ["basketball", ["Le Havre", "Fos-sur-Mer"], ["Le Havre", "Fos Provence Basket"]],
    ["basketball", ["Chalon/Saône", "Nancy"], ["Elan Chalon", "SLUC Nancy Basket"]],
    ["basketball", ["Rio Natura Monbus Obradoiro", "Lleida Basquet"], ["Obradoiro CAB", "Força Lleida"]],
    ["basketball", ["Baskonia Vitoria", "Joventut Badalone"], ["Saski Baskonia", "Club Joventut Badalona"]],
    ["basketball", ["Abc Cantu", "Generazione Vincente Cuore Napoli"], ["Pallacanestro Cantù", "Napoli Basket"]],
    ["handball", ["MOL-Pick Szeged", "Sporting CP"], ["Pick Szeged", "Sporting Clube Portugal"]],
    ["hockey sur glace", ["Ferencvaros Budapest", "Vienne Capitals"], ["Ferencvarosi TC", "Vienna Capitals"]],
  ];

  it.each(matches)("pairs the %s match %j with %j", (sport, full, other) => {
    const result = matchEvents({
      betclic: [event({ sport, participants: full })],
      vbet: [event({ sport, participants: other })],
    });

    expect(result).toHaveLength(1);
  });

  it("still keeps apart a club and the other club of its name", () => {
    const result = matchEvents({
      betclic: [event({ participants: ["Universitatea Cluj", "FC Rapid 1923"] })],
      vbet: [event({ participants: ["Universitatea Craiova", "Rapid Vienne"] })],
    });

    expect(result).toHaveLength(2);
  });
});

describe("keepsSidesOrder", () => {
  // Merkur Bets's women's teams carry a leading "W", the others' a "(W)" at the
  // end: neither is a player's initial. Read as one, "Madrid CFF (W)" was "W
  // Atletico Madrid" ("W." and "Madrid"), and the Atlético's price was Madrid
  // CFF's (18/10/2026).
  it("does not read a women's team's W as an initial", () => {
    expect(keepsSidesOrder(["Atlético Madrid (W)", "Madrid CFF (W)"], ["W Atl. Madrid", "W Madrid CFF"])).toBe(true);
    expect(keepsSidesOrder(["Atlético Madrid (W)", "Madrid CFF (W)"], ["W Madrid CFF", "W Atl. Madrid"])).toBe(false);
  });

  it("reads the same side first under another bookmaker's spelling", () => {
    // Betclic's and Winamax's names for one basketball match (14/10/2026).
    expect(keepsSidesOrder(["Groningen", "Spirou Charleroi"], ["Donar Groningue", "Spirou Basket"])).toBe(true);
  });

  it("tells sides listed the other way round", () => {
    expect(keepsSidesOrder(["Groningen", "Spirou Charleroi"], ["Spirou Basket", "Donar Groningue"])).toBe(false);
  });

  it("has no sides to swap in an outright, and none to compare across sizes", () => {
    expect(keepsSidesOrder(["Masters"], ["US Masters"])).toBe(true);
    expect(keepsSidesOrder(["Masters"], ["PSG", "OM"])).toBe(false);
  });
});

// The winner of a competition of a sport with head-to-heads (Ligue 1, Roland-
// Garros, the NBA): an outright the bookmakers date each their own way (Vbet's
// next matchday, Unibet's season end, 9/10/2026), so the title and the
// contenders pair them, not the date.
describe("matchEvents, the winner of a competition", () => {
  const winner = (title: string, startTime: string, prices: Record<string, number>, sport = "football"): RawEvent => ({
    sport,
    competition: title,
    startTime,
    participants: [title],
    odds: Object.entries(prices).map(([selection, price]) => ({ market: "Vainqueur", selection, price })),
  });
  const ligue1 = { "Paris Saint-Germain": 1.5, "Olympique de Marseille": 6, "AS Monaco": 9, "Olympique Lyonnais": 12, "Lille": 15, "Stade Rennais": 30 };
  const premierLeague = { "Arsenal": 2.2, "Manchester City": 2.8, "Liverpool": 5, "Chelsea": 14, "Tottenham Hotspur": 30, "Newcastle United": 40 };
  const ligue2 = { "FC Lorient": 4, "Paris FC": 5, "FC Metz": 6, "Stade Lavallois": 15, "Amiens SC": 20, "Pau FC": 30 };

  it("pairs a league dated by its next matchday with the same league dated by its season's end", () => {
    const result = matchEvents({
      unibet: [winner("Ligue 1", "2027-05-23T19:00:00.000Z", ligue1)],
      vbet: [winner("Ligue 1 2026/2027", "2026-10-09T18:45:00.000Z", { ...ligue1, "Paris Saint-Germain": 1.45 })],
    });
    expect(result).toHaveLength(1);
    expect(Object.keys(result[0].byBookmaker).sort()).toEqual(["unibet", "vbet"]);
    // Listed until the latest of their dates, not the seed's.
    expect(result[0].startTime).toBe("2027-05-23T19:00:00.000Z");
    expect(result[0].participants).toEqual(["Ligue 1"]);
  });

  it("lines the clubs up under the first bookmaker's names, whichever date comes first", () => {
    const result = matchEvents({
      betclic: [winner("Ligue 1 McDonald's®", "2026-08-15T19:00:00.000Z", ligue1)],
      vbet: [winner("Ligue 1 2026/2027", "2026-10-09T18:45:00.000Z", { "Paris Saint Germain": 1.45, "Marseille": 6.5, "Monaco": 9.5, "Lille": 15 })],
    });
    expect(result).toHaveLength(1);
    expect(result[0].byBookmaker.vbet.map((o) => o.selection)).toEqual(["Paris Saint-Germain", "Olympique de Marseille", "AS Monaco", "Lille"]);
    // Past at the seed's, still to come at the other's.
    expect(result[0].startTime).toBe("2026-10-09T18:45:00.000Z");
  });

  it("writes a season as 2026/27, 2026/2027 or 2026 alike", () => {
    for (const title of ["Ligue 1 2026/27", "Ligue 1 2026/2027", "Ligue 1 2026-2027", "Ligue 1 2026"]) {
      const result = matchEvents({
        unibet: [winner("Ligue 1 2026/2027", "2027-05-23T19:00:00.000Z", ligue1)],
        vbet: [winner(title, "2026-10-09T18:45:00.000Z", ligue1)],
      });
      expect(result, title).toHaveLength(1);
    }
  });

  it("keeps apart two competitions with the same clubs: Ligue 1 and Ligue 2, a league and its cup", () => {
    const cup = { ...ligue1, "FC Lorient": 20, "Paris FC": 25 };
    expect(
      matchEvents({
        unibet: [winner("Ligue 1", "2027-05-23T19:00:00.000Z", { ...ligue1, ...ligue2 })],
        vbet: [winner("Ligue 2 2026/2027", "2027-05-23T19:00:00.000Z", ligue2)],
      })
    ).toHaveLength(2);
    expect(
      matchEvents({
        unibet: [winner("Ligue 1", "2027-05-23T19:00:00.000Z", ligue1)],
        vbet: [winner("Coupe de France 2026/2027", "2027-05-23T19:00:00.000Z", cup)],
      })
    ).toHaveLength(2);
  });

  it("keeps apart a part of a competition from the whole, whatever the title's words: half its field is not a league's", () => {
    const nba = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`Team ${i}`, 10 + i]));
    const west = Object.fromEntries(Array.from({ length: 15 }, (_, i) => [`Team ${i}`, 10 + i]));
    const result = matchEvents({
      unibet: [winner("NBA Cup 2026", "2026-12-11T00:00:00.000Z", nba, "basketball")],
      netbet: [winner("NBA Cup 2026 Conférence Ouest", "2026-12-11T00:00:00.000Z", west, "basketball")],
    });
    expect(result).toHaveLength(2);
  });

  it("keeps apart the men's and the women's, and one season from the next", () => {
    const clubs = { "FC Barcelone": 3, "Olympique Lyonnais": 5, "Chelsea": 6, "Arsenal": 8 };
    expect(
      matchEvents({
        unibet: [winner("Ligue des Champions 2026/2027", "2027-05-30T19:00:00.000Z", clubs)],
        vbet: [winner("Ligue des Champions (F) 2026/2027", "2027-05-30T19:00:00.000Z", clubs)],
      })
    ).toHaveLength(2);
    expect(
      matchEvents({
        unibet: [winner("Roland-Garros 2027", "2027-06-05T10:00:00.000Z", { "Carlos Alcaraz": 2, "Jannik Sinner": 2.5, "Novak Djokovic": 9 }, "tennis")],
        vbet: [winner("Roland-Garros 2028", "2028-06-03T10:00:00.000Z", { "Carlos Alcaraz": 2, "Jannik Sinner": 2.5, "Novak Djokovic": 9 }, "tennis")],
      })
    ).toHaveLength(2);
  });

  it("pairs a tournament's men's with the men's whether it is marked or not, and keeps the women's apart", () => {
    const men = { "Carlos Alcaraz": 2, "Jannik Sinner": 2.5, "Novak Djokovic": 9 };
    const women = { "Iga Swiatek": 3, "Aryna Sabalenka": 3.5, "Coco Gauff": 7 };
    const result = matchEvents({
      unibet: [
        winner("Roland-Garros 2027", "2027-06-05T10:00:00.000Z", men, "tennis"),
        winner("Roland-Garros 2027 Femmes", "2027-06-05T10:00:00.000Z", women, "tennis"),
      ],
      vbet: [
        winner("Roland-Garros (F) 2027", "2027-05-23T09:00:00.000Z", women, "tennis"),
        winner("Roland-Garros (H) 2027", "2027-05-23T09:00:00.000Z", men, "tennis"),
      ],
    });
    expect(result).toHaveLength(2);
    expect(result.map((r) => Object.keys(r.byBookmaker).sort())).toEqual([["unibet", "vbet"], ["unibet", "vbet"]]);
  });

  it("tells the leagues of one name apart by their clubs", () => {
    const welsh = { "The New Saints": 1.4, "Bala Town": 8, "Connah's Quay": 12 };
    const result = matchEvents({
      unibet: [winner("Premier League", "2027-05-23T15:00:00.000Z", premierLeague)],
      vbet: [
        winner("Premier League 2026/2027", "2026-10-17T11:30:00.000Z", welsh),
        winner("Premier League 2026/2027", "2026-10-17T14:00:00.000Z", premierLeague),
      ],
    });
    expect(result).toHaveLength(2);
    const english = result.find((r) => r.byBookmaker.unibet);
    expect(english?.byBookmaker.vbet.map((o) => o.selection)).toContain("Arsenal");
    expect(english?.byBookmaker.vbet.map((o) => o.selection)).not.toContain("Bala Town");
  });

  it("never pairs one with a match", () => {
    const result = matchEvents({
      unibet: [winner("Ligue 1", "2027-05-23T19:00:00.000Z", ligue1)],
      vbet: [event({ participants: ["Olympique de Marseille", "AS Monaco"], startTime: "2027-05-23T19:00:00.000Z" })],
    });
    expect(result).toHaveLength(2);
  });

  it("keeps the id of the seed whichever other bookmaker lists it", () => {
    const alone = matchEvents({ unibet: [winner("Ligue 1", "2027-05-23T19:00:00.000Z", ligue1)] });
    const paired = matchEvents({
      unibet: [winner("Ligue 1", "2027-05-23T19:00:00.000Z", ligue1)],
      vbet: [winner("Ligue 1 2026/2027", "2026-10-09T18:45:00.000Z", ligue1)],
    });
    expect(paired[0].id).toBe(alone[0].id);
  });

  it("pairs a hundred competitions at eleven bookmakers in a blink", () => {
    const clubs = (c: number) => Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`Club ${c}-${i}`, 2 + i]));
    const bookmakers = ["betclic", "winamax", "unibet", "pmu", "netbet", "genybet", "vbet", "circusbet", "daznbet", "betsson", "betify"];
    const events = Object.fromEntries(
      bookmakers.map((b, k) => [
        b,
        Array.from({ length: 100 }, (_, c) => winner(`Championnat ${String.fromCharCode(97 + (c % 26))}${c} 2026/2027`, `2026-1${k % 3}-09T18:45:00.000Z`, clubs(c))),
      ])
    );
    const started = Date.now();
    const result = matchEvents(events);
    expect(result).toHaveLength(100);
    expect(Date.now() - started).toBeLessThan(5000);
  });
});

describe("matchEvents, the winner of a competition: the titles of the real feeds", () => {
  const winner = (title: string, startTime: string, clubs: string[]): RawEvent => ({
    sport: "football",
    competition: title,
    startTime,
    participants: [title],
    odds: clubs.map((selection, i) => ({ market: "Vainqueur", selection, price: 2 + i })),
  });
  const clubs = ["Real Madrid", "FC Barcelone", "Bayern Munich", "Manchester City", "Arsenal", "Inter"];

  // Unibet's titles write the season "26/27", Vbet's "2026/2027" (9 to 14/10/2026), and
  // each names the same competitions in its own language.
  it.each([
    ["Ligue des Champions 26/27", "Ligue des Champions 2026/2027"],
    ["UEFA Champions League 26/27", "Ligue des Champions 2026/2027"],
    ["UEFA Europa League 26/27", "Ligue Europa - Compétition 2026/2027"],
    ["UEFA Conference League 26/27", "Ligue Conférence 2026/2027"],
    ["Euroleague 26/27", "Euroligue 2026/2027"],
    ["Ligue 1 26/27", "Ligue 1 2026/2027"],
    ["Serie A 26/27", "Serie A 2026/2027"],
  ])("pairs %s with %s", (unibet, vbet) => {
    const result = matchEvents({
      unibet: [winner(unibet, "2027-05-30T00:00:00.000Z", clubs)],
      vbet: [winner(vbet, "2026-10-15T16:45:00.000Z", clubs)],
    });
    expect(result).toHaveLength(1);
  });

  it("keeps apart 26/27 and 27/28, and a league from the one numbered above it", () => {
    expect(
      matchEvents({
        unibet: [winner("Ligue 1 26/27", "2027-05-30T00:00:00.000Z", clubs)],
        vbet: [winner("Ligue 1 2027/2028", "2028-05-30T00:00:00.000Z", clubs)],
      })
    ).toHaveLength(2);
    expect(
      matchEvents({
        unibet: [winner("Bundesliga 26/27", "2027-05-31T00:00:00.000Z", clubs)],
        vbet: [winner("2. Bundesliga 26/27", "2027-06-01T00:00:00.000Z", clubs)],
      })
    ).toHaveLength(2);
  });
});
