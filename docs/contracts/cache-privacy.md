# Cache-key privacy audit (branch `u21-personal-coach`)

**Server data cache** (`createServerClient({ revalidateSeconds, cacheTags })`, `src/lib/supabase/server.ts:67-72`):
Next's fetch cache is keyed on the full PostgREST URL, so every filter is part of the key. Per-viewer queries put
the viewer in the URL and never share an entry:
- `plans/week`, `dashboard/weekly`: `.or(planRowsFilter(whose|me))` → per athlete. Draft-hiding and test-account
  filtering run in code **after** the cached read, per request.
- `groups/leaderboard`, `groups/standings`, `club/today`, `club/upcoming`, `plans/weeks`: club-wide, identical for
  every member by design. Test accounts are excluded for **everyone** there, staff and the account itself
  included, because the result is shared.
- `coach/pulse`: staff route. `strava/account-check`, `photos/browse/folder`: not identity-scoped data.
- Auth: `requireSession` memoises per token (`resolveCached(tokenKey(token))`); the approval and path decisions
  run after the cache, per request (`auth-session.ts:252-262`).

**HTTP caching:** identity-bound responses use `private` (`activities/stream` 300 s, `activities/analysis` 300 s,
`staff/attention` 60 s) or `no-store`. `public` is used only where no identity is involved: event forecast
(1800 s), `public/stats`, `public/qr`. `admin/tab-permissions` deliberately sets no shared cache (`:25`).

**Project scope:** cache entries are per deployment, and each deployment has one Supabase project, so dev and prod
never share an entry.

**Finding:** no cross-user leak found. A residual risk to remember: a future route that filters by viewer **in JS**
on a cached club-wide query is fine; one that puts viewer data **into** a shared cached query's result is not.
