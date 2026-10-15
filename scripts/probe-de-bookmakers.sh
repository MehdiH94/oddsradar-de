#!/usr/bin/env bash
# Which German sports betting sites answer from this machine, and which
# anti-bot each one sits behind: one line per site, its final address, its
# HTTP status and the protection its headers or page name. Run it on the
# server and on a home connection to tell a datacenter block from a site
# closed to every script:
#   bash scripts/probe-de-bookmakers.sh
# A page is only asked once, as a browser would; nothing is worked around.
set -uo pipefail

UA="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36"
SITES=(
  https://www.tipico.de/
  https://sports.bwin.de/
  https://www.interwetten.de/
  https://www.bet-at-home.de/
  https://www.betano.de/
  https://www.admiralbet.de/
  https://www.merkurbets.de/
  https://www.happybet.de/
  https://www.bet3000.de/
  https://www.sportwetten.de/
  https://www.neo.bet/
  https://betway.de/
  https://www.unibet.de/
  https://www.oddset.de/
  https://www.bet365.de/
  https://www.winamax.de/
  https://www.888sport.de/
  https://www.tipwin.de/
  https://www.xtip.de/
  https://www.betvictor.de/
  https://www.novibet.de/
  https://www.lottoland.de/sportwetten
  https://www.leovegas.de/
  https://www.mybet.de/
  https://www.ladbrokes.de/
  https://www.cashpoint.de/
  https://www.wettarena.de/
  https://www.betfair.de/
  https://www.pokerstars.de/sports/
  https://www.betsson.de/
  https://www.bildbet.de/
  https://www.wetten.com/
)

for url in "${SITES[@]}"; do
  headers=$(curl -4 -s -L --max-time 20 -A "$UA" -H "Accept-Language: de-DE,de;q=0.9" \
    -D - -o /tmp/probe-body -w '\n%{http_code} %{url_effective}' "$url" 2>/dev/null)
  result=$(tail -n1 <<<"$headers")
  status=${result%% *}
  final=${result#* }
  [[ -n "$status" && "$status" != "000" ]] || { printf '%-38s %s\n' "$url" "000 no answer"; continue; }
  body=$(head -c 200000 /tmp/probe-body 2>/dev/null | tr 'A-Z' 'a-z')
  h=$(tr 'A-Z' 'a-z' <<<"$headers")
  waf=""
  grep -q 'cf-ray' <<<"$h" && waf+="cloudflare "
  grep -qE 'x-datadome|datadome' <<<"$h$body" && waf+="datadome "
  grep -q 'cloudfront' <<<"$h" && waf+="cloudfront "
  grep -qE 'akamai|_abck|bm_sz' <<<"$h$body" && waf+="akamai "
  grep -qE 'incapsula|x-iinfo|visid_incap' <<<"$h" && waf+="imperva "
  grep -qE 'px-captcha|_px[0-9]|perimeterx' <<<"$h$body" && waf+="perimeterx "
  grep -qE 'captcha|challenge-platform|just a moment' <<<"$body" && waf+="(challenge) "
  printf '%-38s %s %-45s %s\n' "$url" "$status" "${final:0:45}" "$waf"
done
