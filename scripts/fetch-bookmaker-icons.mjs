// Fetches the icons of the bookmakers added without one (Genybet, CircusBet,
// DAZN Bet) into web/src/assets/bookmakers/<id>.<ext>, where web/src/bookmakers.ts
// finds them by their file name.
//
//   npm run icons                  # the three, skipping those already there
//   npm run icons -- --force       # fetch again, replacing the files
//   npm run icons -- --dry-run     # say what would be fetched, write nothing
//   npm run icons -- genybet       # one bookmaker
//
// In this order, for each bookmaker:
//   1. the site itself: the icons its page declares (<link rel="apple-touch-icon">,
//      "icon", the web manifest's), then the usual paths (/apple-touch-icon.png,
//      /favicon.png, /favicon.svg, /favicon.ico), the biggest raster first;
//   2. failing that, the web: DuckDuckGo's and Google's favicon services.
// Each file is checked to be an image of a sensible size before it is kept. A
// plain GET of public files, with no cookie and no token; a site that answers
// with an anti-bot page just has no icon from that step.
//
// Look at what it wrote before committing it: a favicon service answers with a
// generic globe for a site it does not know, which no check here can tell apart.
// Needs Node >= 18. No dependency.

import { mkdir, writeFile, access } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "web", "src", "assets", "bookmakers");
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36";
const SITES = {
  genybet: "https://www.genybet.fr/",
  circusbet: "https://www.circusbet.fr/",
  daznbet: "https://www.daznbet.fr/",
  betify: "https://betify10.sh/",
};
const MAX_BYTES = 300_000;
const EXTENSIONS = { png: "png", ico: "ico", svg: "svg", webp: "webp", jpeg: "jpg" };

const args = process.argv.slice(2);
const force = args.includes("--force");
const dryRun = args.includes("--dry-run");
const wanted = args.filter((a) => !a.startsWith("--"));
const ids = wanted.length ? wanted : Object.keys(SITES);

// What the bytes are, by their first bytes; the size in pixels when a PNG says it.
function sniff(buf) {
  if (buf.length < 16) return undefined;
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { type: "png", size: buf.readUInt32BE(16) };
  }
  if (buf[0] === 0 && buf[1] === 0 && buf[2] === 1 && buf[3] === 0) {
    // An .ico: its biggest image (width byte 0 means 256).
    const count = buf.readUInt16LE(4);
    let best = 0;
    for (let i = 0; i < count && 6 + i * 16 + 1 < buf.length; i++) best = Math.max(best, buf[6 + i * 16] || 256);
    return { type: "ico", size: best };
  }
  if (buf.subarray(0, 4).toString() === "RIFF" && buf.subarray(8, 12).toString() === "WEBP") return { type: "webp", size: 0 };
  if (buf[0] === 0xff && buf[1] === 0xd8) return { type: "jpeg", size: 0 };
  const head = buf.subarray(0, 600).toString("utf8").toLowerCase();
  if (head.includes("<svg")) return { type: "svg", size: 0 };
  return undefined;
}

async function get(url) {
  const res = await fetch(url, {
    headers: { "user-agent": UA, accept: "image/avif,image/webp,image/png,image/svg+xml,image/*,*/*;q=0.8", "accept-language": "fr-FR,fr;q=0.9" },
    redirect: "follow",
    signal: AbortSignal.timeout(20_000),
  });
  return { status: res.status, buf: Buffer.from(await res.arrayBuffer()), type: res.headers.get("content-type") ?? "" };
}

// The icons a page declares, biggest declared size first, SVG and PNG before ICO.
function declaredIcons(html, base) {
  const found = [];
  for (const tag of html.matchAll(/<link\b[^>]*>/gi)) {
    const rel = /\brel=["']([^"']+)["']/i.exec(tag[0])?.[1]?.toLowerCase() ?? "";
    const href = /\bhref=["']([^"']+)["']/i.exec(tag[0])?.[1];
    if (!href || !/icon/.test(rel) || /mask-icon/.test(rel)) continue;
    const sizes = /\bsizes=["'](\d+)x\d+/i.exec(tag[0])?.[1];
    let url;
    try {
      url = new URL(href, base).href;
    } catch {
      continue;
    }
    const apple = rel.includes("apple-touch");
    const rank = (sizes ? Number(sizes) : apple ? 180 : /\.svg(\?|$)/i.test(url) ? 128 : /\.ico(\?|$)/i.test(url) ? 32 : 64) + (apple ? 1000 : 0);
    found.push({ url, rank });
  }
  return found.sort((a, b) => b.rank - a.rank).map((f) => f.url);
}

async function fromManifest(html, base) {
  const href = /<link\b[^>]*rel=["']manifest["'][^>]*href=["']([^"']+)["']/i.exec(html)?.[1];
  if (!href) return [];
  try {
    const url = new URL(href, base);
    const manifest = JSON.parse((await get(url.href)).buf.toString("utf8"));
    return (manifest.icons ?? [])
      .map((i) => ({ src: i.src, size: Number(String(i.sizes ?? "0").split("x")[0]) || 0 }))
      .sort((a, b) => b.size - a.size)
      .map((i) => new URL(i.src, url).href);
  } catch {
    return [];
  }
}

async function candidatesFromSite(site) {
  const urls = [];
  try {
    const page = await get(site);
    if (page.status === 200) {
      const html = page.buf.toString("utf8");
      urls.push(...declaredIcons(html, site), ...(await fromManifest(html, site)));
    }
  } catch (err) {
    console.log(`  site: no answer (${err?.cause?.code ?? err?.name})`);
  }
  for (const path of ["/apple-touch-icon.png", "/favicon.png", "/favicon.svg", "/favicon.ico"]) urls.push(new URL(path, site).href);
  return [...new Set(urls)];
}

function candidatesFromWeb(site) {
  const host = new URL(site).host;
  return [`https://icons.duckduckgo.com/ip3/${host}.ico`, `https://www.google.com/s2/favicons?domain=${host}&sz=128`];
}

async function firstImage(urls) {
  for (const url of urls) {
    try {
      const { status, buf } = await get(url);
      const kind = status === 200 && buf.length <= MAX_BYTES ? sniff(buf) : undefined;
      // Under 16 px is a placeholder, not an icon.
      if (kind && (kind.size === 0 || kind.size >= 16)) return { url, buf, kind };
    } catch {
      /* the next one */
    }
  }
  return undefined;
}

const exists = (p) => access(p).then(() => true, () => false);

await mkdir(OUT, { recursive: true });
let missing = 0;
for (const id of ids) {
  const site = SITES[id];
  if (!site) {
    console.log(`${id}: unknown (known: ${Object.keys(SITES).join(", ")})`);
    missing++;
    continue;
  }
  const have = (await Promise.all(Object.values(EXTENSIONS).map(async (ext) => ((await exists(join(OUT, `${id}.${ext}`))) ? `${id}.${ext}` : undefined)))).find(Boolean);
  if (have && !force) {
    console.log(`${id}: ${have} is there already (--force to fetch again)`);
    continue;
  }
  console.log(`${id}: ${site}`);
  let found = await firstImage(await candidatesFromSite(site));
  let origin = "the site";
  if (!found) {
    found = await firstImage(candidatesFromWeb(site));
    origin = "the web (favicon service)";
  }
  if (!found) {
    console.log("  no icon found, from the site or the web");
    missing++;
    continue;
  }
  const file = `${id}.${EXTENSIONS[found.kind.type]}`;
  console.log(`  ${file} from ${origin}: ${found.url} (${found.kind.type}${found.kind.size ? `, ${found.kind.size} px` : ""}, ${found.buf.length} bytes)`);
  if (!dryRun) await writeFile(join(OUT, file), found.buf);
}
console.log(missing ? `\n${missing} without an icon: they keep showing their name.` : "\nLook at the files before committing them.");
process.exitCode = missing ? 1 : 0;
