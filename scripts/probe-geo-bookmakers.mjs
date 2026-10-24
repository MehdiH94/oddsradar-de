// The bookmakers that refuse visitors outside Germany (backlog #27): what
// each one's sports page asks its servers for while it loads, from the
// German VPS, to write their scrapers from the real answers. A plain visit
// in a browser, like network-log.mjs: nothing is clicked, nothing is worked
// around; a site behind an anti-bot challenge is noted as such.
//   cd /opt/oddsradar
//   sudo npx playwright install-deps chromium            (once: the system's libraries)
//   sudo -u oddsradar npx playwright install chromium    (once: the browser)
//   sudo -u oddsradar node scripts/probe-geo-bookmakers.mjs [seconds per site]
// Writes /tmp/probe-geo-bookmakers.txt: the file to post in the Discord
// feedback channel (scp it to your computer first). Nothing in the app's
// folder changes.
import { writeFileSync } from "node:fs";
import { chromium } from "@playwright/test";

const SITES = [
  ["neobet", "https://www.neo.bet/de/sportwetten"],
  ["bet3000", "https://www.bet3000.de/de/sportwetten"],
  ["letsbet", "https://www.letsbet.de/de/sportwetten"],
  ["tipico", "https://sports.tipico.de/de/alle/fussball"],
  ["daznbet", "https://www.daznbet.de/de-de/sport"],
  ["rabona", "https://rabona.com/de/sport"],
];
const seconds = Number(process.argv[2] ?? 25);
// The answers that carry data: an API's JSON, a websocket's frames.
const DATA = /json|javascript-text|text\/plain|protobuf|octet-stream/;

const browser = await chromium.launch();
const out = [`probe of ${SITES.length} sites, ${new Date().toISOString()}`];
for (const [name, url] of SITES) {
  const page = await browser.newPage({
    locale: "de-DE",
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
    viewport: { width: 1366, height: 900 },
  });
  const lines = [];
  page.on("response", async (res) => {
    const req = res.request();
    if (!["xhr", "fetch"].includes(req.resourceType())) return;
    const type = res.headers()["content-type"] ?? "";
    let sample = "";
    if (DATA.test(type)) {
      try {
        sample = (await res.text()).replace(/\s+/g, " ").slice(0, 300);
      } catch {}
    }
    lines.push(`  ${res.status()} ${req.method()} ${req.url().slice(0, 200)}${sample ? `\n      ${sample}` : ""}`);
  });
  page.on("websocket", (ws) => {
    lines.push(`  WS ${ws.url().slice(0, 200)}`);
    let n = 0;
    ws.on("framereceived", (f) => {
      if (n++ < 3) lines.push(`      WS< ${String(f.payload).slice(0, 300)}`);
    });
  });
  let status = "?";
  try {
    const res = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
    status = String(res?.status() ?? "?");
    await page.waitForTimeout(seconds * 1000);
  } catch (err) {
    status = `failed: ${err.message.split("\n")[0]}`;
  }
  const title = await page.title().catch(() => "");
  const challenge = /just a moment|attention required|access denied|captcha/i.test(title) ? " (anti-bot challenge)" : "";
  out.push("", `== ${name} ${url} -> ${status} "${title.slice(0, 80)}"${challenge}, ${lines.length} requests`, ...lines.slice(0, 120));
  await page.close();
}
await browser.close();
const file = "/tmp/probe-geo-bookmakers.txt";
writeFileSync(file, out.join("\n") + "\n");
console.log(out.filter((l) => l.startsWith("== ")).join("\n"));
console.log(`\n${file} written: post it in the Discord feedback channel.`);
