# Race live — Valencia 2026-12-06

## Source research (2026-11-21)

- The organizer (Valencia Ciudad del Running / SD Correcaminos) publishes **no documented API or
  feed**. The only live channel named in the regulations (Art. 23.3) is LiveTracking inside the
  official app, by name or bib, chip mats along the course. Results are "published on the website"
  (resultados.valenciaciudaddelrunning.com, which serves a JS app — no public schema).
- Runners can set their LiveTracking to **public, PIN-protected or hidden** in the official app.
  We must not republish a runner who hid themselves there → our own opt-out + an explicit bib
  entry per runner (we only ever track a bib the runner or staff gave us).
- No terms grant third-party reuse of the timing data. Any JSON endpoint found behind the app is
  **undocumented, may change on race morning, and may be refused** — treat it as best effort.

### Follow-up probe (2026-11-21, read-only, one request each)
- `resultados.valenciaciudaddelrunning.com` renders an empty document to a browser with no
  visible links or API calls: no past-race endpoint to test against.
- The organizer does publish **official result PDFs** (name, bib, splits) on its CDN, e.g.
  `cdn1.valenciaciudaddelrunning.com/wp-content/uploads/2025/12/discapacidad-funcional-42k-2025.pdf`.
  A plain server request got **403 "Request blocked" from CloudFront** — the CDN refuses
  non-browser clients. Not worked around (no UA spoofing): that is the organizer's answer.
- Consequence: a server poller against the organizer's own hosts would very likely be refused on
  race day too. **The parser is NOT proven against a real response** — the replay is synthetic.
  The feed adapter stays off; manual entry is the plan, not the fallback.

**Chosen design: source-agnostic.**
1. `manual` (primary, always works): staff type splits off the official app
   (`POST /api/race-live/{eventId}/manual`). Same claim path → can't double-push with the feed.
2. `feed` (optional): a per-bib URL template (`{bib}`), ~10 GETs a minute, stop-on-refusal,
   exponential backoff. Only if someone confirms a usable endpoint *and* the organizer is OK with it.
3. Athlete's own Garmin activity lands in the feed as usual after the race (unchanged).
4. `replay`: synthetic past-race-shaped data on the club's real bibs, for rehearsals.

## Garmin LiveTrack (Ofer's decision, 2026-11-21: "Staff + Garmin LiveTrack")

Race-day plan = **staff manual entry** (official chip times) + **Garmin LiveTrack** (live progress,
start/half pushes, a provisional finish). The organizer-feed poller stays a bonus.

What LiveTrack exposes (no public API; the livetrack.garmin.com page's own internal JSON, as a
community integration verified it on 2026-10-17 — appstrate/appstrate#2064):
- `GET /<personal-name>` HTML → `livetrack_csrf` cookie + `<meta name="csrf-token">`; every `/api/` call
  needs both (double-submit) or it's 403.
- `/api/personal-url/<name>/user` → `{ garminGuid, isPasscodeRequired }`
- `/api/v2/user/<guid>/profile-sessions` → `{ activeSessions[], completedSessions[] }` with `sessionId`, `sessionToken`
- `/api/sessions/<id>/track-points/common?token=` → `{ trackPoints: [{ dateTime, position{lat,lon}, speed, altitude }] }`
- **No cumulative distance** — we sum GPS (spikes > 12 m/s ignored). GPS runs long (~0.3–1 %), so
  watch splits come a little early; finish from the watch only once the session ended with ≥ 41 km,
  at the last point.

Terms/fragility: this is exactly what a viewer's browser fetches for a link the runner chose to
share, read only for links the runner gave us, one runner at a time every 2 min, stopped at
finish/session end, links deleted 24 h after the window. Still **undocumented** — Garmin can change
or block it; a 403/429 marks the runner `error:refused` and stops the pass. Passcode links are not
supported (the setup screen says how to turn the passcode off). Not tested against a real Garmin
session (none running); tested against a simulated session that enforces the CSRF handshake.

Source precedence for the same point: **manual (chip) > feed > livetrack > replay** — the watch can
never overwrite a staff time; a staff finish over a watch finish updates the feed card, no new push.

Privacy: the link is server-side only (never serialised, not even to its owner — the board says
"set" + state). The latest position (one row, no trail) is shown only to members who opted in to
the map, never for an opted-out runner; opting out deletes the link and position immediately.

Native: ולנסיה → "מעקב חי מהשעון" (explanation, how-to, paste, **בדיקת הקישור**, save, delete) —
works the evening before with the personal link; board → map toggle + map; "(שעון)" marks a watch split.

## Pieces
- Migration `196_race_live.sql` (NOT applied): config, entries (bib, goal, opt-out), splits, milestone ledger.
- Feature flag `race_live` (feature_enablements, default off): who sees the board and gets pushes.
- `src/lib/race-live/core.ts` pure logic · `server.ts` tick/store/claim/push/feed card · `replay.ts`.
- `POST /api/cron/race-live` (CRON_SECRET) · `.github/workflows/race-live.yml` loops every 60 s.
- Pushes: start + half → the runner's followers; finish → followers + every member with the flag on.
  Kind `race_live`, category `events` (mutable), quiet hours applied by the send path. One per
  milestone per runner, ever (ledger PK); a missed poll announces only the furthest milestone.
- Finisher feed card: `feed_items` type `achievement`, payload `{kind:'race_result', chipSec}`.
- Native: Valencia tab card → board (finished / on course / not started) → runner detail with
  splits, goal delta, pace group, self opt-out toggle; finish celebration; results after the race.
  Demo: `-raceLive live|results`.

## Race-day runbook (Ofer)
1. **By 2026-11-30:** paste `196_race_live.sql` in Supabase SQL editor.
2. Merge the server part (`src/lib/race-live`, the routes, the workflow, flag + prefs lines) to
   **main** and deploy — GitHub Actions runs workflows from the default branch only. Set repo
   secrets `APP_URL` and `CRON_SECRET` if not already there.
3. **Evening before (5 Dec):** every runner opens ולנסיה → מעקב חי מהשעון, pastes their personal
   LiveTrack link, taps בדיקת הקישור (must say תקין), saves. Staff check the board: own-row states.
   Turn on Garmin Connect LiveTrack auto-share for runs.
4. Enter each runner's bib + goal (`PUT /api/race-live/{eventId}/entries`, staff). Ask runners
   who hid their official LiveTracking whether to set `liveOptOut`.
5. **Rehearsal (~2026-12-01):** `PUT …/config {"replay":{"speed":30,"resetMilestones":true},"active":true,"pushEnabled":false}`
   for the flag on for staff only, run the workflow by hand (`minutes: 20`), watch the tab.
   Then once with `pushEnabled:true` for staff only. After: `replay` reset + `active:false`, and
   delete the rehearsal milestones (`resetMilestones`) and the rehearsal finisher cards.
6. **Race morning 6 Dec:** `PUT …/config {"source":"manual","active":true,"pushEnabled":true,"pollFrom":"2026-12-06T07:45:00+01:00","pollTo":"2026-12-06T14:30:00+01:00"}`
   (or `source:"feed"` + `feedUrl` if an endpoint is confirmed), enable `race_live` for the club,
   start the `race-live` workflow by hand at ~07:45 Valencia (the schedule is a backup).
7. Staff watch the official app and enter half + finish for each runner (start optional) —
   see "Manual entry" below.
8. After: `active:false`. The board stays as results. Turn the flag off on 2026-12-08 with the tab.

## Manual entry (the race-day plan)

Who: two staff phones (e.g. one at home, one in Valencia), each owning half the runners —
splitting the list means nobody enters the same runner twice (and if they do, the server's
milestone ledger still pushes only once).

Before the race:
- Every runner has a bib in `race_entries` (the board shows "מספר חזה" until they start).
- In the official Maratón Valencia app, add each club runner's bib to favourites. Runners who set
  their official tracking to PIN must share the PIN with staff, or be entered from their own message.

During the race, in our app (native, staff account): ולנסיה → live card → tap a runner →
**הזנת זמן (צוות)** → pick the point → type the chip time shown in the official app (`1:28:30`)
→ שמירה.
- **Start** (optional): no time needed; sends "יצא/ה לדרך" to followers.
- **Half**: sends the half push to followers with the predicted finish.
- **Finish**: sends "X סיים/ה ב-…" to followers + the club, and posts the feed card.
- 5/10/…/40 km: optional; they update position and prediction, never push.
- A wrong time: enter it again with the right value — the split is overwritten, the board and
  feed card show the new value, but **the push already sent is not re-sent or corrected**.

If the native app is unavailable, the same call by hand (staff JWT):
```bash
curl -X POST "$APP_URL/api/race-live/$EVENT_ID/manual" -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" -d '{"athleteId":"…","point":"finish","time":"2:58:41"}'
```

Rehearse this exact flow on the rehearsal day with `source: "manual"` and pushes on for staff only.

## Not verified
- No real organizer response was parsed: none documented, the results site exposes nothing, and the CDN returns 403 to servers.
- The staff entry screen and the LiveTrack screens are written but not yet compiled or shot (machine held for the release pass).
- LiveTrack never read against a real Garmin session; a staff member should start a short LiveTrack run on rehearsal day and paste their link.
- Pushes reach the PWA web-push subscriptions via the existing send path; native APNs only if
  that path already covers it.
- The native HTTP calls are untested against a live server (same as the rest of the Valencia tab).

## Phone location (b24, flag `race_live_phone`, default off)

Research: review-2026-11-20/valencia-live-research.md — the organizer publishes no feed and LiveTrack is
share-link only, so **the runner's own phone is the only legal source at 1–2 minute freshness.**

- **Write:** `POST /api/race-live/{eventId}/position { lat, lon, distanceM, elapsedSec, at }` — the CALLER's
  own row only. Identity is the JWT (`resolveVerifiedCaller`); there is no athlete id in the body, and staff
  cannot write for anyone. Refused unless: `race_live_phone` on for the caller, the race window is open
  (`race_live_config.active` and `poll_from ≤ now ≤ poll_to`), the caller has a `race_entries` row that is not
  `live_opt_out`. Rate: one write per 20 s; distance may not drop more than 200 m (a new session).
  `DELETE` = stop sharing, the row goes at once. Pure rules + tests: `lib/race-live/phone.ts`,
  `raceLivePhone.test.ts`.
- **What is stored:** exactly what LiveTrack stores — ONE row in `race_positions` (latest point; no trail,
  no history). No migration.
- **Who sees it:** the existing board rules, unchanged — any verified member with `race_live` on, positions
  only for members who opted in to the map (`race_map_viewers`), never for an opted-out runner. The board
  now also returns the position's `elapsedSec` and an `etaSec` (elapsed × 42.195 / covered).
- **Retention:** the existing purge deletes every position 24 h after `poll_to` (`PURGE_AFTER_MS`);
  stopping, opting out or the client's 7 h cap ends it sooner.
- **Exposure change (recorded 2026-11-25):** precise live location of a named member, readable by every
  member who opts in to the map, during the race window. Same class LiveTrack positions already had; the
  new part is the source (the phone, so anyone with the app can share, not only Garmin users). It must never
  become public, never get a trail, and never outlive the purge. Splits are NOT derived from the phone (that
  would need a 'phone' split source — migration 220, not proposed here).
- **Client:** opt-in sheet with explicit consent copy; background location only while sharing, only in the
  race window; stops at the finish line distance, after 7 h, or by the runner; 120 s posts in Low Power Mode.
