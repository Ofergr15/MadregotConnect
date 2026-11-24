#!/usr/bin/env bash
# Copy Supabase Storage objects TOKYO → EU through the Storage REST API.
# NOT RUN by Claude. Ofer runs it, with keys in his own shell:
#   export TOKYO_URL=https://njzldypndkicpsmdtyll.supabase.co EU_URL=https://zrrklhonqtzycayjdbor.supabase.co
#   export TOKYO_SERVICE_KEY=... EU_SERVICE_KEY=...     # never commit, never paste in chat
#   ./copy-storage.sh --dry-run            # list per bucket, copy nothing (default)
#   I_HAVE_APPROVAL=yes ./copy-storage.sh  # copy; objects already on EU (same name+size) are skipped
#   I_HAVE_APPROVAL=yes ./copy-storage.sh feed-media avatars   # only these buckets
# Idempotent: re-run until it reports 0 to copy. Buckets must already exist on EU (migrations).
set -euo pipefail
: "${TOKYO_URL:?}" "${EU_URL:?}" "${TOKYO_SERVICE_KEY:?}" "${EU_SERVICE_KEY:?}"
DRY=1
[[ "${1:-}" == "--dry-run" ]] && shift
[[ "${I_HAVE_APPROVAL:-}" == "yes" ]] && DRY=0
BUCKETS=("$@")
[[ ${#BUCKETS[@]} -eq 0 ]] && BUCKETS=(avatars badge-icons event-images face-crops feed-media \
  notification-images perk-images program-plans reference-faces run-chat store-products)
[[ "$EU_URL" == "$TOKYO_URL" ]] && { echo "source == target, refusing" >&2; exit 1; }

DRY=$DRY python3 -I - "${BUCKETS[@]}" <<'PY'
import json, os, sys, urllib.request, urllib.parse
SRC, DST = os.environ["TOKYO_URL"].rstrip("/"), os.environ["EU_URL"].rstrip("/")
SK, DK = os.environ["TOKYO_SERVICE_KEY"], os.environ["EU_SERVICE_KEY"]
DRY = os.environ["DRY"] == "1"

def req(base, key, path, method="GET", body=None, headers=None):
    h = {"Authorization": f"Bearer {key}", "apikey": key, **(headers or {})}
    r = urllib.request.Request(base + path, data=body, method=method, headers=h)
    with urllib.request.urlopen(r, timeout=120) as resp:
        return resp.read()

def walk(base, key, bucket, prefix=""):
    """Yield (name, size, mimetype) recursively. Items without id are folders."""
    offset = 0
    while True:
        body = json.dumps({"prefix": prefix, "limit": 1000, "offset": offset,
                           "sortBy": {"column": "name", "order": "asc"}}).encode()
        items = json.loads(req(base, key, f"/storage/v1/object/list/{bucket}", "POST", body,
                               {"Content-Type": "application/json"}))
        for it in items:
            full = f"{prefix}{it['name']}"
            if it.get("id") is None:
                yield from walk(base, key, bucket, full + "/")
            else:
                md = it.get("metadata") or {}
                yield full, md.get("size"), md.get("mimetype") or "application/octet-stream"
        if len(items) < 1000:
            return
        offset += 1000

q = lambda p: urllib.parse.quote(p, safe="/")
total = 0
for bucket in sys.argv[1:]:
    have = {n: s for n, s, _ in walk(DST, DK, bucket)}
    todo = [(n, s, m) for n, s, m in walk(SRC, SK, bucket) if have.get(n) != s]
    print(f"{bucket}: {len(todo)} to copy ({len(have)} already on EU)", flush=True)
    total += len(todo)
    if DRY:
        continue
    for i, (name, size, mime) in enumerate(todo, 1):
        data = req(SRC, SK, f"/storage/v1/object/{bucket}/{q(name)}")
        req(DST, DK, f"/storage/v1/object/{bucket}/{q(name)}", "POST", data,
            {"Content-Type": mime, "x-upsert": "true", "cache-control": "3600"})
        if i % 50 == 0:
            print(f"  {bucket}: {i}/{len(todo)}", flush=True)
print(f"{'would copy' if DRY else 'copied'} {total} objects")
PY
