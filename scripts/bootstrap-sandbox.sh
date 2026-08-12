#!/usr/bin/env bash
# Create / link madregot-strava-dev and push migrations.
# Prereq: free-tier slot available (pause another active project in the dashboard).
set -euo pipefail
cd "$(dirname "$0")/.."

ORG_ID="${SUPABASE_ORG_ID:-vncgsopdjdfntgecsnxw}"
REGION="${SUPABASE_REGION:-eu-west-1}"
NAME="${SUPABASE_PROJECT_NAME:-madregot-strava-dev}"
PASS_FILE=".supabase-sandbox/db-password.txt"

mkdir -p .supabase-sandbox
if [[ ! -f "$PASS_FILE" ]]; then
  openssl rand -base64 24 | tr -d '/+=' | head -c 28 > "$PASS_FILE"
  chmod 600 "$PASS_FILE"
fi
DB_PASS="$(cat "$PASS_FILE")"

REF="${SUPABASE_PROJECT_REF:-}"
if [[ -z "$REF" ]]; then
  echo "Creating project $NAME in $REGION (org $ORG_ID)…"
  set +e
  CREATE_OUT="$(supabase projects create "$NAME" \
    --org-id "$ORG_ID" \
    --region "$REGION" \
    --db-password "$DB_PASS" \
    --yes 2>&1)"
  CREATE_RC=$?
  set -e
  echo "$CREATE_OUT" | tee .supabase-sandbox/create.log
  REF="$(printf '%s' "$CREATE_OUT" | python3 -c '
import sys, json, re
raw = sys.stdin.read()
for chunk in re.findall(r"\{[^{}]*\}", raw):
    try:
        d = json.loads(chunk)
    except Exception:
        continue
    ref = d.get("ref") or d.get("id") or ""
    if ref:
        print(ref)
        break
')"
  if [[ -z "$REF" || $CREATE_RC -ne 0 ]]; then
    echo ""
    echo "Create failed (often free-tier 2-project limit)."
    echo "Pause https://supabase.com/dashboard/project/ufqfkzjkulhwvtzzmyod"
    echo "then re-run, or: SUPABASE_PROJECT_REF=<ref> ./scripts/bootstrap-sandbox.sh"
    exit 1
  fi
fi

echo "Linking $REF…"
supabase link --project-ref "$REF" --password "$DB_PASS" --yes

echo "Pushing migrations…"
supabase db push --yes

echo "Fetching API keys…"
supabase projects api-keys --project-ref "$REF" -o json > .supabase-sandbox/api-keys.json
python3 - "$REF" <<'PY'
import json, os, sys
ref = sys.argv[1]
keys = json.load(open(".supabase-sandbox/api-keys.json"))
anon = next((k.get("api_key") for k in keys if k.get("name") == "anon" or k.get("id") == "anon"), "")
service = next((k.get("api_key") for k in keys if k.get("name") == "service_role" or k.get("id") == "service_role"), "")
url = f"https://{ref}.supabase.co"
extra = []
if os.path.exists(".env.local"):
    keep = ("ANTHROPIC", "STRAVA", "STREAM", "ENCRYPTION", "CRON", "NEXT_PUBLIC_APP")
    with open(".env.local") as f:
        for line in f:
            if any(line.startswith(k) for k in keep):
                extra.append(line.rstrip("\n"))
with open(".env.local.sandbox", "w") as out:
    out.write(f"NEXT_PUBLIC_SUPABASE_URL={url}\n")
    out.write(f"NEXT_PUBLIC_SUPABASE_ANON_KEY={anon}\n")
    out.write(f"SUPABASE_SERVICE_ROLE_KEY={service}\n")
    for line in extra:
        out.write(line + "\n")
print("Wrote .env.local.sandbox")
print(f"Project ref: {ref}")
print("Next: cp .env.local .env.local.prod.bak && cp .env.local.sandbox .env.local && npm run dev")
PY
