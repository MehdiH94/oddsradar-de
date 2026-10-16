#!/usr/bin/env bash
# A consistent copy of a SQLite database while its services run (sqlite3's
# .backup is the online backup API), checked, with the copies older than a
# number of days removed. Run by the oddsradar-backup*.service units from the
# checkout (WorkingDirectory=/opt/oddsradar); the copies go to ./backups.
#
# Usage: deploy/backup-db.sh <database> <name> <days-kept>
#   deploy/backup-db.sh data/auth.sqlite auth 30
#
# A copy that fails its integrity check is kept as <copy>.corrupt for a look,
# the script fails (systemd shows the unit as failed) and the older copies are
# left alone: the last good one must not go because the newest is bad.
set -euo pipefail

database=${1:?usage: backup-db.sh <database> <name> <days-kept>}
name=${2:?usage: backup-db.sh <database> <name> <days-kept>}
days_kept=${3:?usage: backup-db.sh <database> <name> <days-kept>}
[[ "$name" =~ ^[A-Za-z0-9_-]+$ ]] || {
  echo "[backup] invalid name: $name" >&2
  exit 1
}
[[ "$days_kept" =~ ^[0-9]+$ ]] || {
  echo "[backup] days-kept must be a number: $days_kept" >&2
  exit 1
}
[[ -f "$database" ]] || {
  echo "[backup] $database not found" >&2
  exit 1
}

mkdir -p backups
copy="backups/${name}-$(date +%F-%H%M).sqlite"
sqlite3 "$database" ".backup '$copy'"

result=$(sqlite3 "$copy" "PRAGMA integrity_check")
if [[ "$result" != "ok" ]]; then
  mv "$copy" "$copy.corrupt"
  echo "[backup] $copy failed its integrity check: ${result:0:200}" >&2
  exit 1
fi
echo "[backup] $copy ok ($(du -h "$copy" | cut -f1))"

find backups -maxdepth 1 -name "${name}-*.sqlite" -mtime "+$days_kept" -delete
