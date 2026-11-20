# Auth errors: what each one means for the native client

Pinned by `src/__tests__/authErrorContract.test.ts` (`requireSession`, `src/lib/auth-session.ts:234-385`).

| Our API answers | Meaning | Client should |
|---|---|---|
| 401 `Missing bearer token` | No `Authorization` header | Attach the token; if none, show sign-in |
| 401 `Invalid or expired session` | Token expired (checked locally) or Supabase rejected it (4xx) | Refresh once; if refresh fails definitively, show sign-in |
| 503 `Could not verify session, try again` | Supabase Auth 429/5xx or unreachable | **Keep the session**, retry with backoff. Never sign out on 503 |
| 403 `No membership found…` / `pending` / `inactive` | Valid session, not an active member | Show the waiting/blocked screen, not sign-in |
| 500 `Supabase not configured` | Server misconfiguration | Generic error; not the user's fault |

Refresh (`POST {SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`) answers:
- **Definitive, sign in again:** 400/401 with `invalid_grant` (refresh token not found, revoked, or already used
  outside the reuse interval).
- **Transient, keep tokens and retry:** network errors, timeouts, 429, 5xx.
- Store the new `refresh_token` atomically with the new `access_token`; a lost write turns the next refresh into
  a reuse, which revokes the session.

## Sign-in failures are NOT generically retryable
Since the session mint fails closed (`c21dbc18`), a mint failure answers 500, but what the caller may do next
differs per route:
- `POST /api/auth/email-code` verify → `500 { error: "failed" }`: the code was **already deleted**
  (`route.ts:174`, before the mint at `:182`). Do **not** retry verify with the same code (it will 401). Ask the user
  to request a new code (send is capped at 3 per address per 15 min).
- `POST /api/auth/claim-login` → `500 "Login failed"`: the pending login row is already spent, deliberately
  (`route.ts:64-71`). Restart the sign-in flow.
- `admin/login`, `auth/silent-session`: 500, restart the flow.
Before the fix the same outage was silently "absorbed" by rotating the password, which signed the user out on
every other device instead.
