# API route auth inventory

Generated 2026-11-27 from `src/app/api/**/route.ts` (491 routes). Pinned by
`src/__tests__/routeAuthInventory.test.ts`: a new route must either gate on a verified
session (or CRON_SECRET / a device token / a signed URL) or be added to the public allowlist
there with a reason — so this file and the code cannot silently drift apart.

## Summary

- **No route still takes identity from a caller-supplied email / `coach_id` / `approverEmail`.**
  Every member, staff and admin route resolves the caller from the Supabase JWT, directly
  through `src/lib/auth/self-or-staff.ts` (`resolveVerifiedCaller`, `mayActFor`,
  `requireMember`, `requireStaff`, `requireCallerForAthlete`, `requirePackLeader`) or through a
  domain wrapper that funnels into them (`requireAcademyManager`, `requireStoryAdmin`,
  `requireContentStaff`, `requireApprover`, `plan-builder gate()`, `recordsGate`, `loadPain`, …).
- `coach_id` still appears in many routes, but as the club constant `COACH_ID` used to scope
  queries, not as caller identity.
- Cron routes authenticate with `Bearer CRON_SECRET`; the Watch/device routes with a device token
  (`requireDevice`); photo routes with `verifyRequest` (same JWT check).
- 37 routes are intentionally reachable without a session; each is listed below with why.

Who should be allowed, by prefix: `/api/admin/**`, `/api/plan-builder/**` → staff/admin;
`/api/academy/**` → academy manager / paired coach / the trainee (self-or-staff);
`/api/athletes/**`, `/api/activities/**` → self-or-staff, or member where CLAUDE.md records it;
`/api/feed/**`, `/api/packs/**`, `/api/club-updates/**` → member (pack leader for pack writes);
`/api/cron/**` → cron; `/api/device/**` → paired device; `/api/public/**`, `/api/join/**` → public / token.

## Routes reachable without a session (allowlisted)

| route | kind | why it is safe |
|---|---|---|
| `/api/version` | public | build/version probe, no data |
| `/api/ping` | public | liveness probe |
| `/api/health` | public | uptime probe: DB reachable + ages of last cron tick / Garmin / Strava sync; ages only, no ids or error text |
| `/api/config` | public | public client config (no secrets) |
| `/api/badges` | public | badge catalogue, same public-read convention as /api/events |
| `/api/client-log` | public | client error sink, write-only log line |
| `/api/push/receipt` | endpoint-as-credential | service worker has no session; the push endpoint URL is the credential; moves one timestamp, returns 204 always |
| `/api/garmin/sso-callback` | oauth-callback | Garmin SSO redirect target; identity comes from the OAuth state/ticket |
| `/api/garmin/sso-callback/app` | oauth-callback | same, native-app variant |
| `/api/public/signup` | public-form | registration form; creates a pending row only, approval is staff-gated elsewhere |
| `/api/public/signup/status` | public-form | status lookup for the submitter |
| `/api/public/manifest` | public | PWA manifest |
| `/api/public/groups` | public | group names for the signup form |
| `/api/public/qr` | public | QR image for a public URL |
| `/api/public/current-plan` | public | public current-plan summary |
| `/api/public/stats` | public | aggregate club stats, no per-person data |
| `/api/academy/register` | public-form | academy application form, rate-limited (allowFromIp/allowSubmit) |
| `/api/auth/claim-login` | login | login flow step, establishes the session |
| `/api/auth/athlete-login` | login | login flow step |
| `/api/auth/sign-out` | login | ends the caller's own session |
| `/api/auth/claim-member/confirm` | login | confirms a claim code sent to the member |
| `/api/features/public` | public | public feature flags |
| `/api/join/groups` | token-scoped | invite token is the credential (see CLAUDE.md 2026-09-05) |
| `/api/join/phone-link` | token-scoped | invite token; mails only the address on that invite row, 2-min cooldown |
| `/api/release/approved` | public | approved release id for the deploy train |
| `/api/store/products` | public | store catalogue |
| `/api/dev/auth-log` | dev-only | 403 in production |
| `/api/dev/strava-athletes` | dev-only | 403 in production |
| `/api/device/token` | device-pairing | exchanges a pairing code for a device token |
| `/api/native/auth/refresh` | login | refresh-token exchange for the native app |
| `/api/native/storage/program-plans/[folder]/[file]` | public | 302 to a public bucket object (same objects /api/program-weeks already hands out) |
| `/api/events/[id]/forecast` | public | weather forecast for a public event |
| `/api/photos/browse/img` | signed-url | serves only URLs carrying a valid server signature (verifyImageUrl) |
| `/api/photos/browse/video` | signed-url | same, verifyVideoUrl |
| `/api/auth/email-code` | login | send/verify a 6-digit sign-in code; only to an address on an approved athlete row |
| `/api/auth/silent-session` | login | re-mints a session for a browser holding the mc_device HMAC from a real login |
| `/api/admin/login` | login | shared admin password + best-effort throttle (see owner question in the PR) |
| `/api/u21/register` | public-form | U21 application, default OFF behind a feature switch, honeypot + rate limit, stores pending_review only |

## Every route

`gate` is the gating call(s) found in the route source; `-` means it is gated by a
non-exported helper in the same folder (e.g. `loadPain`), by CRON_SECRET, or is allowlisted above.

| route | methods | gate | kind |
|---|---|---|---|
| `/api/academy/activity-load` | GET | requireCallerForAthlete | verified |
| `/api/academy/adherence` | GET | requireCallerForAthlete | verified |
| `/api/academy/assign` | POST | requireAcademyManager | verified |
| `/api/academy/bands` | PATCH,PUT | requireAcademyManager, requireTraineeAccess | verified |
| `/api/academy/benchmark-zones` | GET | resolveVerifiedCaller | verified |
| `/api/academy/benchmarks` | DELETE,GET,PATCH,POST | resolveVerifiedCaller | verified |
| `/api/academy/body` | GET | requireCallerForAthlete | verified |
| `/api/academy/candidates` | GET,PATCH,POST | acceptAction, resolveVerifiedCaller | verified |
| `/api/academy/characterization` | GET,PUT | resolveVerifiedCaller | verified |
| `/api/academy/characterization/self` | GET,PUT | notifyAthlete, resolveVerifiedCaller | verified |
| `/api/academy/coach` | PUT | requireAcademyManager | verified |
| `/api/academy/coach-today` | GET | resolveVerifiedCaller | verified |
| `/api/academy/coach-tools` | GET | buildCoachTools, resolveVerifiedCaller | verified |
| `/api/academy/coaches` | GET,PUT | notifyAthlete, requireAcademyManager | verified |
| `/api/academy/completion` | GET | requireStaffCaller | verified |
| `/api/academy/completion/request` | POST | notifyAthlete, requireStaffCaller | verified |
| `/api/academy/copy-week` | GET,POST | notifyPlanSaved, requireTraineeAccess, writeWeek | verified |
| `/api/academy/day-plan` | GET,POST | notifyPlanSaved, pushWeekToAthlete, requireTraineeAccess | verified |
| `/api/academy/dispatch` | GET | resolveVerifiedCaller | verified |
| `/api/academy/dispatch/resend` | POST | notifyAthlete, pushWeekToAthlete, requireTraineeAccess | verified |
| `/api/academy/feedback` | GET,POST | notifyAthlete, requireSession, resolveVerifiedCaller | verified |
| `/api/academy/goal` | GET,PUT | notifyAthlete, resolveVerifiedCaller | verified |
| `/api/academy/goal/result` | POST | resolveVerifiedCaller | verified |
| `/api/academy/home` | GET | requireStaffCaller | verified |
| `/api/academy/hub` | GET | resolveVerifiedCaller | verified |
| `/api/academy/import` | GET,PATCH,POST | inviteImported, requireAcademyManager, setCardEmail | verified |
| `/api/academy/library` | GET,PATCH,POST | resolveVerifiedCaller | verified |
| `/api/academy/library/classify` | POST | resolveVerifiedCaller | verified |
| `/api/academy/library/import` | GET,POST | gate, resolveVerifiedCaller | verified |
| `/api/academy/load` | GET | requireCallerForAthlete | verified |
| `/api/academy/me` | GET | requireCallerForAthlete | verified |
| `/api/academy/members` | GET | resolveVerifiedCaller, staff | verified |
| `/api/academy/members/application` | DELETE | requireAcademyManager | verified |
| `/api/academy/members/bulk` | POST | requireAcademyManager, runBulk | verified |
| `/api/academy/members/invite` | POST | requireAcademyManager | verified |
| `/api/academy/members/invite/resend` | POST | requireAcademyManager | verified |
| `/api/academy/members/people` | GET | requireAcademyManager | verified |
| `/api/academy/migration` | GET | requireAcademyManager | verified |
| `/api/academy/migration/remind` | POST | notifyAthlete, requireAcademyManager | verified |
| `/api/academy/missed-week` | POST | notifyMissedWeek, requireTraineeAccess, writeWeek | verified |
| `/api/academy/month` | GET | requireCallerForAthlete | verified |
| `/api/academy/my-races` | DELETE,GET,PATCH,POST | gate, resolveVerifiedCaller | verified |
| `/api/academy/pace-update` | POST | buildCoachTools, notifyPaceUpdate, requireTraineeAccess, reresolveFuturePlans | verified |
| `/api/academy/payments` | GET,POST | resolveVerifiedCaller | verified |
| `/api/academy/plan-inputs` | GET | resolveVerifiedCaller | verified |
| `/api/academy/queue` | GET | requireStaffCaller | verified |
| `/api/academy/race-plan` | GET,PUT | resolveVerifiedCaller | verified |
| `/api/academy/read-nudge` | POST | notifyAthlete, requirePackLeader, resolveVerifiedCaller, staff | verified |
| `/api/academy/readiness` | GET | buildCoachTools, requireCallerForAthlete, resolveVerifiedCaller | verified |
| `/api/academy/register` | GET,POST | acceptImported, notifyStaff | allowlisted |
| `/api/academy/registration` | GET,PUT | requireAcademyManager | verified |
| `/api/academy/registrations` | GET | requireAcademyManager | verified |
| `/api/academy/segments` | GET | resolveVerifiedCaller | verified |
| `/api/academy/self-report` | POST | resolveVerifiedCaller | verified |
| `/api/academy/settings` | GET,PUT | requireAcademyManager, requireStaffCaller | verified |
| `/api/academy/stats` | GET | requireStaffCaller | verified |
| `/api/academy/summary` | GET | requireAcademyManager | verified |
| `/api/academy/test-analysis` | GET,POST | resolveVerifiedCaller | verified |
| `/api/academy/test-analysis/send` | POST | notifyTestAnalysis, resolveVerifiedCaller | verified |
| `/api/academy/test-invitation` | GET,PATCH,POST | notifyTestConfirmed, notifyTestInvited, notifyTestOtherTime, resolveVerifiedCaller | verified |
| `/api/academy/test-invitation/board` | GET | resolveVerifiedCaller | verified |
| `/api/academy/test-round` | POST | notifyTestInvited, resolveVerifiedCaller | verified |
| `/api/academy/tests` | GET,PATCH,POST | notifyTestApproved, notifyTestSubmitted, resolveVerifiedCaller | verified |
| `/api/academy/tests/entry` | GET | resolveVerifiedCaller | verified |
| `/api/academy/tests/watch` | GET | resolveVerifiedCaller | verified |
| `/api/academy/threads` | POST | resolveVerifiedCaller | verified |
| `/api/academy/threads/inbox` | GET | resolveVerifiedCaller | verified |
| `/api/academy/threads/messages` | GET,POST | notifyAthlete, resolveVerifiedCaller | verified |
| `/api/academy/threads/read` | POST | resolveVerifiedCaller | verified |
| `/api/academy/today` | GET | requireCallerForAthlete | verified |
| `/api/academy/trainee-setup` | GET,PUT | gate, resolveVerifiedCaller | verified |
| `/api/academy/trends` | GET | requireStaffCaller | verified |
| `/api/academy/viewer` | GET | requireSession | verified |
| `/api/academy/week-board` | GET | resolveVerifiedCaller | verified |
| `/api/academy/week-moments` | GET,PUT | requireStaffCaller | verified |
| `/api/academy/week-moments/board` | GET | requireAcademyManager | verified |
| `/api/academy/week-moments/mine` | GET | resolveVerifiedCaller | verified |
| `/api/academy/week-moments/read` | POST | resolveVerifiedCaller | verified |
| `/api/academy/week-moments/receipts` | GET | resolveVerifiedCaller | verified |
| `/api/academy/week-moments/send` | POST | requireStaffCaller, sendMoment | verified |
| `/api/academy/workout` | GET | resolveVerifiedCaller | verified |
| `/api/academy/workouts` | DELETE,GET,POST | requireSession, requireStaff | verified |
| `/api/academy/zones` | GET,PUT | requireTraineeAccess | verified |
| `/api/account/delete-request` | DELETE,GET,POST | notifyStaff, resolveVerifiedCaller | verified |
| `/api/activities` | GET | requireCallerForAthlete | verified |
| `/api/activities/[id]/kudos` | DELETE,GET,POST | notifyFeedInteraction, resolveVerifiedCaller | verified |
| `/api/activities/[id]/lane` | POST | resolveVerifiedCaller | verified |
| `/api/activities/[id]/plan-match` | GET | resolveVerifiedCaller, staff | verified |
| `/api/activities/analysis` | GET | resolveVerifiedCaller, staff | verified |
| `/api/activities/details` | GET | resolveVerifiedCaller, staff | verified |
| `/api/activities/gpx` | GET | resolveVerifiedCaller | verified |
| `/api/activities/similar` | GET | resolveVerifiedCaller | verified |
| `/api/activities/stream` | GET | resolveVerifiedCaller | verified |
| `/api/activities/strength` | GET | resolveVerifiedCaller | verified |
| `/api/activities/strength/week` | GET | resolveVerifiedCaller | verified |
| `/api/admin/access` | GET,PUT | gate, resolveVerifiedCaller | verified |
| `/api/admin/approve` | POST | notifyAthlete, requireSession | verified |
| `/api/admin/athlete-source` | GET,PATCH | requireSession, requireStaffCaller | verified |
| `/api/admin/badges` | POST | requireSession | verified |
| `/api/admin/badges/[id]` | DELETE,PATCH | requireSession | verified |
| `/api/admin/badges/icon` | POST | requireSession | verified |
| `/api/admin/birthdays` | GET,PUT | requireBirthdayAdmin | verified |
| `/api/admin/birthdays/photo` | POST | requireBirthdayAdmin | verified |
| `/api/admin/celebrations` | GET,PATCH | requireContentStaff | verified |
| `/api/admin/challenges` | GET,POST | requireSession | verified |
| `/api/admin/challenges/[id]` | DELETE,PATCH | requireSession | verified |
| `/api/admin/champions` | DELETE,GET,PATCH,POST | requireContentStaff | verified |
| `/api/admin/cheers` | POST | publishGate, sendPushLocalized | verified |
| `/api/admin/cheers/suggestions` | GET | requireApprover | verified |
| `/api/admin/club-numbers` | GET | resolveVerifiedCaller | verified |
| `/api/admin/club-stories` | DELETE,POST | publishGate, requireContentStaff, sendPushLocalized | verified |
| `/api/admin/club-updates` | GET,PUT | clubUpdatesCaller | verified |
| `/api/admin/content` | GET | requireContentLevel | verified |
| `/api/admin/content/drafts` | GET,POST | gate, notifyAthlete, requireSession | verified |
| `/api/admin/content/post` | GET | requireContentLevel | verified |
| `/api/admin/content/surveys` | GET | requireContentLevel | verified |
| `/api/admin/content/surveys/[id]` | GET,POST | notifySurveyNonResponders, requireApprover, requireContentLevel, staff | verified |
| `/api/admin/core-runners` | GET,PUT | notifyAthlete, requireStaff, resolveVerifiedCaller | verified |
| `/api/admin/core-runners/preview` | GET | requireStaffCaller | verified |
| `/api/admin/data-check` | GET | requireStaff | verified |
| `/api/admin/email-health` | GET | requireStaff | verified |
| `/api/admin/entry-queue` | GET | requireStaffCaller | verified |
| `/api/admin/entry-queue/nudge` | POST | notifyAthlete, requireStaffCaller | verified |
| `/api/admin/entry-queue/remove` | POST | requireStaffCaller | verified |
| `/api/admin/finance` | GET | resolveVerifiedCaller | verified |
| `/api/admin/finance/remind` | POST | notifyAthlete, resolveVerifiedCaller | verified |
| `/api/admin/group-change-requests` | GET,POST | requireStaffCaller | verified |
| `/api/admin/leads` | GET | requireStaffCaller | verified |
| `/api/admin/leads/touch` | POST | requireStaffCaller | verified |
| `/api/admin/login` | POST | - | allowlisted |
| `/api/admin/manager-home` | GET | resolveVerifiedCaller | verified |
| `/api/admin/mobile-tab-permissions` | GET,PUT | requireSession | verified |
| `/api/admin/move` | GET,POST | gate, requireSession, sendPushDetailed | verified |
| `/api/admin/move/checks` | POST | requireSession | verified |
| `/api/admin/needs-you` | GET | requireStaffCaller | verified |
| `/api/admin/notifications` | GET,PUT | resolveVerifiedCaller | verified |
| `/api/admin/notifications/image` | POST | requireApprover | verified |
| `/api/admin/onboarding-funnel` | GET | requireSession | verified |
| `/api/admin/overview` | GET | requireStaff | verified |
| `/api/admin/partner-orders` | GET | resolveVerifiedCaller | verified |
| `/api/admin/people` | GET | requireStaff | verified |
| `/api/admin/people/delete` | POST | requireStaffCaller | verified |
| `/api/admin/perks` | GET,POST | requireSession, sendPushLocalized | verified |
| `/api/admin/perks/[id]` | DELETE,PATCH | requireSession | verified |
| `/api/admin/perks/image` | POST | requireSession | verified |
| `/api/admin/photos-status` | GET | resolveVerifiedCaller | verified |
| `/api/admin/podium` | GET,POST | requireStaffCaller, sendOpenPush | verified |
| `/api/admin/podium/csv` | GET | requireStaffCaller | verified |
| `/api/admin/podium/orders/[id]` | DELETE,PATCH | requireStaffCaller, tellDelivered, tellRunner | verified |
| `/api/admin/podium/products` | POST | requireStaffCaller | verified |
| `/api/admin/podium/receive` | GET,POST | requireStaffCaller | verified |
| `/api/admin/publish/message` | POST | publishGate, sendPushLocalized | verified |
| `/api/admin/push-health` | GET | resolveVerifiedCaller | verified |
| `/api/admin/registrations` | GET | requireSession | verified |
| `/api/admin/registrations/approve` | POST | notifyAthlete, requireSession | verified |
| `/api/admin/registrations/link` | POST | notifyAthlete, requireSession | verified |
| `/api/admin/registrations/resend` | POST | requireSession | verified |
| `/api/admin/roles` | GET,POST,PUT | notifyAthlete, resolveVerifiedCaller | verified |
| `/api/admin/store/orders` | GET | requireSession | verified |
| `/api/admin/store/orders/[id]` | PATCH | requireSession | verified |
| `/api/admin/store/products` | GET,POST | requireSession | verified |
| `/api/admin/store/products/[id]` | PATCH | requireSession | verified |
| `/api/admin/store/products/image` | POST | requireSession | verified |
| `/api/admin/stories` | GET,PUT | - | verified |
| `/api/admin/stories/person` | DELETE,GET,PATCH | - | verified |
| `/api/admin/stories/testers` | DELETE,POST | requireBirthdayAdmin | verified |
| `/api/admin/stories/upcoming` | GET | - | verified |
| `/api/admin/strava/webhook-subscribe` | DELETE,GET,POST | requireSession | verified |
| `/api/admin/surveys` | GET,POST | createAndSendSurvey, publishGate, requireApprover | verified |
| `/api/admin/tab-permissions` | GET,PUT | requireMember, requireSession | verified |
| `/api/admin/tests` | GET,POST | gate, resolveVerifiedCaller | verified |
| `/api/admin/trainee-data-coverage` | GET | resolveVerifiedCaller | verified |
| `/api/admin/users` | DELETE,GET,PUT | requireStaff, resolveVerifiedCaller | verified |
| `/api/admin/view-as` | GET | requireSession | verified |
| `/api/athletes` | DELETE,GET,POST,PUT | afterPackMove, notifyPackScheduled, requireSession, requireStaff | verified |
| `/api/athletes/[id]/availability` | PUT | notifyStaff, resolveVerifiedCaller, staff | verified |
| `/api/athletes/[id]/connections` | GET | resolveVerifiedCaller | verified |
| `/api/athletes/[id]/pace-at-hr` | GET | requireCallerForAthlete, staff | verified |
| `/api/athletes/[id]/public` | GET | resolveVerifiedCaller | verified |
| `/api/athletes/[id]/records/run/[activityId]` | GET | resolveVerifiedCaller | verified |
| `/api/athletes/[id]/runs` | GET | resolveVerifiedCaller | verified |
| `/api/athletes/[id]/stats` | GET | resolveVerifiedCaller | verified |
| `/api/athletes/activities/manual` | POST | checkShoeAlert, requireCallerForAthlete | verified |
| `/api/athletes/avatar` | POST | requireCallerForAthlete | verified |
| `/api/athletes/badges` | GET | resolveVerifiedCaller | verified |
| `/api/athletes/connect` | POST | resolveVerifiedCaller | verified |
| `/api/athletes/discover` | GET | resolveVerifiedCaller | verified |
| `/api/athletes/favorites` | DELETE,GET,POST | requireAthlete | verified |
| `/api/athletes/follow` | DELETE,POST | notifyAthlete, requireCallerForAthlete | verified |
| `/api/athletes/heatmap` | GET | resolveVerifiedCaller | verified |
| `/api/athletes/me` | GET,PUT | requireCallerForAthlete | verified |
| `/api/athletes/me/new-record` | GET | resolveVerifiedCaller | verified |
| `/api/athletes/notification-prefs` | GET,PATCH,PUT | gate, resolveVerifiedCaller | verified |
| `/api/athletes/prs` | DELETE,GET,PUT | requireCallerForAthlete, resolveVerifiedCaller, staff | verified |
| `/api/athletes/prs/exclusions` | DELETE,POST | requireCallerForAthlete | verified |
| `/api/athletes/races` | GET,PATCH | checkAndAwardBadges, resolveVerifiedCaller, staff | verified |
| `/api/athletes/summary` | GET | resolveVerifiedCaller | verified |
| `/api/athletes/update-group` | POST | resolveVerifiedCaller | verified |
| `/api/athletes/volume-history` | GET | resolveVerifiedCaller | verified |
| `/api/attendance` | GET,POST | resolveVerifiedCaller | verified |
| `/api/attendance/lineup` | GET | resolveVerifiedCaller | verified |
| `/api/attendance/presence` | PUT | requireStaffCaller | verified |
| `/api/attendance/real` | GET | resolveVerifiedCaller | verified |
| `/api/auth/athlete-login` | POST | - | allowlisted |
| `/api/auth/claim-login` | POST | - | allowlisted |
| `/api/auth/claim-member` | POST | requireSession | verified |
| `/api/auth/claim-member/confirm` | POST | - | allowlisted |
| `/api/auth/device-token` | POST | requireSession | verified |
| `/api/auth/email-code` | POST | - | allowlisted |
| `/api/auth/install-key` | POST | requireSession | verified |
| `/api/auth/me` | GET | notifyTraineeJoined, requireSession | verified |
| `/api/auth/resolve-role` | POST | - | verified |
| `/api/auth/sign-out` | POST | - | allowlisted |
| `/api/auth/silent-session` | POST | - | allowlisted |
| `/api/badges` | GET | - | allowlisted |
| `/api/birthday-year` | GET | resolveVerifiedCaller, storyAccess | verified |
| `/api/challenges` | GET | resolveVerifiedCaller | verified |
| `/api/chat/group` | PATCH | requireStaffCaller | verified |
| `/api/client-events` | POST | resolveVerifiedCaller | verified |
| `/api/client-log` | POST | - | allowlisted |
| `/api/club-updates` | GET,POST | clubUpdatesCaller, sendUpdatePush | verified |
| `/api/club-updates/[id]` | DELETE,PATCH | clubUpdatesCaller, mayEdit | verified |
| `/api/club-updates/[id]/react` | POST | clubUpdatesCaller | verified |
| `/api/club-updates/topics` | GET | clubUpdatesCaller | verified |
| `/api/club/champions` | GET | resolveVerifiedCaller | verified |
| `/api/club/records` | GET | resolveVerifiedCaller | verified |
| `/api/club/today` | GET | resolveVerifiedCaller | verified |
| `/api/club/upcoming` | GET | requireMember | verified |
| `/api/coach-space/switch` | GET,PUT | requireSession | verified |
| `/api/coach/athlete/[id]` | GET | requireStaffCaller | verified |
| `/api/coach/lists` | GET,POST | requireStaff, requireStaffCaller | verified |
| `/api/coach/lists/[id]` | DELETE,PUT | requireStaffCaller | verified |
| `/api/coach/message` | POST | notifyAthlete, requireStaffCaller | verified |
| `/api/coach/pulse` | GET | requireStaff | verified |
| `/api/coach/roster` | GET | requireStaff | verified |
| `/api/coach/volume` | GET | requireStaff | verified |
| `/api/config` | GET | - | allowlisted |
| `/api/cron/academy-report` | GET,POST | - | cron |
| `/api/cron/badges` | GET,POST | checkAndAwardBadges | cron |
| `/api/cron/detect` | GET,POST | - | cron |
| `/api/cron/notifications` | GET,POST | notifySurveyNonResponders, sendPushDetailed, sendPushLocalized | cron |
| `/api/cron/partner-orders` | GET,POST | - | cron |
| `/api/cron/photos-mirror` | GET | sendConfirmedAlert | cron |
| `/api/cron/race-live` | GET,POST | - | cron |
| `/api/cron/sync` | GET,POST | runScheduledHistoryBackfill | cron |
| `/api/cron/tick` | GET,POST | afterPackMove, dispatchDueTestReminders, dispatchMorningReminders, dispatchScheduledMoments, gateState, notifyAthlete, notifyStaff, reconcileResolvedReports, runPainFollowups, runPendingReminders, runPodiumPushes, runScheduledPlanPublishes, runSessionPhotoFolders, sendDuePolls, sendEveningWatchReminders, sendMeetupReminders, sendPushLocalized, sendSoonReminders | cron |
| `/api/cron/wellness` | GET,POST | - | cron |
| `/api/cron/workout-watch` | GET,POST | sendPushLocalized | cron |
| `/api/dashboard/stats` | GET | requireStaff | verified |
| `/api/dashboard/weekly` | GET | resolveVerifiedCaller | verified |
| `/api/day-session` | DELETE,GET,PUT | requireSession, sendDaySessionPush | verified |
| `/api/day-session/late` | DELETE,POST | requireStaffCaller, sendLatePush | verified |
| `/api/day-session/remove` | GET,POST | requireSession | verified |
| `/api/day-session/watch` | GET,POST | requireSession, startDaySessionSend, watchStatus | verified |
| `/api/dev/auth-log` | POST | - | allowlisted |
| `/api/dev/run-chat-participants` | GET | requireSession | verified |
| `/api/dev/strava-athletes` | GET | - | allowlisted |
| `/api/dev/test-signin` | POST | requireSession | verified |
| `/api/device/activities` | POST | checkAndAwardBadges, checkAndAwardChallenges, checkShoeAlert, notifyNewRecords, requireDevice | verified |
| `/api/device/deliveries/ack` | POST | notifyAthlete, requireDevice | verified |
| `/api/device/pending-workouts` | GET | requireDevice | verified |
| `/api/device/register` | POST | requireAthlete | verified |
| `/api/device/revoke` | POST | requireAthlete, requireDevice | verified |
| `/api/device/token` | POST | - | allowlisted |
| `/api/events` | GET,POST | optionalCaller, requireSession, sendPushLocalized | verified |
| `/api/events/[id]` | DELETE,GET,PATCH | optionalCaller, requireSession | verified |
| `/api/events/[id]/answers` | GET,PUT | resolveVerifiedCaller, staff | verified |
| `/api/events/[id]/forecast` | GET | - | allowlisted |
| `/api/events/[id]/pace-groups` | GET,POST,PUT | requireStaff | verified |
| `/api/events/[id]/publish` | POST | requireStaff, sendPushLocalized | verified |
| `/api/events/[id]/register` | DELETE,POST | requireAthlete | verified |
| `/api/events/[id]/registrations` | GET | requireSession | verified |
| `/api/events/images` | POST | requireStaff | verified |
| `/api/events/resolve-map-link` | POST | requireSession | verified |
| `/api/features/[feature]/athletes/[id]` | GET | requireStaffCaller | verified |
| `/api/features/[feature]/enablements` | GET,PUT | requireStaffCaller | verified |
| `/api/features/me` | GET | resolveVerifiedCaller | verified |
| `/api/features/public` | GET | - | allowlisted |
| `/api/feed` | GET | requireSession | verified |
| `/api/feed/celebrations` | GET | requireSession | verified |
| `/api/feed/comments` | DELETE,GET,POST | notifyFeedInteraction, notifyMentions, requireAthlete, requireSession | verified |
| `/api/feed/highlight` | GET | requireSession | verified |
| `/api/feed/items/[id]` | GET,PATCH | requireAthlete, requireSession | verified |
| `/api/feed/like` | POST | notifyFeedInteraction, requireAthlete | verified |
| `/api/feed/likes` | GET | requireSession | verified |
| `/api/feed/media` | POST | requireAthlete | verified |
| `/api/feed/pinned` | GET | requireSession | verified |
| `/api/feed/posts` | DELETE,POST | notifyMentions, requireAthlete, requireSession, sendPushLocalized | verified |
| `/api/feed/session-photos` | GET | requireSession | verified |
| `/api/feedback` | DELETE,GET,PATCH,POST,PUT | notifyReportResolved, notifyStaff, requireStaff, resolveVerifiedCaller | verified |
| `/api/feedback-prompts` | GET | resolveVerifiedCaller | verified |
| `/api/feedback-prompts/[activityId]/dismiss` | POST | resolveVerifiedCaller | verified |
| `/api/garmin/activity-details` | GET | resolveVerifiedCaller | verified |
| `/api/garmin/authenticate` | POST | resolveGarminTarget, storeGarminAuth | verified |
| `/api/garmin/push-workouts` | POST | appleCandidates, notifyStaff, pushWeekToAthlete, requireSession | verified |
| `/api/garmin/sso-callback` | GET | - | allowlisted |
| `/api/garmin/sso-callback/app` | GET | - | allowlisted |
| `/api/garmin/sync-activities` | GET,PATCH,POST,PUT | backfillGarminHistory, checkAndAwardBadges, checkAndAwardChallenges, checkShoeAlert, notifyAthlete, notifyMainWorkoutFeedback, notifyNewRecords, notifyTeammatesOfActivity, requireCallerForAthlete, resolveVerifiedCaller | verified |
| `/api/garmin/ticket-auth` | POST | resolveGarminTarget, storeGarminAuth | verified |
| `/api/group-chat` | GET,POST | resolveVerifiedCaller | verified |
| `/api/group-chat/messages` | DELETE,PATCH,POST | cleanClientId, gate, mayDelete, mayEdit, notifyAthlete, resolveVerifiedCaller | verified |
| `/api/groups` | DELETE,GET,POST,PUT | requireSession, requireStaff | verified |
| `/api/groups/leaderboard` | GET | requireMember | verified |
| `/api/groups/standings` | GET | requireMember | verified |
| `/api/join/groups` | GET | - | allowlisted |
| `/api/join/phone-link` | POST | - | allowlisted |
| `/api/maintenance` | GET,PUT | requireSession | verified |
| `/api/me/capabilities` | GET | publishGate, requireSession | verified |
| `/api/me/data-source` | PUT | requireAthlete | verified |
| `/api/me/data-sources` | GET | requireAthlete | verified |
| `/api/me/data-sources/disconnect` | GET,POST | requireAthlete | verified |
| `/api/me/data-sources/garmin/password` | POST | afterGarminConnect, requireAthlete | verified |
| `/api/me/data-sources/garmin/sso` | GET | requireAthlete | verified |
| `/api/me/data-sources/garmin/ticket` | POST | afterGarminConnect, requireAthlete | verified |
| `/api/me/data-sources/strava` | GET | requireAthlete | verified |
| `/api/me/data-sources/sync` | POST | requireAthlete | verified |
| `/api/me/plan-history` | GET | requireAthlete | verified |
| `/api/me/plan-scores` | GET | resolveVerifiedCaller | verified |
| `/api/me/progress-summary` | GET | resolveVerifiedCaller | verified |
| `/api/me/story-prefs` | GET,PUT | resolveVerifiedCaller | verified |
| `/api/me/watch/resend` | POST | requireAthlete, resendOwnDay | verified |
| `/api/moderation/block` | DELETE,GET,POST | resolveVerifiedCaller | verified |
| `/api/moderation/report` | GET,PATCH,POST | notifyStaff, requireStaffCaller, resolveVerifiedCaller | verified |
| `/api/my-watch` | GET,POST | providerFor, pushOwnWeek, requireAthlete | verified |
| `/api/native/auth/refresh` | POST | - | allowlisted |
| `/api/native/storage/program-plans/[folder]/[file]` | GET | - | allowlisted |
| `/api/notifications` | DELETE,GET,POST,PUT | requireApprover, resolveVerifiedCaller, sendPushLocalized | verified |
| `/api/notifications/approvals` | GET,POST,PUT | gate, gateState, requireSession | verified |
| `/api/notifications/inbox` | GET | resolveVerifiedCaller | verified |
| `/api/notifications/seen` | POST | requireSession | verified |
| `/api/notifications/unread` | GET | resolveVerifiedCaller | verified |
| `/api/onboarding` | GET,POST | requireSession | verified |
| `/api/onboarding/event` | POST | requireSession | verified |
| `/api/onboarding/group-change` | POST | notifyStaff, resolveVerifiedCaller | verified |
| `/api/onboarding/notify-email` | GET,POST | announceSignupRequest, gate, requireSession | verified |
| `/api/onboarding/phone-open` | POST | requireSession | verified |
| `/api/onboarding/setup` | POST | resolveVerifiedCaller | verified |
| `/api/pack-stories` | GET | requireSession | verified |
| `/api/packs/[id]/attendance` | GET,POST | requirePackLeader | verified |
| `/api/packs/[id]/attendance/history` | GET | requirePackLeader | verified |
| `/api/packs/[id]/home` | GET | requirePackLeader | verified |
| `/api/packs/[id]/moments/[mid]/send` | POST | requirePackLeader | verified |
| `/api/packs/[id]/week-summary` | GET | requireStaff | verified |
| `/api/packs/mine` | GET | resolveVerifiedCaller | verified |
| `/api/pain-reports` | GET,POST | notifyStaff, resolveVerifiedCaller, sendPainAlert | verified |
| `/api/pain-reports/[id]` | GET,PATCH | - | verified |
| `/api/pain-reports/[id]/checkin` | POST | - | verified |
| `/api/pain-reports/[id]/close` | POST | - | verified |
| `/api/pain-reports/[id]/reply` | POST | notifyAthlete | verified |
| `/api/pain-reports/recipients` | GET | resolveVerifiedCaller | verified |
| `/api/parse-workout` | POST | requireSession | verified |
| `/api/perks` | GET | resolveVerifiedCaller | verified |
| `/api/perks/core` | GET | resolveVerifiedCaller | verified |
| `/api/photos` | GET | verifyRequest | verified |
| `/api/photos/browse` | GET | resolveVerifiedCaller | verified |
| `/api/photos/browse/folder` | GET | requireMember | verified |
| `/api/photos/browse/img` | GET | - | allowlisted |
| `/api/photos/browse/video` | GET | - | allowlisted |
| `/api/photos/clusters` | POST | verifyRequest | verified |
| `/api/photos/drive-dates` | GET | verifyRequest | verified |
| `/api/photos/enroll-selfie` | POST | sendPushToSubscriptions, verifyRequest | verified |
| `/api/photos/folder-meta` | PATCH | requireSession | verified |
| `/api/photos/import` | POST | verifyRequest | verified |
| `/api/photos/label` | DELETE,POST | verifyRequest | verified |
| `/api/photos/likes` | DELETE,GET,POST | tagsGate | verified |
| `/api/photos/likes/mine` | GET | tagsGate | verified |
| `/api/photos/notify-import` | POST | sendPushToSubscriptions, verifyRequest | verified |
| `/api/photos/process` | POST | verifyRequest | verified |
| `/api/photos/selfie-url` | GET | verifyRequest | verified |
| `/api/photos/session` | GET | resolveVerifiedCaller | verified |
| `/api/photos/tags` | DELETE,GET,POST | tagsGate | verified |
| `/api/photos/tags/approve` | POST | tagsGate | verified |
| `/api/photos/tags/mine` | GET | tagsGate | verified |
| `/api/photos/video-timing` | POST | requireMember | verified |
| `/api/ping` | GET | - | allowlisted |
| `/api/plan-builder/config` | GET | staff | verified |
| `/api/plan-builder/parse-jobs` | POST | runParseJob, staff | verified |
| `/api/plan-builder/parse-jobs/[id]` | DELETE,GET | staff | verified |
| `/api/plan-builder/weeks/[week]` | GET,PUT | gate | verified |
| `/api/plan-builder/weeks/[week]/copy-last` | POST | gate | verified |
| `/api/plan-builder/weeks/[week]/lock` | DELETE,POST | gate | verified |
| `/api/plan-builder/weeks/[week]/publish` | POST | gate, publishVersion | verified |
| `/api/plan-builder/weeks/[week]/push` | GET,POST | gate, retryPush | verified |
| `/api/plan-builder/weeks/[week]/release-request` | POST | gate, requestRelease | verified |
| `/api/plan-builder/weeks/[week]/unpublish` | POST | gate | verified |
| `/api/plan-execution` | GET | resolveVerifiedCaller, staff | verified |
| `/api/plans` | DELETE,GET,POST,PUT | requireSession, tellWeekAdmins | verified |
| `/api/plans/[planId]/clipboards` | POST | requireSession | verified |
| `/api/plans/[planId]/matches` | GET,PUT | requireSession | verified |
| `/api/plans/[planId]/sent-days` | GET | requireSession | verified |
| `/api/plans/history` | GET | requireStaff | verified |
| `/api/plans/import-program` | POST | requireSession | verified |
| `/api/plans/nutrition` | DELETE,GET,POST | requireSession, requireStaff | verified |
| `/api/plans/reimport` | POST | requireSession | verified |
| `/api/plans/story` | GET | resolveVerifiedCaller | verified |
| `/api/plans/sync-from-program` | POST | requireSession | verified |
| `/api/plans/training` | DELETE,GET,POST | requireSession, requireStaff | verified |
| `/api/plans/verify` | GET | requireSession | verified |
| `/api/plans/watch-status` | GET | planWatchStatus, requireSession | verified |
| `/api/plans/week` | GET | requireTraineeAccess, resolveVerifiedCaller | verified |
| `/api/plans/weeks` | GET | requireMember | verified |
| `/api/podium` | GET,PUT | gate, resolveVerifiedCaller, tellRunner | verified |
| `/api/practice-videos` | GET,PUT | requireApprover | verified |
| `/api/program-weeks` | GET,POST | requireSession | verified |
| `/api/public/current-plan` | GET | - | allowlisted |
| `/api/public/groups` | GET | - | allowlisted |
| `/api/public/manifest` | GET | - | allowlisted |
| `/api/public/qr` | GET | - | allowlisted |
| `/api/public/signup` | POST | notifyStaff | allowlisted |
| `/api/public/signup/status` | POST | - | allowlisted |
| `/api/public/stats` | GET | - | allowlisted |
| `/api/push/health` | GET | requireCallerForAthlete | verified |
| `/api/push/receipt` | POST | - | allowlisted |
| `/api/push/subscribe` | POST | requireCallerForAthlete | verified |
| `/api/push/test` | POST | requireCallerForAthlete, sendPushLocalized | verified |
| `/api/push/unsubscribe` | POST | resolveVerifiedCaller | verified |
| `/api/quality-session` | GET,POST,PUT | notifyAthlete, requireSession | verified |
| `/api/quality-session/days` | GET | requireSession | verified |
| `/api/quality-session/photos` | DELETE,GET,POST | gate, publishSessionPhotos, requireSession | verified |
| `/api/quality-session/photos/approve` | POST | approveSessionPhotos, requireContentLevel | verified |
| `/api/quality-session/photos/import` | POST | requireSession | verified |
| `/api/quality-session/photos/status` | GET,PATCH | requireContentLevel | verified |
| `/api/quality-session/plan-days` | GET,PUT | requireSession | verified |
| `/api/race-live/[eventId]` | GET | resolveVerifiedCaller | verified |
| `/api/race-live/[eventId]/config` | GET,PUT | resolveVerifiedCaller | verified |
| `/api/race-live/[eventId]/entries` | PUT | resolveVerifiedCaller | verified |
| `/api/race-live/[eventId]/livetrack-test` | POST | resolveVerifiedCaller | verified |
| `/api/race-live/[eventId]/manual` | POST | requireStaffCaller | verified |
| `/api/race-live/[eventId]/map` | PUT | resolveVerifiedCaller | verified |
| `/api/race-live/[eventId]/position` | DELETE,POST | resolveVerifiedCaller | verified |
| `/api/race-live/[eventId]/results` | GET | resolveVerifiedCaller | verified |
| `/api/records/champions` | GET | recordsGate | verified |
| `/api/records/privacy` | PATCH | resolveVerifiedCaller | verified |
| `/api/records/progress` | GET | recordsGate | verified |
| `/api/records/weekly` | GET | recordsGate | verified |
| `/api/release/approved` | GET | - | allowlisted |
| `/api/reminder-config` | GET,PUT | requireApprover | verified |
| `/api/run-chat` | DELETE,POST | requireSession | verified |
| `/api/run-chat/[chatId]/ai` | POST | requireSession | verified |
| `/api/run-chat/[chatId]/plan` | POST | requireSession | verified |
| `/api/run-chat/laps` | GET | requireSession | verified |
| `/api/run-chat/token` | POST | requireSession | verified |
| `/api/runs/meetups` | DELETE,GET,POST | cancelRun, notifyAthlete, requireAthlete, requireMember | verified |
| `/api/runs/meetups/[id]` | GET,PATCH,POST | cancelRun, notifyAthlete, requireAthlete, requireMember | verified |
| `/api/runs/meetups/[id]/wa` | GET | requireAthlete | verified |
| `/api/runs/meetups/group-runs` | GET | requireAthlete, requireMember | verified |
| `/api/runs/meetups/hide` | POST | requireAthlete | verified |
| `/api/runs/meetups/pin-check` | POST | requireAthlete | verified |
| `/api/runs/meetups/requests` | DELETE,PATCH,POST | notifyAthlete, requireAthlete | verified |
| `/api/search` | GET | resolveVerifiedCaller | verified |
| `/api/setup` | GET,PATCH | resolveVerifiedCaller | verified |
| `/api/shoes` | DELETE,GET,PATCH,POST | checkShoeAlert, requireCallerForAthlete | verified |
| `/api/social/folders` | GET,PATCH,POST | createFolderNow, gate, requireSession | verified |
| `/api/staff/attention` | GET | resolveVerifiedCaller | verified |
| `/api/store/orders` | GET,POST | notifyStaff, requireCallerForAthlete | verified |
| `/api/store/products` | GET | - | allowlisted |
| `/api/stories/annual` | GET | resolveVerifiedCaller, storyAccess | verified |
| `/api/stories/birthday` | GET | resolveVerifiedCaller | verified |
| `/api/stories/mark` | POST | resolveVerifiedCaller | verified |
| `/api/stories/weekly` | GET | resolveVerifiedCaller | verified |
| `/api/strava` | GET | requireCallerForAthlete | verified |
| `/api/strava/account-check` | GET | requireCallerForAthlete | verified |
| `/api/strava/callback` | GET | queuePendingStravaSignup | verified |
| `/api/strava/disconnect` | POST | requireCallerForAthlete | verified |
| `/api/strava/sync-activities` | PATCH,POST | checkAndAwardBadges, checkAndAwardChallenges, checkShoeAlert, notifyMainWorkoutFeedback, notifyNewRecords, notifyTeammatesOfActivity, requireCallerForAthlete, resolveVerifiedCaller | verified |
| `/api/strava/webhook` | GET,POST | - | verified |
| `/api/surveys/[id]` | GET | resolveVerifiedCaller | verified |
| `/api/surveys/[id]/respond` | POST | resolveVerifiedCaller | verified |
| `/api/surveys/open` | GET | resolveVerifiedCaller | verified |
| `/api/tours` | GET,POST | requireAthlete | verified |
| `/api/tours/switch` | GET,PUT | requireSession | verified |
| `/api/u21/register` | POST | - | allowlisted |
| `/api/u21/registrations` | GET | resolveVerifiedCaller | verified |
| `/api/version` | GET | - | allowlisted |
| `/api/watch/changes` | GET | requireContentStaff | verified |
| `/api/weather/at` | GET | requireMember | verified |
| `/api/webhooks/resend` | POST | - | verified |
| `/api/week-setup` | GET | loadWeek, requireStaffCaller | verified |
| `/api/week-setup/done` | POST | requireStaffCaller, tellWeekAdmins | verified |
| `/api/week-setup/override` | PUT | requireStaffCaller | verified |
| `/api/week-setup/owners` | PUT | requireStaffCaller | verified |
| `/api/week-setup/polls` | DELETE,POST | gate, publishPoll, requireStaffCaller | verified |
| `/api/week-setup/skip` | POST | requireStaffCaller | verified |
| `/api/week-setup/watches` | GET | requireStaffCaller | verified |
| `/api/week-story` | GET,PATCH | resolveVerifiedCaller | verified |
| `/api/wellness` | GET | requireSession | verified |
| `/api/whats-new` | DELETE,GET,PATCH,POST | requireStaffCaller, resolveVerifiedCaller | verified |
| `/api/workout-feedback` | GET,POST | notifyAthlete, notifyStaff, requireCallerForAthlete, requireStaffCaller | verified |
| `/api/workout-feedback/[id]` | DELETE | resolveVerifiedCaller | verified |
| `/api/workout-feedback/[id]/messages` | GET,POST | notifyAthlete, resolveVerifiedCaller | verified |
| `/api/workout-feedback/handled` | POST | resolveVerifiedCaller | verified |
| `/api/workout-feedback/reply` | PATCH,POST | notifyAthlete, resolveVerifiedCaller | verified |
