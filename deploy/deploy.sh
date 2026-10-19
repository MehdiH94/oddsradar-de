#!/usr/bin/env bash
# Deploys a commit of origin/main on this machine: check it out, build both
# packages, restart the systemd services, check they answer.
#
# The staging checkout (/opt/oddsradar-staging) runs this same script for
# origin/development and its own services: its SSH key's forced command sets
# DEPLOY_BRANCH and DEPLOY_SERVICES (README, "Environnement de test").
#
# Run by the GitHub Actions deploy job (.github/workflows/deploy.yml) through
# an SSH key restricted to this script (a forced command in authorized_keys,
# see README): the commit SHA the job tested arrives in SSH_ORIGINAL_COMMAND,
# the settings it keeps in GitHub secrets on standard input (apply_settings).
# Also runnable by hand from the checkout: deploy/deploy.sh [sha]
#
# Everything runs from main(), called on the last line: bash then parses the
# whole file before running any of it, so the `git reset` below can rewrite
# this very file mid-run safely.
set -euo pipefail

# Production by default; the staging key's forced command overrides both, so
# that a key can only ever deploy its own branch to its own services.
DEPLOY_BRANCH=${DEPLOY_BRANCH:-main}
[[ "$DEPLOY_BRANCH" =~ ^[A-Za-z0-9._/-]+$ ]] || {
  echo "[deploy] ERROR: invalid DEPLOY_BRANCH" >&2
  exit 1
}
read -r -a SERVICES <<<"${DEPLOY_SERVICES:-oddsradar-worker oddsradar-web}"
HEALTH_TIMEOUT_S=${DEPLOY_HEALTH_TIMEOUT_S:-30}

log() { echo "[deploy] $*"; }
fail() {
  echo "[deploy] ERROR: $*" >&2
  exit 1
}

checkout() {
  local requested=$1 target
  # Fail instead of waiting for a password nobody will type.
  export GIT_TERMINAL_PROMPT=0
  # </dev/null: standard input carries the settings, for apply_settings.
  git fetch --quiet origin "$DEPLOY_BRANCH" </dev/null ||
    fail "git fetch failed: this machine must read the repository without a password (see README)"

  if [[ -z "$requested" ]]; then
    target=$(git rev-parse "origin/$DEPLOY_BRANCH")
  elif [[ "$requested" =~ ^[0-9a-f]{40}$ ]]; then
    git merge-base --is-ancestor "$requested" "origin/$DEPLOY_BRANCH" 2>/dev/null ||
      fail "$requested is not a commit of origin/$DEPLOY_BRANCH"
    target=$requested
  else
    fail "expected a full commit SHA, got: ${requested:0:80}"
  fi

  # .env and data/ are ignored by git, so they survive; local edits to tracked
  # files (such as a package-lock.json rewritten by an old `npm install`) don't.
  log "checking out $target"
  git reset --quiet --hard "$target"
}

# The settings the deploy job passes on standard input, one KEY=value per
# line: written to .env, which both services read (EnvironmentFile), so the
# GitHub secrets are their source of truth. Only these keys, each checked
# against its pattern, and never printed; an empty value removes the line.
# Nothing to read when run by hand from a terminal; at most 5 s of waiting
# when run by hand over SSH.
declare -A SETTING_PATTERNS=(
  [DISCORD_WEBHOOK_URL]='^https://(discord\.com|discordapp\.com)/api/webhooks/[0-9]+/[A-Za-z0-9_-]+$'
  # The administrators' channel, for the bookmakers' health (src/alerts/health.ts).
  [DISCORD_ADMIN_WEBHOOK_URL]='^https://(discord\.com|discordapp\.com)/api/webhooks/[0-9]+/[A-Za-z0-9_-]+$'
  [PUBLIC_URL]='^https?://[A-Za-z0-9.-]+(:[0-9]+)?$'
  # The accounts' emails (src/auth/mailer.ts). No quote, backslash, dollar or
  # space in a secret: the same file is read by systemd and by dotenv.
  [SMTP_HOST]='^[A-Za-z0-9.-]+$'
  [SMTP_PORT]='^[0-9]{2,5}$'
  [SMTP_USER]='^[A-Za-z0-9._%+@-]+$'
  [SMTP_PASSWORD]='^[A-Za-z0-9._~+/=@:!%^*()-]+$'
  [SMTP_FROM]='^[A-Za-z0-9 ._-]*<?[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+>?$'
)

apply_settings() {
  local env_file=$1 line key value
  [[ -t 0 ]] && return 0
  while IFS= read -r -t 5 line || [[ -n "$line" ]]; do
    line=${line%$'\r'}
    [[ -n "$line" ]] || continue
    key=${line%%=*}
    value=${line#*=}
    if [[ "$line" != *=* || ! "$key" =~ ^[A-Z_]+$ || -z "${SETTING_PATTERNS[$key]+known}" ]]; then
      fail "unexpected setting on standard input: ${key:0:40}"
    fi
    if [[ -n "$value" && ! "$value" =~ ${SETTING_PATTERNS[$key]} ]]; then
      fail "$key does not have the expected form (value not shown): check its GitHub secret"
    fi
    set_env "$env_file" "$key" "$value"
    line=""
  done
}

# Sets KEY=value in the env file (removes it when the value is empty), only
# when it changes, keeping the file's permissions.
set_env() {
  local file=$1 key=$2 value=$3 current tmp
  [[ -f "$file" ]] || install -m 600 /dev/null "$file"
  current=$(grep -E "^${key}=" "$file" | tail -n 1 || true)
  if [[ -z "$value" && -z "$current" ]] || [[ -n "$value" && "$current" == "${key}=${value}" ]]; then
    return 0
  fi
  tmp=$(mktemp "${file}.XXXXXX")
  grep -vE "^${key}=" "$file" >"$tmp" || true
  if [[ -n "$value" ]]; then
    printf '%s=%s\n' "$key" "$value" >>"$tmp"
    log "$key set in $(basename "$file")"
  else
    log "$key removed from $(basename "$file")"
  fi
  chmod --reference="$file" "$tmp"
  mv "$tmp" "$file"
}

build() {
  log "building the backend"
  npm ci --no-audit --no-fund
  npm run build
  log "building the web dashboard"
  (cd web && npm ci --no-audit --no-fund && npm run build)
}

restart() {
  log "restarting ${SERVICES[*]}"
  # -n: fail instead of prompting when sudo would want a password.
  sudo -n systemctl restart "${SERVICES[@]}"
}

check_health() {
  local port deadline service
  port=$(sed -n 's/^PORT=//p' .env 2>/dev/null | tail -n 1 | tr -d '"\r ')
  port=${port:-3000}

  deadline=$((SECONDS + HEALTH_TIMEOUT_S))
  until curl -fs -o /dev/null "http://localhost:${port}/api/health"; do
    ((SECONDS < deadline)) ||
      fail "the API does not answer on port $port after ${HEALTH_TIMEOUT_S}s (journalctl -u ${SERVICES[*]})"
    sleep 1
  done

  # The worker serves nothing to probe: check that neither service went down
  # in the seconds after the restart, e.g. by crashing on startup.
  sleep 5
  for service in "${SERVICES[@]}"; do
    systemctl is-active --quiet "$service" || fail "$service is not running (journalctl -u $service)"
  done
  log "health check passed"
}

main() {
  cd "$(dirname "$(readlink -f "$0")")/.."

  if [[ "${DEPLOY_STAGE:-}" != build ]]; then
    checkout "${SSH_ORIGINAL_COMMAND:-${1:-}}"
    # Carry on with the version of this script just checked out, so a change
    # to the build steps applies to the very deploy that ships it.
    DEPLOY_STAGE=build exec "$PWD/deploy/deploy.sh"
  fi

  apply_settings .env
  build
  restart
  check_health
  log "deployed $(git rev-parse --short HEAD)"
}

main "$@"
exit
