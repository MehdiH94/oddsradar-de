// Second pass of scripts/probe-bookmakers.mjs: for the sites that answered, which
// hosts does their page talk to, and which platform is it? That tells whether a
// public JSON API (like PMU's Kambi one) sits behind it, which is what a scraper
// of this project reads.
//
//   node scripts/probe-platforms.mjs                # the four candidates
//   node scripts/probe-platforms.mjs https://x.fr/  # any other URL
//
// One plain GET per page, the same headers as the scrapers, nothing followed
// beyond the page itself: it reads the HTML and lists what is in it. It does not
// call the APIs it finds, does not solve a challenge, does not use a cookie.
// Needs Node >= 18.

const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36";
const PAGES = process.argv.slice(2).length
  ? process.argv.slice(2)
  : [
      "https://www.bwin.fr/fr/sports",
      "https://www.pokerstars.fr/sports/",
      "https://www.circusbet.fr/sport",
      "https://www.daznbet.fr/",
    ];

// Words that give a betting platform away, in the page's scripts and config.
const PLATFORMS = [
  "kambi", "kambicdn", "sbtech", "sbtechapi", "betconstruct", "swarm", "altenar", "sportradar", "betradar",
  "digitain", "betgenius", "openbet", "scientific games", "playtech", "entain", "cds-api", "bwin", "sportnco",
  "genybet", "delasport", "gan ", "everymatrix", "oddsmatrix", "pronet", "leovegas", "betby", "softswiss", "nsoft", "kaizen",
];

const hostOf = (u) => {
  try {
    return new URL(u).host;
  } catch {
    return "";
  }
};

for (const page of PAGES) {
  console.log(`\n=== ${page}`);
  let html;
  try {
    const res = await fetch(page, {
      headers: { "user-agent": UA, accept: "text/html,*/*;q=0.8", "accept-language": "fr-FR,fr;q=0.9" },
      signal: AbortSignal.timeout(20_000),
    });
    console.log(`HTTP ${res.status}, final url ${res.url}`);
    html = (await res.text()).slice(0, 2_000_000);
  } catch (err) {
    console.log(`no answer (${err?.cause?.code ?? err?.name})`);
    continue;
  }

  const base = page;
  const abs = (u) => {
    try {
      return new URL(u, base).href;
    } catch {
      return "";
    }
  };

  const hosts = new Map();
  for (const m of html.matchAll(/(?:src|href|data-src|content)=["']([^"']+)["']/gi)) {
    const host = hostOf(abs(m[1]));
    if (host) hosts.set(host, (hosts.get(host) ?? 0) + 1);
  }
  // Absolute URLs written in inline scripts and JSON config.
  const inline = new Set();
  for (const m of html.matchAll(/https?:\\?\/\\?\/[a-z0-9.-]+(?:\\?\/[^\s"'<>\\)]*)?/gi)) inline.add(m[0].replace(/\\\//g, "/"));
  const apiLike = [...inline].filter((u) => /api|cds|odds|offering|sport|fixture|event|feed|swarm|socket|wss?:/i.test(u));

  const lower = html.toLowerCase();
  const found = PLATFORMS.filter((p) => lower.includes(p));
  const generator = /<meta[^>]+name=["']generator["'][^>]+content=["']([^"']+)/i.exec(html)?.[1];
  const title = /<title[^>]*>([^<]*)/i.exec(html)?.[1]?.trim();

  console.log(`title: ${title ?? "-"}${generator ? ` | generator: ${generator}` : ""} | ${html.length} chars`);
  console.log(`platform words in the page: ${found.length ? found.join(", ") : "none"}`);
  console.log("hosts it loads (count):");
  for (const [h, n] of [...hosts].sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(`  ${h} (${n})`);
  console.log("API-like URLs written in the page:");
  for (const u of [...apiLike].slice(0, 40)) console.log(`  ${u}`);
  // Public keys a site's own front end sends with every call (an access id, an
  // anonymous token): shown by name only, never the value.
  const keys = new Set([...html.matchAll(/["']?(access[_-]?id|client[_-]?id|api[_-]?key|x-[a-z0-9-]*accessid|site[_-]?id|brand[_-]?id)["']?\s*[:=]/gi)].map((m) => m[1]));
  console.log(`config keys the front end sets: ${keys.size ? [...keys].join(", ") : "none"}`);
}
