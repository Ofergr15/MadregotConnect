# Week-anchor audit (2026-11-27)

Scope: every `getDay()` / `getUTCDay()` call in `src/`, all week-start arithmetic, and the weekday-gated crons. These were checked against CLAUDE.md "Week starts — TWO anchors": the plan week starts on Sunday, the activity week on Monday.

## Fixed
- `src/lib/ai/parser.ts` `splitIntoDays`: a pasted plan with no day markers defaulted to `new Date().getDay()`. That is the server's UTC weekday, so text pasted between 00:00 and 03:00 Israel time was put on yesterday. It now uses `israelNow().weekday`. Test: `parserDefaultDayIsrael.test.ts`.

## Reviewed: OK
- **Weekday of a date string.** Calls of the form `new Date(\`${date}T12:00:00Z\`).getUTCDay()` or `new Date(\`${date}T12:00:00\`).getDay()` on a stored date or Israel date are correct on both UTC and local clocks. This covers about 50 sites: academy (day-plan, segments, week-board, day-cards, chat-list, coach-tools, book-import, board), quality-session, day-session, watch/changes, badges, notifications, club-numbers dow, stories, publish, feed, photos, reports and pack-stories.
- **Activity start times.** `getUTCDay()` on an activity `start_time` (run-chat ai, offerSlots, birthday-year) is correct, because start times hold the local wall clock (Convention A).
- **Plan week (Sunday).** All of these are plan-week by design: `program-weeks` (local parse and format, consistent), `plan-builder/route-helpers` (asserts a Sunday), `quality-session/plan-days`, `week-setup/log`, `athletes/plan-week.ts` (`buildPlanWeek`, Israel wall clock), `academy/report` `sundayOf`, `feed/highlight` (target only), and `plans/team-day` (local date, documented).
- **Activity week (Monday).** `profile-stats` `computeLikeForLikeTrend` uses `daysElapsed` with `startDay = MONDAY_WEEK` and the local anchor from `israelDateAnchor`. Correct.
- **Weekday-gated crons.** `cron/tick` (`weekday`/`hour` from `israelNow`) and `cron/academy-report` (`israelNow().weekday`) are both correct.
- **Calendar grids.** The leading blanks in `runs-range` and the grids in components lay out Sunday-first calendars. This is display only.

## Owner question
- `lib/club-numbers/compute.ts` groups the staff "club numbers" km and runs by **Sunday** weeks (`sundayOf`). That matches team and plan weeks, but not what a watch shows (Mon–Sun). It was left as is. Should it move to the activity week?
