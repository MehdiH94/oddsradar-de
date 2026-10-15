// What a page asks for while it loads, as a browser's Network tab shows it:
// every request but images, fonts and styles, with its status and size, and
// the websockets it opens. To find the API a sportsbook reads its prices from.
//   node scripts/network-log.mjs https://20bet.com/de/sports [seconds]
// A plain visit: nothing is clicked, nothing is worked around.
import { chromium } from "@playwright/test";

const url = process.argv[2];
const seconds = Number(process.argv[3] ?? 25);
if (!url) {
  console.error("usage: node scripts/network-log.mjs <url> [seconds]");
  process.exit(1);
}

const browser = await chromium.launch();
// The user agent of the Chrome it is, without "Headless": some sites leave
// parts of the page out for headless browsers.
const page = await browser.newPage({
  locale: "de-DE",
  userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
  viewport: { width: 1366, height: 900 },
});
const seen = [];
page.on("response", async (res) => {
  const req = res.request();
  if (["image", "font", "stylesheet", "media"].includes(req.resourceType())) return;
  let size = "?";
  try {
    size = String((await res.body()).length);
  } catch {}
  seen.push(`${res.status()} ${req.method()} ${req.resourceType().padEnd(10)} ${size.padStart(8)}  ${req.url().slice(0, 180)}`);
});
page.on("websocket", (ws) => {
  seen.push(`WS  ${ws.url()}`);
  let n = 0;
  ws.on("framereceived", (f) => {
    if (n++ < 3) seen.push(`WS<  ${String(f.payload).slice(0, 200)}`);
  });
});

await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 }).catch((e) => seen.push(`goto: ${e.message}`));
await page.waitForTimeout(seconds * 1000);
console.log(seen.join("\n"));
await browser.close();
