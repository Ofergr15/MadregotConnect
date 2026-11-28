# Night questions

Open owner questions from the unattended night runs. Each has the safe default the PR shipped.

## Task 95 — Strava webhook idempotency

- **Is per-instance (in-memory) dedupe enough, or do you want a DB table of processed Strava event ids?** Default shipped: in-memory per warm instance, plus a DB check that a `create` for an already-stored activity is skipped. A duplicate can still cost one extra sync on a cold instance, never a duplicate run (the import upserts on the Strava id). A table would need a migration; not added.

## Task 164 — Sized image variants

- **Backfill variants for avatars and feed photos uploaded before this?** Default shipped: no backfill. Only new uploads get `sized/…@128/512.webp` (avatars) and `@640/1080.webp` (feed photos); an old URL has no `sz=` marker and is drawn as before. A one-off script could re-render the existing ~club-size set; not written, it would write to prod storage.
- **Supabase's own image transformations (`/render/image/…?width=`) instead?** Default: not used — it needs the Pro plan's transformation add-on and bills per origin image; the upload-time copies cost one sharp pass and a few KB of storage each.
