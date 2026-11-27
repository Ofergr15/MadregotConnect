# Push targets

Every route a push notification's `url` may open. The source of truth is
`src/lib/notifications/push-targets.ts` (`PUSH_TARGETS`); this table mirrors it for the
native app's router (PushTap / NativeTarget), which must handle every row.

- Query strings are allowed on any target and are not part of the match.
- `#ledger:<tag>` urls are inbox ledger rows, never navigated to.
- **Native only** = no web page at that path; the web service worker lands on home.

| Pattern | Screen | Native only |
|---|---|---|
| `/feed` | Feed (optionally ?item=, ?activity=, ?weekStory=1) |  |
| `/dashboard` | Home |  |
| `/dashboard/profile` | Own profile (optionally ?tab=badges) |  |
| `/dashboard/teammate/:id` | Teammate's profile |  |
| `/dashboard/teammate/:id/records/:bucket` | A runner's record history for one distance |  |
| `/dashboard/run-together/:id` | One shared run (meetup) |  |
| `/dashboard/run-chat/:id` | Run chat thread |  |
| `/dashboard/calendar/:id` | Club calendar event |  |
| `/dashboard/surveys/:id` | Survey |  |
| `/dashboard/academy` | Academy home |  |
| `/dashboard/program` | Season program |  |
| `/dashboard/notifications` | Notification inbox |  |
| `/dashboard/notifications/approve` | Staff: push approvals |  |
| `/dashboard/store` | Store |  |
| `/dashboard/records` | Records tab |  |
| `/dashboard/entry-queue` | Staff: entry queue |  |
| `/dashboard/feedback` | Staff: runner feedback |  |
| `/dashboard/workout-feedback` | Post-workout feedback |  |
| `/dashboard/quality-session` | Quality session |  |
| `/dashboard/push-health` | Staff: push health |  |
| `/dashboard/photos` | Photos gallery |  |
| `/dashboard/week` | Staff: week setup |  |
| `/dashboard/settings` | Settings |  |
| `/dashboard/review` | Staff: review |  |
| `/dashboard/content` | Staff: content |  |
| `/chat/:id` | Group chat (groupChatUrl — no web page yet) | yes |
| `/coach/pain/:id` | Staff: one pain report | yes |
| `/me/pain/:id` | Own pain report | yes |
| `/me/pain/:id/checkin` | Pain report check-in | yes |

## Kinds built by `buildPushPayload` (`src/lib/notifications/payload.ts`)

| Kind | url |
|---|---|
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
