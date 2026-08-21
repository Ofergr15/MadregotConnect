# Run chat architecture

## Purpose

Each Strava activity has a persistent Stream Chat channel shared by the runner,
the human coach, and `aicoach`. The channel combines the published workout,
actual activity data, AI tool traces, related historical runs, and normal chat.

## Main seams

- Page and Stream composition:
  `src/app/dashboard/run-chat/[activityId]/page.tsx`
- Chat creation, membership, and reset:
  `src/app/api/run-chat/route.ts`
- First-open seeding and attachment backfill:
  `src/lib/run-chat/seed-chat.ts`
- AI tool turn:
  `src/app/api/run-chat/[chatId]/ai/route.ts`
- Access checks: `src/lib/run-chat/access.ts`
- Attachment contracts: `src/lib/run-chat/attachments.ts`
- Attachment renderer: `src/components/run-chat/RunChatAttachment.tsx`
- Message/RTL layout:
  `src/components/run-chat/RunChatMessage.tsx` and
  `src/app/dashboard/run-chat/run-chat.css`

## Data and identity

`run_chats` links an `athlete_activities` row to a Stream channel and stores the
matched plan text/workout. Migration `049_run_chat.sql` creates the core tables;
`050_run_chat_clipboard.sql` adds clipboard state.

Stream IDs are not interchangeable with database coach IDs. Resolve the coach
through `resolveCoachStreamUser()` and always add the runner, resolved human
coach, and `AI_USER_ID` as members. Stream credentials are generated only after
server-side session verification.

## Channel lifecycle

1. The page gets a Stream token.
2. `POST /api/run-chat` finds or creates `run_chats`, resolves the matched plan,
   upserts members, and calls `ensureChatSeeded()`.
3. Seeding publishes the group-specific workout clipboard and the actual Strava
   attachment. It also enriches older historical attachments when fields were
   added later.
4. Mentioning `@aicoach` calls the AI route. Tools run through a tracked wrapper,
   a compact trace is updated, and the final answer includes related-run
   attachments.
5. Development reset deletes the channel, database row, and generated artifacts
   so the next open recreates the initial state.

## Structured attachments

Custom types are `workout`, `strava_run`, and `tool_trace`.
`RunChatAttachment` must retain Stream's native renderer for ordinary files and
images.

Stream limits total custom attachment data on a message to 5 KB:

- Keep tool-result previews short.
- Limit related runs.
- Downsample route points (historical attachments currently use 16 points).
- Store generated images in Supabase Storage and attach URLs, never image bytes.

The `run-chat` public bucket stores plan and lap artifacts. Lap previews are
versioned by `LAPS_CLIPBOARD_VERSION`; bumping it causes current and historical
messages to regenerate on open.

## Message presentation

One Stream message may contain a tool trace, multiple run cards, and answer text.
They must render as one bordered message block. Run cards are inset attachment
surfaces, not independent messages. Hover actions sit outside the message's
physical left edge; reactions occupy a dedicated row below the bubble.

The app is RTL, but stat rows and run headings intentionally use `dir="ltr"` for
stable `name | time | Strava` and numeric ordering. The route minimap uses one
geographic scale for both axes; do not independently stretch latitude and
longitude.

Use shadcn primitives from `src/components/ui/` for shared interaction behavior.
Stream's internal DOM still needs scoped overrides under `.run-chat-shell`.

## AI tools

Tool definitions cover activity details, laps, plan-vs-execution analysis, GPX,
recent/history search, comparison, and similar workouts. Tool labels belong in
`src/lib/run-chat/tool-metadata.ts`. Historical searches must exclude the
current activity when the user asks about previous runs.

The final answer and trace are separate messages for new turns. Legacy channels
may contain both in one message, so rendering and backfill must support both.

## Verification

- `npm run typecheck`
- `npm test`
- `npm run lint` (four unrelated exhaustive-deps warnings are currently known)
- Browser-check collapsed/expanded width, RTL alignment, reactions, tool traces,
  historical route/lap enrichment, and Stream's 5 KB attachment limit.
