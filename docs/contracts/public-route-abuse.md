# Abuse controls on public routes

Two routes take unauthenticated POSTs from the open internet: the U21 questionnaire submit and
the email sign-in code. This note lists what stops abuse on each today, what does not, and what is
proposed. No CAPTCHA vendor, no new external service, no new table — by decision (item 9).

Tests: `u21RegisterConcurrency.test.ts`, `u21RegisterContract.test.ts`, `u21RegisterRoute.test.ts`,
`emailCodeMembershipOracle.test.ts`, `emailCodeVerifyRace.test.ts`, `emailCodeWhoOracle.test.ts`.

## POST /api/u21/register

| # | Control | Scope | Where | Answer |
|---|---|---|---|---|
| 1 | Env guard: only the approved dev Supabase project | global | `lib/u21/env-guard.ts`, first line of the route | 503 |
| 2 | 10 requests / minute / IP | **per instance**, in memory | `createRateLimiter` (`lib/academy/intake.ts`) | 429 |
| 3 | Honeypot (`website` filled) | per request | `isBotSubmit` | same 200, nothing stored |
| 4 | Validation (age 16–21, guardian for 16–17, known fields only) | per request | `lib/u21/intake.ts` | 400 |
| 5 | Same email + track within 10 min = same submit | DB, cross-instance, sliding window | `recentSubmits` (`lib/u21/register-guard.ts`) | same 200, nothing stored |
| 6 | Same email + track in flight on this instance runs one at a time | **per instance** | `serializeByKey` | (makes #5 see the first row) |
| 7 | Unique `dedupe_key` (email \| track \| 10-min bucket) | DB, cross-instance, atomic | migration **183 — written, NOT applied** | 23505 on that index → same 200 |
| 8 | ≤ 3 stored submits per email per hour (any track) | DB, cross-instance | `recentSubmits`, `U21_MAX_PER_EMAIL_PER_HOUR` | same 200, nothing stored |
| 9 | DB/exception text never returned | — | route | 500 `Could not save` / `Server error` |

**The race (fixed).** #5 alone is read-then-insert: two identical submits arriving together both
read "nothing recent" and both insert (pinned by the first test in `u21RegisterConcurrency`).
On one instance #6 now serializes them. Across instances only #7 closes it, and only once 183 is
pasted. Until then the route detects the missing column (PGRST204/42703 naming `dedupe_key`)
and inserts without it, exactly as before — so the cross-instance race remains open pre-183.
Only a 23505 that names `dedupe_key` is treated as a duplicate; any other unique violation stays a 500.

**Why 183 is a new nullable column, not a unique index on existing columns:** a bucket of
`created_at` is not IMMUTABLE (cannot be indexed), and `CREATE UNIQUE INDEX` fails outright if
existing rows already collide — which the race may have produced. Existing rows have
`dedupe_key = NULL`, NULLs never collide, so the partial index builds on any data. Residual: a
bucket boundary can split two simultaneous submits (both land); outside a race #5 catches it.

### Gaps
- **No cross-instance per-IP cap.** The table has no IP column; adding one means storing the IP
  of minors, which is more personal data for a modest gain. #2 is per instance only, so N
  instances allow ~10·N/min per IP.
- **The per-email cap is per typed address**, not per person: a script rotating addresses gets
  10/min/IP/instance rows. Honeypot only stops naive bots.
- #8 is read-then-insert as well: a burst of concurrent submits for one email on *different
  tracks* can exceed 3 by the number in flight (same-track ones are stopped by #6/#7).
- Timing: a deduped/capped submit skips the insert, so it answers one round-trip faster. It
  reveals only "this address submitted recently", which the submitter typed themselves.

### Proposals (not built)
- If abuse appears: an `ip_hash` column (HMAC of IP with a server key, not the raw IP) with a
  DB count, deleted with the row under the retention rule below.
- Lock the client's send button after the first tap (already in `u21-register.md`).

## POST /api/auth/email-code (`send`, `verify`, `who`)

| # | Control | Scope | Where | Answer |
|---|---|---|---|---|
| 1 | 40 / minute / IP; 5 / minute per action+IP+email | **per instance**, in memory, before membership is looked at | route | 429 `too-many` (identical for member/stranger) |
| 2 | `send` answers `{ok:true}` before anything reads the address; all work in `after()` | — | route | 200 always |
| 3 | ≤ `MAX_SENDS` (3) codes per address per 15 min | DB, cross-instance | `sendCodeIfMember` | silent (no code, no mail) |
| 4 | **Post-insert recount**: if the window now holds more than the cap, withdraw this row, send no mail | DB, cross-instance | `sendCodeIfMember` (new) | silent |
| 5 | ≤ `MAX_ATTEMPTS` (5) guesses per code, claimed by compare-and-set before comparing | DB, atomic | `verify` | 401 `wrong-code` |
| 6 | No-code / expired / used-up / wrong all answer the same 401 with the same work shape | — | `verify` | 401 `wrong-code` |
| 7 | `who` only for a join-link token; unknown token and non-member identical | — | route | 404 `unknown-link` |
| 8 | Code stored only as HMAC bound to the address; 10-minute TTL; one use | — | `lib/auth/email-code.ts` | — |

**Send cap under concurrency (fixed).** #3 is count-then-insert: six concurrent sends for one
member (different instances/IPs, so #1 never bites) all read 0 and all mailed. #4 recounts after
its own insert and, if over the cap, deletes its own row (by `code_hash`) and mails nothing. Under
a race every racer may withdraw — fail-closed: fewer mails than the cap, never more. Pinned by
`concurrent sends … never mail past MAX_SENDS` in `emailCodeMembershipOracle.test.ts` (fails
without the recount). The recount runs only for a member, but inside `after()`, so nothing about
it reaches the response; the oracle test pins the shared read shape before it.

**Verify cap under concurrency.** Already covered: `emailCodeVerifyRace.test.ts` fires parallel
guesses at a fake DB whose UPDATE applies only when filters match current values; the CAS allows
exactly `MAX_ATTEMPTS` comparisons.

**Enumeration.** `send`: same status, body and time for any address (response precedes all reads;
`emailCodeMembershipOracle` checks status/body equality and that the response waits on no DB read).
`verify`: one 401 body for every failure, and the no-code path performs the same select + CAS +
HMAC as a live code. `who`: refused for a bare address. 429 is applied before membership. The
remaining distinguishable answers are format-only (`invalid-email` 400, `bad-code` 400) and an
unknown join token (404) — the token is itself the credential.

### Gaps
- #1 is per instance; the only cross-instance brakes are #3–#5 (per address). A distributed
  guesser across many addresses is limited by #5 per code, i.e. 5 guesses per 10^6 per code.
- A mail-bomb across many *different* member addresses is limited only by #1 per instance.
- The withdrawal in #4 can, under a burst, leave a member with no code from that burst; the next
  send outside the race works normally.

### Proposals (not built)
- A DB-backed per-IP counter would need a table (out of scope); revisit only if logs show
  distributed abuse.

## u21_registrations — what it holds, who reads it, retention

**Stored per submit (migration 180):** name, email, phone, birth date + age band, framework,
track; for 16–17-year-olds the **guardian's name and phone** and a consent flag; four
**health red-flag booleans** (chest pain, fainting, bone pain, acute injury) + `red_flag`; the full
questionnaire as `intake` jsonb (injuries, sleep, training history — free text included); status;
timestamps; from 183, `dedupe_key` (contains the email). Applicants are **minors (16–17)** and
young adults; the flags are health data.

**Who can read it:** only the service role. RLS is on with no policies, so anon/authenticated keys
read nothing. The one read route, `GET /api/u21/registrations`, is admin/super-user only and returns
list columns only (`id, first_name, last_name, age_band, track, red_flag, status, created_at`) —
no contact, guardian, birth date or intake. Anyone with Supabase dashboard or service-role access
sees everything.

**Retention: none.** No job, cron, or route deletes or anonymises rows; declined and stale
registrations stay forever, and so do duplicates stopped by nothing.

**Proposed rule (doc only, needs product/legal sign-off):**
- `declined`, and `pending_review` untouched for 90 days → delete the row.
- `accepted` → once linked to a member record, delete the intake copy here within 30 days (the
  member record becomes the system of record); keep at most the status and dates.
- `reviewed` with no decision for 180 days → delete.
- Implement as a daily step in the existing `cron/tick` (no new service), logging counts only,
  never names. Deletion on request (applicant or guardian) by an admin action, same gate as the list.
