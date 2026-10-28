// The bookmakers' public promotions lists found by `vps-report promo-network`
// (#76), fetched from the German VPS as plain GETs and printed whole (up to
// MAX_CHARS each, or the list's own cap), to write the site's readers (src/promos/) and their tests
// from real answers: Sportingbet's and neobet's answer only from Germany,
// 20bet's not from this session's US address either. Nothing is worked
// around or written. Run by `vps-report promo-samples` (deploy/vps-report.sh).
const LISTS = [
  ["sportingbet", "https://www.sportingbet.de/de/promo/api/offers"],
  ["neobet", "https://neobet.de/.crm/banner/campaigns?language=de&country=DE"],
  ["admiralbet", "https://rmg-crm-api-at.greentube.com/v3/bonus/banners?platform=admiralbetde&client=web&lang=de"],
  ["twentybet", "https://20bet.com/api/promotion/list?isUserAuthenticated=false&excludePromotionType=3&lang=de&_trlang=de"],
  // The mirror the promotions page called from the VPS (#76): 20bet.com
  // itself answers "not available in your region" (#77). Its list (184 kB,
  // #80) printed whole, for its reader's test.
  ["twentybet-mirror", "https://20betz0ne1.com/api/promotion/list?isUserAuthenticated=false&excludePromotionType=3&lang=de&_trlang=de", 400_000],
];
const HEADERS = {
  accept: "application/json, text/plain, */*",
  "accept-language": "de-DE,de;q=0.9",
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
};
const MAX_CHARS = 60_000;

const out = [`promotions lists, ${new Date().toISOString()}`];
for (const [name, url, maxChars = MAX_CHARS] of LISTS) {
  out.push("", `== ${name} ${url}`);
  try {
    const res = await fetch(url, { headers: HEADERS, redirect: "follow", signal: AbortSignal.timeout(25_000) });
    const text = await res.text();
    out.push(`  ${res.status} ${res.url} ${res.headers.get("content-type") ?? ""} ${text.length} chars`);
    let body = text;
    try {
      body = JSON.stringify(JSON.parse(text));
    } catch {
      out.push("  (not JSON)");
    }
    out.push(body.slice(0, maxChars));
  } catch (err) {
    out.push(`  no answer: ${err.cause?.code ?? err.message}`);
  }
}
console.log(out.join("\n"));
