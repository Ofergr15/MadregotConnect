# Apple Watch: the server contract for the companion iPhone app

Status: Phase 0 (server only).
- Every `/api/device/*` route answers **404 `{"error":"watch-not-enabled"}`** until migration 136
  (`athlete_devices`, …) is applied.
- Nothing is reachable until a device registers.
- Design notes are in `~/.cache/madregot/plans/watch-phase0-plan.md`.

## Why an app at all

There is no Apple cloud API for workouts. WorkoutKit (`WorkoutScheduler`, `CustomWorkout`) and HealthKit only
exist on the device, so a small iOS 17+ app does two things:
1. It pulls the athlete's scheduled workouts from us and hands them to `WorkoutScheduler`.
2. It reads finished runs out of HealthKit and uploads them.

No watchOS app is needed: scheduled workouts appear in the Workout app on the watch.

## Auth

```
POST /api/device/register   Authorization: Bearer <Supabase session JWT>   (the athlete signs in in-app)
  { "platform":"ios", "installationId":"<UUID kept in Keychain>", "appVersion":"1.0", "osVersion":"18.1",
    "deviceName":"…", "apnsToken":"<hex>", "schedulerAuthorized":true, "healthAuthorized":true }
→ 201 { "deviceId", "refreshToken":"wrt1.…", "accessToken":"wat1.…", "accessTokenExpiresAt" }
```

- The **refresh token is shown once**. Store it in the Keychain. It lasts 180 days and is rotated on every use.
- Registering again with the same `installationId` replaces the old registration.
- An athlete has at most 5 live devices.

```
POST /api/device/token      (no auth header)
  { "refreshToken":"wrt1.…", "appVersion", "osVersion", "apnsToken", "schedulerAuthorized", "healthAuthorized" }
→ 200 { "accessToken":"wat1.…", "accessTokenExpiresAt", "refreshToken":"wrt1.<NEW>" }
```

- Call it on every launch or wake. **Always replace the stored refresh token with the new one.**
- If the response was lost, retrying with the old token within 120 s works.
- Any other reuse of an old token revokes the device (401 `refresh-reused`). The athlete then has to sign in again.
- The state fields matter. Workouts are routed to Apple only for an athlete with no Garmin link and
  `schedulerAuthorized: true`.

Every other call sends `Authorization: Bearer wat1.…` (15 minutes):
- 401 means refresh.
- 401 again means sign in again.
- 403 means the account is not active.

```
POST /api/device/revoke      Bearer wat1.…   → revokes this device
POST /api/device/revoke      { "refreshToken" } → revokes the device that token belongs to
```

## Scheduling workouts

```
GET /api/device/pending-workouts
→ { "serverTime", "window": {"from":"YYYY-MM-DD","to":"YYYY-MM-DD"}, "maxScheduled": 15,
    "workouts": [ { "deliveryId", "planId":"<UUID>", "date", "scheduledAt":{"date","hour","minute"},
                    "status":"pending"|"success", "workout": WatchWorkoutV1 } ],
    "remove":   [ { "deliveryId", "planId", "date" } ] }
```

The app reconciles `WorkoutScheduler.shared.scheduledWorkouts` against this list:
1. For each `workouts[]` entry not yet scheduled:
   - Build the `CustomWorkout`, then `WorkoutPlan(.custom(w), id: UUID(planId))`.
   - Call `schedule(plan, at: scheduledAt)`. The **`id` is what attributes the finished run to the plan.**
2. For each `remove[]` entry, remove the scheduled plan with that id. The coach changed or dropped it.
3. Respect `WorkoutScheduler.maxAllowedScheduledWorkoutCount`. The server already caps its list at 15, earliest
   first.
4. Report back:

```
POST /api/device/deliveries/ack
  { "scheduled": [deliveryId…], "removed": [deliveryId…], "failed": [ { "deliveryId", "error" } ] }
→ { "scheduled": n, "removed": n, "failed": n }
```

`scheduled` is the moment the athlete's app shows the workout as "on your watch". Until then it stays pending.

### WatchWorkoutV1 → WorkoutKit (1:1; all shape work is done server-side)

| JSON | WorkoutKit |
|---|---|
| `name`, `activity:"running"`, `location:"outdoor"` | `CustomWorkout(activity: .running, location: .outdoor, displayName: name, …)` |
| `warmup` / `cooldown` (step or null) | `warmup:` / `cooldown:` `WorkoutStep(goal:alert:displayName:)` |
| `blocks[] {iterations, steps[]}` | `IntervalBlock(steps:, iterations:)`. Blocks are never empty, nothing is nested, and `iterations` is ≥ 1. |
| `steps[].purpose` `work`/`recovery` | `IntervalStep(.work / .recovery, step:)` |
| `goal {type:"open"}` | `.open` |
| `goal {type:"distance", meters}` | `.distance(meters, .meters)` |
| `goal {type:"time", seconds}` | `.time(seconds, .seconds)` |
| `alert {type:"speedRange", minMps, maxMps, metric:"current"}` | `.speed(minMps...maxMps, unit: .metersPerSecond, metric: .current)` (min is the slow end) |
| `alert {type:"heartRateRange", minBpm, maxBpm}` | `HeartRateRangeAlert(target: Measurement(minBpm/60, .hertz)...Measurement(maxBpm/60, .hertz))` |
| `alert: null` | no alert (the watch shows HR) |
| `displayName` | `WorkoutStep.displayName`, **iOS 18+ only**. On iOS 17, leave it out. |
| `target` | what the coach wrote (pace sec/km, HR % and bpm). For the phone UI; never sent to WorkoutKit. |
| `sourcePath` | index path into the original plan step. Keep it for lap-to-step mapping later. |
| `hash` | content hash. The same `planId` always carries the same hash. |
| `warnings` | what normalisation did; never shown on the wrist. |

Validate each step with `CustomWorkout.supportsGoal` / `supportsAlert`.
- If an alert is unsupported, drop it rather than fail the whole workout. Pace alerts indoors need watchOS 11.
- If a whole workout can't be built, ack it as `failed` with the reason.

## Uploading runs

```
POST /api/device/activities          (≤ 4 MB)
{ "schema":"madregot.apple-activity", "version":1,
  "appleWorkoutUuid":"<HKWorkout.uuid>", "workoutPlanId":"<(try? await workout.workoutPlan)?.id or null>",
  "startDate":"ISO-8601", "endDate":"ISO-8601", "timeZone":"Asia/Jerusalem", "indoor":false, "name":null,
  "distanceM":10020, "durationS":2980, "energyKcal":780, "avgHr":151, "maxHr":176, "elevationGainM":40, "avgCadence":176,
  "laps":[ { "startOffsetS", "durationS", "distanceM", "avgHr", "maxHr", "avgCadence", "avgPower", "elevationGainM" } ],
  "route":[ { "t": secondsFromStart, "lat", "lng", "alt" } ],
  "heartRate":[ { "t": secondsFromStart, "bpm" } ] }
```

Field sources:
- `durationS` is `HKWorkout.duration`.
- `route` comes from an `HKAnchoredObjectQuery` on `HKSeriesType.workoutRoute()`, followed by `HKWorkoutRouteQuery`.
- `laps` come from `workoutEvents` of type `.lap` / `.segment`, or from `workoutActivities`.
- Units are metres, seconds, bpm and steps/min.

Responses. Treat **any 2xx as delivered** and stop retrying:
- **201** `inserted`.
- **200** `duplicate`: the same uuid was already stored. If the stored row lacked a route or laps that this
  upload has, they are added.
- **200** `upgraded-strava`: Strava had this run, and its row now carries the Apple recording. Its id,
  kudos and comments are kept.
- **200** `skipped-twin`: Garmin already has this run, so nothing new is stored.

Each response carries `activityId` and `match` (`{workoutKey, matchMethod:"apple_workout"|…, weeklyPlanId}` or null).

Other status codes:
- 422 means the payload is invalid. Fix it and don't retry it as is.
- 5xx means retry with backoff.

**Re-send the same uuid after a route arrives late.** HealthKit may attach or replace a route after the
workout is saved, and the server only fills in what was missing.

## Sync triggers (app side, Phase 1/2)

- On app open, call `token` → `pending-workouts` → schedule/remove → `ack`, then upload any runs not yet sent
  (`HKAnchoredObjectQuery` anchor in the app).
- For background runs: `HKObserverQuery` on `HKWorkoutType` plus `enableBackgroundDelivery`, which needs the
  `com.apple.developer.healthkit.background-delivery` entitlement. Always call the observer's completion
  handler.
- For plan changes: a `BGAppRefreshTask`, and (Phase 2) a silent APNs push from the server when a coach pushes.
