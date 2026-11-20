# Inbox (plan V6): server contract for the native client

Tests: `inboxContract.test.ts`. All three routes need `Authorization: Bearer <supabase jwt>`.

## `GET /api/notifications/inbox?athleteId={uuid}`
- 200 `{ items: Item[], unread: number }`, newest first.
- `Item` = `{ id, kind, title, body, url, sentAt, unread, actorName, actorAvatarUrl, toAll }`
  plus, only when prefetched, `kudosGiven?: boolean` and `rsvpAttending?: boolean | null`
  (absent = not looked up; treat as unknown, not false).
  `url` is an app path (never a `#…` sentinel; falls back to `/dashboard`). `title`/`body` are the
  Hebrew copy (`title_he`/`body_he`); there is no English variant on this route.
- Window: the newest **150** sent rows for my audience (all / my group / academy / me), ledger rows
  excluded before the limit. No paging, no cursor.
- Folding: consecutive `like`/`follow` rows on the same `url` merge into one row (first row's id,
  title rewritten to "X and N others…" in the athlete's notification language). `unread` counts
  **rows after folding**.
- Club posts: feed announcements from the last 7 days are merged in by time as
  `kind: "club_post"`, `id: "post:<feedItemId>"`, `url: "/feed?item=<feedItemId>"`, `toAll: true`.
  Ids are therefore not all UUIDs.
- `unread` = `sentAt > athletes.last_seen_at`, and false for any kind the athlete muted.
- Auth: no session → 401; another athlete's id → 403 `{ error: "forbidden" }` (staff/super user may).
- Surprise: a missing or non-UUID `athleteId` → **200 `{ items: [], unread: 0 }` before the auth
  check**, so a bad id looks like an empty inbox, not an error. Always send the caller's own UUID.
- Unknown athlete → `{ items: [], unread: 0 }`. Failure → 500 `{ error, items: [], unread: 0 }`.

## `GET /api/notifications/unread?athleteId={uuid}` → `{ count }`
- The app-icon badge: unread notification **pushes** (not folded: five likes count five)
  **plus Stream chat unread**. So `count` differs from the inbox `unread`; do not reconcile them.
- No session → 401, other athlete → 403 `{ error: "forbidden" }`. Bad/missing id → `{ count: 0 }`.
  Any internal failure → **200 `{ count: 0 }`** (indistinguishable from "nothing unread").

## Marking read
- There is **no read/unread endpoint** and no per-item read state. "Read" is one timestamp,
  `athletes.last_seen_at`, stamped by `GET /api/auth/me` (after the response; skipped while an
  admin is viewing-as). The inbox GET writes nothing. To clear dots and badge: call `/api/auth/me`
  when the app opens, then refetch. Everything sent before that moment counts as read.

## `GET /api/notifications/approvals` (approvers / super user only)
- No session → 401; signed in without `canApprove` (staff included) → 403 `{ error: "Forbidden" }`.
- 200 `{ mode: "quality" | "team" | "off", today: "YYYY-MM-DD" (Israel), days: ApprovalDay[], groups: [{ id, name }] }`.
- `days` = team days (default Tue/Fri) in today..today+7. `ApprovalDay` = `{ date, dayOfWeek, askAt,
  workoutName, quality, state: "not_needed" | "pending" | "approved" | "skipped", decidedBy, decidedAt,
  pushes: Push[] }`; `Push` = `{ key: "dayBefore" | "eveningBefore", slot, week, when, hour, defaultHour,
  audience, audienceId, off, edited, title, body, defaultTitle, defaultBody }`. `askAt`, `when` and
  `audience` are pre-formatted Hebrew display strings.
- `POST { date, action: "approve" | "skip" | "reset" }` and `PUT { mode }` return the same view;
  bad input → 400 `{ error }`. These two are not pinned by the contract test.

## Mark seen: POST /api/notifications/seen (since 2026-11-20)
`Authorization: Bearer`, no body. Stamps the caller's own `athletes.last_seen_at`, which is what
clears the unread count. Call it when the inbox screen opens.
200 `{ seenAt }` · 401 no session · 403 no athlete row · 204 while viewing as someone else (nothing
changed) · 500 `{ error: "Failed to mark seen" }`. Not on the dev allowlist yet (pending decision).
