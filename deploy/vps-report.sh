#!/usr/bin/env bash
# The read-only reports the vps-report workflow asks the VPS for, over SSH,
# with its own key: that key's forced command in ~/.ssh/authorized_keys
# (README, "Rapports du VPS"), so whatever the client asks, only this script
# runs, and it runs only the commands below. Nothing here writes to the
# databases, restarts a service, deploys or prints a setting.
#
# The command asked comes in SSH_ORIGINAL_COMMAND:
#   surebet-report [days]  npm run surebet-report (src/tools/surebetReport.ts)
#   probe                  the geo-blocked bookmakers' probe
#                          (scripts/probe-geo-bookmakers.mjs), then its file
#   status                 the services' state, their last log lines, the
#                          deployed commit and the free disk space
# REPORT_DRY_RUN=1 prints what would run instead (tests/deploy/vpsReport.test.ts).
set -euo pipefail

APP_DIR="${APP_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
SERVICES="oddsradar-worker oddsradar-web"

read -r -a words <<<"${SSH_ORIGINAL_COMMAND:-}"
name="${words[0]:-}"

refuse() {
  echo "vps-report: $1. Allowed: surebet-report [days], probe, status." >&2
  exit 2
}

case "$name" in
  surebet-report)
    days="${words[1]:-7}"
    [ "${#words[@]}" -le 2 ] || refuse "too many arguments"
    [[ "$days" =~ ^[0-9]{1,2}$ ]] && [ "$days" -ge 1 ] || refuse "days must be a number from 1 to 99"
    run=(npm run --silent surebet-report -- "$days")
    ;;
  probe)
    [ "${#words[@]}" -eq 1 ] || refuse "probe takes no argument"
    run=(sh -c 'node scripts/probe-geo-bookmakers.mjs && echo && cat /tmp/probe-geo-bookmakers.txt')
    ;;
  status)
    [ "${#words[@]}" -eq 1 ] || refuse "status takes no argument"
    # journalctl needs the user in the systemd-journal group; without it,
    # the services' state still comes.
    run=(sh -c "git log -1 --format='deployed: %h %s (%ci)'; df -h / | tail -n 1; \
systemctl status --no-pager --lines=0 $SERVICES || true; \
journalctl --no-pager -n 150 -u oddsradar-worker -u oddsradar-web 2>&1 || true")
    ;;
  "")
    refuse "no command"
    ;;
  *)
    refuse "unknown command \"$name\""
    ;;
esac

cd "$APP_DIR"
if [ "${REPORT_DRY_RUN:-}" = 1 ]; then
  printf '%s\n' "${run[*]}"
  exit 0
fi
exec "${run[@]}"
