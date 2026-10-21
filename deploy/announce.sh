#!/usr/bin/env bash
# Prints the Discord message telling the administrators what the deploy job
# just shipped, or nothing when there is nothing worth telling.
#
# Usage: deploy/announce.sh <success|failure> <repository URL> <site URL>
# Standard input: the deployed commit's message, a pull request's merge
# ("Merge pull request #N from owner/feat/x", a blank line, its title).
#
# Worth telling: a feature or a fix that reached production (a feat/ or fix/
# branch), and any failed deploy. Docs, CI and chores stay quiet.
set -euo pipefail

result="$1"
repo_url="$2"
app_url="$3"

message="$(cat)"
first_line="$(printf '%s\n' "$message" | head -n 1)"
title="$(printf '%s\n' "$message" | sed -n '3p')"
pr=""
branch=""
if [[ "$first_line" =~ ^Merge\ pull\ request\ \#([0-9]+)\ from\ [^/]+/(.+)$ ]]; then
  pr="${BASH_REMATCH[1]}"
  branch="${BASH_REMATCH[2]}"
fi
[ -n "$title" ] || title="$first_line"

if [ "$result" = "success" ]; then
  [[ "$branch" =~ ^(feat|fix)/ ]] || exit 0
  [[ "$branch" == feat/* ]] && icon="🚀" || icon="🛠️"
  text="$icon **In production:** $title"
else
  text="❌ **Deploy failed:** $title"
fi
[ -n "$pr" ] && text="$text"$'\n'"$repo_url/pull/$pr"
[ "$result" = "success" ] && text="$text"$'\n'"$app_url"

jq -cn --arg content "$text" '{username: "OddsBlitzer", allowed_mentions: {parse: []}, content: $content}'
