#!/usr/bin/env bash
# Deploys a commit of origin/main on this machine: check it out, rebuild the
# containers (docker-compose.sandbox.yml), restart them, check they answer.
#
# Runs as the "claude" user, in its checkout (~/projets/oddsblitzer), with its
# own rootless Docker: the site has been running in containers since
# 09/11/2026 (README, "Docker (sandbox)"). Caddy, on the machine, sends
# odds-blitzer.de to 127.0.0.1:5010.
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

# main by default; a key's forced command may name another branch, so that a
# key can only ever deploy its own branch.
DEPLOY_BRANCH=${DEPLOY_BRANCH:-main}
[[ "$DEPLOY_BRANCH" =~ ^[A-Za-z0-9._/-]+$ ]] || {
  echo "[deploy] ERROR: invalid DEPLOY_BRANCH" >&2
  exit 1
}
COMPOSE=${DEPLOY_COMPOSE:-docker-compose.sandbox.yml}
# The API's port as docker-compose.sandbox.yml publishes it on the machine.
HEALTH_URL=${DEPLOY_HEALTH_URL:-http://127.0.0.1:5010/api/health}
# Both containers must be running after the restart.
SERVICES=(web worker)
HEALTH_TIMEOUT_S=${DEPLOY_HEALTH_TIMEOUT_S:-60}

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
  log "building the image (backend and web dashboard)"
  docker compose -f "$COMPOSE" build
}

restart() {
  log "restarting the containers"
  docker compose -f "$COMPOSE" up -d --remove-orphans
}

# The backup timers (deploy/oddsblitzer-backup*): systemd user units of this
# user, refreshed from the checkout at every deploy so that a change to them
# ships like any other.
TIMERS=(oddsblitzer-backup.timer oddsblitzer-backup-odds.timer)
install_timers() {
  local dir=${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user
  log "installing the backup timers"
  mkdir -p "$dir" backups
  install -m 644 deploy/oddsblitzer-backup*.service deploy/oddsblitzer-backup*.timer "$dir/"
  systemctl --user daemon-reload
  systemctl --user enable --now "${TIMERS[@]}"
}

check_health() {
  local deadline service running
  deadline=$((SECONDS + HEALTH_TIMEOUT_S))
  until curl -fs -o /dev/null "$HEALTH_URL"; do
    ((SECONDS < deadline)) ||
      fail "the API does not answer on $HEALTH_URL after ${HEALTH_TIMEOUT_S}s (docker compose -f $COMPOSE logs web)"
    sleep 1
  done

  # The worker serves nothing to probe: check that neither container went
  # down in the seconds after the restart, e.g. by crashing on startup.
  sleep 5
  running=$(docker compose -f "$COMPOSE" ps --status running --services)
  for service in "${SERVICES[@]}"; do
    grep -qx "$service" <<<"$running" || fail "$service is not running (docker compose -f $COMPOSE logs $service)"
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
  install_timers
  check_health
  log "deployed $(git rev-parse --short HEAD)"
}

main "$@"
exit
