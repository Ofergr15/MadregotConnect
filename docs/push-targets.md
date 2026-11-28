# Push targets

Every route a push notification's `url` may open. The source of truth is
`src/lib/notifications/push-targets.ts` (`PUSH_TARGETS`); this table mirrors it for the
native app's router (PushTap / NativeTarget), which must handle every row. The
`Native kind` column is what `buildPushPayload` sends as `target.kind` and what
`GET /api/push/targets` returns (task 83) — switch on it rather than re-parsing the url.

- Query strings are allowed on any target and are not part of the match.
- `#ledger:<tag>` urls are inbox ledger rows, never navigated to.
- **Native only** = no web page at that path; the web service worker lands on home.

| Pattern | Native kind | Screen | Native only |
|---|---|---|---|
| `/feed` | `feed` | Feed (optionally ?item=, ?activity=, ?weekStory=1) |  |
| `/dashboard` | `home` | Home |  |
| `/dashboard/profile` | `profile` | Own profile (optionally ?tab=badges) |  |
| `/dashboard/teammate/:id` | `teammate` | Teammate's profile |  |
| `/dashboard/teammate/:id/records/:bucket` | `recordHistory` | A runner's record history for one distance |  |
| `/dashboard/run-together/:id` | `meetup` | One shared run (meetup) |  |
| `/dashboard/run-chat/:id` | `runChat` | Run chat thread |  |
| `/dashboard/calendar/:id` | `event` | Club calendar event |  |
| `/dashboard/surveys/:id` | `survey` | Survey |  |
| `/dashboard/academy` | `academy` | Academy home |  |
| `/dashboard/program` | `program` | Season program |  |
| `/dashboard/notifications` | `inbox` | Notification inbox |  |
| `/dashboard/notifications/approve` | `pushApprovals` | Staff: push approvals |  |
| `/dashboard/store` | `store` | Store |  |
| `/dashboard/records` | `records` | Records tab |  |
| `/dashboard/entry-queue` | `entryQueue` | Staff: entry queue |  |
| `/dashboard/feedback` | `runnerFeedback` | Staff: runner feedback |  |
| `/dashboard/workout-feedback` | `workoutFeedback` | Post-workout feedback |  |
| `/dashboard/quality-session` | `qualitySession` | Quality session |  |
| `/dashboard/push-health` | `pushHealth` | Staff: push health |  |
| `/dashboard/photos` | `photos` | Photos gallery |  |
| `/dashboard/week` | `weekSetup` | Staff: week setup |  |
| `/dashboard/settings` | `settings` | Settings |  |
| `/dashboard/review` | `review` | Staff: review |  |
| `/dashboard/content` | `content` | Staff: content |  |
| `/chat/:id` | `groupChat` | Group chat (groupChatUrl — no web page yet) | yes |
| `/coach/pain/:id` | `coachPain` | Staff: one pain report | yes |
| `/me/pain/:id` | `painReport` | Own pain report | yes |
| `/me/pain/:id/checkin` | `painCheckin` | Pain report check-in | yes |

## Kinds built by `buildPushPayload` (`src/lib/notifications/payload.ts`)

| Kind | url |
|---|---|---|---|
| `follow` | `/dashboard/teammate/:followerId` (fallback `/dashboard/profile`) |
| `kudos`, `like`, `comment` | `/feed?item=:feedItemId` |
| `meetup_message` | `/dashboard/run-together/:meetupId` |
| `shoe_limit` | `/dashboard/profile` |
| `approval` | `/dashboard` |
| `badge` | `/dashboard/profile?tab=badges` |
| `store_order` | `/dashboard/store` |
| `event_new` | `/dashboard/calendar/:eventId` |
| `weekly_recap` | `/feed?weekStory=1` |
| `activity_synced` | `/feed?activity=:activityId` |
| `plan_pushed` | `/dashboard` |
| `new_record` | `/dashboard/teammate/:athleteId/records/:bucket?new=:activityId` (fallback `/dashboard/profile`) |

`src/__tests__/pushPayloadBuilder.test.ts` fails if a kind builds a url that is not in
the table, or if a web target has no page under `src/app`.
