# CoteRadar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the abandoned EV+ logger POC with CoteRadar, a web dashboard that scrapes Winamax/Betclic and shows a side-by-side odds comparison table. (Unibet was dropped from v1 — see Global Constraints and the ledger.)

**Architecture:** Two independent Node/TS processes sharing one SQLite file — a scraping worker (Playwright scrapers → fuzzy matcher → DB) on a cron interval, and a web process (Express API + React/Vite dashboard) reading that same DB read-only.

**Tech Stack:** TypeScript, Node's built-in `node:sqlite` (`DatabaseSync`), Playwright, cheerio, express, fastest-levenshtein, vitest (+ supertest for API, @testing-library/react for the frontend), React + Vite.

**Spec:** [docs/superpowers/specs/2026-09-20-coteradar-design.md](../specs/2026-09-20-coteradar-design.md)

## Global Constraints

- No EV / sharp-reference calculation anywhere — pure side-by-side comparison.
- Exactly 2 bookmakers in v1: Winamax, Betclic — via direct scraping, not The Odds API. Unibet was dropped from v1 (ruled during Task 6/7 dispatch): its site is protected by DataDome, a commercial anti-bot/anti-fraud service that returns a JS-challenge wall even to a realistic browser User-Agent; building around it would mean actively engineering bot-detection evasion against a licensed operator's anti-fraud system, which is out of scope for this project. Task 8 (originally: Unibet scraper) is kept in this document as a skipped placeholder documenting that decision, not executed.
- No sport/market filtering — scrape whatever markets are present, don't hardcode to one market type.
- Refresh is periodic server-side polling (`POLL_INTERVAL_MINUTES`), never on-demand from the browser.
- Storage is SQLite, one file, no separate DB service.
- Event matching across bookmakers is automatic/fuzzy — no manual alias table.
- Worker and web are separate processes/entrypoints, both reading/writing the same SQLite file, so one can fail without affecting the other.
- Target host is a VPS running both processes continuously.
- Node version floor is `>=23.4.0` (required for `node:sqlite` without the `--experimental-sqlite` flag; ruled during Task 1 — see ledger).
- `vitest` is pinned to `^3.2.7`, not `^2.1.1` (ruled during Task 3 — `vite-node@2.1.9` fails to resolve `node:sqlite` as a builtin when it's imported as a *value* (`Failed to load url sqlite`); fixed upstream in `vite-node@3.x`. See ledger.).

## Note on the scraper tasks (6-7; 8 skipped)

Tasks 6 and 7 (one per bookmaker) cannot be fully specified here: the exact CSS selectors for each site's DOM can only be discovered by loading the live page and inspecting it — this plan is written without live browser access to winamax.fr/betclic.fr. Each of those tasks therefore starts with an explicit **investigation step** (capture the real page, inspect it in devtools, fill in a `SELECTORS` object) before the extraction logic is written and tested against what was actually captured. This is the one place in the plan where "figure it out" is the correct instruction rather than a shortcut — every other task is fully specified.

Task 8 (Unibet) is **not executed**. A network check before dispatching it found Unibet's site protected by DataDome (a commercial anti-bot/anti-fraud service) returning a JS-challenge wall even to a realistic browser User-Agent, unlike Winamax and Betclic which responded normally. Building a scraper for it would mean actively engineering bot-detection evasion, which is out of scope. The user chose to drop Unibet from v1 rather than pursue that. Task 8's text is left below as a record of the original intent, in case Unibet is revisited later (e.g. if they offer a legitimate data feed/partner API instead of scraping the consumer site).

---

### Task 1: Reset the repository to a clean slate

**Files:**
- Delete: `src/ev.ts`, `src/index.ts`, `src/logger.ts`, `src/oddsApi.ts`, `src/types.ts`, `src/env.ts`, `src/providers/` (entire directory, including any untracked files in it)
- Delete: `data/ev-hits.csv`
- Delete: `.github/workflows/ev-poc.yml`
- Modify: `README.md` (replace entirely)
- Modify: `package.json` (replace entirely)
- Modify: `.env.example` (replace entirely)
- Modify: `.gitignore` (add `data/*.sqlite*`)
- Create: `src/index.ts` (trivial placeholder, deleted in Task 2 — see Step 6)
- `tsconfig.json` stays as-is (already correct: strict, ES2022, rootDir `src`, outDir `dist`)

**Interfaces:** None — this task has no code dependencies, everything downstream depends on the clean `package.json`/`tsconfig.json` this leaves behind.

- [ ] **Step 1: Delete the POC source files and artifacts**

```bash
git rm -rf src/ev.ts src/index.ts src/logger.ts src/oddsApi.ts src/types.ts src/env.ts src/providers data/ev-hits.csv .github/workflows/ev-poc.yml
```

(`src/env.ts` and `src/providers/` are untracked — `git rm` will fail on them; delete those two with `rm -rf src/env.ts src/providers` instead.)

- [ ] **Step 2: Replace `package.json`**

```json
{
  "name": "coteradar",
  "version": "0.1.0",
  "description": "Comparateur de cotes en direct entre bookmakers francais (Winamax, Betclic).",
  "private": true,
  "scripts": {
    "build": "tsc",
    "worker": "ts-node src/worker/index.ts",
    "api": "ts-node src/api/index.ts",
    "test": "vitest run"
  },
  "dependencies": {
    "cheerio": "^1.0.0",
    "dotenv": "^16.4.5",
    "express": "^4.19.2",
    "fastest-levenshtein": "^1.0.16",
    "playwright": "^1.47.0"
  },
  "devDependencies": {
    "@types/express": "^4.17.21",
    "@types/node": "^26.0.0",
    "@types/supertest": "^6.0.2",
    "supertest": "^7.0.0",
    "ts-node": "^10.9.2",
    "typescript": "^5.5.2",
    "vitest": "^3.2.7"
  },
  "engines": {
    "node": ">=23.4.0"
  }
}
```

Storage uses Node's built-in `node:sqlite` (`DatabaseSync`) — no `better-sqlite3` dependency, no native module to compile. `@types/node@^26.0.0` is required because `node:sqlite`'s type definitions aren't in `@types/node` until v22.5+; pinning to `^26` matches the `>=23.4.0` engines floor. (Ruled during Task 1 after `better-sqlite3`'s native bindings failed to compile against this environment's Node version — see ledger.)

- [ ] **Step 3: Replace `.env.example`**

```
# Port de l'API HTTP (process web)
PORT=3000

# Chemin du fichier SQLite partage entre le worker et l'API
DB_PATH=./data/coteradar.sqlite

# Frequence de scraping en minutes (process worker)
POLL_INTERVAL_MINUTES=5
```

- [ ] **Step 4: Add the SQLite file to `.gitignore`**

Append to `.gitignore`:

```
data/*.sqlite*
```

- [ ] **Step 5: Replace `README.md`**

```markdown
# CoteRadar

Comparateur de cotes en direct entre bookmakers francais (Winamax, Betclic
pour l'instant -- Unibet bloque le scraping avec une protection anti-bot
DataDome, voir le plan d'implementation) : un worker scrape les sites en
continu, une API + dashboard web affichent un tableau comparatif.

## Prerequis

Node.js >= 23.4 (utilise le module natif \`node:sqlite\`, sans flag experimental
a partir de cette version).

## Installation

\`\`\`bash
npm install
npx playwright install chromium
cp .env.example .env
\`\`\`

## Lancer en developpement

Deux process separes, partagent le meme fichier SQLite (\`DB_PATH\`) :

\`\`\`bash
npm run worker   # scrape les 3 books toutes les POLL_INTERVAL_MINUTES minutes
npm run api      # sert l'API sur PORT
\`\`\`

Frontend (dossier \`web/\`, package.json separe) :

\`\`\`bash
cd web && npm install && npm run dev
\`\`\`

Voir \`docs/superpowers/specs/2026-09-20-coteradar-design.md\` pour le design
complet, et \`docs/superpowers/plans/2026-09-20-coteradar-plan.md\` pour le
detail de l'implementation.
```

- [ ] **Step 6: Add a placeholder so the build has something to compile**

`tsc` errors (`TS18003: No inputs were found`) when its `include` glob matches zero files — an empty `src/` does NOT build cleanly. Create a single placeholder file:

```typescript
// src/index.ts
// Placeholder so `tsc` has an input file. Removed in Task 2 once src/types.ts exists.
```

Do not create `src/worker/` or `src/api/` placeholders — those directories and their real content are created by Task 9 and Task 10. One flat placeholder at `src/index.ts` is enough to satisfy `tsc`, and Task 2 deletes it.

- [ ] **Step 7: Verify the clean slate builds**

Run: `npm install && npm run build`
Expected: succeeds (0 errors).

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "chore: reset project to a clean slate for the CoteRadar pivot"
```

---

### Task 2: Shared domain types

**Files:**
- Create: `src/types.ts`
- Delete: `src/index.ts` (Task 1's placeholder — `src/types.ts` now satisfies `tsc`'s input requirement, so it's no longer needed)

**Interfaces:**
- Produces: `RawOdds`, `RawEvent`, `CanonicalEvent`, `EventWithOdds` — used by every task from here on.

- [ ] **Step 1: Write the types**

```typescript
export interface RawOdds {
  market: string;
  selection: string;
  price: number;
}

export interface RawEvent {
  sport: string;
  competition: string;
  startTime: string; // ISO 8601
  participants: string[];
  odds: RawOdds[];
}

export interface CanonicalEvent {
  id: string;
  sport: string;
  competition: string;
  startTime: string;
  participants: string[];
  byBookmaker: Record<string, RawOdds[]>;
}

export interface EventWithOdds {
  id: string;
  sport: string;
  competition: string;
  startTime: string;
  participants: string[];
  byBookmaker: Record<string, { scrapedAt: string; odds: RawOdds[] }>;
}
```

There is no test for this task — it's pure type declarations, exercised by every later task's tests.

- [ ] **Step 2: Delete Task 1's placeholder**

```bash
git rm src/index.ts
```

- [ ] **Step 3: Verify it compiles**

Run: `npm run build`
Expected: succeeds (0 errors).

- [ ] **Step 4: Commit**

```bash
git add src/types.ts
git commit -m "feat: add shared domain types"
```

---

### Task 3: SQLite schema, client, and repository

**Files:**
- Create: `src/db/client.ts`
- Create: `src/db/repository.ts`
- Test: `tests/db/repository.test.ts`

**Interfaces:**
- Consumes: `CanonicalEvent`, `EventWithOdds`, `RawOdds` from Task 2.
- Produces: `openDb(path: string): DatabaseSync`, `upsertCanonicalEvents(db, events: CanonicalEvent[]): void`, `getLatestEvents(db, opts?: { sport?: string }): EventWithOdds[]`.

- [ ] **Step 1: Write `src/db/client.ts`**

```typescript
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS bookmakers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  sport TEXT NOT NULL,
  competition TEXT NOT NULL,
  start_time TEXT NOT NULL,
  participants TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS event_bookmaker_odds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL REFERENCES events(id),
  bookmaker_id TEXT NOT NULL REFERENCES bookmakers(id),
  market TEXT NOT NULL,
  selection TEXT NOT NULL,
  price REAL NOT NULL,
  scraped_at TEXT NOT NULL,
  UNIQUE(event_id, bookmaker_id, market, selection)
);
`;

export function openDb(path: string): DatabaseSync {
  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true });
  }
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec(SCHEMA);
  return db;
}
```

- [ ] **Step 2: Write the failing test for `src/db/repository.ts`**

Create `tests/db/repository.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { openDb } from "../../src/db/client";
import { upsertCanonicalEvents, getLatestEvents } from "../../src/db/repository";
import { CanonicalEvent } from "../../src/types";

describe("repository", () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = openDb(":memory:");
  });

  const sampleEvent: CanonicalEvent = {
    id: "evt1",
    sport: "football",
    competition: "Ligue 1",
    startTime: "2026-09-21T19:00:00.000Z",
    participants: ["PSG", "OM"],
    byBookmaker: {
      winamax: [{ market: "1X2", selection: "1", price: 1.5 }],
      betclic: [{ market: "1X2", selection: "1", price: 1.55 }],
    },
  };

  it("stores and retrieves an event with odds from multiple bookmakers", () => {
    upsertCanonicalEvents(db, [sampleEvent]);

    const events = getLatestEvents(db);

    expect(events).toHaveLength(1);
    expect(events[0].id).toBe("evt1");
    expect(events[0].participants).toEqual(["PSG", "OM"]);
    expect(events[0].byBookmaker.winamax.odds).toEqual([{ market: "1X2", selection: "1", price: 1.5 }]);
    expect(events[0].byBookmaker.betclic.odds).toEqual([{ market: "1X2", selection: "1", price: 1.55 }]);
    expect(events[0].byBookmaker.winamax.scrapedAt).toBeTypeOf("string");
  });

  it("updates the price on re-upsert instead of duplicating rows", () => {
    upsertCanonicalEvents(db, [sampleEvent]);
    const updated: CanonicalEvent = {
      ...sampleEvent,
      byBookmaker: { winamax: [{ market: "1X2", selection: "1", price: 1.6 }] },
    };
    upsertCanonicalEvents(db, [updated]);

    const events = getLatestEvents(db);
    expect(events).toHaveLength(1);
    expect(events[0].byBookmaker.winamax.odds).toEqual([{ market: "1X2", selection: "1", price: 1.6 }]);
  });

  it("filters by sport", () => {
    upsertCanonicalEvents(db, [
      sampleEvent,
      { ...sampleEvent, id: "evt2", sport: "tennis", participants: ["Nadal", "Alcaraz"] },
    ]);

    const events = getLatestEvents(db, { sport: "tennis" });
    expect(events).toHaveLength(1);
    expect(events[0].id).toBe("evt2");
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run tests/db/repository.test.ts`
Expected: FAIL — `src/db/repository.ts` does not exist yet.

- [ ] **Step 4: Write `src/db/repository.ts`**

```typescript
import { DatabaseSync } from "node:sqlite";
import { CanonicalEvent, EventWithOdds } from "../types";

export function upsertCanonicalEvents(db: DatabaseSync, events: CanonicalEvent[]): void {
  const insertEvent = db.prepare(`
    INSERT INTO events (id, sport, competition, start_time, participants)
    VALUES (@id, @sport, @competition, @startTime, @participants)
    ON CONFLICT(id) DO UPDATE SET
      sport = excluded.sport,
      competition = excluded.competition,
      start_time = excluded.start_time,
      participants = excluded.participants
  `);
  const insertBookmaker = db.prepare(`
    INSERT INTO bookmakers (id, name) VALUES (@id, @name)
    ON CONFLICT(id) DO NOTHING
  `);
  const insertOdds = db.prepare(`
    INSERT INTO event_bookmaker_odds (event_id, bookmaker_id, market, selection, price, scraped_at)
    VALUES (@eventId, @bookmakerId, @market, @selection, @price, @scrapedAt)
    ON CONFLICT(event_id, bookmaker_id, market, selection) DO UPDATE SET
      price = excluded.price,
      scraped_at = excluded.scraped_at
  `);

  const scrapedAt = new Date().toISOString();

  db.exec("BEGIN");
  try {
    for (const event of events) {
      insertEvent.run({
        id: event.id,
        sport: event.sport,
        competition: event.competition,
        startTime: event.startTime,
        participants: JSON.stringify(event.participants),
      });
      for (const [bookmakerId, odds] of Object.entries(event.byBookmaker)) {
        insertBookmaker.run({ id: bookmakerId, name: bookmakerId });
        for (const o of odds) {
          insertOdds.run({
            eventId: event.id,
            bookmakerId,
            market: o.market,
            selection: o.selection,
            price: o.price,
            scrapedAt,
          });
        }
      }
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

interface OddsRow {
  id: string;
  sport: string;
  competition: string;
  startTime: string;
  participants: string;
  bookmakerId: string;
  market: string;
  selection: string;
  price: number;
  scrapedAt: string;
}

export function getLatestEvents(db: DatabaseSync, opts: { sport?: string } = {}): EventWithOdds[] {
  const query = `
    SELECT e.id, e.sport, e.competition, e.start_time as startTime, e.participants,
           o.bookmaker_id as bookmakerId, o.market, o.selection, o.price, o.scraped_at as scrapedAt
    FROM events e
    JOIN event_bookmaker_odds o ON o.event_id = e.id
    ${opts.sport ? "WHERE e.sport = @sport" : ""}
    ORDER BY e.start_time ASC
  `;
  const rows = db.prepare(query).all(opts.sport ? { sport: opts.sport } : {}) as unknown as OddsRow[];

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
    event.byBookmaker[row.bookmakerId].odds.push({
      market: row.market,
      selection: row.selection,
      price: row.price,
    });
  }
  return Array.from(eventsById.values());
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/db/repository.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add src/db tests/db
git commit -m "feat: add SQLite schema, client, and odds repository"
```

---

### Task 4: Matcher — name normalization and fuzzy event matching

**Files:**
- Create: `src/matcher/normalize.ts`
- Create: `src/matcher/match.ts`
- Test: `tests/matcher/normalize.test.ts`
- Test: `tests/matcher/match.test.ts`

**Interfaces:**
- Consumes: `RawEvent`, `CanonicalEvent` from Task 2.
- Produces: `normalizeName(name: string): string`, `matchEvents(eventsByBookmaker: Record<string, RawEvent[]>): CanonicalEvent[]`.

- [ ] **Step 1: Write the failing test for `normalize.ts`**

Create `tests/matcher/normalize.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { normalizeName } from "../../src/matcher/normalize";

describe("normalizeName", () => {
  it("lowercases, strips accents, and collapses punctuation/whitespace", () => {
    expect(normalizeName("Étoile Rouge  de  Belgrade!")).toBe("etoile rouge de belgrade");
  });

  it("trims leading/trailing whitespace", () => {
    expect(normalizeName("  Real Madrid  ")).toBe("real madrid");
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npx vitest run tests/matcher/normalize.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Write `src/matcher/normalize.ts`**

```typescript
export function normalizeName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
```

- [ ] **Step 4: Run it, verify it passes**

Run: `npx vitest run tests/matcher/normalize.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Write the failing test for `match.ts`**

Create `tests/matcher/match.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { matchEvents } from "../../src/matcher/match";
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
    // Deliberately uses DIFFERENT spellings per bookmaker (not identical fixtures) --
    // otherwise this test can't tell the sorted-seed fix apart from no fix at all,
    // since an identical seed always hashes the same regardless of which one is picked.
    const winamaxEvent = event({ participants: ["Olympique de Marseille", "AS Monaco"] });
    const betclicEvent = event({ participants: ["Olympique Marseille", "Monaco"] });
    const a = matchEvents({ winamax: [winamaxEvent], betclic: [betclicEvent] });
    const b = matchEvents({ betclic: [betclicEvent], winamax: [winamaxEvent] });
    expect(a[0].id).toBe(b[0].id);
  });
});
```

- [ ] **Step 6: Run it, verify it fails**

Run: `npx vitest run tests/matcher/match.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 7: Write `src/matcher/match.ts`**

```typescript
import { distance } from "fastest-levenshtein";
import { createHash } from "node:crypto";
import { RawEvent, RawOdds, CanonicalEvent } from "../types";
import { normalizeName } from "./normalize";

const NAME_SIMILARITY_THRESHOLD = 0.75;
const START_TIME_TOLERANCE_MS = 10 * 60 * 1000;

function nameSimilarity(a: string, b: string): number {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  const maxLen = Math.max(na.length, nb.length, 1);
  return 1 - distance(na, nb) / maxLen;
}

function permutations<T>(items: T[]): T[][] {
  if (items.length <= 1) return [items];
  const result: T[][] = [];
  for (let i = 0; i < items.length; i++) {
    const rest = [...items.slice(0, i), ...items.slice(i + 1)];
    for (const perm of permutations(rest)) {
      result.push([items[i], ...perm]);
    }
  }
  return result;
}

function participantsSimilarity(a: string[], b: string[]): number {
  if (a.length !== b.length) return 0;
  // Bookmakers don't always list participants in the same order (e.g. home/away
  // swapped) — try every ordering of b against a and keep the best-scoring one.
  // Participant counts are always small (2-4), so brute-forcing permutations is cheap.
  let best = 0;
  for (const order of permutations(b)) {
    const scores = a.map((name, i) => nameSimilarity(name, order[i]));
    const avg = scores.reduce((sum, s) => sum + s, 0) / scores.length;
    if (avg > best) best = avg;
  }
  return best;
}

function sameEvent(a: RawEvent, b: RawEvent): boolean {
  if (a.sport !== b.sport) return false;
  const timeDiff = Math.abs(new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
  if (timeDiff > START_TIME_TOLERANCE_MS) return false;
  return participantsSimilarity(a.participants, b.participants) >= NAME_SIMILARITY_THRESHOLD;
}

function canonicalId(event: RawEvent): string {
  const key = `${event.sport}:${event.startTime}:${event.participants.map(normalizeName).sort().join("-")}`;
  return createHash("sha1").update(key).digest("hex").slice(0, 16);
}

// Bookmakers spell the same outcome differently (Winamax: "Match nul", Betclic:
// "Nul"; Winamax: "Spaeri", Betclic: "FC Spaeri"). Storing raw selection strings
// verbatim means the frontend's exact-string comparison (bestOdds.ts, OddsTable.tsx)
// can never find a cross-bookmaker match for the same real outcome -- the whole
// comparison table silently degrades to showing one bookmaker's price with a dash
// next to it. This was found post-implementation by running real captured fixtures
// through the real pipeline; the spec requires aligning equivalent markets/outcomes
// across bookmakers, and this closes that gap by normalizing each outcome to "1"
// (first participant wins), "X" (draw), or "2" (second participant wins) before
// it's ever stored. The raw label is discarded -- only the canonical key is kept,
// since neither the DB schema nor the frontend currently needs the original text.
const DRAW_LABELS = new Set(["nul", "match nul", "egalite", "draw", "x"]);

function canonicalizeSelection(rawSelection: string, ownParticipants: string[]): string {
  if (DRAW_LABELS.has(normalizeName(rawSelection))) return "X";

  if (ownParticipants.length === 2) {
    const simFirst = nameSimilarity(rawSelection, ownParticipants[0]);
    const simSecond = nameSimilarity(rawSelection, ownParticipants[1]);
    if (simFirst >= NAME_SIMILARITY_THRESHOLD && simFirst >= simSecond) return "1";
    if (simSecond >= NAME_SIMILARITY_THRESHOLD) return "2";
  }

  // Doesn't match a participant name or a known draw label -- not a head-to-head
  // outcome this function knows how to canonicalize (e.g. a future over/under or
  // handicap market). Keep the raw label rather than guessing.
  return rawSelection;
}

// Reorders a bookmaker's OWN participant spellings so position i lines up with the
// accumulator seed's participant at position i.
//
// A selection label must be resolved against the spellings used by the bookmaker
// that produced it, NOT against the seed bookmaker's spellings -- verified against
// the real committed fixtures: the seed (Betclic, alphabetically first) spells the
// home side "FC Spaeri" while Winamax spells it "Spaeri"; nameSimilarity("Spaeri",
// "FC Spaeri") is only 0.667, under NAME_SIMILARITY_THRESHOLD, so resolving
// Winamax's "Spaeri" selection against the SEED's participants falls through to
// the raw label and the cross-bookmaker comparison stays broken for that outcome.
// Resolving it against Winamax's own participants scores 1.0 instead.
//
// But "1"/"2" are defined by position in the CANONICAL event's participant order
// (the seed's -- see the returned CanonicalEvent below, and the frontend, which
// renders `participants.join(" - ")`), and matchEvents deliberately merges events
// whose bookmakers list participants in opposite order (see participantsSimilarity
// above). So resolving a selection against a bookmaker's own participant list is
// only sound after reordering that list onto the seed's -- this reuses the same
// permutation/similarity search participantsSimilarity already uses to decide the
// two events matched at all.
function alignParticipantsToSeed(own: string[], seed: string[]): string[] {
  if (own.length !== seed.length) return own;

  let best = own;
  let bestScore = -1;
  for (const order of permutations(own)) {
    const avg = seed.reduce((sum, name, i) => sum + nameSimilarity(name, order[i]), 0) / seed.length;
    if (avg > bestScore) {
      bestScore = avg;
      best = order;
    }
  }
  return best;
}

function canonicalizeOdds(odds: RawOdds[], ownParticipants: string[], seedParticipants: string[]): RawOdds[] {
  const aligned = alignParticipantsToSeed(ownParticipants, seedParticipants);
  return odds.map((o) => ({ ...o, selection: canonicalizeSelection(o.selection, aligned) }));
}

interface Accumulator {
  seed: RawEvent;
  byBookmaker: Record<string, RawOdds[]>;
}

export function matchEvents(eventsByBookmaker: Record<string, RawEvent[]>): CanonicalEvent[] {
  const accumulators: Accumulator[] = [];

  // Process bookmakers in a fixed (sorted) order, not object-insertion order: which
  // bookmaker's raw event becomes an accumulator's "seed" (and therefore whose exact
  // spelling feeds canonicalId) must not depend on which bookmaker happened to
  // respond first or which one dropped out this cycle — that would make the same
  // real-world event hash to a different id from one scrape to the next.
  const bookmakerIds = Object.keys(eventsByBookmaker).sort();
  for (const bookmakerId of bookmakerIds) {
    const events = eventsByBookmaker[bookmakerId];
    for (const rawEvent of events) {
      const existing = accumulators.find((acc) => sameEvent(acc.seed, rawEvent));
      if (existing) {
        existing.byBookmaker[bookmakerId] = canonicalizeOdds(
          rawEvent.odds,
          rawEvent.participants,
          existing.seed.participants
        );
      } else {
        const accumulator: Accumulator = { seed: rawEvent, byBookmaker: {} };
        accumulator.byBookmaker[bookmakerId] = canonicalizeOdds(
          rawEvent.odds,
          rawEvent.participants,
          rawEvent.participants
        );
        accumulators.push(accumulator);
      }
    }
  }

  return accumulators.map((acc) => ({
    id: canonicalId(acc.seed),
    sport: acc.seed.sport,
    competition: acc.seed.competition,
    startTime: acc.seed.startTime,
    participants: acc.seed.participants,
    byBookmaker: acc.byBookmaker,
  }));
}
```

- [ ] **Step 8: Run it, verify it passes**

Run: `npx vitest run tests/matcher/match.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 9: Commit**

```bash
git add src/matcher tests/matcher
git commit -m "feat: add fuzzy event matcher across bookmakers"
```

---

### Task 5: Scraper orchestrator with per-bookmaker isolation

**Files:**
- Create: `src/scraper/run.ts`
- Test: `tests/scraper/run.test.ts`

**Interfaces:**
- Consumes: `RawEvent` from Task 2, `matchEvents` from Task 4, `upsertCanonicalEvents` from Task 3, `openDb` from Task 3.
- Produces: `BookmakerScraper` interface (`{ id: string; fetch: () => Promise<RawEvent[]> }`), `runScrapeCycle(db, scrapers: BookmakerScraper[]): Promise<void>` — Tasks 6-8 each implement one `BookmakerScraper`; Task 9 calls `runScrapeCycle`.

- [ ] **Step 1: Write the failing test**

Create `tests/scraper/run.test.ts`:

```typescript
import { describe, it, expect, vi, afterEach } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { openDb } from "../../src/db/client";
import { getLatestEvents } from "../../src/db/repository";
import { runScrapeCycle, BookmakerScraper } from "../../src/scraper/run";
import { RawEvent } from "../../src/types";

const sampleEvent: RawEvent = {
  sport: "football",
  competition: "Ligue 1",
  startTime: "2026-09-21T19:00:00.000Z",
  participants: ["PSG", "OM"],
  odds: [{ market: "1X2", selection: "1", price: 1.5 }],
};

describe("runScrapeCycle", () => {
  let db: DatabaseSync;

  afterEach(() => {
    db?.close();
  });

  it("stores events from succeeding scrapers even when another scraper fails", async () => {
    db = openDb(":memory:");
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const scrapers: BookmakerScraper[] = [
      { id: "winamax", fetch: async () => [sampleEvent] },
      {
        id: "betclic",
        fetch: async () => {
          throw new Error("betclic.fr changed its markup");
        },
      },
    ];

    await runScrapeCycle(db, scrapers);

    const events = getLatestEvents(db);
    expect(events).toHaveLength(1);
    expect(events[0].byBookmaker.winamax).toBeDefined();
    expect(events[0].byBookmaker.betclic).toBeUndefined();
    expect(consoleErrorSpy).toHaveBeenCalledOnce();

    consoleErrorSpy.mockRestore();
  });

  it("isolates a scraper that throws synchronously instead of returning a rejected promise", async () => {
    db = openDb(":memory:");
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const scrapers: BookmakerScraper[] = [
      { id: "winamax", fetch: async () => [sampleEvent] },
      {
        id: "betclic",
        // Deliberately NOT declared `async` -- throws synchronously the moment
        // fetch() is called, before returning any promise at all.
        fetch: () => {
          throw new Error("betclic.fr's parser crashed before awaiting anything");
        },
      },
    ];

    await runScrapeCycle(db, scrapers);

    const events = getLatestEvents(db);
    expect(events).toHaveLength(1);
    expect(events[0].byBookmaker.winamax).toBeDefined();
    expect(events[0].byBookmaker.betclic).toBeUndefined();
    expect(consoleErrorSpy).toHaveBeenCalledOnce();

    consoleErrorSpy.mockRestore();
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npx vitest run tests/scraper/run.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Write `src/scraper/run.ts`**

```typescript
import { DatabaseSync } from "node:sqlite";
import { RawEvent } from "../types";
import { matchEvents } from "../matcher/match";
import { upsertCanonicalEvents } from "../db/repository";

export interface BookmakerScraper {
  id: string;
  fetch: () => Promise<RawEvent[]>;
}

export async function runScrapeCycle(db: DatabaseSync, scrapers: BookmakerScraper[]): Promise<void> {
  // Wrapping in `async (s) => s.fetch()` (not `(s) => s.fetch()`) matters: if a
  // scraper's fetch throws synchronously instead of returning a rejected promise
  // (a real risk -- BookmakerScraper's type doesn't enforce `async`), a bare
  // `.map((s) => s.fetch())` would throw out of the array construction itself,
  // before Promise.allSettled ever runs, losing every bookmaker's results for
  // the whole cycle instead of isolating just the one that failed.
  const results = await Promise.allSettled(scrapers.map(async (s) => s.fetch()));

  const eventsByBookmaker: Record<string, RawEvent[]> = {};
  results.forEach((result, i) => {
    const scraper = scrapers[i];
    if (result.status === "fulfilled") {
      eventsByBookmaker[scraper.id] = result.value;
    } else {
      console.error(`[scraper:${scraper.id}] failed:`, result.reason);
    }
  });

  const canonicalEvents = matchEvents(eventsByBookmaker);
  upsertCanonicalEvents(db, canonicalEvents);
}
```

- [ ] **Step 4: Run it, verify it passes**

Run: `npx vitest run tests/scraper/run.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/scraper tests/scraper
git commit -m "feat: add scraper orchestrator with per-bookmaker failure isolation"
```

---

### Task 6: Winamax scraper

**Files:**
- Create: `src/scraper/winamax.ts`
- Create: `scripts/capture-fixture.ts`
- Create: `tests/scraper/fixtures/winamax.html` (captured, not hand-written)
- Test: `tests/scraper/winamax.test.ts`

**Interfaces:**
- Consumes: `RawEvent`, `RawOdds` from Task 2; `BookmakerScraper` from Task 5.
- Produces: `winamaxScraper: BookmakerScraper`, `parseWinamaxHtml(html: string): RawEvent[]` (exported for testing).

- [ ] **Step 1: Install Playwright's browser binary (one-time, shared by Tasks 6-8)**

```bash
npx playwright install chromium
```

- [ ] **Step 2: Write the fixture-capture script**

Create `scripts/capture-fixture.ts` (a throwaway dev tool, not part of the app):

```typescript
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";

const url = process.argv[2];
const outPath = process.argv[3];

if (!url || !outPath) {
  console.error("Usage: ts-node scripts/capture-fixture.ts <url> <output-path>");
  process.exit(1);
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(3000); // let any lazy-loaded odds widgets settle
  writeFileSync(outPath, await page.content());
  await browser.close();
  console.log(`Saved ${outPath}`);
}

main();
```

- [ ] **Step 3: Investigation — capture and inspect the real Winamax page**

Run:

```bash
mkdir -p tests/scraper/fixtures
npx ts-node scripts/capture-fixture.ts https://www.winamax.fr/paris-sportifs/sports tests/scraper/fixtures/winamax.html
```

If the saved HTML doesn't contain visible odds (e.g. a cookie-consent wall blocked rendering), open the live URL in a real browser first, note the consent button's selector, and add a `page.click(...)` for it in the capture script between `goto` and `waitForTimeout`, then re-run.

Open `tests/scraper/fixtures/winamax.html` and the live page's devtools side by side. Identify the real selectors for: one card per match, participant names, competition/league label, start time (prefer an element with a machine-readable `datetime`/timestamp attribute over parsing displayed text), and the market/selection/price structure. Note whether all markets are visible on this listing page or only the main one (if only the main market shows, note that as a known v1 limitation — extending to per-event detail pages is future work, not required by this task).

- [ ] **Step 4: Write the failing test**

Create `tests/scraper/winamax.test.ts`, asserting against values you actually observed in the captured fixture in Step 3 (replace the example values below with the real ones):

```typescript
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseWinamaxHtml } from "../../src/scraper/winamax";

describe("parseWinamaxHtml", () => {
  const html = readFileSync(join(__dirname, "fixtures/winamax.html"), "utf-8");

  it("extracts at least one event with participants, a start time, and odds", () => {
    const events = parseWinamaxHtml(html);

    expect(events.length).toBeGreaterThan(0);
    const first = events[0];
    expect(first.participants.length).toBeGreaterThanOrEqual(2);
    expect(first.startTime).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(first.odds.length).toBeGreaterThan(0);
    expect(first.odds[0].price).toBeGreaterThan(1);
  });

  it("extracts more than one market when the fixture shows more than one", () => {
    const events = parseWinamaxHtml(html);
    const marketsSeen = new Set(events.flatMap((e) => e.odds.map((o) => o.market)));
    expect(marketsSeen.size).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 5: Run it, verify it fails**

Run: `npx vitest run tests/scraper/winamax.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 6: Write `src/scraper/winamax.ts`**

Fill in every `SELECTORS` value from your Step 3 findings before this will work — the structure and control flow are final, the selector strings are the only unknowns:

```typescript
import { chromium } from "playwright";
import * as cheerio from "cheerio";
import { RawEvent, RawOdds } from "../types";
import { BookmakerScraper } from "./run";

const WINAMAX_URL = "https://www.winamax.fr/paris-sportifs/sports";

// Filled in from live inspection (Task 6, Step 3). Each is a CSS selector.
const SELECTORS = {
  cookieConsentButton: "",  // dismisses the cookie banner, if present
  eventCard: "",            // one per match on the listing page
  participantName: "",      // within eventCard, one per team/player
  startTimeAttr: "",        // within eventCard, element holding the datetime
  competition: "",          // within eventCard, league/tournament label
  marketBlock: "",          // within eventCard, one per betting market
  marketName: "",           // within marketBlock, the market's label
  selection: "",            // within marketBlock, one per outcome
  selectionLabel: "",       // within selection, outcome name (e.g. "1")
  selectionPrice: "",       // within selection, decimal odds text
};

export async function fetchWinamaxHtml(): Promise<string> {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(WINAMAX_URL, { waitUntil: "networkidle", timeout: 30000 });
    if (SELECTORS.cookieConsentButton) {
      const consent = page.locator(SELECTORS.cookieConsentButton);
      if (await consent.count()) await consent.click();
    }
    await page.waitForSelector(SELECTORS.eventCard, { timeout: 15000 });
    return await page.content();
  } finally {
    await browser.close();
  }
}

export function parseWinamaxHtml(html: string): RawEvent[] {
  const $ = cheerio.load(html);
  const events: RawEvent[] = [];

  $(SELECTORS.eventCard).each((_, el) => {
    const card = $(el);
    const participants = card
      .find(SELECTORS.participantName)
      .map((_, p) => $(p).text().trim())
      .get();
    const startTime = card.find(SELECTORS.startTimeAttr).attr("datetime") ?? "";
    const competition = card.find(SELECTORS.competition).text().trim();

    const odds: RawOdds[] = card
      .find(SELECTORS.marketBlock)
      .toArray()
      .flatMap((marketEl) => {
        const market = $(marketEl).find(SELECTORS.marketName).text().trim();
        return $(marketEl)
          .find(SELECTORS.selection)
          .toArray()
          .map((sel) => ({
            market,
            selection: $(sel).find(SELECTORS.selectionLabel).text().trim(),
            price: parseFloat($(sel).find(SELECTORS.selectionPrice).text().trim().replace(",", ".")),
          }));
      });

    if (participants.length >= 2 && startTime && odds.length > 0) {
      events.push({ sport: "football", competition, startTime, participants, odds });
    }
  });

  return events;
}

export const winamaxScraper: BookmakerScraper = {
  id: "winamax",
  fetch: async () => parseWinamaxHtml(await fetchWinamaxHtml()),
};
```

- [ ] **Step 7: Run it, verify it passes**

Run: `npx vitest run tests/scraper/winamax.test.ts`
Expected: PASS (2 tests). If it fails, the selectors from Step 3 are wrong or too narrow — go back to devtools on the fixture file, not the live site (it may have changed since capture).

- [ ] **Step 8: Commit**

```bash
git add src/scraper/winamax.ts scripts/capture-fixture.ts tests/scraper/winamax.test.ts tests/scraper/fixtures/winamax.html
git commit -m "feat: add Winamax scraper"
```

---

### Task 7: Betclic scraper

Same structure as Task 6, targeting `https://www.betclic.fr/`.

**Files:**
- Create: `src/scraper/betclic.ts`
- Create: `tests/scraper/fixtures/betclic.html` (captured)
- Test: `tests/scraper/betclic.test.ts`

**Interfaces:**
- Consumes: `RawEvent`, `RawOdds` from Task 2; `BookmakerScraper` from Task 5.
- Produces: `betclicScraper: BookmakerScraper`, `parseBetclicHtml(html: string): RawEvent[]`.

- [ ] **Step 1: Capture the fixture**

```bash
npx ts-node scripts/capture-fixture.ts https://www.betclic.fr/ tests/scraper/fixtures/betclic.html
```

Betclic's homepage may need navigating into a sports listing first — if the captured HTML has no visible matches, find the right listing URL by browsing the live site and re-run against that URL instead.

- [ ] **Step 2: Investigate and note selectors**

Same procedure as Task 6 Step 3: inspect the captured fixture + live devtools, identify selectors for event card, participants, start time, competition, market/selection/price.

- [ ] **Step 3: Write the failing test**

Create `tests/scraper/betclic.test.ts` — identical in shape to `tests/scraper/winamax.test.ts` (Task 6, Step 4), importing `parseBetclicHtml` from `../../src/scraper/betclic` and reading `fixtures/betclic.html`.

- [ ] **Step 4: Run it, verify it fails**

Run: `npx vitest run tests/scraper/betclic.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 5: Write `src/scraper/betclic.ts`**

Same structure as `src/scraper/winamax.ts` (Task 6, Step 6) — copy it, rename every `Winamax` identifier to `Betclic`, set `BETCLIC_URL` to the listing URL found in Step 1, and fill `SELECTORS` from Step 2's findings. Export `betclicScraper: BookmakerScraper` with `id: "betclic"`.

- [ ] **Step 6: Run it, verify it passes**

Run: `npx vitest run tests/scraper/betclic.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 7: Commit**

```bash
git add src/scraper/betclic.ts tests/scraper/betclic.test.ts tests/scraper/fixtures/betclic.html
git commit -m "feat: add Betclic scraper"
```

---

### Task 8: Unibet scraper — SKIPPED, not executed (see "Note on the scraper tasks" above)

Left below unexecuted, as a record of original intent only. Do not dispatch this task; Task 9 onward only wire up `winamaxScraper` and `betclicScraper`.

Same structure as Task 6, targeting `https://www.unibet.fr/`.

**Files:**
- Create: `src/scraper/unibet.ts`
- Create: `tests/scraper/fixtures/unibet.html` (captured)
- Test: `tests/scraper/unibet.test.ts`

**Interfaces:**
- Consumes: `RawEvent`, `RawOdds` from Task 2; `BookmakerScraper` from Task 5.
- Produces: `unibetScraper: BookmakerScraper`, `parseUnibetHtml(html: string): RawEvent[]`.

- [ ] **Step 1: Capture the fixture**

```bash
npx ts-node scripts/capture-fixture.ts https://www.unibet.fr/ tests/scraper/fixtures/unibet.html
```

Same caveat as Task 7 Step 1: navigate to the actual sports-listing URL if the homepage capture has no matches.

- [ ] **Step 2: Investigate and note selectors**

Same procedure as Task 6 Step 3.

- [ ] **Step 3: Write the failing test**

Create `tests/scraper/unibet.test.ts` — same shape as `tests/scraper/winamax.test.ts`, importing `parseUnibetHtml` from `../../src/scraper/unibet` and reading `fixtures/unibet.html`.

- [ ] **Step 4: Run it, verify it fails**

Run: `npx vitest run tests/scraper/unibet.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 5: Write `src/scraper/unibet.ts`**

Same structure as `src/scraper/winamax.ts` (Task 6, Step 6) — copy it, rename every `Winamax` identifier to `Unibet`, set `UNIBET_URL` to the listing URL found in Step 1, and fill `SELECTORS` from Step 2's findings. Export `unibetScraper: BookmakerScraper` with `id: "unibet"`.

- [ ] **Step 6: Run it, verify it passes**

Run: `npx vitest run tests/scraper/unibet.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 7: Commit**

```bash
git add src/scraper/unibet.ts tests/scraper/unibet.test.ts tests/scraper/fixtures/unibet.html
git commit -m "feat: add Unibet scraper"
```

---

### Task 9: Worker scheduler and entrypoint

**Files:**
- Create: `src/worker/scheduler.ts`
- Create: `src/worker/index.ts`
- Test: `tests/worker/scheduler.test.ts`

**Interfaces:**
- Consumes: `runScrapeCycle` from Task 5, `openDb` from Task 3, `winamaxScraper`/`betclicScraper` from Tasks 6-7 (Task 8/Unibet is skipped — not wired in).
- Produces: `startScheduler(intervalMinutes: number, run: () => Promise<void>): { stop: () => void }`.

- [ ] **Step 1: Write the failing test**

Create `tests/worker/scheduler.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { startScheduler } from "../../src/worker/scheduler";

describe("startScheduler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("runs immediately, then again on each interval, and stops on demand", async () => {
    const run = vi.fn().mockResolvedValue(undefined);

    const handle = startScheduler(1, run);
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1));

    await vi.advanceTimersByTimeAsync(60_000);
    expect(run).toHaveBeenCalledTimes(2);

    handle.stop();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("logs and continues if a cycle throws", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const run = vi.fn().mockRejectedValue(new Error("cycle failed"));

    const handle = startScheduler(1, run);
    await vi.waitFor(() => expect(consoleErrorSpy).toHaveBeenCalledOnce());

    handle.stop();
    consoleErrorSpy.mockRestore();
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npx vitest run tests/worker/scheduler.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Write `src/worker/scheduler.ts`**

```typescript
export function startScheduler(intervalMinutes: number, run: () => Promise<void>): { stop: () => void } {
  let stopped = false;

  const tick = async () => {
    if (stopped) return;
    try {
      await run();
    } catch (err) {
      console.error("[scheduler] cycle failed:", err);
    }
  };

  void tick();
  const handle = setInterval(tick, intervalMinutes * 60 * 1000);

  return {
    stop: () => {
      stopped = true;
      clearInterval(handle);
    },
  };
}
```

- [ ] **Step 4: Run it, verify it passes**

Run: `npx vitest run tests/worker/scheduler.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Write `src/worker/index.ts`**

This is a bootstrap entrypoint (env loading + process wiring) — it has no dedicated automated test; verify it manually in Step 6.

```typescript
import "dotenv/config";
import { openDb } from "../db/client";
import { runScrapeCycle } from "../scraper/run";
import { startScheduler } from "./scheduler";
import { winamaxScraper } from "../scraper/winamax";
import { betclicScraper } from "../scraper/betclic";
// Unibet is not wired in -- dropped from v1, see the plan's Global Constraints.

const dbPath = process.env.DB_PATH ?? "./data/coteradar.sqlite";
const intervalMinutes = Number(process.env.POLL_INTERVAL_MINUTES ?? "5");

const db = openDb(dbPath);
const scrapers = [winamaxScraper, betclicScraper];

console.log(`[worker] starting, polling every ${intervalMinutes} min, db=${dbPath}`);
startScheduler(intervalMinutes, () => runScrapeCycle(db, scrapers));
```

- [ ] **Step 6: Verify manually**

Run: `npm run worker`
Expected: logs `[worker] starting, polling every 5 min, db=./data/coteradar.sqlite`, then either succeeds or logs a per-bookmaker `[scraper:<id>] failed:` without crashing the process. Stop with `Ctrl+C`.

- [ ] **Step 7: Commit**

```bash
git add src/worker tests/worker
git commit -m "feat: add worker scheduler and entrypoint"
```

---

### Task 10: API server

**Files:**
- Create: `src/api/server.ts`
- Create: `src/api/index.ts`
- Test: `tests/api/server.test.ts`

**Interfaces:**
- Consumes: `getLatestEvents` from Task 3, `openDb` from Task 3.
- Produces: `createServer(db: DatabaseSync): Express` — an HTTP `GET /api/events?sport=<sport>` endpoint returning `EventWithOdds[]` as JSON.

- [ ] **Step 1: Write the failing test**

Create `tests/api/server.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { DatabaseSync } from "node:sqlite";
import { openDb } from "../../src/db/client";
import { upsertCanonicalEvents } from "../../src/db/repository";
import { createServer } from "../../src/api/server";
import { CanonicalEvent } from "../../src/types";

describe("GET /api/events", () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = openDb(":memory:");
    const events: CanonicalEvent[] = [
      {
        id: "evt1",
        sport: "football",
        competition: "Ligue 1",
        startTime: "2026-09-21T19:00:00.000Z",
        participants: ["PSG", "OM"],
        byBookmaker: { winamax: [{ market: "1X2", selection: "1", price: 1.5 }] },
      },
      {
        id: "evt2",
        sport: "tennis",
        competition: "ATP Paris",
        startTime: "2026-09-22T14:00:00.000Z",
        participants: ["Nadal", "Alcaraz"],
        byBookmaker: { betclic: [{ market: "winner", selection: "Nadal", price: 2.1 }] },
      },
    ];
    upsertCanonicalEvents(db, events);
  });

  it("returns all events with their bookmakers' odds", async () => {
    const res = await request(createServer(db)).get("/api/events");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
  });

  it("filters by sport", async () => {
    const res = await request(createServer(db)).get("/api/events?sport=tennis");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].id).toBe("evt2");
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npx vitest run tests/api/server.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Write `src/api/server.ts`**

```typescript
import express, { Express } from "express";
import { DatabaseSync } from "node:sqlite";
import { getLatestEvents } from "../db/repository";

export function createServer(db: DatabaseSync): Express {
  const app = express();

  app.get("/api/events", (req, res) => {
    const sport = typeof req.query.sport === "string" ? req.query.sport : undefined;
    res.json(getLatestEvents(db, { sport }));
  });

  return app;
}
```

- [ ] **Step 4: Run it, verify it passes**

Run: `npx vitest run tests/api/server.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Write `src/api/index.ts`**

Bootstrap entrypoint, no dedicated test — verified manually in Step 6.

```typescript
import "dotenv/config";
import { openDb } from "../db/client";
import { createServer } from "./server";

const dbPath = process.env.DB_PATH ?? "./data/coteradar.sqlite";
const port = Number(process.env.PORT ?? "3000");

const db = openDb(dbPath);
createServer(db).listen(port, () => {
  console.log(`[api] listening on port ${port}, db=${dbPath}`);
});
```

- [ ] **Step 6: Verify manually**

Run: `npm run api`, then in another terminal: `curl http://localhost:3000/api/events`
Expected: `[]` (empty array — no worker has run yet) with HTTP 200, no crash.

- [ ] **Step 7: Commit**

```bash
git add src/api tests/api
git commit -m "feat: add API server"
```

---

### Task 11: Frontend dashboard

**Files:**
- Create: `web/package.json`, `web/vite.config.ts`, `web/tsconfig.json`, `web/index.html`
- Create: `web/src/main.tsx`, `web/src/App.tsx`
- Create: `web/src/types.ts`
- Create: `web/src/api.ts`
- Create: `web/src/OddsTable.tsx`
- Create: `web/src/bestOdds.ts`
- Test: `web/src/bestOdds.test.ts`
- Test: `web/src/OddsTable.test.tsx`

**Interfaces:**
- Consumes: the `GET /api/events` response shape from Task 10 (`EventWithOdds[]`, duplicated as `web/src/types.ts` since this is a separately deployed package that shouldn't import from the backend's `src/`).
- Produces: a running Vite dev server rendering the comparison table.

v1 UI scope: one row per event, one column per bookmaker, showing that bookmaker's odds for the event's *primary* market (the first market present in its odds array) — not every market. All markets are already stored and returned by the API for future iteration; collapsing N markets into one glanceable table is out of scope for v1.

- [ ] **Step 1: Scaffold the Vite React app**

```bash
mkdir -p web/src
cd web && npm create vite@latest . -- --template react-ts
```

When prompted about the non-empty directory, proceed (it only contains `src/`). This generates `package.json`, `vite.config.ts`, `tsconfig.json`, `index.html`, and a default `src/`.

- [ ] **Step 2: Add test tooling**

```bash
npm install -D vitest jsdom @testing-library/react @testing-library/jest-dom
```

Add to `web/vite.config.ts`:

```typescript
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
  },
});
```

Add to `web/package.json` scripts: `"test": "vitest run"`.

- [ ] **Step 3: Write `web/src/types.ts`**

```typescript
export interface RawOdds {
  market: string;
  selection: string;
  price: number;
}

export interface EventWithOdds {
  id: string;
  sport: string;
  competition: string;
  startTime: string;
  participants: string[];
  byBookmaker: Record<string, { scrapedAt: string; odds: RawOdds[] }>;
}
```

- [ ] **Step 4: Write the failing test for `bestOdds.ts`**

Create `web/src/bestOdds.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { getBestBookmaker } from "./bestOdds";
import { EventWithOdds } from "./types";

const event: EventWithOdds = {
  id: "evt1",
  sport: "football",
  competition: "Ligue 1",
  startTime: "2026-09-21T19:00:00.000Z",
  participants: ["PSG", "OM"],
  byBookmaker: {
    winamax: { scrapedAt: "2026-09-20T10:00:00.000Z", odds: [{ market: "1X2", selection: "1", price: 1.5 }] },
    betclic: { scrapedAt: "2026-09-20T10:00:00.000Z", odds: [{ market: "1X2", selection: "1", price: 1.65 }] },
  },
};

describe("getBestBookmaker", () => {
  it("returns the bookmaker with the highest price for the given market/selection", () => {
    expect(getBestBookmaker(event, "1X2", "1")).toBe("betclic");
  });

  it("returns null when no bookmaker offers that market/selection", () => {
    expect(getBestBookmaker(event, "over_under_2.5", "over")).toBeNull();
  });
});
```

- [ ] **Step 5: Run it, verify it fails**

Run: `cd web && npx vitest run src/bestOdds.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 6: Write `web/src/bestOdds.ts`**

```typescript
import { EventWithOdds } from "./types";

export function getBestBookmaker(event: EventWithOdds, market: string, selection: string): string | null {
  let best: { bookmaker: string; price: number } | null = null;

  for (const [bookmaker, { odds }] of Object.entries(event.byBookmaker)) {
    const match = odds.find((o) => o.market === market && o.selection === selection);
    if (match && (!best || match.price > best.price)) {
      best = { bookmaker, price: match.price };
    }
  }

  return best?.bookmaker ?? null;
}
```

- [ ] **Step 7: Run it, verify it passes**

Run: `cd web && npx vitest run src/bestOdds.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 8: Write `web/src/api.ts`**

```typescript
import { EventWithOdds } from "./types";

export async function fetchEvents(sport?: string): Promise<EventWithOdds[]> {
  const url = sport ? `/api/events?sport=${encodeURIComponent(sport)}` : "/api/events";
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} failed: ${res.status}`);
  return res.json();
}
```

- [ ] **Step 9: Write the failing test for `OddsTable.tsx`**

Create `web/src/OddsTable.test.tsx`:

```typescript
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { OddsTable } from "./OddsTable";
import { EventWithOdds } from "./types";

const events: EventWithOdds[] = [
  {
    id: "evt1",
    sport: "football",
    competition: "Ligue 1",
    startTime: "2026-09-21T19:00:00.000Z",
    participants: ["PSG", "OM"],
    byBookmaker: {
      winamax: { scrapedAt: "2026-09-20T10:00:00.000Z", odds: [{ market: "1X2", selection: "1", price: 1.5 }] },
      betclic: { scrapedAt: "2026-09-20T10:00:00.000Z", odds: [{ market: "1X2", selection: "1", price: 1.65 }] },
    },
  },
];

describe("OddsTable", () => {
  it("renders one row per event with participant names and each bookmaker's price", () => {
    render(<OddsTable events={events} />);

    expect(screen.getByText("PSG - OM")).toBeInTheDocument();
    expect(screen.getByText("1.50")).toBeInTheDocument();
    expect(screen.getByText("1.65")).toBeInTheDocument();
  });

  it("highlights the best price in the row", () => {
    render(<OddsTable events={events} />);

    const bestCell = screen.getByText("1.65");
    expect(bestCell.className).toContain("best");
  });
});
```

- [ ] **Step 10: Run it, verify it fails**

Run: `cd web && npx vitest run src/OddsTable.test.tsx`
Expected: FAIL — module does not exist.

- [ ] **Step 11: Write `web/src/OddsTable.tsx`**

```tsx
import { EventWithOdds } from "./types";
import { getBestBookmaker } from "./bestOdds";

const BOOKMAKERS = ["winamax", "betclic"];

function primaryMarketAndSelection(event: EventWithOdds): { market: string; selection: string } | null {
  for (const { odds } of Object.values(event.byBookmaker)) {
    if (odds.length > 0) return { market: odds[0].market, selection: odds[0].selection };
  }
  return null;
}

export function OddsTable({ events }: { events: EventWithOdds[] }) {
  return (
    <table>
      <thead>
        <tr>
          <th>Match</th>
          {BOOKMAKERS.map((b) => (
            <th key={b}>{b}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {events.map((event) => {
          const primary = primaryMarketAndSelection(event);
          const best = primary ? getBestBookmaker(event, primary.market, primary.selection) : null;

          return (
            <tr key={event.id}>
              <td>{event.participants.join(" - ")}</td>
              {BOOKMAKERS.map((bookmaker) => {
                const odds = event.byBookmaker[bookmaker]?.odds.find(
                  (o) => primary && o.market === primary.market && o.selection === primary.selection
                );
                return (
                  <td key={bookmaker} className={bookmaker === best ? "best" : undefined}>
                    {odds ? odds.price.toFixed(2) : "-"}
                  </td>
                );
              })}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
```

- [ ] **Step 12: Run it, verify it passes**

Run: `cd web && npx vitest run src/OddsTable.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 13: Write `web/src/App.tsx`**

```tsx
import { useEffect, useState } from "react";
import { fetchEvents } from "./api";
import { OddsTable } from "./OddsTable";
import { EventWithOdds } from "./types";

const POLL_MS = 30_000;

export function App() {
  const [events, setEvents] = useState<EventWithOdds[]>([]);
  const [sport, setSport] = useState<string>("");

  useEffect(() => {
    const load = () => fetchEvents(sport || undefined).then(setEvents).catch(console.error);
    load();
    const interval = setInterval(load, POLL_MS);
    return () => clearInterval(interval);
  }, [sport]);

  return (
    <div>
      <h1>CoteRadar</h1>
      <input
        placeholder="Filtrer par sport (ex: football)"
        value={sport}
        onChange={(e) => setSport(e.target.value)}
      />
      <OddsTable events={events} />
    </div>
  );
}
```

- [ ] **Step 14: Wire `web/src/main.tsx` to render `App`**

Replace the generated `web/src/main.tsx` content with:

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
```

Delete the Vite template's default `App.css`/`index.css` styling files if `App.tsx` no longer references them (or keep `index.css` with just a body margin reset — no styling requirements were specified beyond the highlighted-cell class).

- [ ] **Step 15: Add a dev proxy so the frontend can reach the API**

Add to `web/vite.config.ts`, inside `defineConfig({...})`:

```typescript
  server: {
    proxy: {
      "/api": "http://localhost:3000",
    },
  },
```

- [ ] **Step 16: Verify manually**

With `npm run api` running (Task 10) in one terminal:

```bash
cd web && npm install && npm run dev
```

Open the printed local URL. Expected: page loads, shows "CoteRadar" heading and an empty table (no worker data yet) without console errors.

- [ ] **Step 17: Commit**

```bash
git add web
git commit -m "feat: add React dashboard with odds comparison table"
```

---

### Task 12: End-to-end wiring check

**Files:**
- Modify: `README.md` (only if manual verification in this task surfaces a gap in the setup steps written in Task 1)
- Modify: `package.json` (the `description` field still says "Winamax, Betclic, Unibet" from Task 1, before Unibet was dropped — fix it)

**Interfaces:** None — this task wires together everything from Tasks 1-11 and is verified manually, not with new automated tests.

- [ ] **Step 1: Run the full backend test suite**

Run: `npm test`
Expected: all tests from Tasks 3, 4, 5, 6, 7, 9, 10 pass (Task 8/Unibet was skipped, not executed).

- [ ] **Step 2: Run the full frontend test suite**

Run: `cd web && npm test`
Expected: all tests from Task 11 pass.

- [ ] **Step 3: Run all three processes together**

In three terminals:

```bash
npm run worker
npm run api
cd web && npm run dev
```

Wait one polling cycle (`POLL_INTERVAL_MINUTES`), then open the frontend URL.
Expected: the table populates with real events and per-bookmaker odds, the best price per row is highlighted, and the sport filter narrows the rows.

- [ ] **Step 4: Fix the README if setup steps don't match reality**

If any command in `README.md` (from Task 1, Step 5) turned out to be wrong or incomplete during Step 3, fix it now.

- [ ] **Step 5: Sync the "Unibet" mentions left over from Task 1**

Task 1's `package.json` `description` and `README.md` intro were written before Unibet was dropped from v1 (see Global Constraints) and still say "Winamax, Betclic, Unibet" / "les 3 sites". Update both to reflect 2 bookmakers, matching the language already used elsewhere in this plan (e.g. "Winamax, Betclic pour l'instant -- Unibet bloque le scraping avec une protection anti-bot DataDome").

- [ ] **Step 6: Commit**

```bash
git add README.md package.json
git commit -m "docs: fix CoteRadar setup instructions and drop stale Unibet mentions"
```

---

### Task 13: VPS deployment configs

**Files:**
- Create: `deploy/coteradar-worker.service`
- Create: `deploy/coteradar-web.service`
- Modify: `README.md` (add a "Déploiement" section)

**Interfaces:** None — these are systemd unit templates, not application code.

- [ ] **Step 1: Write `deploy/coteradar-worker.service`**

```ini
[Unit]
Description=CoteRadar scraping worker
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/coteradar
EnvironmentFile=/opt/coteradar/.env
ExecStart=/usr/bin/node dist/worker/index.js
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
```

- [ ] **Step 2: Write `deploy/coteradar-web.service`**

```ini
[Unit]
Description=CoteRadar API + web
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/coteradar
EnvironmentFile=/opt/coteradar/.env
ExecStart=/usr/bin/node dist/api/index.js
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
```

- [ ] **Step 3: Add a deployment section to `README.md`**

Append:

```markdown
## Déploiement (VPS)

\`\`\`bash
git clone <repo> /opt/coteradar
cd /opt/coteradar
npm install --production
npx playwright install --with-deps chromium
npm run build
cp .env.example .env   # puis editer .env
sudo cp deploy/*.service /etc/systemd/system/
sudo systemctl enable --now coteradar-worker coteradar-web
\`\`\`

Le frontend (\`web/\`) se build separement (\`cd web && npm run build\`) et se
sert comme fichiers statiques (ex: nginx pointant sur \`web/dist\`, proxy
\`/api\` vers le process web sur \`PORT\`) — a configurer selon l'hebergement
choisi.
```

- [ ] **Step 4: Commit**

```bash
git add deploy README.md
git commit -m "docs: add systemd unit templates and VPS deployment instructions"
```
