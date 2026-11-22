# Schema dependencies of the native/candidate paths

Migrations are pasted by hand; nothing in the repo records which are applied. Sources: "dev" from the native
dev session's report (2026-11-20 12:53); "prod" columns show only whether the file exists on the production commit
`462b4a11` (existing in git ≠ applied in the production database, which I can't read).

| Migration | Used by | Behaviour when missing | Dev (`rtcgkles…`) | In git on prod `462b4a11` |
|---|---|---|---|---|
| 132 `login_codes` | `POST /api/auth/email-code` | send silently mails nothing (`[email-code] login_codes missing`), so sign-in can't work | **applied** (reported) | yes |
| 138 `watch_devices` (`athlete_devices`, `device_tokens`) | `/api/device/*`, APNs tokens | device routes 404 `watch-not-enabled`; native push has no tokens | unknown | yes |
| 154 `club_updates` (+ topics) | `/api/club-updates*` (Valencia) | `missing: true`, empty lists, 200 | unknown | yes |
| 171 `push_deliveries` | delivery log for web push + APNs | logging only; sends still work | unknown | yes |
| 178 `form_mail_claimed_at` | academy register mail dedupe | falls back to the email-log check (best effort) | unknown | yes |
| 180 `u21_registrations` | `POST /api/u21/register`, admin list | insert fails → 500; admin list `ready:false` | **applied** (reported) | **no** (branch only) |
| 181 `events.course_gpx_url` | event course map (V11) | POST without the field works; PATCH with it → 503 naming 181 | not applied | no |
| 182 `athletes.is_test_account` | test-account isolation everywhere | **fails open**: nobody is treated as a test account | not applied | no |
| 183 `u21_registrations.dedupe_key` | cross-instance U21 dedupe | insert retried without the key; only the in-instance dedupe holds | not applied | no |

**Candidate minimum** (sign-in + Today + feed + run details + U21 submit): 132 and 180 in the target database.
Isolation of a synthetic test account additionally needs 182. 181 and 183 are optional hardening.
Applying any migration needs explicit approval.
