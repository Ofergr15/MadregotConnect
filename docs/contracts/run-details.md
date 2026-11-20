# Run detail: server contract for the native client

Tests: `activityDetailsContract.test.ts` (plus `verifiedRouteIdentity.test.ts`).

## `GET /api/activities/details?activityId=<uuid>[&include=hr,steps]`
Needs `Authorization: Bearer`. Any verified club member can read any member's run.

- 200 `{ activity, gpsPoints: [{lat,lng,…}], splits: Split[], hasPolyline, source: "garmin"|"strava",
  qualityName: string|null, repTarget: object|null, hrTrace?, stepBands? }`.
- `activity` is the DB row in **snake_case** (the feed uses camelCase): `id, athlete_id, source, strava_activity_id,
  garmin_activity_id, activity_name, activity_type, start_time, distance, duration, moving_duration, average_pace,
  average_hr, max_hr, calories, elevation_gain, start_lat, start_lng, avg_cadence, avg_stride_length, vo2max,
  lap_count, location_name, perceived_rpe, perceived_feel, has_polyline, elapsed_duration?`, plus
  `athlete_name, athlete_avatar_url, shoe_name`. `elapsed_duration` and `shoe_name` depend on migrations that may
  not be applied, so treat both as optional.
- `start_time` is wall-clock time written as UTC. Display it in UTC.
- `gpsPoints` is `[]` when the run has no track. It is never null. It holds the full trace, so don't keep it after
  the user signs out and never show it outside the app.
- `activityId` can also be a legacy numeric Garmin or Strava id. Prefer the uuid from the feed (`activity.id`).

## `include=`
- `hr` adds `hrTrace: [[metres, bpm], …]` (about 240 points). **Owner only.**
- `steps` adds `stepBands` (the workout steps with their targets), or `null`. **Owner only.**
- For anyone else, teammate *or* coach, the response is still 200 and these keys are simply **absent**. Check
  whether the key is there. Don't expect a 403.

## Errors
400 `{ error: "activityId required" }` (checked before auth) · 401 with no session or an expired one · 403 when
signed in but not an approved member · 404 `{ error: "Activity not found" }`, which a pending runner's run also
returns · 500 `{ error }`.

## Caveat
This screen does **not** apply the feed's `payload.hiddenFields`. A teammate who opens the detail sees the heart
rate, pace and calories that the runner hid on their card. This is a known server gap. Don't count on this screen
to hide anything.
