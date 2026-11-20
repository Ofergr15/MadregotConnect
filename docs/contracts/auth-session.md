# Sign-in and session: contract for the native client

## 1. Sign in: `POST /api/auth/email-code` (on the dev allowlist)
1. `{ "action": "send", "email": "..." }` → always `200 { "ok": true }`, the same answer whether or not the
   address is a member. A code is mailed only to an approved member, at most 3 per address per 15 min
   (`src/lib/auth/email-code.ts:12-15`).
2. `{ "action": "verify", "email": "...", "code": "123456" }` →
   `200 { ok, email, name, athleteId, groupId, role, isAcademy, session }` (`route.ts:188-197`).
   A wrong or expired code → `401`. More than 5 attempts → the code is spent (`MAX_ATTEMPTS`).
   Verify also flips an `invited` member to `active` (`route.ts:118`), so it is not read-only.
3. Every API call sends `Authorization: Bearer <session.access_token>`.

## 2. What `session` is: a standard Supabase session, not a custom token
`session = { access_token, refresh_token, expires_in, token_type }` (`src/lib/auth/synthetic-session.ts:7-10`).
How the server mints it (`createSyntheticSession`, `:51`):
- `auth.admin.createUser` (or find the existing user) → `auth.admin.generateLink({type:'magiclink'})` →
  `verifyOtp({type:'email', token_hash})` with the anon client. The result is an ordinary GoTrue session,
  and minting it **does not touch the user's other sessions** (measured 2026-09-05, comment at `:15-46`).
- **No fallback (since `c21dbc18`, this branch only).** Production (`462b4a11`) still has a password-rotation
  fallback when `generateLink` fails or the link does not redeem (`synthetic-session.ts:101-125` there): it rotates
  the password and signs in with it, which **revokes the account's sessions on every other device**. On this
  branch a mint failure now returns an error (`generate_link:` / `magic_link_verify:`) and the caller answers 500,
  which is retryable. Pinned by `syntheticSessionFailClosed.test.ts`.

## 3. Refresh: straight to Supabase, never through our API
`POST {SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, header `apikey: <anon key>`,
body `{ "refresh_token": "..." }` (native `Core/Auth/AuthClient.swift:90-106` on `u21-native`). The dev
build needs the dev project's Supabase URL + anon key (public values). No server route is involved.

## 4. Token parameters
These live in the Supabase project's Auth settings. There is **no `supabase/config.toml` in the repo**, so
the dev project's actual values are **unverified** (check Dashboard → Authentication → Sessions / JWT Keys).

| Parameter | Supabase hosted default (vendor) | This project |
|---|---|---|
| Access token (JWT) lifetime | 3600 s | unverified |
| Refresh token lifetime | does not expire | unverified |
| Session time-box / inactivity timeout | off (Pro feature) | unverified |
| Refresh reuse interval | 10 s | unverified |
| Revoke on refresh-token reuse | on: reusing an already-rotated token outside the interval revokes **that session** | unverified |

With the defaults, a client that refreshes before `expires_in` and stores the newest `refresh_token`
atomically stays signed in indefinitely. Only logout, revocation, a reuse detection, or the fallback in §2
end the session.

## 5. Not to be confused with the Apple Watch device tokens
The "`refresh-reused` disconnects the real phone" finding is about **`/api/device/token`**
(`src/lib/watch/device-auth.ts`), a separate HMAC token pair for the watch companion: access 15 min,
refresh 180 days, rotating, with a 120 s overlap. Reusing an old one revokes **the whole device**
(401 `refresh-reused`). It has nothing to do with the app's sign-in session above.

## 6. On the dev surface (`u21-personal-coach` preview)
- Allowlisted: email-code, dashboard/weekly, feed, feed/like, athletes/me, athletes/summary,
  activities/details, u21/register (`src/lib/dev-api-allowlist.ts`). Requires `MC_DEV_API_ALLOWLIST=1`.
- **Not** allowlisted (404 there): `/api/auth/me`, `/api/notifications/*` including
  `POST /api/notifications/seen`.
- The preview is behind Vercel Deployment Protection, so Vercel answers 401 before our code runs.
  Access is pending a scoped domain-exception decision. No bypass secret goes into the app.
