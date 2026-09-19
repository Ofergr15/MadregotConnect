/**
 * ספר האימונים — the workout book, and the one rule that makes it a book rather than a folder.
 *
 * The mockup's own sentence is the whole specification: *"אימון בספר נשמר בלי קצבים מוחלטים —
 * הוא נשמר כ״קצב סף״ או ״92% מהסף״, והקצב האמיתי נגזר לכל מתאמן מהספים שלו. לכן אותו אימון
 * מתאים לדבוקה 4 ולדבוקה 9."* A saved workout that holds `4:05/km` is a workout for one runner
 * and a mistake for everyone else, so it would have to be rewritten per trainee — which is
 * exactly the writing time the book exists to remove. Stored as an intensity, one entry serves
 * the whole academy and the arithmetic happens at push time.
 *
 * This file is that arithmetic and nothing else: pure, Supabase-free, clock-free. The store,
 * the routes and the screens all read intensities through here so the number a coach sees in
 * the book's preview is the same number the watch gets.
 *
 * ── Why a percentage of SPEED and not of pace ────────────────────────────────────────────
 *
 * "92% מהסף" means *easier than threshold*, and an easy pace is a BIGGER number of seconds per
 * kilometre. So the percentage cannot be applied to sec/km: `1800 * 0.92` is 1656 sec/km, which
 * is FASTER than threshold — the beginner's recovery run resolved to something quicker than
 * their race pace. The percentage is of velocity, which is how every physiological source
 * writes it (%vLT, %vVO2max), and dividing is what turns it back into a pace:
 *
 *     paceSec = thresholdPaceSec / (pct / 100)
 *
 * 92% of a 5:00/km threshold is 5:26/km. 105% is 4:46/km. That inversion is the single most
 * likely defect in this whole feature and the reason the percentages live behind a named
 * function instead of being multiplied at each call site.
 *
 * ── Why null rather than a fallback ──────────────────────────────────────────────────────
 *
 * A trainee with no usable test has no threshold, and this refuses to resolve them rather
 * than substituting their band offset or a club average. Same discipline as
 * `effectiveOffsetSec` in ./bands and for the same reason: a guessed threshold becomes a
 * pace-zone alarm on a real watch, and `academy_tests` already exists precisely so that
 * number is measured. The caller warns; it does not invent.
 */

import type { ParsedWorkout, WorkoutStep } from '@/lib/ai/types';
import { MAX_PACE_SEC_PER_KM, MIN_PACE_SEC_PER_KM } from './repace';

/**
 * How a saved step states its effort: a band of percentages of threshold SPEED.
 *
 * Two numbers rather than one because `WorkoutStep` has always carried a pace RANGE, and a
 * single figure resolved into `min === max` is a watch alarm that fires on the first stride
 * off the exact number. `fastPct >= slowPct` — a higher share of threshold speed is the
 * faster end — and `resolveIntensity` is where that ordering becomes sec/km, so no caller
 * has to remember which way round it goes.
 */
export interface RelativeIntensity {
  /** Percent of threshold speed at the fast end of the band. 100 = threshold itself. */
  fastPct: number;
  /** Percent of threshold speed at the slow end. */
  slowPct: number;
}

/**
 * The named efforts a coach writes, as percentages of threshold speed.
 *
 * These are GUESSES, flagged as such exactly like `MEANINGFUL_SEC_PER_KM` and the ±8 s/km
 * deviation tolerance, and kept in one table for the same reason: Ofer's numbers replace
 * them with one edit, and until then every screen is at least wrong in the same direction.
 * They are anchored on the standard relationship between threshold and the other efforts —
 * easy sits roughly 60–90 s/km slower than threshold, marathon pace 10–20 s/km slower,
 * 5K–3K work 10–25 s/km faster — converted to speed shares at a 4:30/km threshold.
 *
 * The keys are `WorkoutStep.targetZone`'s existing vocabulary, not a new one, so a library
 * entry resolves into the same zone names the parser already produces and the converter
 * already reads.
 */
export const ZONE_INTENSITY: Record<string, RelativeIntensity> = {
  easy: { fastPct: 80, slowPct: 72 },
  marathon_pace: { fastPct: 97, slowPct: 93 },
  // `tempo` and `threshold` overlap on purpose: in the club's own language they are nearly
  // the same effort, and pretending otherwise would invent a distinction the coach does not
  // make when writing. Tempo is the slightly-restrained end of it.
  tempo: { fastPct: 100, slowPct: 96 },
  threshold: { fastPct: 102, slowPct: 98 },
  interval: { fastPct: 110, slowPct: 105 },
  sprint: { fastPct: 125, slowPct: 115 },
};

export function intensityForZone(zone: string | undefined | null): RelativeIntensity | null {
  if (!zone) return null;
  return ZONE_INTENSITY[zone] ?? null;
}

/** Percent of threshold speed → sec/km, clamped to the bounds a watch may be given. */
export function paceFromPct(thresholdPaceSec: number, pct: number): number {
  if (!(thresholdPaceSec > 0) || !(pct > 0)) return MAX_PACE_SEC_PER_KM;
  const sec = Math.round(thresholdPaceSec / (pct / 100));
  return Math.min(MAX_PACE_SEC_PER_KM, Math.max(MIN_PACE_SEC_PER_KM, sec));
}

/**
 * An intensity band → the `{ min, max }` sec/km pair `WorkoutStep` expects.
 *
 * `min` is the FASTER limit (the smaller number of seconds) and comes from `fastPct`. The
 * swap is done here, once, because `targetPaceMinPerKm` holding the slower of the two is a
 * silent defect: the Garmin converter would build a zone whose floor is above its ceiling.
 */
export function resolveIntensity(
  thresholdPaceSec: number,
  intensity: RelativeIntensity,
): { min: number; max: number } {
  const fast = paceFromPct(thresholdPaceSec, intensity.fastPct);
  const slow = paceFromPct(thresholdPaceSec, intensity.slowPct);
  return { min: Math.min(fast, slow), max: Math.max(fast, slow) };
}

/**
 * A step as the book stores it: everything `WorkoutStep` has, except a pace.
 *
 * Deliberately a near-copy of `WorkoutStep` rather than a fresh shape. Resolution then only
 * has to ADD the pace fields, so the entire existing pipeline — the Garmin converter, the
 * watch-step builder, the segment matcher, the plan-vs-execution grader — reads a resolved
 * library workout without knowing the book exists. The three club pace lanes are dropped
 * too: the academy is coached 1:1 against one threshold, and a stored lane 2 would be an
 * absolute pace by the back door.
 */
export type LibraryStep =
  Omit<WorkoutStep, 'targetPaceMinPerKm' | 'targetPaceMaxPerKm' | 'group2Pace' | 'group3Pace' | 'repeatSteps'>
  & {
    /**
     * The effort, when this step has one. Absent on rests, warmups written open, and
     * anything whose `targetType` is not `'pace'` — a heart-rate target is already
     * individual to the athlete and needs no resolving.
     */
    intensity?: RelativeIntensity;
    repeatSteps?: LibraryStep[];
  };

/** What kind of session this is — the mockup's six filter chips. */
export type LibraryKind = 'intervals' | 'tempo' | 'long' | 'easy' | 'hills' | 'test';

export const LIBRARY_KINDS: readonly LibraryKind[] = [
  'intervals', 'tempo', 'long', 'easy', 'hills', 'test',
];

export function isLibraryKind(value: unknown): value is LibraryKind {
  return typeof value === 'string' && (LIBRARY_KINDS as readonly string[]).includes(value);
}

/**
 * Whose shelf an entry sits on — the mockup's `שלי | אקדמיה` tabs.
 *
 * This is the structural half of Ofer's own open question 8 ("ספר האימונים — שלך או של
 * האקדמיה?"). Two shelves rather than one answer it without forcing the choice: a mentor
 * writes freely on their own shelf, and the academy shelf is the canon. Who may WRITE to
 * `academy` is a permission, enforced on the route, not a property of an entry.
 */
export type LibraryScope = 'mine' | 'academy';

export function isLibraryScope(value: unknown): value is LibraryScope {
  return value === 'mine' || value === 'academy';
}

/** An entry of `academy_workout_library`, as the client uses it. */
export interface LibraryEntry {
  id: string;
  scope: LibraryScope;
  /** The coach who wrote it. Shown on the academy shelf so canon has an author. */
  ownerId: string;
  ownerName: string | null;
  name: string;
  kind: LibraryKind;
  /** The coach's own note on the session — never a pace. */
  notes: string | null;
  steps: LibraryStep[];
  /**
   * How many trainee-pushes this entry has produced. The mockup orders the book by
   * frequency of use ("ממוקם לפי תכיפות שימוש") because the book's value is the three
   * clicks, and three clicks only beats writing if the workout you want is at the top.
   */
  useCount: number;
  lastUsedAt: string | null;
  createdAt: string;
}

/**
 * True when a step carries a pace it should not.
 *
 * The invariant this file exists for is not enforceable by types alone — `LibraryStep` omits
 * the pace fields, but the rows come out of JSONB, and a hand-written SQL insert or an entry
 * saved from a plan by a future code path can put them back. A book entry with an absolute
 * pace in it is not a slightly-wrong entry: it is the one-runner workout the book was built
 * to stop existing, and it fails silently because it looks perfectly fine to whichever coach
 * happens to share that threshold.
 *
 * `notes` counts. `buildStepDescription` in the Garmin converter keeps a note VERBATIM when
 * it already contains a pace, and that string is what the watch prints mid-run — so "בקצב
 * 4:05" in a note reaches the athlete exactly as if it were the target. Checked only on
 * steps that have an intensity, the same gate `shiftPacesInNotes` uses, because a rest
 * step's "2:00 הליכה" is a duration and not a pace.
 */
export function stepHasAbsolutePace(step: LibraryStep): boolean {
  const loose = step as Record<string, unknown>;
  if (typeof loose.targetPaceMinPerKm === 'number') return true;
  if (typeof loose.targetPaceMaxPerKm === 'number') return true;
  if (loose.group2Pace || loose.group3Pace) return true;
  if (step.intensity && step.notes && /\d{1,3}:\d{2}/.test(step.notes)) return true;
  return (step.repeatSteps ?? []).some(stepHasAbsolutePace);
}

/** The same question about a whole entry, for the save route to refuse on. */
export function hasAbsolutePaces(steps: LibraryStep[]): boolean {
  return steps.some(stepHasAbsolutePace);
}

function resolveStep(step: LibraryStep, thresholdPaceSec: number): WorkoutStep {
  const { intensity, repeatSteps, ...rest } = step;
  const out: WorkoutStep = { ...rest } as WorkoutStep;

  if (intensity) {
    const { min, max } = resolveIntensity(thresholdPaceSec, intensity);
    out.targetPaceMinPerKm = min;
    out.targetPaceMaxPerKm = max;
  }
  if (repeatSteps) {
    out.repeatSteps = repeatSteps.map(s => resolveStep(s, thresholdPaceSec));
  }
  return out;
}

export interface ResolveOptions {
  /** The trainee's threshold pace in sec/km, from `thresholdPaceSec(latestUsable(...))`. */
  thresholdPaceSec: number | null;
  /** Which day of the week this copy is being planned for. 0 = Sunday. */
  dayOfWeek: number;
}

/**
 * One book entry → one real workout for one trainee, or `null`.
 *
 * `null` is the no-usable-test case and is the whole safety property of the feature: an
 * entry stores 92%, and 92% of nothing is not a pace. The planner shows the entry, names
 * the missing test, and does not push a guess — see `canResolvePaces` in ./bands for the
 * same refusal on the band-offset path.
 *
 * The result is an ordinary `ParsedWorkout`, which is what lets the book plug into a plan
 * with no other change: it is pushed, converted, matched against the athlete's actual laps
 * and graded by the code that already does all of that.
 */
export function resolveLibraryWorkout(
  entry: Pick<LibraryEntry, 'name' | 'notes' | 'steps'>,
  { thresholdPaceSec, dayOfWeek }: ResolveOptions,
): ParsedWorkout | null {
  if (thresholdPaceSec === null || !(thresholdPaceSec > 0)) return null;
  return {
    dayOfWeek,
    name: entry.name,
    ...(entry.notes ? { description: entry.notes } : {}),
    steps: entry.steps.map(s => resolveStep(s, thresholdPaceSec)),
  };
}

/**
 * The numbers under an entry's name in the list: how long it is, and which efforts it asks
 * for.
 *
 * Numbers and zone keys only — no Hebrew, no units, no formatting. The mockup writes this
 * line as `12 ק״מ · קצב סף · הרצה 28 פעם`, and the words belong to the component that
 * renders it; putting them here is how the same summary ends up phrased two different ways
 * on two screens.
 *
 * Repeats multiply, which is the point of measuring it at all: `6 × 800m` is 4.8 km of work
 * and the coach scanning the book for "a long session" needs the 4.8, not the 800.
 */
export interface EntryVolume {
  distanceM: number;
  /** Seconds of RUNNING measured in time — the tempo, the pyramid, the 30-minute test. */
  durationSec: number;
  /** Seconds of standing still. Kept apart, see below. */
  restSec: number;
}

export function entryVolume(steps: LibraryStep[]): EntryVolume {
  let distanceM = 0;
  let durationSec = 0;
  let restSec = 0;
  for (const step of steps) {
    const reps = Math.max(1, step.repeatCount ?? 1);
    if (step.durationType === 'distance' && step.durationValue) distanceM += reps * step.durationValue;
    if (step.durationType === 'time' && step.durationValue) {
      // The recoveries are counted separately from the work. `6 × 800` with 2:00 walks is not
      // a twelve-minute session, and summing them into one figure makes an interval set look
      // like a short continuous run — the one comparison the volume line exists to support.
      if (step.type === 'rest') restSec += reps * step.durationValue;
      else durationSec += reps * step.durationValue;
    }
    if (step.repeatSteps?.length) {
      const inner = entryVolume(step.repeatSteps);
      distanceM += reps * inner.distanceM;
      durationSec += reps * inner.durationSec;
      restSec += reps * inner.restSec;
    }
  }
  return { distanceM, durationSec, restSec };
}

/**
 * The steps that are the SESSION, as opposed to the getting-ready.
 *
 * A warmup, a cooldown and a recovery are present in nearly every entry and are the same
 * three steps in all of them, so anything derived from all the steps ends up describing the
 * warmup: on screen, a heart-rate pyramid with a 2 km jog in front of it was labelled `קל`,
 * because the jog is the only step in it that carries a pace at all. A repeat BLOCK counts as
 * main work and is walked into — the block is the set.
 *
 * Falls back to everything when an entry is nothing but easy running, which is what an easy
 * run legitimately is.
 */
function mainSteps(steps: LibraryStep[]): LibraryStep[] {
  const main = steps.filter(s => s.type !== 'warmup' && s.type !== 'cooldown' && s.type !== 'rest');
  return main.length ? main : steps;
}

/**
 * The efforts an entry contains, hardest first, deduplicated.
 *
 * Hardest first because that is what names a session: a set of 400s wrapped in a warmup and
 * a cooldown is "intervals", and listing the warmup first would label every workout in the
 * book "easy". Ordered by `fastPct` off `ZONE_INTENSITY` rather than by a second hand-kept
 * list, so adding a zone cannot put it in the wrong place.
 */
export function entryEfforts(steps: LibraryStep[]): { zone: string | null; fastPct: number }[] {
  const seen = new Map<string, { zone: string | null; fastPct: number }>();
  const walk = (list: LibraryStep[]) => {
    for (const step of list) {
      if (step.intensity) {
        // Keyed on the zone when there is one, and on the percentage when there is not: an
        // entry written as a bare `102% מהסף` — the mockup's second row — has no zone name,
        // and dropping it would leave that row with no effort printed at all.
        const zone = step.targetZone ?? null;
        const key = zone ?? `pct:${step.intensity.fastPct}`;
        if (!seen.has(key)) seen.set(key, { zone, fastPct: step.intensity.fastPct });
      }
      if (step.repeatSteps?.length) walk(step.repeatSteps);
    }
  };
  walk(steps);
  return [...seen.values()].sort((a, b) => b.fastPct - a.fastPct);
}

/**
 * The one thing the list line says about how hard this session is.
 *
 * Off the main set, not off every step, and heart rate is a first-class answer rather than an
 * absence: the mockup's own HR row reads `דופק 168–176 · 9 פעם`, with no pace at all. The
 * percentages are of max heart rate for exactly the reason the paces are percentages of
 * threshold — the book is written once and read by every trainee, so an entry cannot hold
 * anyone's bpm any more than it can hold their pace.
 */
export type EntryHeadline =
  | { kind: 'effort'; zone: string | null; fastPct: number }
  | { kind: 'hr'; minPct: number | null; maxPct: number | null };

export function entryHeadline(steps: LibraryStep[]): EntryHeadline | null {
  const main = mainSteps(steps);
  const effort = entryEfforts(main)[0];
  if (effort) return { kind: 'effort', ...effort };

  const findHr = (list: LibraryStep[]): LibraryStep | null => {
    for (const step of list) {
      if (step.targetType === 'heart_rate') return step;
      const inner = step.repeatSteps?.length ? findHr(step.repeatSteps) : null;
      if (inner) return inner;
    }
    return null;
  };
  const hr = findHr(main);
  if (hr) return { kind: 'hr', minPct: hr.targetHrMinPct ?? null, maxPct: hr.targetHrMaxPct ?? null };
  return null;
}

/** Just the zone names, hardest first. */
export function entryZones(steps: LibraryStep[]): string[] {
  return entryEfforts(steps).map(e => e.zone).filter((z): z is string => !!z);
}

/**
 * The badge on the leading edge of a list row: what SHAPE this session is.
 *
 * The mockup gives every row a pill, and it is not decoration — `6×1000` is how a coach
 * recognises the workout they are looking for before reading its name, because the academy's
 * sessions are named by their structure. The amber `דופק` pill is the session whose targets
 * are heart rate rather than pace, which matters here more than anywhere: an HR workout has
 * no intensity to resolve and therefore needs no threshold, so it is the one kind of entry a
 * trainee with no usable test can still be pushed.
 *
 * `null` for a continuous session (a tempo, a long run) — those have no shape worth a badge,
 * and the mockup gives them none.
 */
export type EntryShape =
  | { kind: 'reps'; count: number; distanceM: number }
  | { kind: 'hr' };

export function entryShape(steps: LibraryStep[]): EntryShape | null {
  // A holder rather than two `let`s: TypeScript does not track assignments made inside the
  // closure below, so a plain `let best = null` narrows to `null` at the return statement.
  const found: { best: { count: number; distanceM: number } | null; hr: boolean } =
    { best: null, hr: false };

  const walk = (list: LibraryStep[], inheritedReps: number) => {
    for (const step of list) {
      if (step.targetType === 'heart_rate') found.hr = true;

      const reps = Math.max(1, step.repeatCount ?? 1) * inheritedReps;
      // The rep itself, whether the count sits on this step or on the block around it. Only
      // a distance rep: `6 × 3 דקות` is a real workout but "6×180" reads as a distance, and
      // a badge that lies about its unit is worse than no badge.
      if (reps > 1 && step.durationType === 'distance' && step.durationValue) {
        const { best } = found;
        if (!best || reps * step.durationValue > best.count * best.distanceM) {
          found.best = { count: reps, distanceM: step.durationValue };
        }
      }
      if (step.repeatSteps?.length) walk(step.repeatSteps, reps);
    }
  };
  walk(steps, 1);

  // Structure first, heart rate second — and NOT "pace anywhere beats heart rate", which is
  // what this said until the screenshot showed the consequence: a heart-rate pyramid with a
  // 2 km jog in front of it lost its `דופק` badge to the jog, because the jog is the only step
  // in the entry carrying a pace. A rep count is a shape; a pace is not.
  if (found.best) return { kind: 'reps', ...found.best };
  return found.hr ? { kind: 'hr' } : null;
}

export interface LibraryFilter {
  /** Free text, matched against the name and the coach's note. */
  query?: string;
  kind?: LibraryKind | null;
  scope?: LibraryScope | null;
}

/**
 * The book, filtered and in reading order.
 *
 * Search covers the name and the note and nothing else. Not the steps: a coach typing
 * "800" means the session called 800s, and matching step distances too would return every
 * workout that happens to contain an 800m rep — which on a shelf of 34 sessions is most of
 * them, i.e. a search box that answers every query with "everything".
 *
 * Sorted by use, then by recency, then by name. Frequency first is the mockup's own
 * instruction; the two tie-breakers exist so a shelf of brand-new entries (every count 0)
 * still has a stable order instead of whatever Postgres returned.
 */
export function filterLibrary(entries: LibraryEntry[], filter: LibraryFilter = {}): LibraryEntry[] {
  const needle = (filter.query ?? '').trim().toLowerCase();
  return entries
    .filter(e => {
      if (filter.scope && e.scope !== filter.scope) return false;
      if (filter.kind && e.kind !== filter.kind) return false;
      if (!needle) return true;
      return e.name.toLowerCase().includes(needle)
        || (e.notes ?? '').toLowerCase().includes(needle);
    })
    .sort((a, b) =>
      b.useCount - a.useCount
      || (b.lastUsedAt ?? '').localeCompare(a.lastUsedAt ?? '')
      || a.name.localeCompare(b.name));
}

/**
 * A copy of an entry, ready to be edited into a new one.
 *
 * The mockup's three clicks are "שכפול, עריכה קטנה, ודחיפה ל-6 מתאמנים", and the duplicate
 * is the first of them. It lands on the coach's OWN shelf regardless of where it came from,
 * and its counters reset: a duplicate has never been used, and inheriting the original's 28
 * pushes would put an untested variant at the top of the book above the session it was
 * copied from.
 */
export function duplicateEntry(
  entry: Pick<LibraryEntry, 'name' | 'kind' | 'notes' | 'steps'>,
  ownerId: string,
): Omit<LibraryEntry, 'id' | 'ownerName' | 'createdAt'> {
  return {
    scope: 'mine',
    ownerId,
    name: entry.name,
    kind: entry.kind,
    notes: entry.notes,
    // Structurally cloned: the steps go into a new row's JSONB, and sharing the array with
    // the original would let an edit to the copy rewrite the entry it was copied from for
    // as long as both are on screen together.
    steps: JSON.parse(JSON.stringify(entry.steps)) as LibraryStep[],
    useCount: 0,
    lastUsedAt: null,
  };
}
