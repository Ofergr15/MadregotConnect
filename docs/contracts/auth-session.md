# Sign-in and session: contract for the native client

## Sign in: `POST /api/auth/email-code` (on the dev allowlist)
1. `{ "action": "send", "email": "..." }` → always `200 { "ok": true }` (same answer for a non-member;
   a code is mailed only to an approved member, max 3 per address per 15 min).
2. `{ "action": "verify", "email": "...", "code": "123456" }` →
   `200 { ok, email, name, athleteId, groupId, role, isAcademy, session }`.
   `session` is a **real Supabase session** (`access_token` JWT + `refresh_token`, minted server-side by
   `lib/auth/synthetic-session.ts`), not a custom token. A wrong or expired code → `401`; >5 attempts → locked.
   Verify also flips an `invited` member to `active` (`route.ts:118`) — not read-only.
3. Every API call sends `Authorization: Bearer <access_token>`.

## Refresh: straight to Supabase, never through our API
`POST {SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, header `apikey: <anon key>`,
body `{ "refresh_token": "..." }` (native `Core/Auth/AuthClient.swift`). So the native dev build needs
the dev project's **Supabase URL + anon key** (public values, not the service key). No server route is
involved, which is why none is on the allowlist.

## On the dev surface (`u21-personal-coach` preview)
- Allowlisted: email-code, dashboard/weekly, feed, feed/like, athletes/me, athletes/summary,
  activities/details, u21/register (`src/lib/dev-api-allowlist.ts`). Requires `MC_DEV_API_ALLOWLIST=1`.
- **Not** allowlisted (404 there): `/api/auth/me`, `/api/notifications/*` including
  `POST /api/notifications/seen`.
- The preview is behind Vercel Deployment Protection, so Vercel answers 401 before our code runs.
  Access is pending a scoped domain-exception decision. No bypass secret goes into the app.
