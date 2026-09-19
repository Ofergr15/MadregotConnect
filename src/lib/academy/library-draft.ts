/**
 * Writing an entry into the book — the editable shape, and the two conversions.
 *
 * `LibraryStep` is what the table stores and what the rest of the pipeline reads: a general
 * tree, nested repeats, fifteen optional fields, three of which must never be set. It is the
 * wrong thing to put a form on. A coach writes four kinds of thing —
 *
 *     easy running · a continuous block · a set of reps · a heart-rate block
 *
 * — and `DraftStep` is exactly those four, so the form has one row per thing the coach
 * actually says and the step tree is derived. That is also the strongest available form of
 * the no-absolute-paces invariant: the editor has no pace field to type one into. The effort
 * is picked from the named zones, and `toLibrarySteps` is the only thing that writes the
 * `intensity` those names resolve to.
 *
 * ── Why the reverse conversion refuses rather than guesses ───────────────────────────────
 *
 * `fromLibrarySteps` returns `null` for anything it cannot represent exactly. An entry could
 * reach the table from a path this editor does not model — a workout saved out of a plan, a
 * hand-written insert, a shape a later version writes — and a lossy read would show the coach
 * a form that looks complete, then silently drop the steps it did not understand the moment
 * they pressed save. On a session the academy has pushed 28 times that is not an editing bug,
 * it is a deletion. So the screen says it cannot edit this one and leaves it intact.
 */

import {
  ZONE_INTENSITY,
  type LibraryStep,
  type RelativeIntensity,
} from './library';

/** The efforts the editor offers, in the order a coach thinks about them. */
export const DRAFT_ZONES = ['easy', 'marathon_pace', 'tempo', 'threshold', 'interval', 'sprint'] as const;
export type DraftZone = typeof DRAFT_ZONES[number];

export function isDraftZone(value: unknown): value is DraftZone {
  return typeof value === 'string' && (DRAFT_ZONES as readonly string[]).includes(value);
}

/** Metres, or seconds. One field, so the form cannot hold both and mean neither. */
export type DraftMeasure = 'distance' | 'time';

export type DraftStep =
  /** The jog at each end. Always easy, which is the only reason it needs no effort field. */
  | { kind: 'easy'; role: 'warmup' | 'cooldown'; metres: number }
  /** One unbroken block — a tempo, a long run, the 30 minutes of a test. */
  | { kind: 'continuous'; measure: DraftMeasure; value: number; zone: DraftZone | null }
  /**
   * `count ×` a block, with a recovery between them.
   *
   * `restNote` is carried, not edited. Every workout the PDF parser writes puts the recovery
   * in words on the rest step — `2:00 הליכה` — and refusing to open an entry over it made the
   * editor refuse essentially every entry in the book, which is what the screenshot showed.
   * Dropping it instead would lose the one thing `restSec` cannot say: whether the recovery is
   * walked or jogged. So it round-trips verbatim and has no field in the form, which also
   * means it is not a second place to type a pace — a rest step carries no intensity, so
   * `stepHasAbsolutePace` does not read its note, and an editable one would be a hole.
   */
  | { kind: 'reps'; count: number; measure: DraftMeasure; value: number; zone: DraftZone; restSec: number; restNote?: string }
  /** A block held at a share of max heart rate — the one kind that needs no threshold. */
  | { kind: 'hr'; seconds: number; minPct: number; maxPct: number };

export const DRAFT_KINDS: readonly DraftStep['kind'][] = ['easy', 'continuous', 'reps', 'hr'];

/** A new row of each kind, with the numbers a coach most often writes already in it. */
export function blankStep(kind: DraftStep['kind']): DraftStep {
  switch (kind) {
    case 'easy': return { kind: 'easy', role: 'warmup', metres: 2000 };
    case 'continuous': return { kind: 'continuous', measure: 'time', value: 1200, zone: 'tempo' };
    case 'reps': return { kind: 'reps', count: 6, measure: 'distance', value: 1000, zone: 'interval', restSec: 120 };
    case 'hr': return { kind: 'hr', seconds: 1800, minPct: 88, maxPct: 93 };
  }
}

function paceStep(
  order: number,
  type: LibraryStep['type'],
  measure: DraftMeasure,
  value: number,
  zone: DraftZone,
): LibraryStep {
  return {
    order,
    type,
    durationType: measure,
    durationValue: value,
    targetType: 'pace',
    targetZone: zone,
    intensity: ZONE_INTENSITY[zone] as RelativeIntensity,
  };
}

/** The draft → what the table stores. `order` is assigned here, so the form never holds it. */
export function toLibrarySteps(draft: DraftStep[]): LibraryStep[] {
  return draft.map((step, index) => {
    const order = index + 1;
    switch (step.kind) {
      case 'easy':
        return paceStep(order, step.role, 'distance', step.metres, 'easy');

      case 'continuous':
        if (!step.zone) {
          // No effort named, and that is a statement rather than an omission: a 30-minute
          // test is run at whatever the athlete can hold, which is the entire point of it.
          return { order, type: 'active', durationType: step.measure, durationValue: step.value, targetType: 'no_target' };
        }
        return paceStep(order, 'active', step.measure, step.value, step.zone);

      case 'reps': {
        const inner: LibraryStep[] = [paceStep(1, 'interval', step.measure, step.value, step.zone)];
        if (step.restSec > 0) {
          inner.push({
            order: 2, type: 'rest', durationType: 'time', durationValue: step.restSec, targetType: 'no_target',
            // Spread, so an absent note leaves no `notes: undefined` key behind: the reverse
            // conversion compares shapes, and a present-but-undefined key is not the same row.
            ...(step.restNote ? { notes: step.restNote } : {}),
          });
        }
        // The count sits on a wrapper with no duration of its own, which is the shape the
        // parser produces and the shape `entryVolume` multiplies.
        return { order, type: 'interval', durationType: step.measure, targetType: 'no_target', repeatCount: step.count, repeatSteps: inner };
      }

      case 'hr':
        return {
          order,
          type: 'active',
          durationType: 'time',
          durationValue: step.seconds,
          targetType: 'heart_rate',
          targetHrMinPct: step.minPct,
          targetHrMaxPct: step.maxPct,
        };
    }
  });
}

/** True when a step carries nothing this editor would have to throw away. */
function isPlain(step: LibraryStep, allowed: readonly string[]): boolean {
  const known = new Set([
    'order', 'type', 'durationType', 'durationValue', 'targetType', 'targetZone',
    'intensity', 'repeatCount', 'repeatSteps', 'targetHrMinPct', 'targetHrMaxPct',
    ...allowed,
  ]);
  return Object.keys(step).every(key => known.has(key) || (step as Record<string, unknown>)[key] === undefined);
}

function measureOf(step: LibraryStep): DraftMeasure | null {
  if (step.durationType === 'distance' || step.durationType === 'time') return step.durationType;
  return null;
}

/**
 * What the table stores → the draft, or `null` when it cannot be said exactly.
 *
 * Every refusal below is a step the editor would otherwise have shown as something simpler
 * than it is: a note it would drop on save, a nested repeat it has no row for, a zone outside
 * the six it offers. See the header — a lossy edit of a session pushed 28 times is a deletion.
 */
export function fromLibrarySteps(steps: LibraryStep[]): DraftStep[] | null {
  const draft: DraftStep[] = [];

  for (const step of steps) {
    if (!isPlain(step, [])) return null;

    if (step.repeatCount && step.repeatCount > 1) {
      const inner = step.repeatSteps ?? [];
      // One work step, and at most one recovery after it. Anything richer — a ladder, a
      // rep with its own nested block — is a real workout this form cannot draw.
      if (inner.length < 1 || inner.length > 2) return null;
      const [work, rest] = inner;
      // A note is allowed on the recovery and nowhere else — see `restNote` on `DraftStep`.
      if (!isPlain(work, []) || (rest && !isPlain(rest, ['notes']))) return null;
      if (work.repeatSteps?.length) return null;
      if (work.targetType !== 'pace' || !isDraftZone(work.targetZone)) return null;
      const measure = measureOf(work);
      if (!measure || !work.durationValue) return null;
      if (rest && (rest.type !== 'rest' || rest.durationType !== 'time' || !rest.durationValue)) return null;
      draft.push({
        kind: 'reps',
        count: step.repeatCount,
        measure,
        value: work.durationValue,
        zone: work.targetZone,
        restSec: rest?.durationValue ?? 0,
        ...(rest?.notes ? { restNote: rest.notes } : {}),
      });
      continue;
    }
    if (step.repeatSteps?.length) return null;

    if (step.targetType === 'heart_rate') {
      if (step.durationType !== 'time' || !step.durationValue) return null;
      if (typeof step.targetHrMinPct !== 'number' || typeof step.targetHrMaxPct !== 'number') return null;
      draft.push({ kind: 'hr', seconds: step.durationValue, minPct: step.targetHrMinPct, maxPct: step.targetHrMaxPct });
      continue;
    }

    const measure = measureOf(step);
    if (!measure || !step.durationValue) return null;

    if ((step.type === 'warmup' || step.type === 'cooldown')
        && measure === 'distance' && step.targetZone === 'easy') {
      draft.push({ kind: 'easy', role: step.type, metres: step.durationValue });
      continue;
    }

    if (step.targetType === 'no_target') {
      draft.push({ kind: 'continuous', measure, value: step.durationValue, zone: null });
      continue;
    }
    if (step.targetType === 'pace' && isDraftZone(step.targetZone)) {
      draft.push({ kind: 'continuous', measure, value: step.durationValue, zone: step.targetZone });
      continue;
    }
    return null;
  }

  return draft;
}

/**
 * Why this draft cannot be saved yet, or `null`.
 *
 * Returned as a reason rather than a boolean because "שמירה" being greyed out with no
 * explanation is the worst state a form can be in — the coach's next move is to tap it
 * repeatedly. English keys, Hebrew in the component, same split as everywhere else.
 */
export type DraftProblem =
  | 'no-steps'
  | 'no-name'
  | 'zero-value'
  | 'zero-count'
  | 'hr-band';

export function draftProblem(name: string, draft: DraftStep[]): DraftProblem | null {
  if (!name.trim()) return 'no-name';
  if (draft.length === 0) return 'no-steps';
  for (const step of draft) {
    if (step.kind === 'easy' && !(step.metres > 0)) return 'zero-value';
    if (step.kind === 'continuous' && !(step.value > 0)) return 'zero-value';
    if (step.kind === 'reps') {
      if (!(step.value > 0)) return 'zero-value';
      if (!(step.count > 1)) return 'zero-count';
    }
    if (step.kind === 'hr') {
      if (!(step.seconds > 0)) return 'zero-value';
      // A band the wrong way round is a watch alarm that cannot be satisfied, and it is a
      // realistic typo: the two fields sit next to each other and both hold two digits.
      if (!(step.minPct > 0) || !(step.maxPct >= step.minPct)) return 'hr-band';
    }
  }
  return null;
}
