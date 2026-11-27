# Night queue 27.11 — summary (tasks 62–75, second agent)

Every PR below is open, unmerged, branched from `origin/main`. Nothing was pushed to `main`/`production`, no migration was run, no email/push sent, no production API called.

| Task | PR | One line |
|---|---|---|
| 62 | #179 | `GET/POST /api/admin/signup-queue`: reject with reason code + note, 10-min undo; migration **240** (file only) |
| 63 | #180 | `GET /api/features/catalog`: every flag + Hebrew description (added to FEATURES) + enabled scopes, staff-only |
| 64 | #187 | PII-free JSON logger, `x-request-id` on every `/api` request, cron/tick error summary |
| 65 | #184 | 40 swallowed server errors now logged via `noteSwallowed`; plan-push retry reports failures |
| 66 | #185 | Read-only integrity checks (orphans, Garmin/Strava twins, impossible plan/activity dates) + script + docs |
| 67 | #203 | Response-size budget test for 10 GET routes on a seeded club (fails CI above +25%) |
| 68 | PR_68 | axe-core Playwright checks for 10 pages on a placeholder-env build |
| 69 | #192 | English wording pass (16 strings) |
| 70 | #194 | `docs/he-glossary.md` + 41 he.json strings aligned |
| 71 | #188, #190 | Dead code: 35 unreferenced exports in lib, then unused components |
| 72 | PR_72 | `any` removed from 4 hot lib files (step 1 of many) |
| 73 | #196 | DB types vs migrations drift test; enum names fixed; migration **241** records `athlete_status 'removed'` |
| 74 | #199 | Security headers: framing/referrer/permissions enforced, full CSP report-only |
| 75 | this PR | This summary + bug hunt: 6 API bugs fixed with tests |

The other agent's PRs (tasks 48–55 at time of writing): #178, #181, #182, #183, #186, #189, #191, #193.

## Owner must do
- Paste migrations **240** (#179) and **241** (#73's PR, on its own) when merging; the other queue used 230 — re-check numbering.
- #74: check the console for CSP report-only violations, then flip `CSP_REPORT_ONLY`.

## Open questions (details + safe defaults in each PR body)
- #179 approvals are not undoable; window 10 min.
- #180 catalogue staff-only.
- #184 push-prefs read failure stays fail-open.
- #75 should academy coaches only see their own trainees' feedback threads? (unchanged tonight)
- #192/#194 button case, pack vs group, brand-name script, קבוצה meaning a pace group.

## Flakes
`nativeSupabaseProxy.test.ts` times out at 5 s under parallel load; passes alone.
