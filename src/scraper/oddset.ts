import { RawEvent } from "../types";
import { BookmakerScraper } from "./run";
import { ENTAIN_SPORTS, EntainFixture, EntainReply, EntainSite, entainUrl, fetchEntain, parseEntainFixtures } from "./entain";

// ODDSET's prices (the Lotto companies' sports betting, on Entain's platform,
// bwin's), from the API its site reads them from (www.oddset.de/cds-api, seen
// in its pages' requests, 19/10/2026, tests/scraper/fixtures/oddset-*.json),
// read as every Entain site is (./entain.ts). No challenge stands in front of it.

// The German betting tax, 5.3%. Taken off the whole price, as for
// bet-at-home.de (./betathome.ts): a price never shows more than it pays.
export const ODDSET_TAX = 0.053;

export const ODDSET: EntainSite = {
  id: "oddset",
  origin: "https://www.oddset.de",
  // The site's msApp.publicAccessId.
  accessId: "ZjE1ZjlmZDMtYTZlZC00OTQyLTlkYjgtNDZlOWMzZTMyZTI5",
  tax: ODDSET_TAX,
};

export const ODDSET_SPORTS = ENTAIN_SPORTS;
export type OddsetFixture = EntainFixture;
export type OddsetReply = EntainReply;

export const oddsetUrl = (sportId: string, skip: number): string => entainUrl(ODDSET, sportId, skip);

export const parseOddsetFixtures = (reply: OddsetReply, sportId: string): RawEvent[] => parseEntainFixtures(reply, sportId, ODDSET);

export const fetchOddset = (opts: { delayMs?: number } = {}): Promise<RawEvent[]> => fetchEntain(ODDSET, opts);

export const oddsetScraper: BookmakerScraper = { id: "oddset", fetch: fetchOddset };
