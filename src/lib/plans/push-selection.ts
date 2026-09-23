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

/** The only field the counting needs. `0` = Sunday, matching a plan day. */
export type PushDayWorkout = { dayOfWeek: number };

/** What the sheet needs to name a session, and what a per-athlete map keys on. */
export type PushSession = PushDayWorkout & {
  name?: string;
  /** Stable across all three pace-group variants — see ParsedWorkout. */
  workoutKey?: string;
  partIndex?: number;
  partCount?: number;
};

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

/**
 * The sessions this selection sends, in the order the week runs.
 *
 * The sheet used to say only how MANY were going out, which is the question the
 * coach asks second. The first one is which: "כל השבוע" is a fine answer when it
 * is the whole week, but "1 workout" for a picked Sunday leaves the coach to
 * remember what Sunday was — and this whole sheet writes to people's watches.
 */
export function selectedSessions<T extends PushSession>(
  workouts: readonly T[],
  pushDays: readonly number[] | null
): T[] {
  const picked = pushDays === null ? workouts : workouts.filter((w) => pushDays.includes(w.dayOfWeek));
  return [...picked].sort(
    (a, b) => a.dayOfWeek - b.dayOfWeek || (a.partIndex ?? 1) - (b.partIndex ?? 1)
  );
}

/**
 * A PER-ATHLETE CUSTOM WEEK: which weekday each session lands on for one person.
 *
 * Keyed by session (see `sessionSlot`), valued by the weekday it should be
 * delivered on — or `null` for "not for them this week". A session missing from
 * the map keeps the day the plan gives it, so a map only ever holds exceptions
 * and an empty one is indistinguishable from no map at all.
 *
 * This exists because one athlete's week does not always match the club's: the
 * coach needs to hand somebody Wednesday's session as their Monday without
 * forking the plan into a second plan for one person.
 */
export type DayMap = Record<string, number | null>;

/**
 * A stable id for a session within a plan, used as the `DayMap` key.
 *
 * `workoutKey` when the plan has one (deterministic, and the same string across
 * the three pace-group variants, so a map made while looking at group 1 still
 * applies to a group-3 athlete). Plans saved before the write paths normalized
 * have no keys, hence the positional fallback — good enough for a map that lives
 * as long as one sheet is open, and it cannot collide with a real key.
 */
export function sessionSlot(w: PushSession, index: number): string {
  return w.workoutKey || `slot-${w.dayOfWeek}-${w.partIndex ?? index + 1}`;
}

/**
 * One athlete's copy of the week, with their own days.
 *
 * Rewriting `dayOfWeek` is the whole mechanism: the delivery date is
 * `weekStartDate + dayOfWeek` (lib/garmin/push-week.ts), so a session handed
 * `dayOfWeek: 1` is scheduled on Monday no matter which day the plan wrote it
 * for. Nothing about the session's content changes, and athletes with no map get
 * the exact array that was passed in.
 */
export function remapForAthlete<T extends PushSession>(
  workouts: readonly T[],
  map?: DayMap | null
): T[] {
  if (!map || Object.keys(map).length === 0) return [...workouts];
  const out: T[] = [];
  workouts.forEach((w, i) => {
    const to = map[sessionSlot(w, i)];
    if (to === undefined) {
      out.push(w);
      return;
    }
    // Explicit null is "skip this one for them" — a real answer, not a gap.
    if (to === null) return;
    out.push({ ...w, dayOfWeek: to });
  });
  return out;
}

/** Just the exceptions, for showing what a custom week actually changes. */
export function dayMapChanges<T extends PushSession>(
  workouts: readonly T[],
  map?: DayMap | null
): Array<{ slot: string; name?: string; from: number; to: number | null }> {
  if (!map) return [];
  const out: Array<{ slot: string; name?: string; from: number; to: number | null }> = [];
  workouts.forEach((w, i) => {
    const slot = sessionSlot(w, i);
    const to = map[slot];
    if (to === undefined || to === w.dayOfWeek) return;
    out.push({ slot, name: w.name, from: w.dayOfWeek, to });
  });
  return out;
}
