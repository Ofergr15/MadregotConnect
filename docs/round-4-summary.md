# Round 4 summary (tasks 76–115)

Unattended run, 2026-11-27/28. The first session died at ~06:24 IST mid-queue; the remaining
tasks were resumed by several sessions. Every task is a separate `claude/r4-<n>-*` branch with
an open PR against `main` — nothing was merged, nothing touched `ios/` or production.

**This file is partial:** it lists the round-4 PRs that existed when it was written. The
coordinator completes it (later PRs, skipped tasks, failures) before merge.

## PRs

| Task | PR | What |
|---|---|---|
| 76 | #207 | docs(security): CLAUDE.md security posture from the route-auth inventory |
| 77 | #208 | feat(auth): admin login by JWT + role; shared password behind ADMIN_PASSWORD_LOGIN, default off |
| 78 | #213 | feat(security): rate + size limits on push/receipt and client-log; client-log caller from a verified bearer only |
| 79 | #215 | fix(email-center): budget-cut bulk send stays unsent and resumes with only who was missed |
| 80 | #216 | docs(storage): every storage path runs on the service role — 223 is web-safe; ratchet test |
| 81 | #217 | feat(club-numbers): activity week (Mon–Sun) behind club_numbers_activity_week, default off |
| 82 | #218 | feat(race-live): GPS finish detection + results freeze after the race window |
| 83 | #219 | feat(push): url → native target map, one source, attached by the payload builder + GET /api/push/targets |
| 84 | #228 | feat(store): order status transition rules + reason on the audit row, migration 250 |
| 87 | #232 | feat(chat): unread per group in one Stream query + idempotent mark-read |
| 92 | #225 | feat(events): RSVP reminder data for staff — who hasn't answered, dry run, default off |
| 94 | #230 | feat(garmin): back off on a refused credential + reconnect state for the member |
| 96 | #209 | feat(reliability): timeouts + typed OutboundTimeoutError on Garmin, Strava, Anthropic, Resend, web push |
| 97 | #211 | feat(health): GET /api/health — DB reachability + last cron/sync ages, uptime-check doc |
| 98 | #212 | docs(backups): read-only table exports + quarterly restore drill |
| 99 | #214 | perf(feed): one day_sessions read per page, one strength read, satellites in the batch |
| 100 | #222 | perf(volume): per-(athlete, week) cache keyed on a trigger-bumped change stamp, behind WEEKLY_VOLUME_CACHE |
| 101 | #223 | perf(profile): precomputed all-time/year/month totals refreshed on sync, behind PROFILE_STAT_ROLLUPS |
| 103 | #224 | refactor(types): remove any from 6 api routes + ratchet on src/app/api |
| 104 | #226 | refactor(dates): api day math through utils helpers + Israel-day fix in 2 routes |
| 105 | #229 | refactor(pace): one m:ss formatter + strict parser in src/lib/pace |
| 107 | #227 | feat(api): zod body validation on 20 hot handlers; bad input → 400 |
| 108 | #231 | fix(api): every 4xx/5xx body carries error; 87 raw .message 500s → internalErrorBody; shape ratchet |
| 110 | #233 | scripts/seed-dev.mts — deterministic fake club for the dev project, refuses production |
| 113 | #220 | docs: architecture.md — request flow, auth gates, sync pipeline, grading engines, flags |
| 114 | #221 | docs: runbook.md — Garmin, Strava rate limits, cron failures, missing migrations, email bounces |
| 115 | this PR | bug hunt in src/lib: challenges use the Israel day; Garmin/Apple workout dates via planDayKey (DST-safe) |

## Not yet covered when this was written

85, 86, 88, 89, 90, 91, 93, 95, 102, 106, 109, 111, 112 — no round-4 PR yet. Some overlap
round-3 PRs still open (e.g. #180 features catalog ↔ 85, #191 your-week push ↔ 86, #203 perf
budget ↔ 102, #206 axe checks ↔ 111, #194 he glossary ↔ 112); the coordinator decides whether
those count or were skipped.

## Failures and environment notes

- Node 22 / nvm is not installed on the machine, so the resumed tasks ran `npm run check` on
  Node 26 with `NODE_OPTIONS="--max-old-space-size=8192 --no-experimental-webstorage"`:
  `tsc --noEmit` needs ~4.6 GB on `main` (OOMs at Node's default heap), and Node 26's built-in
  `localStorage` shadows jsdom's in `coverageSweepPure.test.ts`. Neither is caused by a PR.
- Under load, a few route tests hit the 5 s vitest timeout on cold imports
  (`nativeSupabaseProxy`, `academyCoachToolsServer`); they pass alone. Task 109 (test speed)
  is the place to fix this.
- `gh` defaults to the work account here; PRs were opened with the personal account's token.

## Owner questions

Each PR body carries its question and the safe default it shipped; the same text is appended to
`docs/night-questions.md` on that PR's branch. Collect them from there when merging.
