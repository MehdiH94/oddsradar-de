import express, { Express } from "express";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { getLatestEvents, getDistinctSports, getEventSuggestions, getCompetitions, getValueBets, ListingOptions } from "../db/repository";
import { surebetsOrNone, withoutSurebets } from "../db/surebets";
import { getEventDetail } from "../db/eventDetail";
import { getPlayerStats } from "../db/playerStats";
import { getAlertStatus } from "../db/alerts";
import { ttlCache } from "./cache";
import helmet from "helmet";
import { AuthContext } from "../auth/context";
import { authRouter } from "../auth/routes";
import { loadSession, requireAuth, requireRole } from "../auth/middleware";
import { adminRouter } from "../auth/adminRoutes";
import { preferencesRouter } from "../auth/preferencesRoutes";
import { walletRouter } from "../freebets/walletRoutes";
import { conversionsRouter } from "../freebets/conversionsRoutes";
import { createConversionsService } from "../freebets/conversions";
import { createInlinePool, ComputePool } from "../freebets/pool";
import { loadFreebetMarkets } from "../db/freebets";
import { getPublicHomeStats } from "../db/publicStats";

// The built frontend, relative to this module's directory. tsconfig.json maps
// src -> dist (rootDir/outDir), so this file runs either as src/api/server.ts
// (ts-node, in development) or as dist/api/server.js (after `npm run build`);
// "../../web/dist" resolves to <project-root>/web/dist in both cases.
const WEB_DIST = path.join(__dirname, "../../web/dist");

// The dashboard's page (ODDS_PATH in web/src/routes.ts): the same index.html as
// the home's, whose script shows one or the other from the address. A reload
// or a shared link on it must find the page rather than a 404. Listed one by
// one, so that any other unknown path still is a 404.
const SPA_PATHS = ["/odds", "/login", "/signup", "/forgot-password", "/reset-password", "/verify-email", "/admin", "/freebets"];

// The events listing's "kind": the winners of the competitions alone, or the
// matches and the winners together; anything else is the matches.
function eventKind(value: unknown): "competition" | "all" | undefined {
  return value === "competition" || value === "all" ? value : undefined;
}

export interface ServerOptions {
  // How long /api/value-bets' answer is kept (ms); 0, the default, keeps none.
  valueBetsCacheMs?: number;
  // The built frontend's folder (a test points it at a temporary one).
  webDist?: string;
  // The accounts: every data route below answers 401 without a live session.
  auth: AuthContext;
  // Behind a reverse proxy (Caddy): how many hops to trust for the client's
  // address and protocol; 0 when the process faces the network.
  trustProxy?: number;
  // Where the Freebets page's calculations run (src/freebets/pool.ts): a worker
  // thread on the site, in the request's own thread when missing (the tests).
  freebetsPool?: ComputePool;
  // How long the matches on offer, and an account's answer, are reused (ms); 0, the default, keeps none.
  freebetsCacheMs?: number;
}

export function createServer(
  db: DatabaseSync,
  listing: ListingOptions = {},
  { valueBetsCacheMs = 0, webDist = WEB_DIST, auth, trustProxy = 0, freebetsPool = createInlinePool(), freebetsCacheMs = 0 }: ServerOptions
): Express {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", trustProxy);
  // Security headers: a strict CSP (the built site loads nothing from
  // elsewhere), HSTS, no referrer (email links carry a token), no sniffing.
  // Over plain http (development) neither HSTS nor upgrading requests to https
  // makes sense: the site would not load.
  const https = auth.secureCookies;
  app.use(
    helmet({
      strictTransportSecurity: https,
      contentSecurityPolicy: { directives: { upgradeInsecureRequests: https ? [] : null } },
    })
  );

  // Is the process up: for the deploy's checks. Public, and says nothing else.
  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });
  app.use("/api/auth", authRouter(auth));
  // The accounts' endpoints are above; every other /api route is data and
  // needs a session. A new route under /api is protected by default.
  app.use("/api", loadSession(auth));
  // What the home page may show anyone: totals only, never a price.
  app.get("/api/public/home", (_req, res) => {
    res.json(getPublicHomeStats(db, listing));
  });
  app.use("/api", requireAuth);
  app.use("/api/preferences", preferencesRouter(auth));
  // The freebets an account holds, at their exact path, and what the Freebets
  // page converts them into, next to it under /api/freebets.
  app.use("/api/freebets/wallet", walletRouter(auth));
  // What to do with it: the matches on offer are read once for everyone (they
  // only move with the worker's cycles), the calculation is each account's own.
  const freebetMarkets = ttlCache<ReturnType<typeof loadFreebetMarkets>>(freebetsCacheMs);
  const conversions = createConversionsService({ markets: () => freebetMarkets("markets", () => loadFreebetMarkets(db, listing)), pool: freebetsPool });
  app.use("/api/freebets/conversions", conversionsRouter({ auth, service: conversions, cacheMs: freebetsCacheMs }));
  app.use("/api/admin", requireRole("admin"), adminRouter(auth));
  // Value bets and surebets read every upcoming match's prices: the slowest
  // answer by far, and the same for everyone until the worker's next cycle.
  const cachedValueBets = ttlCache<{ bets: unknown[]; total: number; surebets: unknown[] }>(valueBetsCacheMs);

  app.get("/api/events", (req, res) => {
    const sport = typeof req.query.sport === "string" ? req.query.sport : undefined;
    const q = typeof req.query.q === "string" ? req.query.q : undefined;
    const page = typeof req.query.page === "string" ? Number(req.query.page) : undefined;
    const pageSize = typeof req.query.pageSize === "string" ? Number(req.query.pageSize) : undefined;
    const sort = req.query.sort === "trj" || req.query.sort === "value" ? req.query.sort : "start";
    // Comma-separated; present but empty means none, so every TRJ is null.
    const bookmakers =
      typeof req.query.bookmakers === "string" ? req.query.bookmakers.split(",").filter(Boolean) : undefined;
    // "players=1": only the matches with a players' market (scorers...).
    const players = req.query.players === "1";
    // "kind=competition": the winners of the competitions (Ligue 1, Roland-Garros...)
    // instead of the matches, whatever their sport; "kind=all": the matches and
    // the winners together.
    const kind = eventKind(req.query.kind);
    // "competition=Ligue 1": only that competition's events, its winner too.
    const competition = typeof req.query.competition === "string" ? req.query.competition : undefined;
    res.json(getLatestEvents(db, { sport, q, page, pageSize, sort, bookmakers, players, kind, competition, ...listing }));
  });

  // Every value bet (src/db/value.ts), biggest edge first or, on
  // ?sort=start, soonest kick-off first.
  app.get("/api/value-bets", (req, res) => {
    const q = typeof req.query.q === "string" ? req.query.q : undefined;
    const sort = req.query.sort === "start" ? "start" : "value";
    // Like /api/events': present but empty means none, so no value bet.
    const bookmakers =
      typeof req.query.bookmakers === "string" ? req.query.bookmakers.split(",").filter(Boolean) : undefined;
    // And every surebet (src/db/surebets.ts), the same way: a value bet a
    // surebet holds is shown as that surebet only.
    const opts = { q, sort, bookmakers, ...listing } as const;
    const key = JSON.stringify([q, sort, bookmakers && [...bookmakers].sort()]);
    res.json(
      cachedValueBets(key, () => {
        const surebets = surebetsOrNone(db, opts);
        const bets = withoutSurebets(getValueBets(db, opts).bets, surebets);
        return { bets, total: bets.length, surebets };
      })
    );
  });

  app.get("/api/events/suggestions", (req, res) => {
    const sport = typeof req.query.sport === "string" ? req.query.sport : undefined;
    const q = typeof req.query.q === "string" ? req.query.q : undefined;
    const kind = eventKind(req.query.kind);
    const competition = typeof req.query.competition === "string" ? req.query.competition : undefined;
    res.json(getEventSuggestions(db, { q, sport, kind, competition, ...listing }));
  });

  // After /api/events/suggestions, which this route would otherwise take.
  app.get("/api/events/:id", (req, res) => {
    const bookmakers =
      typeof req.query.bookmakers === "string" ? req.query.bookmakers.split(",").filter(Boolean) : undefined;
    const detail = getEventDetail(db, req.params.id, { bookmakers, ...listing });
    if (!detail) {
      res.status(404).json({ error: "match not found, started or taken down" });
      return;
    }
    res.json(detail);
  });

  // What the exchange's players' markets gave since `since` (an ISO time;
  // the last 3 days when missing or unreadable): src/db/playerStats.ts.
  app.get("/api/stats/players", (req, res) => {
    const asked = typeof req.query.since === "string" ? Date.parse(req.query.since) : Number.NaN;
    const since = new Date(Number.isNaN(asked) ? Date.now() - 3 * 24 * 60 * 60 * 1000 : asked).toISOString();
    res.json(getPlayerStats(db, since));
  });

  // The Discord alerts (src/alerts/gems.ts): whether the worker has a webhook,
  // its last failure, the last gems sent. Never the webhook itself.
  app.get("/api/alerts", (_req, res) => {
    res.json(getAlertStatus(db));
  });

  app.get("/api/sports", (_req, res) => {
    res.json(getDistinctSports(db, listing));
  });

  // The competitions to filter the matches' list by, a sport's when given.
  app.get("/api/competitions", (req, res) => {
    const sport = typeof req.query.sport === "string" ? req.query.sport : undefined;
    res.json(getCompetitions(db, { sport, ...listing }));
  });

  // Serve the built dashboard, so coteradar-web.service is genuinely "API + web"
  // as its unit description and the spec's architecture both say -- previously
  // nothing served the frontend at all in production. Registered after the API
  // route, so /api/events can never be shadowed by a static file. If web/dist
  // does not exist yet (a dev checkout where nobody has run the frontend build)
  // express.static simply matches nothing and falls through to a 404; it does
  // not throw at registration or request time.
  app.use(express.static(webDist));

  // The frontend's own pages (SPA_PATHS). Without a build there is no
  // index.html to send: the 404 is the same as for any unknown path.
  app.get(SPA_PATHS, (_req, res, next) => {
    res.sendFile(path.join(webDist, "index.html"), (err) => {
      if (err && !res.headersSent) next();
    });
  });

  return app;
}
