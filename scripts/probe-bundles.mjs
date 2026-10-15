// Third pass of the probes (scripts/probe-bookmakers.mjs, probe-platforms.mjs):
// where does each site's front end read its odds from? Their pages are shells;
// the address of the API, the site's id on the platform and the public key the
// front sends are in the JavaScript bundles the page loads.
//
//   node scripts/probe-bundles.mjs                     # the four candidates
//   node scripts/probe-bundles.mjs https://x.fr/       # any other page
//   node scripts/probe-bundles.mjs --no-swarm          # read only, no websocket
//
// What it does: one GET of the page, one GET of each of its own scripts (what a
// browser does to show the page), and a search of their text for websocket and
// API addresses and for the ids and keys the front sets. For the sites on
// BetConstruct's "Swarm" protocol (CircusBet, DAZN Bet, like Vbet, which
// src/scraper/vbet.ts reads), it then does what that scraper does: opens the
// websocket it found, asks for an anonymous session with the site's id and lists
// the sports. Nothing else: no cookie, no token, no challenge solved, no call to
// any API but that anonymous websocket. A refusal is a result, not an obstacle.
//
// The keys it finds are shown masked (4 characters and the length), and a
// `key=` / `token=` / `pwd=` in an address is hidden: paste the output freely.
// Needs Node >= 22 (global WebSocket). No dependency.

const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36";
const args = process.argv.slice(2);
const noSwarm = args.includes("--no-swarm");
const PAGES = args.filter((a) => !a.startsWith("--")).length
  ? args.filter((a) => !a.startsWith("--"))
  : ["https://www.circusbet.fr/", "https://www.daznbet.fr/", "https://www.bwin.fr/fr/sports", "https://www.pokerstars.fr/sports/"];

const MAX_BUNDLES = 30;
const MAX_BUNDLE_BYTES = 6_000_000;
// Scripts of these hosts are third parties' (analytics, consent, ads): not read.
const THIRD_PARTY = /google|gstatic|googletagmanager|facebook|cookielaw|onetrust|doubleclick|hotjar|sentry|cloudflare(insights)?|youtube|twitter|tiktok|trustpilot|optimizely|segment|newrelic|datadog|clarity\.ms/i;

const mask = (v) => `${v.slice(0, 4)}… (${v.length} characters)`;
const hideSecrets = (s) =>
  s.replace(/([?&;/](?:key|token|pwd|password|apikey|api_key|secret|signature)[=/])[^&;/"'\s]+/gi, "$1<hidden>");

async function get(url, accept) {
  const res = await fetch(url, {
    headers: { "user-agent": UA, accept, "accept-language": "fr-FR,fr;q=0.9" },
    signal: AbortSignal.timeout(20_000),
  });
  return { status: res.status, url: res.url, text: (await res.text()).slice(0, MAX_BUNDLE_BYTES) };
}

function scriptUrls(html, base) {
  const urls = new Set();
  for (const m of html.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)) urls.add(m[1]);
  for (const m of html.matchAll(/<link[^>]+(?:modulepreload|as=["']script["'])[^>]*href=["']([^"']+)["']/gi)) urls.add(m[1]);
  for (const m of html.matchAll(/<link[^>]+href=["']([^"']+\.js[^"']*)["']/gi)) urls.add(m[1]);
  return [...urls].flatMap((u) => {
    try {
      const abs = new URL(u, base);
      return abs.protocol.startsWith("http") && !THIRD_PARTY.test(abs.host) ? [abs.href] : [];
    } catch {
      return [];
    }
  });
}

function findings(text) {
  const wss = new Set();
  for (const m of text.matchAll(/wss?:\\?\/\\?\/[a-z0-9.-]+(?::\d+)?(?:\\?\/[^\s"'`<>\\)]*)?/gi)) wss.add(m[0].replace(/\\\//g, "/"));
  const apis = new Set();
  for (const m of text.matchAll(/https?:\\?\/\\?\/[a-z0-9.-]+(?:\\?\/[^\s"'`<>\\)]*)?/gi)) {
    const u = m[0].replace(/\\\//g, "/");
    if (/swarm|betconstruct|feedconstruct|bcapps|cds-api|offering|kambi|sportsbook|odds|fixtures|bettingoffer|\/api\//i.test(u) && !THIRD_PARTY.test(u)) apis.add(hideSecrets(u));
  }
  const paths = new Set();
  for (const m of text.matchAll(/["'`](\/(?:cds-api|sportsbook|offering|bettingoffer|api\/(?:sports|odds|events|fixtures))[^"'`\s]{0,100})["'`]/gi)) paths.add(hideSecrets(m[1]));
  // The names may sit in escaped JSON (\"siteId\":123), in an object literal
  // (site_id:123, site_id: "123") or in a query string (site_id=123).
  const ids = new Set();
  for (const m of text.matchAll(/[\\"']*(site_?id|siteId|partner_?id|partnerId|sitePartnerId|brand_?id|brandId|client_?id|clientId|operator_?id|operatorId)[\\"']*\s*[:=]\s*[\\"']*(\d{1,8})\b/gi)) ids.add(`${m[1]}=${m[2]}`);
  const keys = new Set();
  for (const m of text.matchAll(/["']?(api[_-]?key|apiKey|access[_-]?id|accessId|x-bwin-accessid)["']?\s*[:=]\s*["']([A-Za-z0-9_\-]{8,})["']/g)) keys.add(`${m[1]}=${mask(m[2])}`);
  const swarm = new Set();
  let last = -1000;
  for (const m of text.matchAll(/swarm/gi)) {
    // One snippet per stretch of text, not one per occurrence.
    if (m.index - last < 200) continue;
    last = m.index;
    const around = text.slice(Math.max(0, m.index - 70), m.index + 110).replace(/\s+/g, " ");
    if (/wss?:|url|site|host|source|server/i.test(around)) swarm.add(hideSecrets(around.replace(/[A-Za-z0-9_-]{28,}/g, "<long>")));
    if (swarm.size >= 6) break;
  }
  // Where the front opens its session and names its site: a few words of code
  // around each, long tokens hidden.
  const contexts = new Set();
  for (const word of ["request_session", "site_id", "siteParams", "partnerId", "partner_id"]) {
    let from = -1000;
    let n = 0;
    for (const m of text.matchAll(new RegExp(word, "g"))) {
      if (m.index - from < 300) continue;
      from = m.index;
      const around = text.slice(Math.max(0, m.index - 90), m.index + 130).replace(/\s+/g, " ");
      contexts.add(`${word}: ${hideSecrets(around.replace(/[A-Za-z0-9_-]{28,}/g, "<long>"))}`);
      if (++n >= 3) break;
    }
  }
  return { wss: [...wss], apis: [...apis], paths: [...paths], ids: [...ids], keys: [...keys], swarm: [...swarm], contexts: [...contexts] };
}

// What src/scraper/vbet.ts does: an anonymous session, then the sports.
async function trySwarm(url, siteId) {
  if (typeof WebSocket === "undefined") return "no global WebSocket (Node < 22)";
  return new Promise((resolve) => {
    let finished = false;
    const done = (msg) => {
      // Closing a socket that failed to open raises its error again.
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      try {
        ws.close();
      } catch {
        /* closed already */
      }
      resolve(msg);
    };
    const timer = setTimeout(() => done("no answer within 15 s"), 15_000);
    let ws;
    try {
      ws = new WebSocket(url);
    } catch (err) {
      clearTimeout(timer);
      return resolve(`could not open (${err?.message})`);
    }
    ws.onerror = () => done("websocket failed to open");
    ws.onopen = () => ws.send(JSON.stringify({ command: "request_session", params: { language: "fra", site_id: siteId, source: 42 }, rid: "p1" }));
    ws.onmessage = (message) => {
      let reply;
      try {
        reply = JSON.parse(String(message.data));
      } catch {
        return;
      }
      if (reply.rid === "p1") {
        if (reply.code !== 0) return done(`session refused (code ${reply.code})`);
        ws.send(JSON.stringify({ command: "get", params: { source: "betting", what: { sport: ["id", "alias", "name"] }, where: {}, subscribe: false }, rid: "p2" }));
      } else if (reply.rid === "p2") {
        const sports = Object.values(reply.data?.data?.sport ?? {});
        done(
          reply.code === 0
            ? `session ok, ${sports.length} sports: ${sports.slice(0, 6).map((s) => s.alias ?? s.name).join(", ")}`
            : `sports refused (code ${reply.code})`
        );
      }
    };
  });
}

for (const page of PAGES) {
  console.log(`\n=== ${page}`);
  let main;
  try {
    main = await get(page, "text/html,*/*;q=0.8");
  } catch (err) {
    console.log(`no answer (${err?.cause?.code ?? err?.name})`);
    continue;
  }
  const title = /<title[^>]*>([^<]*)/i.exec(main.text)?.[1]?.trim();
  console.log(`HTTP ${main.status}, ${main.text.length} chars, title: ${title ?? "-"}`);
  if (/just a moment|datadome|captcha-delivery|access denied/i.test(main.text) && main.text.length < 20_000) {
    console.log("blocked by an anti-bot page: not read further");
    continue;
  }

  let all = main.text;
  const bundles = scriptUrls(main.text, main.url).slice(0, MAX_BUNDLES);
  let read = 0;
  for (const url of bundles) {
    try {
      const res = await get(url, "*/*");
      if (res.status === 200) {
        all += `\n${res.text}`;
        read++;
      }
    } catch {
      /* a bundle that does not load costs only its own text */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  console.log(`scripts read: ${read} of ${bundles.length} listed (${(all.length / 1024).toFixed(0)} KB of text)`);

  const f = findings(all);
  const show = (label, list, max = 15) => console.log(`${label}: ${list.length ? "" : "none"}${list.slice(0, max).map((x) => `\n  ${x}`).join("")}`);
  show("websocket addresses", f.wss);
  show("API-like addresses", f.apis);
  show("API-like paths", f.paths);
  show("ids the front sets", f.ids, 25);
  show("keys the front sets (masked)", f.keys);
  show("'swarm' in context", f.swarm, 6);
  show("session and site id in context", f.contexts, 12);

  if (!noSwarm && f.wss.length) {
    const siteIds = [...new Set(f.ids.filter((i) => /^(site_?id|siteId|partner_?id|partnerId)=/.test(i)).map((i) => i.split("=")[1]))].slice(0, 3);
    const urls = f.wss.filter((u) => /swarm|betconstruct|bcapps/i.test(u)).slice(0, 3);
    if (urls.length && siteIds.length) {
      console.log("swarm attempts (anonymous session, as src/scraper/vbet.ts):");
      for (const url of urls) for (const id of siteIds) console.log(`  ${url} site_id=${id}: ${await trySwarm(url, id)}`);
    } else if (urls.length) {
      console.log("a swarm address was found but no site id: nothing tried (read the contexts above, or the request_session message in the browser's network tab, WS)");
    }
  }
}
