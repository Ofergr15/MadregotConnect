/**
 * WHAT THE "SEND TO GARMIN WATCHES" SHEET IS ABOUT TO SEND.
 *
 * The sheet prints three counts, and until feedback 52320d01 two of them came from
 * different places and disagreed out loud: the day-picker line said "sending 1
 * workout per athlete" (correct — only Sunday was picked) while the roster headline
 * nine lines below said "16 Garmin-connected · will receive 8 workouts", because
 * that one was handed the size of the whole parsed plan. The admin sent one workout
 * and was told eight were going out.
 *
 * So every count on that sheet comes from here instead, and the distinction the
 * strings make is the distinction these functions make:
 *
 *   - SESSIONS are what a watch receives. A Tuesday two-a-day is two files, so
 *     counting days would understate it — the same trap the plan summary card's
 *     own count fell into once.
 *   - DAYS are what the chips are, so they are what the button counts down
 *     ("שלח 2 ימים") and what the "pick at least one" guard tests.
 *
 * Both read the same workout list, which is why the chips and the numbers beside
 * them can no longer describe two different weeks.
 */

/** The only field any of this needs. `0` = Sunday, matching a plan day. */
export type PushDayWorkout = { dayOfWeek: number };

/**
 * Days that actually hold a session, Sunday→Saturday — the chips to offer.
 *
 * A plan with nothing on Friday must not offer a Friday chip: picking it would
 * send nothing and still count as a picked day, which is how the guard below
 * could be satisfied by a selection that sends zero workouts.
 */
export function planDaysOf(workouts: readonly PushDayWorkout[]): number[] {
  return Array.from(new Set(workouts.map((w) => w.dayOfWeek))).sort((a, b) => a - b);
}

/**
 * Sessions this selection puts on ONE athlete's watch.
 *
 * `null` is the default "whole week" state rather than "every day listed", so it
 * answers with the plan's full size without having to enumerate the days first.
 */
export function selectedWorkoutCount(
  workouts: readonly PushDayWorkout[],
  pushDays: readonly number[] | null
): number {
  if (pushDays === null) return workouts.length;
  return workouts.filter((w) => pushDays.includes(w.dayOfWeek)).length;
}

/**
 * Days this selection covers — the button's number, not the watch's.
 *
 * Counted against the plan's own days so a stale chip cannot inflate it: if a
 * re-parse drops Thursday while Thursday is still in `pushDays`, the button must
 * not keep promising a day that no longer exists.
 */
export function selectedDayCountOf(
  workouts: readonly PushDayWorkout[],
  pushDays: readonly number[] | null
): number {
  const days = planDaysOf(workouts);
  if (pushDays === null) return days.length;
  return days.filter((d) => pushDays.includes(d)).length;
}
