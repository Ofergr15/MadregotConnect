# Outbound egress map: what can leave the server, and how to turn it off

Source: branch `u21-personal-coach`. Nothing here was sent; this is a code reading.

| Channel | Where | Reaches | Off switch (fail closed) |
|---|---|---|---|
| Email (Resend) | `src/lib/email/send.ts:186`; ~22 helpers in `src/lib/email/index.ts` | Any address handed in. **Fixed real recipients:** `APPROVER_EMAILS` (`src/lib/constants.ts:47`, used at `email/index.ts:173`, `:212`), `ADMIN_EMAIL` (env, falls back to a real address, `email/index.ts:35`) | Unset `RESEND_API_KEY` → every send is `skipped: email-not-configured` (`send.ts:174`). Synthetic addresses are always skipped (`send.ts:103`, `:155`) |
| Web push (VAPID) | `src/lib/push.ts` (`sendPushDetailed`) | Subscriptions stored in the **connected database** | Unset `NEXT_PUBLIC_VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` → dropped with a warning (`push.ts:62-65`, `:518`) |
| iPhone push (APNs) | `src/lib/apns.ts`, `src/lib/push-native.ts`, wired in `notifyAthlete` | `athlete_devices.apns_token` in the connected database | Off unless all of `APNS_KEY_P8`, `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_TOPIC`, `APNS_ENV` are valid (`apns.ts` `apnsConfig`). Real transport refuses to run under tests |
| Staff push (`notifyStaff`) | `src/lib/notifications/staff.ts`, routing table (migration 099) | Staff **in the connected database** | Same as web push / APNs |
| Garmin (watch workouts, sync) | `garmin-connect` package, `src/lib/garmin/*`, `/api/garmin/push-workouts` | Real Garmin accounts whose encrypted credentials are in the database | No env switch. Only fires for athletes with `garmin_auth`; a synthetic test account has none |
| Strava | `src/lib/strava/client.ts`, `avatar-refresh.ts` | Strava API, with a member's own token | Only for connected members |
| Google Drive (photos) | `src/lib/photos/drive-browse.ts` | The club's Drive | Needs Drive credentials |
| AI (plan parsing, run chat) | `src/lib/ai/*`, run-chat routes | Anthropic / OpenAI, **costs money** | Unset `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` |
| Weather | `/api/events/[id]/forecast`, activity analysis | Open-Meteo, no key, no personal data (coordinates and dates only) | None needed |

**Reachable from the dev preview** (8 allowlisted routes only): email-code (mails only the requester, an
approved member in the dev DB), feed/like (push to the run owner in the dev DB), u21/register (sends nothing).
Every route that mails the fixed real addresses (signup, academy register, athletes/connect, digests) is 404 there.

**Local `npm run dev`** has no allowlist: every route is reachable on that machine. A real `RESEND_API_KEY` there
can mail `APPROVER_EMAILS` / `ADMIN_EMAIL` (real people) from sign-up, academy, or connect-watch flows. See
`outbound-policy.md` for the proposed guard.
