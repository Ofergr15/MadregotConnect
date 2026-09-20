/**
 * The characterization call's answers, checked against the week the coach is actually building.
 *
 * `characterization.ts` already says what this is for, in the mockup's own words:
 * `הטופס הזה הוא גם הקלט לתוכנית הראשונה` — available days, the physical limitation and the race
 * date flow straight into the composer. `planInputsFrom` has existed since that slice and
 * nothing read it, which meant the answers were collected on the phone and then stored where
 * the person writing the plan could not see them. A coach writing a Tuesday session for
 * somebody who said they cannot run Tuesdays is the failure this closes, and it is a failure
 * nothing downstream contradicts: the watch takes the workout, the trainee misses it, and the
 * adherence screen reports a trainee who does not do their sessions.
 *
 * ── ADVISORY, NEVER BLOCKING ───────────────────────────────────────────────────────────────
 *
 * Every finding here is a sentence, not a refusal. The answers are weeks old by the time the
 * second plan is written, people change jobs, and "I can't run Tuesdays" is a fact about
 * February. The coach knows things this table does not, so the board must stay writable on
 * every day of the week — what changes is that the board says so out loud before the push
 * rather than after it.
 *
 * ── SILENCE IS A REAL ANSWER ───────────────────────────────────────────────────────────────
 *
 * A trainee with no characterization row produces NO findings. Not "trains every day", not "no
 * limitations" — nothing, and their name goes in `uncharacterised` so the coach can see why the
 * strip is quiet about them. The same rule as `coachedForFree` with no join date and the band
 * recommendation with no band paces: a confident sentence derived from an empty row is worse
 * than no sentence, because the first false warning is what teaches a coach to ignore the true
 * ones.
 *
 * Pure: no clock, no fetch, no workouts. The composer extracts the per-day kilometres (two
 * different mechanisms — a written workout's own estimate, a book entry's step volume) and
 * hands over numbers, which is what makes every judgement below testable without a fixture of
 * parsed workouts.
 */

import type { PlanInputs } from './characterization';

/**
 * How much bigger than their current week a plan can be before it is worth a sentence.
 *
 * A GUESS, and flagged as one like every other threshold in the academy modules. The classic
 * coaching rule of thumb is 10% per week, which would warn on nearly every week the academy
 * writes — a trainee arriving at 25 km/week is deliberately built up faster than that in the
 * first month. 30% is set where a jump is more likely to be a typo or a forgotten recipient
 * than a decision: 25 km → 33 km is silent, 25 km → 45 km is not.
 */
export const MAX_WEEKLY_JUMP = 0.3;

/** One day of the board: the day number, and how many kilometres are on it if that is knowable. */
export interface PlannedDay {
  dayOfWeek: number;
  /**
   * `null` when the day's volume cannot be read — a book entry written purely in minutes, or a
   * workout with no distance in its steps. Distinct from 0 on purpose: see `plannedKm`.
   */
  km: number | null;
}

/** One recipient of the week, with their answers if anybody recorded them. */
export interface FitRecipient {
  athleteId: string;
  name: string;
  inputs: PlanInputs | null;
}

/** A day the week uses that one or more recipients said they do not train on. */
export interface DayClash {
  dayOfWeek: number;
  /** Whose answer this is, in the order the recipients were given. */
  names: string[];
}

export interface VolumeJump {
  athleteId: string;
  name: string;
  /** What they told the coach they run now. */
  currentKm: number;
  /** What this week adds up to — a FLOOR when some days have no readable distance. */
  plannedKm: number;
  /** `plannedKm / currentKm - 1`, so 0.45 is "45% more than they run now". */
  jump: number;
  /** Whether `plannedKm` is a floor rather than the whole week. */
  partial: boolean;
}

/** The one free-text answer on the form, carried verbatim. */
export interface LimitationNote {
  athleteId: string;
  name: string;
  text: string;
}

export interface WeekFit {
  clashes: DayClash[];
  jumps: VolumeJump[];
  limitations: LimitationNote[];
  /** Days the primary recipient offered that this week leaves empty. */
  unusedDays: number[];
  /** Recipients with no answers on file. Nothing above says anything about these people. */
  uncharacterised: string[];
  /** The week's total, or a floor when a day's distance is unreadable. `null` when none is. */
  plannedKm: number | null;
  /** Whether `plannedKm` is a floor. */
  plannedKmPartial: boolean;
  plannedDays: number;
  /** Whether there is anything at all to show. Keeps an empty strip off the screen. */
  anything: boolean;
}

/**
 * Whether a set of answers can be reasoned about at all.
 *
 * An empty `availableDays` is treated exactly like a missing row rather than like "no days":
 * the form is filled during a twenty-minute phone call and saves itself from the first
 * keystroke, so a row whose days question was never reached is the normal state, not an answer.
 * Reading it as "trains no days" would clash with every day of the week at once.
 */
function hasUsableDays(inputs: PlanInputs | null): inputs is PlanInputs {
  return !!inputs && inputs.availableDays.length > 0;
}

export function weekFit({
  days,
  recipients,
  primaryId,
}: {
  days: PlannedDay[];
  recipients: FitRecipient[];
  /** Whose offered-but-unused days to report. The board is seeded from this trainee's week. */
  primaryId?: string | null;
}): WeekFit {
  const used = days.map(d => d.dayOfWeek);

  const clashes: DayClash[] = [];
  for (const dayOfWeek of [...new Set(used)].sort((a, b) => a - b)) {
    const names = recipients
      .filter(r => hasUsableDays(r.inputs) && !r.inputs.availableDays.includes(dayOfWeek))
      .map(r => r.name);
    if (names.length) clashes.push({ dayOfWeek, names });
  }

  // A week whose days all have a readable distance has a total; one with a book entry in
  // minutes has a floor. Both are useful and they are not the same claim, so the difference is
  // carried rather than collapsed — see the jump rule below, which depends on it.
  const readable = days.filter(d => typeof d.km === 'number' && (d.km as number) > 0);
  const plannedKmPartial = readable.length !== days.length;
  const plannedKm = readable.length
    ? Math.round(readable.reduce((sum, d) => sum + (d.km as number), 0) * 10) / 10
    : null;

  const jumps: VolumeJump[] = [];
  if (plannedKm !== null) {
    for (const r of recipients) {
      const currentKm = r.inputs?.weeklyKm ?? null;
      // A trainee who said 0, or said nothing, has no ratio to exceed. Any plan is infinitely
      // more than nothing, and "+∞%" beside somebody's name is not information the coach can
      // act on — the useful sentence there is the one the characterization screen already
      // shows, that the volume question was never answered.
      if (currentKm === null || currentKm <= 0) continue;
      const jump = plannedKm / currentKm - 1;
      // With an unreadable day in the week the total is a floor, so it can only grow. A floor
      // already past the threshold is therefore a sound warning; a floor below it proves
      // nothing and stays silent.
      if (jump <= MAX_WEEKLY_JUMP) continue;
      jumps.push({
        athleteId: r.athleteId,
        name: r.name,
        currentKm,
        plannedKm,
        jump: Math.round(jump * 100) / 100,
        partial: plannedKmPartial,
      });
    }
    jumps.sort((a, b) => b.jump - a.jump);
  }

  // Verbatim, and never summarised: this is the sentence that keeps somebody off intervals for
  // a month, and it was typed by the coach during the call for exactly this moment.
  const limitations: LimitationNote[] = recipients
    .filter(r => !!r.inputs?.limitation)
    .map(r => ({ athleteId: r.athleteId, name: r.name, text: r.inputs!.limitation as string }));

  const primary = primaryId ? recipients.find(r => r.athleteId === primaryId) : null;
  const unusedDays = hasUsableDays(primary?.inputs ?? null)
    ? primary!.inputs!.availableDays.filter(d => !used.includes(d))
    : [];

  const uncharacterised = recipients.filter(r => !hasUsableDays(r.inputs)).map(r => r.name);

  return {
    clashes,
    jumps,
    limitations,
    unusedDays,
    uncharacterised,
    plannedKm,
    plannedKmPartial,
    plannedDays: days.length,
    // `uncharacterised` deliberately does NOT count: a strip that appears only to announce that
    // it has nothing to say is noise on every week of a club that has not been characterised.
    anything: clashes.length > 0 || jumps.length > 0 || limitations.length > 0 || unusedDays.length > 0,
  };
}

/**
 * How long until the race, as the one number the coach is actually deciding against.
 *
 * Separate from the clashes because it is not a warning about this week: it is the reason this
 * week looks the way it does, and it belongs on the strip whether or not anything is wrong.
 * `weeksToRace` is already computed by `planInputsFrom`; this only decides when it is worth
 * saying, which is when there IS a race and it has not already happened.
 */
export function raceCountdown(inputs: PlanInputs | null): { weeks: number; date: string } | null {
  if (!inputs?.targetRaceDate || inputs.weeksToRace === null || inputs.weeksToRace < 0) return null;
  return { weeks: inputs.weeksToRace, date: inputs.targetRaceDate };
}
