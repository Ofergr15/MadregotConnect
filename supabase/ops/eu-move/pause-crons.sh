#!/usr/bin/env bash
# GitHub side of the EU-move cron pause. NOT RUN by Claude. Vercel crons are the dashboard
# toggle (Project → Settings → Cron Jobs → Disable/Enable) — no CLI switch exists for it.
#   ./pause-crons.sh disable   # night step 1.3
#   ./pause-crons.sh enable    # night step 7.2 / rollback
set -euo pipefail
case "${1:-}" in disable|enable) ;; *) echo "usage: $0 disable|enable" >&2; exit 2;; esac
for wf in daily-release.yml race-live.yml; do
  gh workflow "$1" "$wf"
done
gh workflow list --all | grep -E 'daily-release|race-live|Release|Race'
