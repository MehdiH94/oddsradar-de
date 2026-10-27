// The bookmakers' promotions pages as the German VPS sees them (backlog #27,
// "Promos from more bookmakers"): for each candidate address, what it
// answers (status, final address, size, title), whether an anti-bot page
// stands in front of it, the keys of its embedded state that name a
// promotion with the start of its value, and the promotion-looking
// addresses in it, in its own scripts and in the promotion chunks they load
// (with the API paths those name), to write the site's readers
// (src/promos/) from the real pages.
// Plain GETs, as a browser's first request: nothing is clicked, nothing is
// worked around, nothing is written. Run by `vps-report promo-pages`
// (deploy/vps-report.sh), or by hand: node scripts/probe-promo-pages.mjs
const PAGES = [
  ["merkurbets", "https://www.merkurbets.de/de/promotions"],
  ["merkurbets", "https://www.merkurbets.de/de/aktionen"],
  ["sportingbet", "https://www.sportingbet.de/de/promo/offers"],
  ["neobet", "https://neobet.de/promotions"],
  ["neobet", "https://www.neo.bet/de/promotions"],
  ["winamaxde", "https://www.winamax.de/promotions"],
  ["betway", "https://betway.de/de/de/promotions"],
  ["admiralbet", "https://www.admiralbet.de/de/promotions"],
  ["twentybet", "https://20bet.com/de/promotions"],
  ["leovegas", "https://www.leovegas.de/de-de/promotions"],
  ["leovegas", "https://www.leovegas.de/de-de/aktionen"],
  ["oddset", "https://www.oddset.de/promotions"],
  ["vbet", "https://www.vbet.de/sport-promos"],
  ["888sport", "https://www.888sport.de/promotions"],
];
const HEADERS = {
  accept: "text/html,application/xhtml+xml",
  "accept-language": "de-DE,de;q=0.9",
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
};
const CHALLENGE = /just a moment|cf-chl|attention required|you have been blocked|access denied|zugriff verweigert|captcha|incapsula|perimeterx|datadome/i;
const PROMO_KEY = /"([A-Za-z_]*(?:[Pp]romo|[Bb]onus|[Oo]ffer|[Aa]ktion|[Cc]ampaign)[A-Za-z_]*)"\s*:/g;
const PROMO_URL = /(?:https?:\/\/[A-Za-z0-9.-]+)?\/[A-Za-z0-9_\-./]*(?:promo|bonus|offer|aktion|campaign)[A-Za-z0-9_\-./?=&]*/gi;
const MAX_SCRIPTS = 12;
// The promotion chunks a single-page app loads later ("UseCampaigns__x.js"),
// read too: where their API paths are.
const MAX_CHUNKS = 8;
const SAMPLE = 600;
const MAX_BYTES = 4_000_000;

async function get(url) {
  const res = await fetch(url, { headers: HEADERS, redirect: "follow", signal: AbortSignal.timeout(25_000) });
  const text = (await res.text()).slice(0, MAX_BYTES);
  return { status: res.status, url: res.url, text };
}

const counted = (matches) => {
  const counts = new Map();
  for (const m of matches) counts.set(m, (counts.get(m) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1]);
};

const out = [`promotions pages from ${process.env.HOSTNAME ?? "here"}, ${new Date().toISOString()}`];
for (const [bookmaker, url] of PAGES) {
  out.push("", `== ${bookmaker} ${url}`);
  let page;
  try {
    page = await get(url);
  } catch (err) {
    out.push(`  no answer: ${err.cause?.code ?? err.message}`);
    continue;
  }
  const title = /<title[^>]*>([^<]*)/i.exec(page.text)?.[1]?.trim().slice(0, 100) ?? "";
  out.push(`  ${page.status} ${page.url} ${page.text.length} bytes, title "${title}"`);
  const challenge = CHALLENGE.exec(page.text);
  if (challenge) out.push(`  anti-bot or block marker: "${challenge[0]}"`);
  const keys = counted([...page.text.matchAll(PROMO_KEY)].map((m) => m[1])).slice(0, 15);
  if (keys.length) out.push(`  state keys: ${keys.map(([k, n]) => `${k}×${n}`).join(", ")}`);
  // Each key's value, its start: whether the list is in the page.
  for (const [key] of keys.slice(0, 5)) {
    const at = page.text.indexOf(`"${key}"`);
    const value = page.text.slice(at + key.length + 2, at + key.length + 2 + SAMPLE).replace(/^\s*:\s*/, "").replace(/\s+/g, " ");
    out.push(`    ${key}: ${value}`);
  }
  const origin = new URL(page.url).origin;
  const urls = new Set([...page.text.matchAll(PROMO_URL)].map((m) => m[0]).filter((u) => !/\.(webp|png|jpe?g|svg|gif|css|woff2?)(\?|$)/i.test(u)));
  // Its own scripts: where a page rendered in the browser asks for its list.
  const scripts = [...page.text.matchAll(/<script[^>]+src="([^"]+)"/gi)]
    .map((m) => new URL(m[1].replace(/&amp;/g, "&"), page.url).toString())
    .filter((s) => new URL(s).origin === origin)
    .slice(0, MAX_SCRIPTS);
  for (const script of scripts) {
    try {
      const js = await get(script);
      for (const m of js.text.matchAll(/["'`]((?:https?:\/\/[A-Za-z0-9.-]+)?\/?[A-Za-z0-9_\-./]*(?:promo|bonus|campaign)[A-Za-z0-9_\-./]*)["'`]/gi)) {
        if (m[1].includes("/") && !/\.(webp|png|jpe?g|svg|gif|css)$/i.test(m[1])) urls.add(`${m[1]}  (in ${new URL(script).pathname.slice(-40)})`);
      }
    } catch {}
  }
  // The promotion chunks named in its scripts, and the API paths in them.
  const chunks = [...urls]
    .map((u) => u.split("  (in")[0])
    .filter((u) => /\.js$/.test(u))
    .map((u) => new URL(u.replace(/^\.\//, "assets/"), `${origin}/`).toString())
    .filter((u, i, all) => all.indexOf(u) === i)
    .slice(0, MAX_CHUNKS);
  for (const chunk of chunks) {
    try {
      const js = await get(chunk);
      const paths = new Set([...js.text.matchAll(/["'`](\/?(?:api|rest|graphql|v\d)\b[A-Za-z0-9_\-./{}$]*|https?:\/\/[A-Za-z0-9.-]+\/[A-Za-z0-9_\-./{}$]*)["'`]/g)].map((m) => m[1]));
      out.push(`  chunk ${new URL(chunk).pathname} (${js.status}, ${js.text.length} bytes): ${[...paths].slice(0, 15).join(" ") || "no API path"}`);
    } catch (err) {
      out.push(`  chunk ${chunk}: no answer (${err.cause?.code ?? err.message})`);
    }
  }
  const list = [...urls].slice(0, 40);
  if (list.length) out.push(`  promotion-looking addresses (${urls.size}):`, ...list.map((u) => `    ${u.slice(0, 200)}`));
  out.push(`  scripts read: ${scripts.length}`);
}
console.log(out.join("\n"));
