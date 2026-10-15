# CoteRadar improvements implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace both scrapers' Playwright/Cheerio DOM scraping with direct API clients (Winamax's Socket.IO odds feed, Betclic's gRPC-Web MatchService), add sport grouping and a sport `<select>` filter to the UI, and add result pagination.

**Architecture:** Each scraper keeps its existing `BookmakerScraper` contract (`{ id, fetch(): Promise<RawEvent[]> }`) so `runScrapeCycle`, the matcher, and the DB layer are untouched. Winamax's `fetch()` opens a `socket.io-client` connection and requests one snapshot per sport; Betclic's `fetch()` sends one plain HTTP POST per sport to its internal gRPC-Web endpoint and decodes the protobuf response with a small hand-rolled, schema-less wire-format reader (no `.proto` file is available). The API layer gains `GET /api/sports` and pagination on `GET /api/events`; the frontend groups results by sport, replaces the free-text filter with a `<select>`, and adds page controls.

**Tech Stack:** TypeScript, Node.js (`node:sqlite`), Express, React 19 + Vite, Vitest + Testing Library, `socket.io-client`.

**Spec:** [docs/superpowers/specs/2026-09-23-coteradar-improvements-design.md](../specs/2026-09-23-coteradar-improvements-design.md)

## Global Constraints

- `RawEvent`/`RawOdds`/`CanonicalEvent`/`EventWithOdds` (`src/types.ts`) do not change.
- `BookmakerScraper` (`src/scraper/run.ts`) and `runScrapeCycle`'s retry/error-isolation logic do not change.
- `src/matcher/match.ts` (`canonicalizeSelection`, `matchEvents`) does not change — it already normalizes raw selection labels like `"Match nul"`/`"Nul"`/team names into `"1"`/`"X"`/`"2"`, so both new fetchers must keep emitting `RawOdds.selection` as the raw label text (team name or draw label), exactly like the scrapers they replace.
- All new network code is defensive like the code it replaces: a match/field that fails to parse is skipped with a `console.warn`, never thrown, so one bad entry doesn't drop the whole fetch.
- Timestamps stored in `RawEvent.startTime` are always `Date.prototype.toISOString()` output (3-digit milliseconds, e.g. `"2026-09-23T16:45:00.000Z"`), matching the existing DB/API/frontend convention.

---

## File structure

| File | Responsibility |
|---|---|
| `src/scraper/protoWire.ts` (new) | Generic, schema-less protobuf wire-format reader + a minimal writer for building request messages. Not Betclic-specific. |
| `src/scraper/betclic.ts` (rewritten) | Betclic gRPC-Web fetch (`fetchBetclicSportFrame`, I/O) + protobuf-to-`RawEvent[]` mapping (`parseBetclicFrame`, pure) + `betclicScraper`. |
| `src/scraper/winamax.ts` (rewritten) | Winamax Socket.IO fetch (`fetchWinamaxSnapshot`, I/O) + snapshot-to-`RawEvent[]` mapping (`snapshotToRawEvents`, pure) + `winamaxScraper`. |
| `src/db/repository.ts` (modified) | Adds `getDistinctSports`; `getLatestEvents` gains pagination and returns an envelope. |
| `src/api/server.ts` (modified) | Adds `GET /api/sports`; `GET /api/events` passes through `page`/`pageSize`. |
| `web/src/api.ts` (modified) | `fetchSports()`; `fetchEvents()` takes `{ sport?, page? }` and returns the pagination envelope. |
| `web/src/groupBySport.ts` (new) | Pure `groupBySport(events)` util. |
| `web/src/GroupedOddsTables.tsx` (new) | Renders one heading + `OddsTable` per sport group. |
| `web/src/App.tsx` (modified) | Sport `<select>` (from `/api/sports`), pagination controls, renders `GroupedOddsTables`. |

Deleted as dead code once the above replaces what they supported: `src/scraper/parisTime.ts`, `scripts/capture-fixture.ts`, `tests/scraper/winamax.test.ts`, `tests/scraper/betclic.test.ts`, `tests/scraper/fixtures/winamax.html`, `tests/scraper/fixtures/betclic.html`. The `playwright` dependency is removed from `package.json`.

Fixtures already captured from the real, live endpoints and staged in the worktree at `tests/scraper/fixtures/` (untracked until the task that uses them commits it — see each task's Step 5/6):
- `winamax-sport1-snapshot.json` — a trimmed-but-real Socket.IO `"sport:1"` (football) snapshot, containing 2 real matches (Atlanta United FC vs New York City FC, Charlotte FC vs Chicago Fire) with their full `sports`/`tournaments`/`bets`/`outcomes`/`odds` entries.
- `winamax-home-snapshot.json` — a trimmed real `"home"` snapshot containing just `sportIds` (the 24 real sport IDs) and `mainMatchCount`.
- `winamax-japon-uruguay-snapshot.json` — a trimmed real Socket.IO `"sport:1"` snapshot containing exactly one match: Japon vs Uruguay (a friendly, kickoff `2026-09-24T10:05:00Z`). Used only by Task 5's rewritten cross-bookmaker regression test (see below) — this exact match is also present in `betclic-matchservice-response.bin`, confirmed live, which is what makes it useful: the two bookmakers give the same raw selection labels for it ("Japon"/"Match nul"(Winamax)~"Nul"(Betclic)/"Uruguay" — country names, not abbreviated by either bookmaker), so a real end-to-end run through both new parsers and the unchanged matcher proves canonicalization still works, the same guarantee the old `match.real-fixtures.test.ts` proved against the old HTML fixtures. (An earlier choice, Seattle Sounders vs Real Salt Lake, was dropped: Winamax abbreviates that specific club's outcome label to `"Seattle"`, which falls below the matcher's fixed 0.75 name-similarity threshold against the full `"Seattle Sounders"` participant name — a real, pre-existing matcher limitation, not something this migration should paper over or reach into `match.ts` to fix, since that file is out of scope. Country names avoid the whole class of abbreviation risk.)
- `betclic-matchservice-request.bin` — the real 22-byte gRPC-Web request frame for `{sport: "football", locale: "fr", limit: 1000}`.
- `betclic-matchservice-response.bin` — the real 68,173-byte gRPC-Web response frame for that request (40 real football matches, including Japon vs Uruguay — see above).

**Preflight-scan finding, ruled on before Task 1:** the plan as first drafted deleted `winamax.html`/`betclic.html` and `parseWinamaxHtml`/`parseBetclicHtml` (Tasks 2/3/5) without accounting for `tests/matcher/match.real-fixtures.test.ts`, which imports exactly those and would fail to compile once they're gone. That test is valuable — it's the only test that ever caught the real cross-bookmaker selection-canonicalization bug (its own header comment explains why) — so the ruling is to keep it, ported onto the new fixtures/functions, not delete it. Task 5 (below) now includes this port as its own step, using the `winamax-japon-uruguay-snapshot.json` fixture described above.

**Second preflight-scan finding, found during Task 5 execution:** the first attempt at this port picked Seattle Sounders vs Real Salt Lake specifically *because* the two bookmakers' raw labels differed ("Seattle" vs "Seattle Sounders"), meaning to demonstrate canonicalization surviving a real spelling mismatch. But the matcher's `canonicalizeSelection` (`src/matcher/match.ts`, unchanged, `NAME_SIMILARITY_THRESHOLD = 0.75`) computes normalized Levenshtein similarity between the raw label and the full participant name — `"Seattle"` vs `"Seattle Sounders"` scores 0.4375, below threshold, so canonicalization genuinely fails for this real match (it stays as the raw string `"Seattle"` instead of becoming `"1"`). This is not a regression introduced by this migration — the old DOM-scraped Winamax data would have hit the identical wall if it had ever scraped this same abbreviated label — but it makes this particular match a bad choice for a test whose whole point is confirming canonicalization *succeeds*. Ruling: switch to Japon vs Uruguay (country names, exact label match on both sides, no abbreviation), leaving `src/matcher/match.ts` untouched as the plan's Global Constraints require. Not a matcher bug to fix in this plan's scope — noted here in case a future improvement to `NAME_SIMILARITY_THRESHOLD` or the similarity function is ever warranted.

---

### Task 1: Generic protobuf wire-format reader/writer

**Files:**
- Create: `src/scraper/protoWire.ts`
- Test: `tests/scraper/protoWire.test.ts`

**Interfaces:**
- Produces: `interface ProtoField { fieldNumber: number; wireType: number; varint?: bigint; bytes?: Buffer; double?: number; float?: number }`, `decodeFields(buf: Buffer, start?: number, end?: number): ProtoField[]`, `fieldString(f: ProtoField): string`, `fieldMessage(f: ProtoField): ProtoField[]`, `fieldVarintNumber(f: ProtoField): number`, `fieldDouble(f: ProtoField): number`, `encodeStringField(fieldNumber: number, value: string): Buffer`, `encodeVarintField(fieldNumber: number, value: number): Buffer`.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/scraper/protoWire.test.ts
import { describe, it, expect } from "vitest";
import {
  decodeFields,
  fieldString,
  fieldMessage,
  fieldVarintNumber,
  fieldDouble,
  encodeStringField,
  encodeVarintField,
} from "../../src/scraper/protoWire";

describe("protoWire", () => {
  it("decodes a real captured request message (sport=football, locale=fr, limit=20)", () => {
    // Captured live from the Betclic MatchService endpoint -- see
    // docs/superpowers/specs/2026-09-23-coteradar-improvements-design.md.
    const bytes = Buffer.from("0a08666f6f7462616c6c1a0266722814", "hex");
    const fields = decodeFields(bytes);

    expect(fields).toHaveLength(3);
    expect(fieldString(fields[0])).toBe("football");
    expect(fields[0].fieldNumber).toBe(1);
    expect(fieldString(fields[1])).toBe("fr");
    expect(fields[1].fieldNumber).toBe(3);
    expect(fieldVarintNumber(fields[2])).toBe(20);
    expect(fields[2].fieldNumber).toBe(5);
  });

  it("decodes a nested message (wire type 2 containing more fields)", () => {
    // field 1 (varint)=7, wrapped inside field 2 (length-delimited)
    const inner = Buffer.concat([encodeVarintField(1, 7)]);
    const outer = Buffer.concat([encodeStringFieldRaw(2, inner)]);
    const fields = decodeFields(outer);

    expect(fields).toHaveLength(1);
    const nested = fieldMessage(fields[0]);
    expect(fieldVarintNumber(nested[0])).toBe(7);
  });

  it("decodes a 64-bit float (wire type 1)", () => {
    // Real captured odds price field: tag 0x62 = field 12, wire type 1.
    const buf = Buffer.alloc(9);
    buf.writeUInt8(0x62, 0);
    buf.writeDoubleLE(2.05, 1);
    const fields = decodeFields(buf);

    expect(fields).toHaveLength(1);
    expect(fields[0].fieldNumber).toBe(12);
    expect(fieldDouble(fields[0])).toBe(2.05);
  });

  it("round-trips encodeStringField/encodeVarintField through decodeFields", () => {
    const bytes = Buffer.concat([encodeStringField(1, "tennis"), encodeVarintField(5, 1000)]);
    const fields = decodeFields(bytes);

    expect(fieldString(fields[0])).toBe("tennis");
    expect(fieldVarintNumber(fields[1])).toBe(1000);
  });
});

// Test-only helper: encodeStringField takes a UTF-8 string, but the nested-message
// test needs to wrap already-encoded bytes -- not a real protoWire export, since
// no real caller needs to write a raw already-encoded submessage directly.
function encodeStringFieldRaw(fieldNumber: number, raw: Buffer): Buffer {
  const tag = Buffer.from([((fieldNumber << 3) | 2) & 0xff]);
  const len = Buffer.from([raw.length]);
  return Buffer.concat([tag, len, raw]);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/scraper/protoWire.test.ts`
Expected: FAIL with "Cannot find module '../../src/scraper/protoWire'"

- [ ] **Step 3: Write the implementation**

```typescript
// src/scraper/protoWire.ts
//
// A generic, schema-less protobuf wire-format reader/writer. No .proto file
// is available for Betclic's internal gRPC-Web API (confirmed by inspecting
// its minified JS bundle -- see docs/superpowers/specs/2026-09-23-coteradar-improvements-design.md),
// so this walks the wire format directly (field number + wire type + value)
// instead of using a generated/typed client.

export interface ProtoField {
  fieldNumber: number;
  wireType: number; // 0 = varint, 1 = 64-bit, 2 = length-delimited, 5 = 32-bit
  varint?: bigint;
  bytes?: Buffer;
  double?: number;
  float?: number;
}

function readVarint(buf: Buffer, pos: number): [bigint, number] {
  let result = 0n;
  let shift = 0n;
  let p = pos;
  while (true) {
    const b = buf[p];
    result |= BigInt(b & 0x7f) << shift;
    p++;
    if ((b & 0x80) === 0) break;
    shift += 7n;
  }
  return [result, p];
}

export function decodeFields(buf: Buffer, start = 0, end: number = buf.length): ProtoField[] {
  const fields: ProtoField[] = [];
  let pos = start;
  while (pos < end) {
    const [tag, afterTag] = readVarint(buf, pos);
    const fieldNumber = Number(tag >> 3n);
    const wireType = Number(tag & 0x7n);
    pos = afterTag;

    if (wireType === 0) {
      const [value, after] = readVarint(buf, pos);
      fields.push({ fieldNumber, wireType, varint: value });
      pos = after;
    } else if (wireType === 1) {
      fields.push({ fieldNumber, wireType, double: buf.readDoubleLE(pos) });
      pos += 8;
    } else if (wireType === 5) {
      fields.push({ fieldNumber, wireType, float: buf.readFloatLE(pos) });
      pos += 4;
    } else if (wireType === 2) {
      const [len, afterLen] = readVarint(buf, pos);
      const dataStart = afterLen;
      const dataEnd = afterLen + Number(len);
      fields.push({ fieldNumber, wireType, bytes: buf.subarray(dataStart, dataEnd) });
      pos = dataEnd;
    } else {
      // Wire types 3/4 (deprecated start/end group) are not used by any
      // message observed in captured traffic -- fail loudly rather than
      // silently misparsing the rest of the buffer.
      throw new Error(`protoWire: unsupported wire type ${wireType} at byte ${pos}`);
    }
  }
  return fields;
}

export function fieldString(f: ProtoField): string {
  if (f.bytes === undefined) throw new Error(`protoWire: field ${f.fieldNumber} is not length-delimited`);
  return f.bytes.toString("utf8");
}

export function fieldMessage(f: ProtoField): ProtoField[] {
  if (f.bytes === undefined) throw new Error(`protoWire: field ${f.fieldNumber} is not length-delimited`);
  return decodeFields(f.bytes);
}

export function fieldVarintNumber(f: ProtoField): number {
  if (f.varint === undefined) throw new Error(`protoWire: field ${f.fieldNumber} is not a varint`);
  return Number(f.varint);
}

export function fieldDouble(f: ProtoField): number {
  if (f.double === undefined) throw new Error(`protoWire: field ${f.fieldNumber} is not a 64-bit value`);
  return f.double;
}

// --- writer (for building Betclic request messages) ---

function writeVarint(n: number | bigint): Buffer {
  const bytes: number[] = [];
  let v = BigInt(n);
  while (true) {
    const b = Number(v & 0x7fn);
    v >>= 7n;
    if (v !== 0n) {
      bytes.push(b | 0x80);
    } else {
      bytes.push(b);
      break;
    }
  }
  return Buffer.from(bytes);
}

function writeTag(fieldNumber: number, wireType: number): Buffer {
  return writeVarint((fieldNumber << 3) | wireType);
}

export function encodeStringField(fieldNumber: number, value: string): Buffer {
  const strBuf = Buffer.from(value, "utf8");
  return Buffer.concat([writeTag(fieldNumber, 2), writeVarint(strBuf.length), strBuf]);
}

export function encodeVarintField(fieldNumber: number, value: number): Buffer {
  return Buffer.concat([writeTag(fieldNumber, 0), writeVarint(value)]);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/scraper/protoWire.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/scraper/protoWire.ts tests/scraper/protoWire.test.ts
git commit -m "feat: add schema-less protobuf wire-format reader/writer"
```

---

### Task 2: Betclic gRPC-Web fetch + parse, replacing Playwright/Cheerio

**Files:**
- Modify (full rewrite): `src/scraper/betclic.ts`
- Test (full rewrite): `tests/scraper/betclic.test.ts`
- Delete: `tests/scraper/fixtures/betclic.html`
- Already present: `tests/scraper/fixtures/betclic-matchservice-request.bin`, `tests/scraper/fixtures/betclic-matchservice-response.bin`

**Interfaces:**
- Consumes: `decodeFields`, `fieldString`, `fieldMessage`, `fieldVarintNumber`, `fieldDouble`, `encodeStringField`, `encodeVarintField` from `./protoWire` (Task 1). `RawEvent`, `RawOdds` from `../types`. `BookmakerScraper` from `./run`.
- Produces: `parseBetclicFrame(frameBytes: Buffer): RawEvent[]` (pure), `fetchBetclicSportFrame(sportSlug: string): Promise<Buffer>` (I/O), `betclicScraper: BookmakerScraper`.

**Verified real field map** (from the committed fixture, and cross-checked against what the live page renders — see the spec doc for the full decode trace): a response frame's outer message has one field 1 (the catalog wrapper); inside that, each repeated field 3 is one match:
- `.1` varint match id (unused)
- `.3` string start time, e.g. `"2026-09-23T16:45:00.0000000Z"` (7 fractional digits; `new Date(...).toISOString()` correctly normalizes this to 3 digits)
- `.8` message: competition info — `.2` string competition name, `.3` message sport info — `.1` string sport slug (e.g. `"football"`)
- `.9` message: main market — `.2` string market name, repeated `.16` message per selection — `.10` string selection label, `.12` float64 price
- repeated `.12` message: contestants — `.3` string team name (in participant order)

- [ ] **Step 1: Write the failing test**

```typescript
// tests/scraper/betclic.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseBetclicFrame } from "../../src/scraper/betclic";

const FIXTURE_PATH = join(__dirname, "fixtures/betclic-matchservice-response.bin");

// The committed fixture is a real gRPC-Web response frame with its 5-byte
// frame header (flag + big-endian length) already stripped by the capture
// script -- parseBetclicFrame takes the protobuf message bytes directly.
function loadFixtureMessageBytes(): Buffer {
  const raw = readFileSync(FIXTURE_PATH);
  const declaredLen = raw.readUInt32BE(1);
  return raw.subarray(5, 5 + declaredLen);
}

describe("parseBetclicFrame", () => {
  it("parses real Betclic match data into RawEvent[]", () => {
    const events = parseBetclicFrame(loadFixtureMessageBytes());

    expect(events.length).toBeGreaterThan(30); // fixture has 40 real football matches

    const first = events[0];
    expect(first.sport).toBe("football");
    expect(first.competition).toBe("Ligue des Champions F.");
    expect(first.startTime).toBe("2026-09-23T16:45:00.000Z");
    expect(first.participants).toEqual(["Servette FC Chenois F.", "OL Lyonnes F."]);
    expect(first.odds).toEqual([
      { market: "Résultat du match (t. rég)", selection: "Servette FC Chenois F.", price: 30 },
      { market: "Résultat du match (t. rég)", selection: "Nul", price: 15 },
      { market: "Résultat du match (t. rég)", selection: "OL Lyonnes F.", price: 1.01 },
    ]);
  });

  it("returns an empty array for a message with no matches", () => {
    expect(parseBetclicFrame(Buffer.alloc(0))).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/scraper/betclic.test.ts`
Expected: FAIL — `parseBetclicFrame` doesn't exist yet (old `betclic.ts` still has the DOM-scraping exports)

- [ ] **Step 3: Write the implementation**

```typescript
// src/scraper/betclic.ts
import {
  decodeFields,
  fieldString,
  fieldMessage,
  fieldDouble,
  encodeStringField,
  encodeVarintField,
  ProtoField,
} from "./protoWire";
import { RawEvent, RawOdds } from "../types";
import { BookmakerScraper } from "./run";

const MATCH_SERVICE_URL =
  "https://offering.begmedia.com/web/offering.access.api/offering.access.api.MatchService/GetMatchesBySportWithNotifications";

// Betclic's internal sport slugs, as used by this endpoint's request field 1.
// "football" is verified extensively against live traffic (the committed
// fixture). "tennis", "basketball", and "ice_hockey" are verified live (each
// returns HTTP 200 with a valid gRPC-Web frame header). The rest follow the
// same naming convention, confirmed against the sport-icon asset filenames
// Betclic's own sidebar loads (sport_baseball.svg, sport_biathlon.svg, etc.)
// but are not individually live-verified -- fetchAllBetclicSports (Task 2,
// Step 3 below) skips and warns on any slug the live endpoint rejects, rather
// than failing the whole scrape.
export const BETCLIC_SPORT_SLUGS = [
  "football",
  "tennis",
  "basketball",
  "ice_hockey",
  "baseball",
  "biathlon",
  "boxing",
  "cycling",
  "american_football",
  "australian_rules",
  "formula_1",
];

// Requesting more matches than actually exist for a sport is a no-op --
// verified live: response size plateaus once the limit exceeds the true
// count (100 vs 300 vs 1000 all returned the same 40 football matches). So a
// generously large limit always returns the sport's entire current catalog
// in a single response frame.
const REQUEST_LIMIT = 1000;

function buildRequestBody(sportSlug: string): Buffer {
  const message = Buffer.concat([
    encodeStringField(1, sportSlug),
    encodeStringField(3, "fr"),
    encodeVarintField(5, REQUEST_LIMIT),
  ]);
  const header = Buffer.alloc(5); // flag byte (0x00) + 4-byte big-endian length
  header.writeUInt32BE(message.length, 1);
  return Buffer.concat([header, message]);
}

// GetMatchesBySportWithNotifications is a server-streaming RPC: after the
// first frame (the full match-catalog snapshot) it keeps the connection open
// and pushes live-odds deltas. This project polls on an interval
// (POLL_INTERVAL_MINUTES) rather than holding a live connection open, so this
// reads only until the first complete frame has arrived and then aborts,
// returning that frame's protobuf message bytes (with its 5-byte gRPC-Web
// frame header stripped).
export async function fetchBetclicSportFrame(sportSlug: string): Promise<Buffer> {
  const controller = new AbortController();
  const res = await fetch(MATCH_SERVICE_URL, {
    method: "POST",
    headers: {
      "content-type": "application/grpc-web+proto",
      "x-grpc-web": "1",
      "x-bg-regulation": "FR",
      "x-bg-ref-brand": "BETCLIC",
      "x-bg-ref-regulator-zone": "FR",
      "x-bg-ref-platform": "DESKTOP",
      appversion: "10.5.0-0",
    },
    body: buildRequestBody(sportSlug),
    signal: controller.signal,
  });

  if (!res.ok || !res.body) {
    throw new Error(`Betclic MatchService POST (${sportSlug}) failed: ${res.status}`);
  }

  const reader = res.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  let declaredFrameEnd: number | null = null;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      chunks.push(Buffer.from(value));
      total += value.length;
      if (declaredFrameEnd === null && total >= 5) {
        const header = Buffer.concat(chunks).subarray(0, 5);
        declaredFrameEnd = header.readUInt32BE(1) + 5;
      }
      if (declaredFrameEnd !== null && total >= declaredFrameEnd) break;
    }
  } finally {
    controller.abort();
  }

  if (declaredFrameEnd === null) {
    throw new Error(`Betclic MatchService (${sportSlug}): response too short to contain a frame header`);
  }
  return Buffer.concat(chunks).subarray(5, declaredFrameEnd);
}

function findField(fields: ProtoField[], num: number): ProtoField | undefined {
  return fields.find((f) => f.fieldNumber === num);
}

// Betclic renders start times with 7 fractional-second digits
// ("2026-09-23T16:45:00.0000000Z"); JS's Date parses this fine, and its own
// toISOString() always normalizes back to exactly 3 digits, matching every
// other timestamp this project stores.
function normalizeTimestamp(raw: string): string {
  return new Date(raw).toISOString();
}

function matchToRawEvent(match: ProtoField[]): RawEvent | null {
  const startTimeField = findField(match, 3);
  const competitionField = findField(match, 8);
  const marketField = findField(match, 9);
  const contestantFields = match.filter((f) => f.fieldNumber === 12);
  if (!startTimeField || !competitionField || !marketField || contestantFields.length < 2) return null;

  const competition = fieldMessage(competitionField);
  const competitionNameField = findField(competition, 2);
  const sportInfoField = findField(competition, 3);
  if (!competitionNameField || !sportInfoField) return null;
  const sportSlugField = findField(fieldMessage(sportInfoField), 1);
  if (!sportSlugField) return null;

  const participants = contestantFields
    .map((f) => findField(fieldMessage(f), 3))
    .filter((f): f is ProtoField => f !== undefined)
    .map(fieldString);
  if (participants.length < 2) return null;

  const market = fieldMessage(marketField);
  const marketNameField = findField(market, 2);
  if (!marketNameField) return null;
  const marketName = fieldString(marketNameField);

  const odds: RawOdds[] = market
    .filter((f) => f.fieldNumber === 16)
    .map((f) => fieldMessage(f))
    .map((selection): RawOdds | null => {
      const labelField = findField(selection, 10);
      const priceField = findField(selection, 12);
      if (!labelField || !priceField) return null;
      return { market: marketName, selection: fieldString(labelField), price: fieldDouble(priceField) };
    })
    .filter((o): o is RawOdds => o !== null);
  if (odds.length === 0) return null;

  return {
    sport: fieldString(sportSlugField),
    competition: fieldString(competitionNameField),
    startTime: normalizeTimestamp(fieldString(startTimeField)),
    participants,
    odds,
  };
}

export function parseBetclicFrame(frameBytes: Buffer): RawEvent[] {
  if (frameBytes.length === 0) return [];
  const rootFields = decodeFields(frameBytes);
  const wrapperField = findField(rootFields, 1);
  if (!wrapperField) return [];
  const wrapperFields = fieldMessage(wrapperField);

  const events: RawEvent[] = [];
  for (const matchField of wrapperFields.filter((f) => f.fieldNumber === 3)) {
    const event = matchToRawEvent(fieldMessage(matchField));
    if (event) events.push(event);
  }
  return events;
}

async function fetchAllBetclicSports(): Promise<RawEvent[]> {
  const events: RawEvent[] = [];
  for (const slug of BETCLIC_SPORT_SLUGS) {
    try {
      const frame = await fetchBetclicSportFrame(slug);
      events.push(...parseBetclicFrame(frame));
    } catch (err) {
      // An unverified slug (see BETCLIC_SPORT_SLUGS) or a transient failure
      // for one sport must not drop every other sport's odds -- runScrapeCycle
      // already retries the whole fetch() once, so a truly transient failure
      // gets a second chance at the outer level.
      console.warn(`[scraper:betclic] fetch failed for sport "${slug}":`, err);
    }
  }
  return events;
}

export const betclicScraper: BookmakerScraper = {
  id: "betclic",
  fetch: fetchAllBetclicSports,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/scraper/betclic.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Delete the old HTML fixture and update `.gitignore`-adjacent state**

```bash
git rm tests/scraper/fixtures/betclic.html
```

- [ ] **Step 6: Commit**

```bash
git add src/scraper/betclic.ts tests/scraper/betclic.test.ts tests/scraper/fixtures/betclic-matchservice-request.bin tests/scraper/fixtures/betclic-matchservice-response.bin
git commit -m "feat: fetch Betclic odds via its gRPC-Web API instead of scraping the DOM"
```

---

### Task 3: Winamax snapshot-to-RawEvent mapping (pure, TDD against the fixture)

**Files:**
- Modify (full rewrite, this task's portion only): `src/scraper/winamax.ts` (pure mapping section)
- Test (full rewrite): `tests/scraper/winamax.test.ts`
- Delete: `tests/scraper/fixtures/winamax.html`
- Already present: `tests/scraper/fixtures/winamax-sport1-snapshot.json`, `tests/scraper/fixtures/winamax-home-snapshot.json`

**Interfaces:**
- Consumes: `RawEvent`, `RawOdds` from `../types`.
- Produces: `interface WinamaxSnapshot { sports: Record<string, { sportName: string }>; tournaments: Record<string, { tournamentName: string }>; matches: Record<string, WinamaxMatch>; bets: Record<string, WinamaxBet>; outcomes: Record<string, { label: string }>; odds: Record<string, number> }` and `snapshotToRawEvents(snapshot: WinamaxSnapshot): RawEvent[]` (pure). This task only adds these to `winamax.ts`; Task 4 adds the I/O half (`fetchWinamaxSnapshot`) and the exported `winamaxScraper` to the same file.

**Verified real field map** (from the committed fixture): `matches[id].sportId` looks up `sports[sportId].sportName` (e.g. `"Football"`); `matches[id].tournamentId` looks up `tournaments[tournamentId].tournamentName`; `matches[id].matchStart` is a Unix timestamp in **seconds**; `matches[id].competitor1Name`/`competitor2Name` are the two participants in order; `matches[id].mainBetId` looks up `bets[mainBetId]`, whose `.betTitle` is the market name and `.outcomes` is an array of outcome IDs, each looked up in `outcomes[id].label` (selection label) and `odds[id]` (price).

- [ ] **Step 1: Write the failing test**

```typescript
// tests/scraper/winamax.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { snapshotToRawEvents, WinamaxSnapshot } from "../../src/scraper/winamax";

const FIXTURE_PATH = join(__dirname, "fixtures/winamax-sport1-snapshot.json");

function loadFixture(): WinamaxSnapshot {
  return JSON.parse(readFileSync(FIXTURE_PATH, "utf8"));
}

describe("snapshotToRawEvents", () => {
  it("maps real Winamax snapshot data into RawEvent[]", () => {
    const events = snapshotToRawEvents(loadFixture());

    expect(events).toHaveLength(2);

    const atlanta = events.find((e) => e.participants.includes("Atlanta United FC"));
    expect(atlanta).toEqual({
      sport: "football",
      competition: "Major League Soccer",
      startTime: "2026-09-26T23:30:00.000Z",
      participants: ["Atlanta United FC", "New York City FC"],
      odds: [
        { market: "Résultat", selection: "Atlanta United FC", price: 2.05 },
        { market: "Résultat", selection: "Match nul", price: 3.45 },
        { market: "Résultat", selection: "New York City FC", price: 2.75 },
      ],
    });

    const charlotte = events.find((e) => e.participants.includes("Charlotte FC"));
    expect(charlotte?.odds).toEqual([
      { market: "Résultat", selection: "Charlotte FC", price: 2.05 },
      { market: "Résultat", selection: "Match nul", price: 3.65 },
      { market: "Résultat", selection: "Chicago Fire", price: 2.65 },
    ]);
  });

  it("skips a match whose sport, tournament, or main bet can't be resolved", () => {
    const snapshot: WinamaxSnapshot = {
      sports: {},
      tournaments: {},
      matches: {
        "1": {
          sportId: 999,
          tournamentId: 999,
          mainBetId: 999,
          matchStart: 1790465400,
          competitor1Name: "A",
          competitor2Name: "B",
        },
      },
      bets: {},
      outcomes: {},
      odds: {},
    };

    expect(snapshotToRawEvents(snapshot)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/scraper/winamax.test.ts`
Expected: FAIL — `snapshotToRawEvents` doesn't exist yet

- [ ] **Step 3: Write the implementation (replaces the entire old file)**

```typescript
// src/scraper/winamax.ts
import { RawEvent, RawOdds } from "../types";
import { BookmakerScraper } from "./run";

export interface WinamaxMatch {
  sportId: number;
  tournamentId: number;
  mainBetId: number;
  matchStart: number; // Unix timestamp, seconds
  competitor1Name: string;
  competitor2Name: string;
}

export interface WinamaxBet {
  betTitle: string;
  outcomes: number[];
}

export interface WinamaxSnapshot {
  sports: Record<string, { sportName: string }>;
  tournaments: Record<string, { tournamentName: string }>;
  matches: Record<string, WinamaxMatch>;
  bets: Record<string, WinamaxBet>;
  outcomes: Record<string, { label: string }>;
  odds: Record<string, number>;
}

export function snapshotToRawEvents(snapshot: WinamaxSnapshot): RawEvent[] {
  const events: RawEvent[] = [];

  for (const match of Object.values(snapshot.matches)) {
    const sport = snapshot.sports[match.sportId];
    const tournament = snapshot.tournaments[match.tournamentId];
    const bet = snapshot.bets[match.mainBetId];
    if (!sport || !tournament || !bet) continue;

    const odds: RawOdds[] = bet.outcomes
      .map((outcomeId): RawOdds | null => {
        const outcome = snapshot.outcomes[outcomeId];
        const price = snapshot.odds[outcomeId];
        if (!outcome || price === undefined) return null;
        return { market: bet.betTitle, selection: outcome.label, price };
      })
      .filter((o): o is RawOdds => o !== null);
    if (odds.length === 0) continue;

    events.push({
      sport: sport.sportName.toLowerCase(),
      competition: tournament.tournamentName,
      startTime: new Date(match.matchStart * 1000).toISOString(),
      participants: [match.competitor1Name, match.competitor2Name],
      odds,
    });
  }

  return events;
}

// fetchWinamaxSnapshot and winamaxScraper are added in Task 4.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/scraper/winamax.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Delete the old HTML fixture** (mirrors Task 2's Step 5 — this task's rewrite of `src/scraper/winamax.ts` in Step 3 already removed every code reference to it)

```bash
git rm tests/scraper/fixtures/winamax.html
```

- [ ] **Step 6: Commit**

```bash
git add src/scraper/winamax.ts tests/scraper/winamax.test.ts tests/scraper/fixtures/winamax-sport1-snapshot.json tests/scraper/fixtures/winamax-home-snapshot.json
git commit -m "feat: map Winamax's real odds-feed snapshot shape into RawEvent[]"
```

---

### Task 4: Winamax Socket.IO connection (I/O), wiring `winamaxScraper`

**Files:**
- Modify: `src/scraper/winamax.ts` (add to the file from Task 3)
- Modify: `package.json` (add `socket.io-client` dependency)

**Interfaces:**
- Consumes: `WinamaxSnapshot`, `snapshotToRawEvents` (this file, Task 3). `BookmakerScraper` from `./run`.
- Produces: `fetchWinamaxSnapshot(): Promise<WinamaxSnapshot>`, `winamaxScraper: BookmakerScraper` (both appended to `src/scraper/winamax.ts`).

**Verified live protocol** (captured from the real endpoint — see the spec doc): connect via `socket.io-client@2.4.0` (Engine.IO v3, matching the server's `EIO=3` query param — v4 of the client does not speak this protocol) to `https://sports-eu-west-3.winamax.fr`, path `/uof-sports-server/socket.io`, query `{ language: "FR", version: "3.65.0", embed: "false" }`, transport `["websocket"]`. After `connect`, `emit("m", { route: "home", requestId })` returns a snapshot whose `sportIds` field lists every sport ID (verified: 24 real IDs). For each sport ID, `emit("m", { route: "sport:" + id, requestId })` returns that sport's **entire** current match catalog in one response (verified live: for football, this returned exactly 682 matches, matching the `"home"` snapshot's own reported `sports["1"].mainMatchCount`). The server echoes back whatever `requestId` was sent on the matching response, which is how each request is correlated to its response.

- [ ] **Step 1: Install the dependency**

```bash
npm install socket.io-client@2.4.0
```

- [ ] **Step 2: Write the failing test (mocks the socket, no live connection)**

```typescript
// tests/scraper/winamax.test.ts -- append to the existing describe blocks
import { EventEmitter } from "node:events";
import { vi } from "vitest";

vi.mock("socket.io-client", () => {
  return {
    io: vi.fn(() => {
      const emitter = new EventEmitter() as EventEmitter & { emit: (event: string, ...args: unknown[]) => boolean };
      const responses: Record<string, unknown> = {
        home: { sportIds: [1] },
        "sport:1": {
          sports: { "1": { sportName: "Football" } },
          tournaments: { "18": { tournamentName: "Major League Soccer" } },
          matches: {
            "66299580": {
              sportId: 1,
              tournamentId: 18,
              mainBetId: 699803926,
              matchStart: 1790465400,
              competitor1Name: "Atlanta United FC",
              competitor2Name: "New York City FC",
            },
          },
          bets: { "699803926": { betTitle: "Résultat", outcomes: [1] } },
          outcomes: { "1": { label: "Atlanta United FC" } },
          odds: { "1": 2.05 },
        },
      };

      const originalEmit = emitter.emit.bind(emitter);
      emitter.emit = (event: string, ...args: unknown[]) => {
        if (event === "m") {
          const payload = args[0] as { route: string; requestId: string };
          const response = { ...(responses[payload.route] as object), requestId: payload.requestId };
          setImmediate(() => originalEmit("m", response));
          return true;
        }
        return originalEmit(event, ...args);
      };

      setImmediate(() => originalEmit("connect"));
      return emitter;
    }),
  };
});

describe("fetchWinamaxSnapshot", () => {
  it("discovers sportIds via the home route, then merges each sport's snapshot", async () => {
    const { fetchWinamaxSnapshot } = await import("../../src/scraper/winamax");
    const snapshot = await fetchWinamaxSnapshot();

    expect(Object.keys(snapshot.matches)).toEqual(["66299580"]);
    expect(snapshot.sports["1"].sportName).toBe("Football");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/scraper/winamax.test.ts`
Expected: FAIL — `fetchWinamaxSnapshot` doesn't exist yet

- [ ] **Step 4: Append the implementation to `src/scraper/winamax.ts`**

```typescript
// Append to src/scraper/winamax.ts (after snapshotToRawEvents)
import { io, Socket } from "socket.io-client";
import { randomUUID } from "node:crypto";

const WINAMAX_WS_URL = "https://sports-eu-west-3.winamax.fr";
const SOCKET_PATH = "/uof-sports-server/socket.io";
const ROUTE_TIMEOUT_MS = 15000;

function emptySnapshot(): WinamaxSnapshot {
  return { sports: {}, tournaments: {}, matches: {}, bets: {}, outcomes: {}, odds: {} };
}

function mergeSnapshot(target: WinamaxSnapshot, incoming: Partial<WinamaxSnapshot>): void {
  for (const key of ["sports", "tournaments", "matches", "bets", "outcomes", "odds"] as const) {
    const value = incoming[key];
    if (value) Object.assign(target[key], value);
  }
}

// The server echoes back whatever requestId was sent on the matching "m"
// response (verified live), which is how a specific request is distinguished
// from an unrelated live-odds delta that might arrive between requests.
function requestRoute(socket: Socket, route: string): Promise<Record<string, unknown>> {
  const requestId = randomUUID();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off("m", onMessage);
      reject(new Error(`Winamax route "${route}" timed out`));
    }, ROUTE_TIMEOUT_MS);

    function onMessage(data: Record<string, unknown>) {
      if (data.requestId !== requestId) return;
      clearTimeout(timeout);
      socket.off("m", onMessage);
      resolve(data);
    }

    socket.on("m", onMessage);
    socket.emit("m", { route, requestId });
  });
}

export async function fetchWinamaxSnapshot(): Promise<WinamaxSnapshot> {
  const snapshot = emptySnapshot();

  const socket = io(WINAMAX_WS_URL, {
    path: SOCKET_PATH,
    query: { language: "FR", version: "3.65.0", embed: "false" },
    transports: ["websocket"],
    timeout: ROUTE_TIMEOUT_MS,
  });

  try {
    await new Promise<void>((resolve, reject) => {
      socket.once("connect", () => resolve());
      socket.once("connect_error", (err: Error) => reject(err));
    });

    const home = await requestRoute(socket, "home");
    mergeSnapshot(snapshot, home as Partial<WinamaxSnapshot>);

    const sportIds = (home.sportIds as number[]) ?? [];
    for (const sportId of sportIds) {
      try {
        const page = await requestRoute(socket, `sport:${sportId}`);
        mergeSnapshot(snapshot, page as Partial<WinamaxSnapshot>);
      } catch (err) {
        // One sport failing to respond in time must not drop every other
        // sport's odds -- mirrors Betclic's per-sport isolation (Task 2).
        console.warn(`[scraper:winamax] fetch failed for sportId ${sportId}:`, err);
      }
    }
  } finally {
    socket.close();
  }

  return snapshot;
}

export const winamaxScraper: BookmakerScraper = {
  id: "winamax",
  fetch: async () => snapshotToRawEvents(await fetchWinamaxSnapshot()),
};
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/scraper/winamax.test.ts`
Expected: PASS (all winamax.test.ts tests, including Task 3's)

- [ ] **Step 6: Commit**

```bash
git add src/scraper/winamax.ts tests/scraper/winamax.test.ts package.json package-lock.json
git commit -m "feat: fetch Winamax odds via its Socket.IO feed instead of scraping the DOM"
```

---

### Task 5: Port the cross-bookmaker regression test, then remove dead code (Playwright, old fixtures, parisTime, capture-fixture script)

**Files:**
- Modify (full rewrite): `tests/matcher/match.real-fixtures.test.ts` — currently imports `parseWinamaxHtml`/`parseBetclicHtml` and reads `winamax.html`/`betclic.html`; must be ported onto `snapshotToRawEvents`/`parseBetclicFrame` and the new fixtures *before* those old fixtures/functions are deleted, or the suite won't compile.
- Already staged in the worktree: `tests/scraper/fixtures/winamax-japon-uruguay-snapshot.json` (see File Structure above).
- Delete: `src/scraper/parisTime.ts`, `scripts/capture-fixture.ts` (`winamax.html`/`betclic.html` are deleted by Task 3's Step 5 and Task 2's Step 5 respectively, not here)
- Modify: `package.json` (remove `playwright` dependency)

Neither new fetcher needs wall-clock timezone resolution (both sources give absolute timestamps directly), DOM scraping, or a browser at all.

- [ ] **Step 1: Rewrite `tests/matcher/match.real-fixtures.test.ts` to use the new parsers and fixtures**

```typescript
// tests/matcher/match.real-fixtures.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { snapshotToRawEvents, WinamaxSnapshot } from "../../src/scraper/winamax";
import { parseBetclicFrame } from "../../src/scraper/betclic";
import { matchEvents } from "../../src/matcher/match";
import { CanonicalEvent, RawOdds } from "../../src/types";

// End-to-end regression test for the cross-bookmaker selection-canonicalization
// bug: real captured API data -> real parsers -> real matcher. Every other
// matcher test builds synthetic RawEvent objects with already-canonical
// selections ("1"), which is exactly why this bug shipped originally -- no
// test ever let real bookmaker-specific outcome labels cross the
// parser/matcher boundary. This test deliberately fabricates nothing.
//
// The real match: Japon vs Uruguay (a friendly), present in both live
// captures with matching raw selection labels on both sides --
// Winamax: "Japon" / "Match nul" / "Uruguay"
// Betclic:  "Japon" / "Nul"       / "Uruguay"
// -- both bookmakers use the plain country name for a national team (never
// abbreviated), which is why this match was chosen over a club match: an
// earlier attempt used Seattle Sounders vs Real Salt Lake, but Winamax
// abbreviates that outcome to "Seattle", which falls below the matcher's
// fixed 0.75 name-similarity threshold against the full "Seattle Sounders"
// participant name -- a real, pre-existing matcher limitation (src/matcher/match.ts
// is out of scope for this plan), not a bug this test should paper over by
// picking a match where canonicalization happens to fail. Country names
// avoid that whole class of risk. If canonicalization ever regresses on a
// name that DOES match exactly, this is the test that catches it.

const FIXTURES_DIR = join(__dirname, "../scraper/fixtures");

function loadWinamaxEvents() {
  const snapshot: WinamaxSnapshot = JSON.parse(
    readFileSync(join(FIXTURES_DIR, "winamax-japon-uruguay-snapshot.json"), "utf-8")
  );
  return snapshotToRawEvents(snapshot);
}

function loadBetclicEvents() {
  const raw = readFileSync(join(FIXTURES_DIR, "betclic-matchservice-response.bin"));
  const declaredLen = raw.readUInt32BE(1);
  return parseBetclicFrame(raw.subarray(5, 5 + declaredLen));
}

function selectionsFor(odds: RawOdds[]): string[] {
  return odds.map((o) => o.selection).sort();
}

describe("matchEvents over real captured API data", () => {
  let sharedEvent: CanonicalEvent;

  const winamaxEvents = loadWinamaxEvents();
  const betclicEvents = loadBetclicEvents();

  // Sanity: both fixtures really did parse into real events.
  expect(winamaxEvents.length).toBeGreaterThan(0);
  expect(betclicEvents.length).toBeGreaterThan(0);

  const allMatched = matchEvents({ winamax: winamaxEvents, betclic: betclicEvents });
  const shared = allMatched.filter((e) => Object.keys(e.byBookmaker).length === 2);
  // Documented real-data assertion: the Winamax fixture contains exactly the
  // one match also present in the (40-match) Betclic fixture.
  expect(shared).toHaveLength(1);
  sharedEvent = shared[0];

  it("finds the one real match present in both bookmakers' captures", () => {
    expect(sharedEvent.sport).toBe("football");
    expect(sharedEvent.participants).toEqual(["Japon", "Uruguay"]);
    expect(Object.keys(sharedEvent.byBookmaker).sort()).toEqual(["betclic", "winamax"]);
  });

  it("aligns both bookmakers' selection labels onto the same canonical keys", () => {
    const winamax = sharedEvent.byBookmaker.winamax;
    const betclic = sharedEvent.byBookmaker.betclic;

    // The core assertion: the two bookmakers' sets of selection keys are EQUAL --
    // real labels from both real parsers, run through the real, unchanged matcher.
    // This is what makes cross-bookmaker comparison possible at all.
    expect(selectionsFor(winamax)).toEqual(selectionsFor(betclic));
    expect(selectionsFor(winamax)).toEqual(["1", "2", "X"]);
  });

  it("gives every canonical selection a real price from BOTH bookmakers", () => {
    for (const selection of ["1", "X", "2"]) {
      const winamaxOdd = sharedEvent.byBookmaker.winamax.find((o) => o.selection === selection);
      const betclicOdd = sharedEvent.byBookmaker.betclic.find((o) => o.selection === selection);

      expect(winamaxOdd, `winamax is missing selection "${selection}"`).toBeDefined();
      expect(betclicOdd, `betclic is missing selection "${selection}"`).toBeDefined();
      expect(winamaxOdd!.price).toBeGreaterThan(1);
      expect(betclicOdd!.price).toBeGreaterThan(1);
    }

    // Concretely, on this real data the two books genuinely disagree, so the
    // "meilleure cote" highlight has something real to point at: the away
    // price differs materially (3.75 Winamax vs 4.00 Betclic).
    const winamaxAway = sharedEvent.byBookmaker.winamax.find((o) => o.selection === "2")!;
    const betclicAway = sharedEvent.byBookmaker.betclic.find((o) => o.selection === "2")!;
    expect(betclicAway.price).toBeGreaterThan(winamaxAway.price);
  });
});
```

- [ ] **Step 2: Run the test to verify it passes**

Run: `npx vitest run tests/matcher/match.real-fixtures.test.ts`
Expected: PASS (3 tests) — confirms the port is correct before the old fixtures/functions it used to depend on are deleted

- [ ] **Step 3: Commit the ported test**

```bash
git add tests/matcher/match.real-fixtures.test.ts tests/scraper/fixtures/winamax-japon-uruguay-snapshot.json
git commit -m "test: port the cross-bookmaker regression test onto the new API parsers"
```

- [ ] **Step 4: Confirm nothing still references the code about to be removed**

Run: `grep -rl "parisTime\|from \"playwright\"\|from 'playwright'\|parseWinamaxHtml\|parseBetclicHtml" --include="*.ts" src tests scripts`
Expected: no matches (Tasks 2–4 and Step 1 above already removed every other reference)

- [ ] **Step 5: Delete the files**

`winamax.html`/`betclic.html` are not included here — Task 3's Step 5 and Task 2's Step 5 already removed them.

```bash
git rm src/scraper/parisTime.ts scripts/capture-fixture.ts
```

- [ ] **Step 6: Remove the `playwright` dependency**

```bash
npm uninstall playwright
```

- [ ] **Step 7: Run the full test suite to confirm nothing broke**

Run: `npm test`
Expected: PASS, no test references the deleted files

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "chore: remove Playwright and DOM-scraping dead code after the API migration"
```

---

### Task 6: `GET /api/sports`

**Files:**
- Modify: `src/db/repository.ts`
- Modify: `src/api/server.ts`
- Test: `tests/api/server.test.ts` (extend)

**Interfaces:**
- Produces: `getDistinctSports(db: DatabaseSync): string[]` in `src/db/repository.ts`. Route `GET /api/sports` returning `string[]` as JSON.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/api/server.test.ts -- add a new describe block
describe("GET /api/sports", () => {
  let db: DatabaseSync;
  const hoursFromNow = (h: number) => new Date(Date.now() + h * 60 * 60 * 1000).toISOString();

  beforeEach(() => {
    db = openDb(":memory:");
    upsertCanonicalEvents(db, [
      {
        id: "evt1",
        sport: "football",
        competition: "Ligue 1",
        startTime: hoursFromNow(2),
        participants: ["PSG", "OM"],
        byBookmaker: { winamax: [{ market: "1X2", selection: "1", price: 1.5 }] },
      },
      {
        id: "evt2",
        sport: "tennis",
        competition: "ATP Paris",
        startTime: hoursFromNow(3),
        participants: ["Nadal", "Alcaraz"],
        byBookmaker: { betclic: [{ market: "winner", selection: "Nadal", price: 2.1 }] },
      },
    ]);
  });

  it("returns every distinct sport with data, sorted alphabetically", async () => {
    const res = await request(createServer(db)).get("/api/sports");
    expect(res.status).toBe(200);
    expect(res.body).toEqual(["football", "tennis"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/api/server.test.ts -t "GET /api/sports"`
Expected: FAIL with 404 (route doesn't exist)

- [ ] **Step 3: Add `getDistinctSports` to `src/db/repository.ts`**

```typescript
// Append to src/db/repository.ts
export function getDistinctSports(db: DatabaseSync): string[] {
  const rows = db.prepare(`SELECT DISTINCT sport FROM events ORDER BY sport`).all() as { sport: string }[];
  return rows.map((r) => r.sport);
}
```

- [ ] **Step 4: Add the route in `src/api/server.ts`**

```typescript
// src/api/server.ts -- add the import and route
import { getLatestEvents, getDistinctSports } from "../db/repository";
// ...
  app.get("/api/sports", (_req, res) => {
    res.json(getDistinctSports(db));
  });
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/api/server.test.ts -t "GET /api/sports"`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/db/repository.ts src/api/server.ts tests/api/server.test.ts
git commit -m "feat: add GET /api/sports for the frontend's sport select"
```

---

### Task 7: Pagination on `GET /api/events`

**Files:**
- Modify: `src/db/repository.ts` (`getLatestEvents`)
- Modify: `src/api/server.ts`
- Modify: `tests/api/server.test.ts` (existing assertions on `res.body` need to move to `res.body.events`)

**Interfaces:**
- Produces: `getLatestEvents(db: DatabaseSync, opts?: { sport?: string; page?: number; pageSize?: number }): { events: EventWithOdds[]; total: number; page: number; pageSize: number }`. Route `GET /api/events` accepts `?page=` and `?pageSize=` in addition to the existing `?sport=`.
- Breaking change: the JSON body of `GET /api/events` becomes `{ events, total, page, pageSize }` instead of a bare array. The only consumer is this project's own frontend (Task 8 updates it in the same plan).

- [ ] **Step 1: Update the existing tests for the new envelope shape, and add pagination tests**

```typescript
// tests/api/server.test.ts -- replace the existing "GET /api/events" describe block's
// body assertions and add pagination coverage
describe("GET /api/events", () => {
  let db: DatabaseSync;
  const hoursFromNow = (h: number) => new Date(Date.now() + h * 60 * 60 * 1000).toISOString();

  beforeEach(() => {
    db = openDb(":memory:");
    const events: CanonicalEvent[] = [
      {
        id: "evt1",
        sport: "football",
        competition: "Ligue 1",
        startTime: hoursFromNow(2),
        participants: ["PSG", "OM"],
        byBookmaker: { winamax: [{ market: "1X2", selection: "1", price: 1.5 }] },
      },
      {
        id: "evt2",
        sport: "tennis",
        competition: "ATP Paris",
        startTime: hoursFromNow(26),
        participants: ["Nadal", "Alcaraz"],
        byBookmaker: { betclic: [{ market: "winner", selection: "Nadal", price: 2.1 }] },
      },
    ];
    upsertCanonicalEvents(db, events);
  });

  it("returns all events with their bookmakers' odds, wrapped in a pagination envelope", async () => {
    const res = await request(createServer(db)).get("/api/events");
    expect(res.status).toBe(200);
    expect(res.body.events).toHaveLength(2);
    expect(res.body).toMatchObject({ total: 2, page: 1, pageSize: 20 });
  });

  it("filters by sport", async () => {
    const res = await request(createServer(db)).get("/api/events?sport=tennis");
    expect(res.status).toBe(200);
    expect(res.body.events).toHaveLength(1);
    expect(res.body.events[0].id).toBe("evt2");
    expect(res.body.total).toBe(1);
  });

  it("paginates results", async () => {
    const db2 = openDb(":memory:");
    const manyEvents: CanonicalEvent[] = Array.from({ length: 25 }, (_, i) => ({
      id: `evt-page-${i}`,
      sport: "football",
      competition: "Ligue 1",
      startTime: hoursFromNow(1 + i * 0.01),
      participants: [`Team ${i}A`, `Team ${i}B`],
      byBookmaker: { winamax: [{ market: "1X2", selection: "1", price: 1.5 }] },
    }));
    upsertCanonicalEvents(db2, manyEvents);

    const page1 = await request(createServer(db2)).get("/api/events?pageSize=20");
    expect(page1.body.events).toHaveLength(20);
    expect(page1.body).toMatchObject({ total: 25, page: 1, pageSize: 20 });

    const page2 = await request(createServer(db2)).get("/api/events?pageSize=20&page=2");
    expect(page2.body.events).toHaveLength(5);
    expect(page2.body.page).toBe(2);
  });

  it("still serves the API as JSON now that static file serving is mounted", async () => {
    const res = await request(createServer(db)).get("/api/events");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/application\/json/);
    expect(Array.isArray(res.body.events)).toBe(true);
  });

  it("404s on an unknown path instead of crashing when the frontend build is absent", async () => {
    const res = await request(createServer(db)).get("/definitely-not-a-real-asset.js");
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/api/server.test.ts`
Expected: FAIL — `res.body.events` is `undefined` (current handler returns a bare array)

- [ ] **Step 3: Rewrite `getLatestEvents` in `src/db/repository.ts`**

```typescript
// Replace the existing getLatestEvents in src/db/repository.ts
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

export interface EventsPage {
  events: EventWithOdds[];
  total: number;
  page: number;
  pageSize: number;
}

export function getLatestEvents(
  db: DatabaseSync,
  opts: { sport?: string; page?: number; pageSize?: number } = {}
): EventsPage {
  const since = new Date(Date.now() - EVENT_FRESHNESS_WINDOW_MS).toISOString();
  const page = opts.page && opts.page > 0 ? Math.floor(opts.page) : 1;
  const pageSize = opts.pageSize && opts.pageSize > 0 ? Math.min(Math.floor(opts.pageSize), MAX_PAGE_SIZE) : DEFAULT_PAGE_SIZE;

  const conditions = ["start_time >= @since"];
  const params: Record<string, string> = { since };
  if (opts.sport) {
    conditions.push("sport = @sport");
    params.sport = opts.sport;
  }
  const whereClause = conditions.join(" AND ");

  const total = (
    db.prepare(`SELECT COUNT(*) as count FROM events WHERE ${whereClause}`).get(params) as { count: number }
  ).count;

  const pageIdRows = db
    .prepare(`SELECT id FROM events WHERE ${whereClause} ORDER BY start_time ASC LIMIT @limit OFFSET @offset`)
    .all({ ...params, limit: pageSize, offset: (page - 1) * pageSize }) as { id: string }[];
  const pageIds = pageIdRows.map((r) => r.id);

  if (pageIds.length === 0) {
    return { events: [], total, page, pageSize };
  }

  const idParams: Record<string, string> = {};
  const idPlaceholders = pageIds.map((id, i) => {
    idParams[`id${i}`] = id;
    return `@id${i}`;
  });

  const rows = db
    .prepare(
      `SELECT e.id, e.sport, e.competition, e.start_time as startTime, e.participants,
              o.bookmaker_id as bookmakerId, o.market, o.selection, o.price, o.scraped_at as scrapedAt
       FROM events e
       JOIN event_bookmaker_odds o ON o.event_id = e.id
       WHERE e.id IN (${idPlaceholders.join(", ")})`
    )
    .all(idParams) as unknown as OddsRow[];

  const eventsById = new Map<string, EventWithOdds>();
  for (const row of rows) {
    let event = eventsById.get(row.id);
    if (!event) {
      event = {
        id: row.id,
        sport: row.sport,
        competition: row.competition,
        startTime: row.startTime,
        participants: JSON.parse(row.participants),
        byBookmaker: {},
      };
      eventsById.set(row.id, event);
    }
    if (!event.byBookmaker[row.bookmakerId]) {
      event.byBookmaker[row.bookmakerId] = { scrapedAt: row.scrapedAt, odds: [] };
    }
    event.byBookmaker[row.bookmakerId].odds.push({ market: row.market, selection: row.selection, price: row.price });
  }

  // Re-derive final order from pageIds (itself ORDER BY start_time ASC)
  // rather than relying on the join query's row order / Map insertion order.
  const events = pageIds.map((id) => eventsById.get(id)).filter((e): e is EventWithOdds => e !== undefined);

  return { events, total, page, pageSize };
}
```

Remove the old `getLatestEvents` (the join-query-with-conditions version) entirely — this replaces it, not adds alongside it.

- [ ] **Step 4: Update the route in `src/api/server.ts`**

```typescript
// src/api/server.ts -- replace the /api/events handler
  app.get("/api/events", (req, res) => {
    const sport = typeof req.query.sport === "string" ? req.query.sport : undefined;
    const page = typeof req.query.page === "string" ? Number(req.query.page) : undefined;
    const pageSize = typeof req.query.pageSize === "string" ? Number(req.query.pageSize) : undefined;
    res.json(getLatestEvents(db, { sport, page, pageSize }));
  });
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/api/server.test.ts`
Expected: PASS (all tests, including the 3 new/updated ones)

- [ ] **Step 6: Commit**

```bash
git add src/db/repository.ts src/api/server.ts tests/api/server.test.ts
git commit -m "feat: paginate GET /api/events"
```

---

### Task 8: Frontend API client — `fetchSports`, paginated `fetchEvents`

**Files:**
- Modify: `web/src/api.ts`
- Test (new): `web/src/api.test.ts`

**Interfaces:**
- Produces: `interface EventsPage { events: EventWithOdds[]; total: number; page: number; pageSize: number }`, `fetchEvents(opts?: { sport?: string; page?: number }): Promise<EventsPage>`, `fetchSports(): Promise<string[]>`.

- [ ] **Step 1: Write the failing test**

```typescript
// web/src/api.test.ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchEvents, fetchSports } from "./api";

describe("fetchEvents", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("requests /api/events with sport and page as query params", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ events: [], total: 0, page: 2, pageSize: 20 }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchEvents({ sport: "tennis", page: 2 });

    expect(fetchMock).toHaveBeenCalledWith("/api/events?sport=tennis&page=2");
    expect(result).toEqual({ events: [], total: 0, page: 2, pageSize: 20 });
  });

  it("requests /api/events with no query params when called with no options", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ events: [], total: 0, page: 1, pageSize: 20 }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await fetchEvents();

    expect(fetchMock).toHaveBeenCalledWith("/api/events");
  });
});

describe("fetchSports", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("requests /api/sports and returns the sport list", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(["football", "tennis"]) });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchSports();

    expect(fetchMock).toHaveBeenCalledWith("/api/sports");
    expect(result).toEqual(["football", "tennis"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/api.test.ts`
Expected: FAIL — `fetchSports` doesn't exist, `fetchEvents` has the wrong signature

- [ ] **Step 3: Rewrite `web/src/api.ts`**

```typescript
// web/src/api.ts
import type { EventWithOdds } from "./types";

export interface EventsPage {
  events: EventWithOdds[];
  total: number;
  page: number;
  pageSize: number;
}

export async function fetchEvents(opts: { sport?: string; page?: number } = {}): Promise<EventsPage> {
  const params = new URLSearchParams();
  if (opts.sport) params.set("sport", opts.sport);
  if (opts.page) params.set("page", String(opts.page));
  const qs = params.toString();
  const url = qs ? `/api/events?${qs}` : "/api/events";

  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} failed: ${res.status}`);
  return res.json();
}

export async function fetchSports(): Promise<string[]> {
  const res = await fetch("/api/sports");
  if (!res.ok) throw new Error(`GET /api/sports failed: ${res.status}`);
  return res.json();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run src/api.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add web/src/api.ts web/src/api.test.ts
git commit -m "feat: fetchSports + paginated fetchEvents in the frontend API client"
```

---

### Task 9: `groupBySport` utility

**Files:**
- Create: `web/src/groupBySport.ts`
- Test: `web/src/groupBySport.test.ts`

**Interfaces:**
- Produces: `groupBySport(events: EventWithOdds[]): Array<[sport: string, events: EventWithOdds[]]>`.

- [ ] **Step 1: Write the failing test**

```typescript
// web/src/groupBySport.test.ts
import { describe, it, expect } from "vitest";
import { groupBySport } from "./groupBySport";
import type { EventWithOdds } from "./types";

function makeEvent(id: string, sport: string): EventWithOdds {
  return { id, sport, competition: "X", startTime: "2026-09-23T16:45:00.000Z", participants: ["A", "B"], byBookmaker: {} };
}

describe("groupBySport", () => {
  it("groups events by sport and sorts groups alphabetically", () => {
    const events = [makeEvent("1", "tennis"), makeEvent("2", "football"), makeEvent("3", "football")];

    const groups = groupBySport(events);

    expect(groups.map(([sport]) => sport)).toEqual(["football", "tennis"]);
    expect(groups[0][1].map((e) => e.id)).toEqual(["2", "3"]);
    expect(groups[1][1].map((e) => e.id)).toEqual(["1"]);
  });

  it("returns an empty array for no events", () => {
    expect(groupBySport([])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/groupBySport.test.ts`
Expected: FAIL — module doesn't exist

- [ ] **Step 3: Write the implementation**

```typescript
// web/src/groupBySport.ts
import type { EventWithOdds } from "./types";

export function groupBySport(events: EventWithOdds[]): Array<[string, EventWithOdds[]]> {
  const bySport = new Map<string, EventWithOdds[]>();
  for (const event of events) {
    const group = bySport.get(event.sport);
    if (group) group.push(event);
    else bySport.set(event.sport, [event]);
  }
  return Array.from(bySport.entries()).sort(([a], [b]) => a.localeCompare(b));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run src/groupBySport.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add web/src/groupBySport.ts web/src/groupBySport.test.ts
git commit -m "feat: add groupBySport util for grouping the odds table by sport"
```

---

### Task 10: `GroupedOddsTables` component

**Files:**
- Create: `web/src/GroupedOddsTables.tsx`
- Test: `web/src/GroupedOddsTables.test.tsx`

**Interfaces:**
- Consumes: `groupBySport` (Task 9), `OddsTable` from `./OddsTable` (unchanged).
- Produces: `GroupedOddsTables({ events }: { events: EventWithOdds[] })`.

- [ ] **Step 1: Write the failing test**

```typescript
// web/src/GroupedOddsTables.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { GroupedOddsTables } from "./GroupedOddsTables";
import type { EventWithOdds } from "./types";

const events: EventWithOdds[] = [
  {
    id: "1",
    sport: "tennis",
    competition: "ATP",
    startTime: "2026-09-23T16:45:00.000Z",
    participants: ["Nadal", "Alcaraz"],
    byBookmaker: {},
  },
  {
    id: "2",
    sport: "football",
    competition: "Ligue 1",
    startTime: "2026-09-23T16:45:00.000Z",
    participants: ["PSG", "OM"],
    byBookmaker: {},
  },
];

describe("GroupedOddsTables", () => {
  it("renders one heading per sport, in alphabetical order", () => {
    render(<GroupedOddsTables events={events} />);

    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual(["football", "tennis"]);
  });

  it("renders each event's participants under its sport's section", () => {
    render(<GroupedOddsTables events={events} />);

    expect(screen.getByText("PSG - OM")).toBeInTheDocument();
    expect(screen.getByText("Nadal - Alcaraz")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/GroupedOddsTables.test.tsx`
Expected: FAIL — module doesn't exist

- [ ] **Step 3: Write the implementation**

```tsx
// web/src/GroupedOddsTables.tsx
import type { EventWithOdds } from "./types";
import { OddsTable } from "./OddsTable";
import { groupBySport } from "./groupBySport";

export function GroupedOddsTables({ events }: { events: EventWithOdds[] }) {
  return (
    <>
      {groupBySport(events).map(([sport, sportEvents]) => (
        <section key={sport}>
          <h2>{sport}</h2>
          <OddsTable events={sportEvents} />
        </section>
      ))}
    </>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run src/GroupedOddsTables.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add web/src/GroupedOddsTables.tsx web/src/GroupedOddsTables.test.tsx
git commit -m "feat: add GroupedOddsTables, rendering one OddsTable section per sport"
```

---

### Task 11: `App.tsx` — sport select, pagination controls, grouped rendering

**Files:**
- Modify: `web/src/App.tsx`

No new test file — consistent with the existing codebase, which does not unit-test `App.tsx` (it's wiring over already-tested pieces: `fetchEvents`/`fetchSports` from Task 8, `GroupedOddsTables` from Task 10). Verified instead via `npm run build` + manual check (Step 3 below).

**Interfaces:**
- Consumes: `fetchEvents`, `fetchSports` (Task 8), `GroupedOddsTables` (Task 10).

- [ ] **Step 1: Rewrite `web/src/App.tsx`**

```tsx
// web/src/App.tsx
import { useEffect, useState } from "react";
import { fetchEvents, fetchSports } from "./api";
import { GroupedOddsTables } from "./GroupedOddsTables";
import type { EventWithOdds } from "./types";

const POLL_MS = 30_000;

export function App() {
  const [events, setEvents] = useState<EventWithOdds[]>([]);
  const [total, setTotal] = useState(0);
  const [pageSize, setPageSize] = useState(20);
  const [sport, setSport] = useState<string>("");
  const [sports, setSports] = useState<string[]>([]);
  const [page, setPage] = useState(1);

  useEffect(() => {
    fetchSports().then(setSports).catch(console.error);
  }, []);

  // Changing the sport filter invalidates whatever page we were on.
  useEffect(() => {
    setPage(1);
  }, [sport]);

  useEffect(() => {
    const load = () =>
      fetchEvents({ sport: sport || undefined, page })
        .then((result) => {
          setEvents(result.events);
          setTotal(result.total);
          setPageSize(result.pageSize);
        })
        .catch(console.error);
    load();
    const interval = setInterval(load, POLL_MS);
    return () => clearInterval(interval);
  }, [sport, page]);

  const hasNextPage = page * pageSize < total;

  return (
    <div>
      <h1>CoteRadar</h1>
      <select value={sport} onChange={(e) => setSport(e.target.value)}>
        <option value="">Tous les sports</option>
        {sports.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>

      <GroupedOddsTables events={events} />

      <div>
        <button onClick={() => setPage((p) => p - 1)} disabled={page <= 1}>
          Précédent
        </button>
        <span>
          {" "}
          Page {page} ({total} résultats){" "}
        </span>
        <button onClick={() => setPage((p) => p + 1)} disabled={!hasNextPage}>
          Suivant
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Run the full frontend test suite**

Run: `cd web && npm test`
Expected: PASS (all existing + new tests, since `OddsTable.test.tsx`/`bestOdds.test.ts` don't touch `App.tsx`)

- [ ] **Step 3: Build and manually verify**

```bash
cd web && npm run build
```

Then start the backend (`npm run api` from the project root, with a populated `data/coteradar.sqlite` from a worker run) and open the served page: confirm the sport `<select>` is populated, changing it re-fetches and resets to page 1, matches render grouped under per-sport `<h2>` headings, and the pagination buttons enable/disable correctly at the first/last page.

- [ ] **Step 4: Commit**

```bash
git add web/src/App.tsx
git commit -m "feat: sport select filter, pagination controls, and grouped rendering in App"
```

---

## Verification (end to end)

1. `npm test` (root) — all backend tests pass, including the new `protoWire`, `betclic`, `winamax` fixture-based tests and the extended `server.test.ts`.
2. `cd web && npm test` — all frontend tests pass, including the new `api`, `groupBySport`, `GroupedOddsTables` tests.
3. `npm run build` (root) then `cd web && npm run build` — both compile cleanly with no `playwright` references left (`grep -r playwright src/ package.json` returns nothing but the removed devDependency's absence).
4. Run the worker once directly (`npx ts-node src/worker/index.ts`, `Ctrl+C` after one cycle) against a scratch `DB_PATH` and confirm `sqlite3 data/coteradar.sqlite "SELECT sport, COUNT(*) FROM events GROUP BY sport"` shows real matches across multiple sports for both `winamax` and `betclic` bookmakers, meaningfully more than the old DOM-scraped counts (23 Winamax / 40 Betclic, football-only for Betclic).
5. Start `npm run api` and `curl "localhost:3000/api/sports"` / `curl "localhost:3000/api/events?page=1&pageSize=5"` to confirm the new response shapes live.
6. Open the built frontend in a browser (Task 11, Step 3) and confirm the golden path: sport select populates and filters, matches group visibly by sport, pagination controls work at both ends.
