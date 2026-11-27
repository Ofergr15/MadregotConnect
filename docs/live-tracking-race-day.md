# Live tracking: race-day runbook (Valencia, 2026-12-06)

This is the short version for the morning. The design, sources and privacy notes are in `docs/race-live.md`.
Expected load: about 25 runners sharing and about 50 viewers.

## Load (what the server has to carry)

| path | rate | per request |
|---|---|---|
| `POST /api/race-live/{eventId}/position` (phones) | 25 runners × 1 per 10-20 s ≈ **1.3-2.5 writes/s**, capped by the 8 s rate limit at ≤ 3.1/s | 1 JWT check, 1 flag read, 3 parallel selects, 1 upsert on a single row per runner |
| `GET /api/race-live/{eventId}` (board) | 50 viewers × 1 per 30 s ≈ **1.7 reads/s** | ~8 selects over 25-row tables |

Measured locally in `src/__tests__/raceLiveRaceDay.test.ts`:
- A full 4 h race at one point every 15 s lands all **961 of 961** points, with exactly one stored row.
- Before this change the 20 s rate limit refused **481 of 961** points (every other one).

Both paths are a few thousand rows a day against Supabase, far under any limit. `race_positions` never grows past one row per runner.

## Turn it on (Valencia runners only)

1. **Flags, per athlete.** Do not turn them on for the club. Use `PUT /api/features/race_live_phone/enablements {"scopeType":"athlete","scopeId":"<athleteId>","enabled":true}` (admin) for each Valencia runner who will share from the phone, or the Settings → feature flags screen. Then turn on `race_live` (the board) for the runners and for the members who will watch, or for the club once the race starts.
2. **Board entries.** Every runner who shares needs a `race_entries` row (bib + goal): `PUT /api/race-live/{eventId}/entries`. A phone with no row gets `403 not-on-board`.
3. **Window.** Race morning:
   `PUT /api/race-live/{eventId}/config {"active":true,"pollFrom":"2026-12-06T07:45:00+01:00","pollTo":"2026-12-06T14:30:00+01:00"}`.
   Positions are accepted, and shown on the board, **only inside this window**.
4. **Viewers opt in to the map** on their own (`PUT …/map {on:true}`). Without that a member sees the board but no positions.

## During the race: what a 4xx means

| status | error | meaning, what to do |
|---|---|---|
| 401 | — | no or expired session. The runner signs in again. |
| 403 | `off` | `race_live_phone` is not on for this runner (step 1). |
| 403 | `not-on-board` | no `race_entries` row (step 2). |
| 403 | `opted-out` | the runner hid themselves. That is intended. |
| 403 | `not-monotonic` | the phone restarted its session and sent a distance of 0 without `resume: true`. The client must send `resume: true` on the first point after a restart. The server then continues the same track and returns `baseDistanceM` / `baseElapsedSec` for the phone to add from then on. |
| 409 | `out-of-window` | outside `pollFrom..pollTo`, or `active:false`. |
| 429 | `too-soon` | under 8 s since the last point. Harmless, the next one lands. |

Stopping and sharing again (DELETE, then POST from 0) is always accepted.

## Who can see a position

- Verified club members only, with `race_live` on, who have opted in to the map. Never anyone without a session: the route is JWT-gated and nothing is public.
- Only inside the race window. After `pollTo` the board returns `position: null`, even before the purge.
- Never for an opted-out runner. They are absent from the board entirely, except to themselves.
- Only the latest point is stored: one row per runner, no trail. Every position is deleted 24 h after `pollTo`, or at once when the runner stops or opts out.

## Turn it off

1. `PUT /api/race-live/{eventId}/config {"active":false}`. Writes stop (409) and positions vanish from the board immediately.
2. Turn `race_live_phone` off for those athletes, or leave it. With the window closed it does nothing.
3. The purge removes every position and LiveTrack link 24 h after `pollTo`. Emergency wipe: a runner's own `DELETE …/position`, or opting a runner out, deletes their row at once.
