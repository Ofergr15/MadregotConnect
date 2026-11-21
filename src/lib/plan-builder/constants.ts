/**
 * The plan builder's product defaults. Each one is an OPEN question to Ofer
 * (design/plan-builder-prototype/NOTES.md) answered here with the prototype's
 * default, so the eventual answer is a one-line change. The native app reads the
 * same values from GET /api/plan-builder/config — never hardcode them client-side.
 */

/** NOTES Q1 — default publish mode and moment: scheduled, Friday 20:00 Israel time
 *  of the week BEFORE the plan week. (getDisplayWeekStart rolls only on Saturday 20:00,
 *  so runners see the new week ~24 h after it is published.) */
export const DEFAULT_PUBLISH_MODE: 'scheduled' | 'now' = 'scheduled';
export const DEFAULT_PUBLISH_WEEKDAY = 5; // 0 = Sunday … 5 = Friday
export const DEFAULT_PUBLISH_HOUR_IL = 20;

/** NOTES Q2 — low-confidence flags are counted and shown but never block publishing. */
export const FLAGS_BLOCK_PUBLISH = false;

/** NOTES Q3 — after publishing, a change notifies only the groups/athletes it touches. */
export const CHANGE_NOTICE_SCOPE: 'affected' | 'everyone' = 'affected';

/** NOTES Q4 — "overwrite workouts already on the watch" is off by default. */
export const DEFAULT_OVERWRITE_WATCH = false;

/** NOTES Q5 — soft lock (shows who is editing + "ask them to finish") rather than merge. */
export const EDIT_LOCK_MODE: 'soft' | 'none' = 'soft';
export const PLAN_LOCK_TTL_SEC = 120;

/** NOTES Q6 — "copy last week" keeps every pace as-is (0 s/km shift). */
export const COPY_LAST_WEEK_PACE_SHIFT_SEC = 0;

/** Push backoff after Garmin 429, seconds; doubles per attempt up to the cap. */
export const PUSH_BACKOFF_BASE_SEC = 60;
export const PUSH_BACKOFF_MAX_SEC = 30 * 60;

export function planBuilderConfig() {
  return {
    defaultPublishMode: DEFAULT_PUBLISH_MODE,
    defaultPublishWeekday: DEFAULT_PUBLISH_WEEKDAY,
    defaultPublishHourIL: DEFAULT_PUBLISH_HOUR_IL,
    flagsBlockPublish: FLAGS_BLOCK_PUBLISH,
    changeNoticeScope: CHANGE_NOTICE_SCOPE,
    defaultOverwriteWatch: DEFAULT_OVERWRITE_WATCH,
    editLockMode: EDIT_LOCK_MODE,
    lockTtlSec: PLAN_LOCK_TTL_SEC,
    copyLastWeekPaceShiftSec: COPY_LAST_WEEK_PACE_SHIFT_SEC,
  };
}
