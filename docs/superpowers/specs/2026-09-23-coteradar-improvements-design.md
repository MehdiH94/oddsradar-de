# CoteRadar improvements — design

## Context

Four improvements were requested for the running CoteRadar odds comparator:

1. Fetch odds via API instead of browser scraping, so the tool isn't capped
   at whatever matches happen to be rendered in the DOM.
2. Group matches visibly by sport in the UI.
3. Replace the free-text sport filter with a `<select>` of the sports that
   actually have data, re-querying the API on every change (already true of
   the filter's behavior — only the input type changes).
4. Add pagination.

Investigation confirmed the root cause behind point 1: both scrapers
(`src/scraper/winamax.ts`, `src/scraper/betclic.ts`) drive a headless
Chromium via Playwright and parse whatever is in the DOM after a fixed wait,
with no scroll/lazy-load triggering — so only a handful of matches per site
(23 Winamax / 40 Betclic in the captured fixtures) are ever seen, and Betclic
is hard-coded to a single football listing URL.

A network capture of both sites' listing pages found that each exposes an
internal, non-public API that a direct client can call instead of rendering
and scraping the page:

- **Winamax** pushes match/odds updates over a Socket.IO WebSocket
  (`wss://sports-eu-west-3.winamax.fr/uof-sports-server/socket.io/`), plain
  JSON payloads.
- **Betclic** exposes a gRPC-Web API
  (`https://offering.begmedia.com/web/offering.access.api/offering.access.api.MatchService/*`),
  binary protobuf, no accessible `.proto` schema.

Both are unauthenticated in the requests captured so far (no cookie/token
observed being required), though this needs to be confirmed per-source during
implementation.

## 1. API-based odds fetching

The `BookmakerScraper` interface (`src/scraper/run.ts`) —
`{ id: string; fetch: () => Promise<RawEvent[]> }` — does not change.
`runScrapeCycle`'s retry/error-isolation logic does not change. Only what
happens inside each scraper's `fetch()` changes.

### Winamax — Socket.IO client

Observed protocol (Engine.IO v3 / Socket.IO v2 framing): the client sends
`42["m",{"route":"home"}]`; the server replies with an initial snapshot
(teasers, bet-category metadata) followed by incremental deltas like
`42["m",{"matches":{...},"odds":{...},"outcomes":{...}}]`, all keyed by
numeric IDs.

Implementation replaces `fetchWinamaxHtml`/`parseWinamaxHtml` with a
`socket.io-client`-based fetcher that:

- Opens the socket, sends the `route` subscription(s) needed for full
  coverage (the exact route(s) that yield the complete multi-sport catalog —
  not just "home" — need to be enumerated as the first implementation step,
  by capturing what the real site sends when switching sports).
- Accumulates the snapshot + deltas into an in-memory state, resolving
  numeric match/outcome/odds IDs to the team/competition/market/price
  concepts `RawEvent`/`RawOdds` need (the un-truncated initial snapshot
  payload — our spike only captured the first 1000 chars — should carry
  these).
- Converts accumulated state into `RawEvent[]` on each `fetch()` call.
- Since this is push-based, prefer keeping one long-lived connection across
  scrape cycles rather than reconnecting every `POLL_INTERVAL_MINUTES` —
  finalize during implementation based on how the worker lifecycle is
  structured.

New dependency: `socket.io-client`.

### Betclic — gRPC-Web, reverse-engineered

Key finding: of the `MatchService` methods, `GetMatchBySport` is **unary**
(no `serverStreaming` flag), unlike `GetMatchesBySportWithNotifications`
(server-streaming). Targeting the unary method means implementing only a
single length-prefixed protobuf request/response, not gRPC-Web's streaming
frame multiplexing.

No `.proto` schema is reachable client-side. Implementation adds:

- `src/scraper/protoWire.ts` — a small, generic, schema-less protobuf
  wire-format reader/writer (varint / 32-bit / 64-bit / length-delimited
  field walking). No message descriptors required.
- Field numbers for the request (sport identifier) and response (match id,
  competition, participants, start time, market/selection/price) are
  reverse-engineered by capturing real request/response byte pairs (via a
  one-off Playwright capture, in the spirit of the existing
  `scripts/capture-fixture.ts`) and cross-referencing decoded values against
  what the page actually renders.
- Captured byte pairs are checked in as binary test fixtures (mirroring
  `tests/scraper/fixtures/*.html`) so the decoder is tested against real
  data, not just a live connection.
- Decoding is defensive: unknown fields are skipped, a match that fails to
  parse is skipped with a warning rather than aborting the whole fetch — the
  same posture the current selector-based scrapers already take for
  missing/unparseable prices.

This is understood to be more fragile than the Winamax path: Betclic can
change field numbers on any deploy with no schema to detect the break other
than decode failures or a shape mismatch. Accepted trade-off, per explicit
choice over the lower-risk "keep Playwright, fix lazy-load" alternative.

### Side benefit

Both APIs likely expose real sport/market identifiers directly, which may
let the new fetchers drop the current DOM-based heuristics
(`inferSport`/`deriveMarketName` in `winamax.ts`) in favor of real values —
to be confirmed once the payload shapes are decoded, not a requirement of
this change.

## 2. Group matches by sport in the UI

- New pure utility, e.g. `web/src/groupBySport.ts`:
  `groupBySport(events: EventWithOdds[]): Array<[sport: string, events: EventWithOdds[]]>`,
  sorted alphabetically by sport for determinism. Directly unit-testable,
  same style as `web/src/bestOdds.test.ts`.
- A new thin wrapper component renders one `<section>` per group: an
  `<h2>{sport}</h2>` heading followed by the existing `<OddsTable events={group} />`.
  `OddsTable` itself is unchanged — no risk to its current tests.
- `App.tsx` renders the wrapper instead of a single flat `OddsTable`.

## 3. Sport filter as a select, API-driven

- New backend endpoint `GET /api/sports` → `SELECT DISTINCT sport FROM events ORDER BY sport`
  (new `getDistinctSports(db)` in `src/db/repository.ts`), returning `string[]`.
- `web/src/api.ts` gets `fetchSports(): Promise<string[]>`.
- `App.tsx` fetches the sports list once on mount and renders a `<select>`
  (with a leading "Tous les sports" option mapping to no filter) in place of
  the current `<input>`. The existing `useEffect` that re-fetches events on
  `sport` state change is unchanged — swapping the input for a select
  preserves "every filter change triggers an API call" with no new logic.

## 4. Pagination

- `GET /api/events` gains optional `page` (default 1) and `pageSize`
  (default 20, capped at 100) query params.
- `getLatestEvents` in `src/db/repository.ts` adds `LIMIT`/`OFFSET` plus a
  companion `COUNT(*)` (same filters: sport + freshness window) for the total.
- Response shape changes from a bare `EventWithOdds[]` to an envelope:
  `{ events: EventWithOdds[]; total: number; page: number; pageSize: number }`.
  This is a breaking response-shape change, but the only consumer is this
  frontend — `web/src/api.ts`'s `fetchEvents` return type and its one caller
  (`App.tsx`) update together.
- `App.tsx` adds a `page` state (reset to 1 whenever `sport` changes) and
  renders "Précédent / Suivant" controls plus a page indicator, disabling
  "Suivant" once `page * pageSize >= total`.
- Pagination applies to the flat filtered/sorted result set as a whole,
  *before* client-side sport-grouping — with "all sports" selected, a page
  can therefore show partial groups from more than one sport, the same as
  any paginated + grouped listing.

## Testing strategy

- Winamax: capture representative Socket.IO frame sequences as fixtures;
  test the accumulation/parsing logic against them, not a live connection.
- Betclic: capture real grpc-web request/response byte pairs as binary
  fixtures; test the wire-format decoder and field mapping against them.
- New pure functions (`groupBySport`, the pagination query, the sports-list
  query) get direct unit tests.
- `tests/api/server.test.ts` extended for `/api/sports` and the new
  pagination params/envelope on `/api/events`.

## Rollout

- No systemd/deploy changes anticipated — both units already share the same
  `DB_PATH` and don't need new configuration for this work.
- No new secrets: both sources remain unauthenticated public endpoints as
  far as currently observed; this is re-verified during implementation.
- New dependency: `socket.io-client` (Winamax only). Betclic's protobuf
  decoding is hand-rolled, no new dependency.
