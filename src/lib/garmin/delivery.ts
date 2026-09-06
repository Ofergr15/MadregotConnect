/**
 * Reading Garmin's own answers to "did you actually take this workout?".
 *
 * A push is two writes to the athlete's Garmin Connect *account* — create the
 * workout, then schedule it on a date — and the watch picks them up on its next
 * sync. No Garmin endpoint reports "device X now holds workout Y", so the
 * strongest true claim is "Garmin has it, on the day we asked for". Everything
 * here exists to make that claim honestly, and in particular to stop inferring
 * it from a 200 that carries nothing back.
 *
 * That was a real hole: `createWorkout` used to return
 * `response.workoutId?.toString() || ''`, so a response with no id produced an
 * empty string, `scheduleWorkout('')` POSTed to a URL with no id, and if that
 * didn't throw the delivery was recorded `status: 'success'` and the athlete got
 * a "new workouts on your watch" notification for nothing.
 *
 * Kept pure and separate from `client.ts` on purpose: that module loads the
 * garmin-connect package, and this is the part worth testing without a network
 * or a real account.
 */

/** Short, safe rendering of a Garmin response for an error message. */
function summarize(response: unknown): string {
  if (response == null) return String(response);
  let text: string;
  try {
    text = typeof response === 'string' ? response : JSON.stringify(response);
  } catch {
    return typeof response;
  }
  if (!text) return typeof response;
  return text.length > 160 ? `${text.slice(0, 160)}…` : text;
}

/**
 * Garmin ids are large positive integers; everything falsy-shaped is absent.
 *
 * Exported because the same rule applies wherever a Garmin id is read out of an
 * untyped response — notably the `workoutId` an activity carries when it was run
 * from a scheduled workout (`lib/garmin/activity-detail.ts`), which arrives as a
 * number, a string, or `null` depending on which of Garmin's endpoints answered.
 * Ids are kept as strings so they round-trip through TEXT columns without a
 * float-precision hazard.
 */
export function readGarminId(value: unknown): string | null {
  if (value == null || typeof value === 'boolean') return null;
  const str = String(value).trim();
  // '0' is not an id Garmin issues — it's what a coerced null/false looks like.
  if (!str || str === '0' || str.toLowerCase() === 'null' || str.toLowerCase() === 'undefined') return null;
  return str;
}

/** `2026-09-08`, `2026-09-08T00:00:00.0`, `2026-09-08 00:00` → `2026-09-08`. */
function readDate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value.trim());
  return match ? match[1] : null;
}

/**
 * The workout id out of Garmin's create response — or a thrown error naming what
 * came back instead. Never returns a placeholder: a caller that gets a string
 * from this has a workout id Garmin issued.
 */
export function readCreatedWorkoutId(response: unknown): string {
  const id = readGarminId((response as { workoutId?: unknown } | null | undefined)?.workoutId);
  if (!id) {
    throw new Error(
      `Garmin accepted the request but returned no workout id, so nothing was created ` +
      `on the athlete's account (response: ${summarize(response)})`
    );
  }
  return id;
}

export interface ScheduleConfirmation {
  /** Garmin's id for the calendar entry, when it sends one. */
  scheduleId: string | null;
  /** The date Garmin says it scheduled, when it sends one. */
  calendarDate: string | null;
}

/**
 * What Garmin confirms about the scheduling POST, whose response this code used
 * to discard entirely.
 *
 * Deliberately asymmetric: a date that disagrees with the one we asked for is a
 * hard failure (the athlete would find the workout on the wrong day, which is
 * worse than not finding it), but a response with no date at all is *not* — the
 * POST succeeded, and Garmin's schedule endpoint is undocumented, so treating a
 * quiet 200 as a failure would break every push if its body ever changes shape.
 * A null `calendarDate` therefore means "unconfirmed", not "wrong"; the workout
 * read-back in `GarminClient.verifyWorkoutOnAccount` is what proves the writes
 * landed.
 */
export function readScheduleConfirmation(response: unknown, expectedDate: string): ScheduleConfirmation {
  const body = (response ?? {}) as Record<string, unknown>;
  const nested = (body.workoutSchedule ?? {}) as Record<string, unknown>;

  const scheduleId = readGarminId(body.workoutScheduleId ?? body.scheduleId ?? nested.workoutScheduleId ?? body.id);
  const calendarDate = readDate(body.calendarDate ?? body.date ?? nested.calendarDate);

  if (calendarDate && calendarDate !== expectedDate) {
    throw new Error(
      `Garmin scheduled the workout on ${calendarDate} instead of ${expectedDate}`
    );
  }

  return { scheduleId, calendarDate };
}

/**
 * Assert that a workout read back off the account is the one we just wrote.
 * Throws if Garmin returns nothing, or returns a different workout.
 */
export function assertWorkoutOnAccount(detail: unknown, workoutId: string): void {
  const found = readGarminId((detail as { workoutId?: unknown } | null | undefined)?.workoutId);
  if (!found) {
    throw new Error(
      `Garmin has no workout ${workoutId} on the athlete's account — the push did not stick ` +
      `(response: ${summarize(detail)})`
    );
  }
  if (found !== workoutId) {
    throw new Error(`Read back Garmin workout ${found} when asking for ${workoutId}`);
  }
}
