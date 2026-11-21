# Test-account isolation — contract

A test account (`athletes.is_test_account = true`, migration 182 — written, **not
applied**) is a synthetic QA athlete. Rule, on every surface:

- its content is **hidden from other non-staff members** (a per-item read answers 404,
  exactly like a missing item or a pending runner);
- it stays **visible to itself and to staff**;
- **fail open**: a missing column or any read error hides nobody (today's behaviour).

Helpers, `src/lib/athletes/test-accounts.ts`: `testAccountIds`, `isTestAccount`,
`hiddenTestAccountsFor(testIds, viewer)` (lists/aggregates) and
`hiddenFromCaller(db, caller, targetId)` (single-athlete reads; also folds in the pending
-runner rule of #77, so the two can't drift).

Tests: `src/__tests__/testAccountIsolation.test.ts` (feed, notifications) and
`src/__tests__/testAccountReadPaths.test.ts` (everything below; "RP" = that file).

## Per-surface table

| Surface | Route / file:line | Filtered | Rule | Test |
|---|---|---|---|---|
| Club feed | `api/feed/route.ts:147` | yes | hidden authors join the pending set; filtered after the slice, so `nextCursor` walks the raw order (an emptied page still returns a cursor) | testAccountIsolation › feed filtering; testAccountGaps › feed paging |
| Feed likes/comments (card preview + counts) | `lib/feed/context.ts`, `lib/feed/project.ts` (`likeCount`/`commentCount`) | yes | test account's likes/comments dropped for other non-staff; counts = stored total − hidden rows | testAccountGaps › likes and comments |
| Like list / comment thread | `api/feed/likes`, `api/feed/comments` (GET + POST/DELETE `commentCount`), `api/feed/like` (`likeCount`, preview) | yes | same, via `lib/feed/test-account-filter.ts` | testAccountGaps › full lists |
| Single feed item | `api/feed/items/[id]/route.ts:57` | yes | 404 via `hiddenFromCaller` | RP › routes apply the gate; hiddenFromCaller member/self/staff |
| Feed highlight | `api/feed/highlight/route.ts:88` | n/a | caller's own runs only (`auth.user.athleteId`) | — |
| Run detail | `api/activities/details/route.ts:108` | yes | 404, mirrors pending path | RP |
| Run stream / analysis | `api/activities/stream/route.ts:48`, `analysis/route.ts:82` | yes | 404 | RP |
| Segments / verdict (by activity) | `api/academy/segments/route.ts:103` | yes | 404 on `?activityId` path | RP › segments |
| Profile header | `api/athletes/[id]/public/route.ts:45` | yes | 404 | RP › public profile |
| Profile runs / stats / record run | `api/athletes/[id]/runs/route.ts:35`, `stats/route.ts:90`, `records/run/[activityId]/route.ts:44` | yes | 404 | RP |
| Profile badges | `api/athletes/badges/route.ts:51` | yes | 404 | RP |
| Followers/following | `api/athletes/[id]/connections/route.ts:42` | yes | 404 on target; dropped from lists | RP |
| Member discover | `api/athletes/discover/route.ts:68` | yes | dropped from roster | RP |
| Roster `GET /api/athletes` | `api/athletes/route.ts:76` | yes (non-staff) | staff unchanged | RP |
| Search: people + pack | `api/search/route.ts:40,101` | yes | dropped | RP |
| Search: runs | `lib/search/runs.ts:51` | yes | joins pending set | RP |
| Group standings / leaderboard | `api/groups/standings`, `api/groups/leaderboard` | yes (pre-existing, b2a2ebb1) | — | — |
| Club today (top-7, pack rank) | `api/club/today/route.ts:50` | yes | not in member map unless self/staff | RP |
| Champions boards | `api/club/champions/route.ts:22` | yes | rows dropped for members | RP |
| Survey who-picked / counts | `api/surveys/[id]/route.ts:68` | yes | dropped from people lists (counts derive from them) | RP |
| Challenges | `api/challenges/route.ts:31` | n/a | self-or-staff (`mayActFor`), one athlete's own progress | — |
| Weekly recap push | `api/cron/tick/route.ts:~560` | n/a | each runner gets only their own km; `packRank: null` | — |
| U21 registrations | `api/u21/registrations/route.ts:22` | no (by design) | admin-only staff view, unchanged | — |
| Club records | `api/club/records` → `computeClubRecordsSnapshot` (`lib/prs/club-records-store.ts`) | yes (for everyone) | shared cached snapshot, so test accounts are excluded when it is computed — staff lose them too | testAccountGaps › club records snapshot |
| Run chat | `api/run-chat/**`, `lib/run-chat/access.ts` | n/a | `canAccessChat`: owner, assigned coach, staff only — no member path | — |
| Avatars / storage URLs | public bucket | **no — gap** | see below | — |
| Realtime (Stream chat, academy threads) | Stream channels | **gap** | see below | — |

## Gaps and design notes

- **Club records** (`getClubRecords`) is one shared, cached snapshot for every viewer,
  so it cannot be viewer-scoped: `testAccountIds` are excluded when the snapshot is
  computed (staff also lose test rows there, acceptable for a members' honours board).
  A snapshot cached before migration 182 is applied still holds them until its TTL
  (6 h) — force a `?refresh=1` once the migration is pasted.
- **Avatars / storage**: objects live in a public bucket; a URL, once known, is readable
  by anyone. Every server route above stops handing the URL out, which is the only
  lever without changing bucket permissions (out of scope). Real isolation would need a
  private bucket + signed URLs.
- **Realtime / Stream**: run-chat channels are membership-scoped by our server
  (`canAccessChat`) and a test account's chat has no other members. Academy threads and
  any client-side Stream query are enforced by Stream channel membership, not by a
  route here; if a test account is ever added to a shared channel, its messages are
  visible there. Guard at channel-membership time (don't add test accounts to shared
  channels) if that path appears.
- Feed **comments/likes** by a test account are filtered from other non-staff viewers'
  previews, lists and counts (`lib/feed/test-account-filter.ts`); counts are the trigger
  total minus that item's hidden rows (one extra query, only when a test account exists).
  Still open: `GET /api/activities/[id]/kudos` reads `feed_likes` likers + `like_count`
  directly and is not yet filtered — next candidate (reuse the same helpers).
