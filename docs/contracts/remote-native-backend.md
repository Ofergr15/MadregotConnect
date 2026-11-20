# Remote phone backend: options and exact route coverage (2026-11-20)

## What the native app calls (Swift sources on `u21-native`)
| Route | On the dev allowlist (`src/lib/dev-api-allowlist.ts`) | Production `462b4a11` |
|---|---|---|
| `POST /api/auth/email-code` | yes | yes |
| `GET /api/athletes/me` | yes | yes |
| `GET /api/athletes/summary` | yes | yes |
| `GET /api/dashboard/weekly` | yes | yes |
| `GET /api/feed`, `POST /api/feed/like` | yes | yes |
| `GET /api/activities/details` | yes | yes |
| `POST /api/u21/register` | yes | **no (absent)** |
| `POST /api/public/signup`, `GET /api/public/groups` (club registration, off outside production by design) | **no** | yes |
| Refresh: `POST {SUPABASE_URL}/auth/v1/token` | n/a (straight to Supabase) | n/a |
Added to the allowlist in `6c4b47d6` (not in deployments before it):
| `GET /api/notifications/inbox`, `GET /api/notifications/unread`, `POST /api/notifications/seen` | JWT self-or-staff (`seen`: self only) |
| `GET /api/events`, `GET /api/events/:id`, `GET /api/events/:id/forecast` | public reads (`:id` = one UUID segment) |
| `GET /api/club-updates`, `GET /api/club-updates/topics` | JWT, club-updates gate |
| `GET /api/surveys/open`, `GET /api/surveys/:id`, `POST /api/surveys/:id/respond` | JWT |
Still closed: every staff write (events POST/PATCH/DELETE, club-updates POST), `/api/notifications/approvals`,
`/api/events/:id/register(s)`, `/api/public/*`. Email on the dev surface never reaches the fixed staff inboxes
(`devSurfaceBlocks`, `src/lib/email/send.ts`).

## Options
**A. Scoped exception for the one preview domain** `madregot-connect-git-u21-personal-coach-st-d1c4461c.vercel.app`
(recommended; owner/coordinator decision, may be a paid Vercel feature).
- Exposes exactly the 8 allowlisted method+paths above, enforced in middleware (`src/proxy.ts:15-18`); every page,
  asset and other API route is 404. Requires `MC_DEV_API_ALLOWLIST=1` (set, branch-scoped).
- Data: dev Supabase `rtcgklespcwvxashhamh`, confirmed synthetic-only by the owner.
- Public-by-design within it: email-code (mails only approved dev members, DB caps) and u21/register (env guard, dedupe,
  per-email cap, no notifications). No CAPTCHA. Abuse controls: `public-route-abuse.md`.
- Covers login + Today + weekly plan + feed + run details + U21 submit. Missing for the app: club registration
  (`public/*`), inbox, Valencia content. Adding any of them is a separate allowlist change.

**B. Production, "read-only"** is not available: signing in writes (`login_codes`, `invited → active`, a Supabase
auth user), and production lacks `u21/register` and every fix on this branch (draft plans, test-account isolation,
fail-closed session mint). Real member data. Not recommended until the branch is reviewed and merged.

**C. Local server on the Mac** works for development only (no allowlist locally, whole API on that machine). It is
not a TestFlight path: testers' phones can't reach it.

**Not options:** a protection-bypass secret in the app (forbidden), or switching project-wide Deployment Protection
(exposes every other branch's preview, whose full API may point at production data).

## Recommendation
A for remote testing now. Production (B) only after merge approval, with migrations 180–183 applied in production and
`public/*` behaviour decided.
