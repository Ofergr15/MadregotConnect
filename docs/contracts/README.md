# Native contract bundle

Each note is backed by tests that run the real route handlers against a fake database
(only auth and the database are faked). If a route's shape changes, its test fails.

| Surface | Note | Tests |
|---|---|---|
| U21 questionnaire submit + admin list | `u21-register.md` | `u21RegisterContract.test.ts`, `trackAReadContract.test.ts` |
| U21 field list (what `answers` must hold) | `u21-fields.md` | `u21FieldSpecContract.test.ts` |
| Academy form: submit, prefill, open/closed check | `academy-register.md` | `academyRegisterContract.test.ts`, `trackAReadContract.test.ts` |
| Valencia tab: events, forecast, course map, updates by event, surveys | `valencia.md` | `valenciaContract`, `eventForecast`, `clubUpdatesTopics`, `eventCourseGpx` |
| Sign-in, session, refresh | `auth-session.md` | `devAllowlistE2E`, `syntheticSessionFailClosed` |
| Outbound egress map (mail, push, APNs, staff, Garmin, AI) | `egress-map.md` | — |
| Proposal: default-deny outbound outside production | `outbound-policy.md` | `outboundPolicy` |
| Logging redaction audit (auth, registration) | `logging-redaction.md` | — |
| Test-account isolation by surface | `test-account-isolation.md` | `testAccountReadPaths`, `testAccountIsolation`, `testActorNotifications` |
| Cache-key privacy audit | `cache-privacy.md` | — |
| Auth errors: definitive vs transient | `auth-errors.md` | `authErrorContract` |
| Inbox and unread count | `inbox.md` | `inboxContract` |
| Today screen (weekly dashboard) | `today.md` | `weeklyDashboardContract` |
| Weekly plan (drafts never reach a runner) | `weekly-plan.md` | `weeklyPlanContract` |
| Feed, likes | `feed.md` | `feedContract` |
| Run details (GPS, splits, owner-only HR trace) | `run-details.md` | `activityDetailsContract` |
| Apple Watch device API (`/api/device/*`) | `watch-device.md` | `deviceApiContract` |
| Abuse controls on public routes (u21 register, email-code) | `public-route-abuse.md` | `u21RegisterConcurrency`, `emailCodeMembershipOracle`, `emailCodeVerifyRace` |
| Staff write permissions by role | `staff-write-authz.md` | `staffWriteAuthz` |

## Not built on the server (no contract possible yet)

- **U21 registration status** for the applicant: nothing returns "where is my submission".
  The submit answers `pending_review` and that is all.
- **U21 profile**: no route.
- **Gateway entry**: `/u21?track=<id>` is a web link (`src/lib/u21/entry.ts`), not an API.
  The native gateway needs no server call; preselect a track with the ids above.

Each of these needs a product decision before it can be built.
