// Probes the French ANJ-licensed bookmakers' sites and says, for each one,
// whether it answers, is blocked by an anti-bot page, or does not answer.
//
// Run it from where the scrapers run (the VPS, or your own machine), not from a
// sandbox whose proxy refuses every host:
//
//   node scripts/probe-bookmakers.mjs            # table
//   node scripts/probe-bookmakers.mjs --json     # raw results, to paste back
//
// It only sends one plain GET per URL, with the headers the scrapers send
// (a Chrome user agent, no cookie, no token). It never tries to get past a
// protection: a challenge page is reported as "blocked" and that is the answer.
// Needs Node >= 18 (global fetch). No dependency.

const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36";
const TIMEOUT_MS = 15_000;

// [name, [urls]]. The first group is read by the project today: it calibrates
// the probe (they must come out "ok" from the same place the worker runs).
const SITES = [
  ["Winamax (control)", ["https://www.winamax.fr/"]],
  ["Betclic (control)", ["https://www.betclic.fr/"]],
  ["Unibet (control)", ["https://www.unibet.fr/"]],
  ["PMU (control)", ["https://www.pmu.fr/sport/", "https://eu.offering-api.kambicdn.com/offering/v2018/pmusportsfr/group.json?lang=fr_FR&market=FR&client_id=200&channel_id=1&depth=1"]],
  ["NetBet (control)", ["https://www.netbet.fr/"]],
  ["Vbet (control)", ["https://www.vbet.fr/"]],
  ["Betsson (control)", ["https://www.betsson.fr/"]],
  ["bet365", ["https://www.bet365.fr/", "https://www.bet365.fr/#/AS/B1/"]],
  ["Bwin", ["https://www.bwin.fr/", "https://sports.bwin.fr/fr/sports"]],
  ["PokerStars Sports", ["https://www.pokerstarssports.fr/", "https://www.pokerstarssports.fr/sports/"]],
  ["ZEbet", ["https://www.zebet.fr/"]],
  ["Olybet", ["https://www.olybet.fr/", "https://www.olybet.fr/sport"]],
  ["Genybet", ["https://www.genybet.fr/"]],
  ["Feelingbet", ["https://www.feelingbet.fr/"]],
  ["CircusBet", ["https://www.circusbet.fr/", "https://www.circusbet.fr/sport"]],
  ["DAZN Bet", ["https://www.daznbet.fr/", "https://www.dazn.com/fr-FR/home"]],
  ["Parions Sport (FDJ)", ["https://www.enligne.parionssport.fdj.fr/"]],
];

// Signatures of the usual anti-bot pages, in the body or the headers.
const BLOCK_SIGNS = [
  ["Cloudflare challenge", (r) => /just a moment|cf-chl|challenge-platform|attention required/i.test(r.body) || (r.status === 403 && /cloudflare/i.test(r.server))],
  ["DataDome", (r) => /datadome|captcha-delivery\.com/i.test(r.body) || r.headers.some(([k]) => /^x-datadome/i.test(k))],
  ["Akamai", (r) => /akamai(ghost)?|reference #\d+\.[0-9a-f]+/i.test(r.body) || /akamai/i.test(r.server)],
  ["Imperva/Incapsula", (r) => /_incapsula_resource|incapsula incident/i.test(r.body) || r.headers.some(([k]) => /^x-iinfo|^x-cdn$/i.test(k))],
  ["PerimeterX", (r) => /px-captcha|perimeterx|_pxhd/i.test(r.body)],
  ["CloudFront", (r) => r.status === 403 && /cloudfront|the request could not be satisfied/i.test(r.server + r.body)],
  ["Geo block", (r) => /not available in your (country|region)|pays n'est pas|indisponible dans votre pays|restricted country/i.test(r.body)],
];

async function probe(url) {
  const started = Date.now();
  try {
    const res = await fetch(url, {
      headers: { "user-agent": UA, accept: "text/html,application/json;q=0.9,*/*;q=0.8", "accept-language": "fr-FR,fr;q=0.9" },
      redirect: "follow",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const body = (await res.text()).slice(0, 200_000);
    const r = {
      url,
      status: res.status,
      finalUrl: res.url,
      ms: Date.now() - started,
      bytes: body.length,
      server: res.headers.get("server") ?? "",
      headers: [...res.headers.entries()],
      body,
    };
    const sign = BLOCK_SIGNS.find(([, test]) => test(r));
    const verdict =
      sign ? `blocked (${sign[0]})` : res.status === 403 || res.status === 429 ? `blocked (HTTP ${res.status}, no known signature)` : res.status >= 500 ? `server error (HTTP ${res.status})` : res.status >= 400 ? `HTTP ${res.status}` : "ok";
    return { url, status: r.status, finalUrl: r.finalUrl, ms: r.ms, bytes: r.bytes, server: r.server, verdict };
  } catch (err) {
    const cause = err?.cause?.code ?? err?.name ?? "error";
    const verdict = /ENOTFOUND|EAI_AGAIN/.test(cause) ? "no answer (DNS)" : /Timeout|UND_ERR_CONNECT_TIMEOUT|ETIMEDOUT/.test(cause + err?.name) ? "no answer (timeout)" : `no answer (${cause})`;
    return { url, status: 0, finalUrl: url, ms: Date.now() - started, bytes: 0, server: "", verdict };
  }
}

const asJson = process.argv.includes("--json");
const results = [];
for (const [name, urls] of SITES) {
  const probes = [];
  for (const url of urls) {
    probes.push(await probe(url));
    await new Promise((r) => setTimeout(r, 500));
  }
  results.push({ name, probes });
  if (!asJson) {
    for (const p of probes) {
      console.log(`${name.padEnd(22)} ${String(p.status || "-").padEnd(4)} ${p.verdict.padEnd(40)} ${String(p.ms).padStart(5)} ms  ${p.url}`);
    }
  }
}
if (asJson) console.log(JSON.stringify({ at: new Date().toISOString(), node: process.version, results }, null, 2));
