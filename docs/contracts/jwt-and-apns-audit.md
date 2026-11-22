# JWT binding + athlete states, and APNs environment separation (audit, branch `u21-personal-coach`)

## Member JWT
- Verification: `requireSession` calls `createClient(NEXT_PUBLIC_SUPABASE_URL, anon).auth.getUser(token)`
  (`src/lib/auth-session.ts:352`). The token is checked **by the auth server of the deployment's own project**, so
  a token minted by another Supabase project (prod vs dev) is rejected there (→ 401). The app does not decode
  `iss`/`aud` itself; project binding comes from asking that project. Expired tokens are rejected locally first
  (`:240`). 429/5xx/network from Supabase → 503, never 401 (`authErrorContract.test.ts`).
- Identity: email from the verified user → athlete row (`pickAthleteRow`); no athlete and no legacy coach → 403
  `No membership found for this account` (`:454`).
- States, after the cache, per request (`:255-262`, `src/lib/auth/approval-gate.ts:75-82`):
  `membership === 'pending'` → 403 `pending-approval`; `athleteStatus === 'inactive'` → 403 `account-inactive`,
  except on the approval-exempt prefixes (`requiresApproval`, `:51`). `requireAthlete` adds 403 for no athlete
  profile / not active (`:466-476`).
- `GET /api/auth/me` side effects are unchanged on this branch (stamps `last_seen_at`, one-time `first_seen_at`);
  the native app does not call it. `POST /api/notifications/seen` is the explicit, monotonic alternative.

## APNs
- Off unless all of `APNS_KEY_P8`, `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_TOPIC`, `APNS_ENV` are valid
  (`src/lib/apns.ts` `apnsConfig`). `APNS_ENV` has **no default**: anything but exactly `sandbox`/`production` is
  "off", so a missing value can never select the production gateway. Pinned by `apnsSender.test.ts`.
- `notifyAthlete` does not even load the native sender without a config (`notifyAthleteNative.test.ts`); the real
  HTTP/2 transport throws under tests.
- A preview has no APNS_* today → no APNs traffic. If keys are ever added to Preview, set `APNS_ENV=sandbox` there:
  development builds register sandbox tokens, which the production gateway rejects (and vice versa).
- Token privacy: `apns_token` is stored per device, written only by the device routes, never returned by any read
  route; invalid tokens (410 / BadDeviceToken) are cleared, not logged with value.
