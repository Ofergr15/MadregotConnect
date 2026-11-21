# Watch device API: server contract for the iOS companion (plan H5–H7)

Tests: `src/__tests__/deviceApiContract.test.ts`. Full background: `docs/apple-watch.md`.
Every response is JSON with `Cache-Control: no-store`.

## Feature off
Until migration 138 is applied, **every** `/api/device/*` route answers 404 `{ "error": "watch-not-enabled" }`.
- This is checked before auth, so it comes back even with no or bad credentials.
- A half-applied 138 reads the same way.
- Treat it as "feature unavailable". Do not sign out, and do not retry in a tight loop.

## Credentials
- `POST /register` (Supabase JWT) `{ platform:"ios", installationId, appVersion?, osVersion?, deviceName?, apnsToken?(hex), schedulerAuthorized?, healthAuthorized? }`
  - Success: 201 `{ deviceId, refreshToken:"wrt1.…", accessToken:"wat1.…", accessTokenExpiresAt }`.
  - Errors:
    - 400 `JSON body required` · `installationId required` · `unsupported-platform`
    - 401 from the session
    - 403 `view-as cannot register a device`
  - Registering again with the same `installationId` revokes the old device. At most 5 live devices are kept; the oldest is retired.
- `POST /token` (no auth) `{ refreshToken, …same state fields }`
  - Success: 200 `{ accessToken, accessTokenExpiresAt, refreshToken }`. **Always store the new refresh token.**
  - Retrying the old token within 120 s, while its successor is unused, gives a fresh pair (the unused successor is revoked).
  - Errors:
    - 400 `refreshToken required`
    - 401 `refresh-unknown` · `refresh-expired` (180 d) · `refresh-revoked` · **`refresh-reused`**
    - 403 `Account is not active`
    - 500 `Could not refresh`
  - `refresh-reused` revokes the whole device, so the real phone must sign in again too.
- Device routes send `Bearer wat1.…` (15 min). The device is re-checked on every request:
  - 401 `Invalid or expired device token` → refresh
  - 401 `Device revoked` / `Device token mismatch` → sign in
  - 403 `Account is not active`

## `GET /pending-workouts`
→ `{ serverTime, window:{from,to}, maxScheduled:15, workouts:[{ deliveryId, planId, date, scheduledAt:{date,hour,minute}, status:"pending"|"success", workout }], remove:[{ deliveryId, planId, date }] }`
- The window runs from yesterday to today+7 (Israel dates).
- Workouts are sorted earliest first (then by part) and capped at 15.
- Morning parts are scheduled at 06:00 + (part−1) minutes. An `evening` part is scheduled at 18:00.
- Both arrays are always present (`[]`, never null).
- Rows with a bad plan id or an unknown schema are silently dropped.

## `POST /deliveries/ack`
- Body: `{ scheduled?:id[], removed?:id[], failed?:[{deliveryId,error}] }`.
- Response: `{ scheduled, removed, failed }` counts of the rows that actually moved.
- Only the caller's own, live Apple rows move (`removed` applies only to superseded rows). Anything else is ignored silently: compare the counts to what you sent.
- No body → 400. Up to 50 ids per list.

## `POST /activities` (≤ 4 MB)
- Idempotent on `appleWorkoutUuid`. Any 2xx means "delivered, stop retrying".
- Outcomes:

| Status | Body | Meaning |
|---|---|---|
| 201 | `{ status:"inserted", activityId, match }` | new run stored |
| 200 | `{ status:"duplicate", activityId, enriched:[cols], match }` | already stored; re-send to add a late route or laps (fills gaps only) |
| 200 | `{ status:"upgraded-strava", activityId, twinSource:"strava", match }` | the Strava copy's row was upgraded in place (same id; name kept) |
| 200 | `{ status:"skipped-twin", activityId, twinSource:"garmin", match }` | Garmin's copy wins; nothing written; `activityId` is the Garmin row |

- `match` is `{ workoutKey, matchMethod, weeklyPlanId }` or `null`.
- Errors:
  - 422 `{ error }`: `appleWorkoutUuid must be a UUID`, `workoutPlanId must be a UUID`, `startDate/endDate invalid`, `workout in the future`, `workout longer than 48h`, `distanceM invalid`, `durationS invalid`, `too many samples`, `unknown schema`, `unsupported version`. Do not retry these.
  - 400 for no body.
  - 500 → retry.

## `POST /revoke`
- Returns `{ revoked:true }` for any of:
  - the device's own `wat1` token;
  - `{ refreshToken }` with no auth (same answer for an unknown token);
  - a Supabase session with `{ deviceId }`.
- Errors: 404 `Device not found` (not your device) · 400 when neither is given.
