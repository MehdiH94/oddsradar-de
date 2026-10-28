// The requests the bookmakers' promotions pages make while they load, from
// the German VPS (backlog #27): their lists are not in the pages' own HTML
// (`vps-report promo-pages`, #75) but fetched by the browser, so this is
// where they come from. A plain visit in a browser, like
// probe-geo-bookmakers.mjs: nothing is clicked, nothing is worked around; a
// page behind an anti-bot check is noted as such. Each page's XHR/fetch
// calls are listed, those naming a promotion first (with their request
// headers, cookies left out), each with the start of its answer. Run by `vps-report promo-network` (deploy/vps-report.sh);
// Playwright's Chromium is the one `vps-report probe` uses.
import { chromium } from "@playwright/test";

const PAGES = [
  ["sportingbet", "https://www.sportingbet.de/de/promo/offers"],
  ["merkurbets", "https://www.merkurbets.de/de/promotions"],
  ["neobet", "https://neobet.de/promotions"],
  ["betway", "https://betway.de/de/de/promotions"],
  ["admiralbet", "https://www.admiralbet.de/de/promotions"],
  ["twentybet", "https://20bet.com/de/promotions"],
];
const SECONDS = 15;
// The answers that carry data, and the ones that look like a promotions list.
const DATA = /json|javascript-text|text\/plain/;
const PROMO = /promo|bonus|campaign|offer|aktion|angebot/i;
const SAMPLE = 500;
const PRIVATE_HEADERS = /^(cookie|authorization|proxy-authorization)$/i;
const MAX_LINES = 40;

// PROBE_CHROMIUM: another Chromium than Playwright's own, to try it elsewhere.
const browser = await chromium.launch(process.env.PROBE_CHROMIUM ? { executablePath: process.env.PROBE_CHROMIUM } : {});
const out = [`promotions pages' requests, ${new Date().toISOString()}`];
for (const [name, url] of PAGES) {
  const page = await browser.newPage({
    locale: "de-DE",
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
    viewport: { width: 1366, height: 900 },
  });
  const calls = [];
  page.on("response", async (res) => {
    const req = res.request();
    if (!["xhr", "fetch"].includes(req.resourceType())) return;
    const type = res.headers()["content-type"] ?? "";
    let body = "";
    if (DATA.test(type)) {
      try {
        body = (await res.text()).replace(/\s+/g, " ");
      } catch {}
    }
    const promo = PROMO.test(req.url()) || PROMO.test(body.slice(0, 20_000));
    // A promotion call's request headers, to ask for the same list without a
    // browser; the session's own (cookies, authorization) left out.
    let headers = "";
    if (promo) {
      const all = await req.allHeaders().catch(() => ({}));
      headers = Object.entries(all)
        .filter(([key]) => !PRIVATE_HEADERS.test(key))
        .map(([key, value]) => `${key}: ${value.slice(0, 120)}`)
        .join(" | ");
    }
    calls.push({
      promo,
      line: `  ${promo ? "*" : " "} ${res.status()} ${req.method()} ${req.url().slice(0, 220)}${headers ? `\n        > ${headers}` : ""}${body ? `\n        ${body.slice(0, SAMPLE)}` : ""}`,
    });
  });
  page.on("websocket", (ws) => calls.push({ promo: false, line: `    WS ${ws.url().slice(0, 200)}` }));
  let status = "?";
  try {
    const res = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
    status = String(res?.status() ?? "?");
    await page.waitForTimeout(SECONDS * 1000);
  } catch (err) {
    status = `failed: ${err.message.split("\n")[0]}`;
  }
  const title = await page.title().catch(() => "");
  const challenge = /just a moment|attention required|access denied|captcha|zugriff verweigert/i.test(title) ? " (anti-bot challenge)" : "";
  // The promotion-looking calls first.
  calls.sort((a, b) => Number(b.promo) - Number(a.promo));
  out.push(
    "",
    `== ${name} ${url} -> ${status} "${title.slice(0, 80)}"${challenge}, ${calls.length} requests, ${calls.filter((c) => c.promo).length} naming a promotion (*)`,
    ...calls.slice(0, MAX_LINES).map((c) => c.line)
  );
  await page.close();
}
await browser.close();
console.log(out.join("\n"));
