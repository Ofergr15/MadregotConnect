import { describe, expect, it } from 'vitest';

import {
  blankStep,
  draftProblem,
  fromLibrarySteps,
  toLibrarySteps,
  type DraftStep,
} from '@/lib/academy/library-draft';
import {
  ZONE_INTENSITY,
  entryHeadline,
  entryShape,
  entryVolume,
  hasAbsolutePaces,
  resolveLibraryWorkout,
  type LibraryStep,
} from '@/lib/academy/library';

/**
 * The editor's model, which is where an entry gets WRITTEN.
 *
 * Two things can only go wrong here. The first is the invariant: the form has no pace field,
 * so the only way an absolute pace could reach the table through it is if `toLibrarySteps`
 * wrote one — which is why the first test asserts the negative on every kind of step at once.
 * The second is the reverse direction: a form that reads an entry it does not fully understand
 * and then saves it back has DELETED the parts it did not understand, and on a session the
 * academy has pushed 28 times that is not an editing bug.
 */

const CLASSIC: DraftStep[] = [
  { kind: 'easy', role: 'warmup', metres: 2000 },
  { kind: 'reps', count: 6, measure: 'distance', value: 1000, zone: 'interval', restSec: 120 },
  { kind: 'easy', role: 'cooldown', metres: 1500 },
];

describe('what the editor writes', () => {
  it('never writes a pace, whatever the coach entered', () => {
    const everything: DraftStep[] = [
      ...CLASSIC,
      { kind: 'continuous', measure: 'time', value: 1200, zone: 'tempo' },
      { kind: 'continuous', measure: 'time', value: 1800, zone: null },
      { kind: 'hr', seconds: 1800, minPct: 88, maxPct: 93 },
    ];
    expect(hasAbsolutePaces(toLibrarySteps(everything))).toBe(false);
  });

  it('numbers the steps in the order they are on screen', () => {
    // `order` is assigned on the way out, so dragging a row around or deleting the middle one
    // cannot leave two steps claiming to be third.
    expect(toLibrarySteps(CLASSIC).map(s => s.order)).toEqual([1, 2, 3]);
  });

  it('turns a set of reps into the shape the rest of the pipeline reads', () => {
    const steps = toLibrarySteps(CLASSIC);
    expect(entryShape(steps)).toEqual({ kind: 'reps', count: 6, distanceM: 1000 });
    expect(entryVolume(steps)).toEqual({ distanceM: 9500, durationSec: 0, restSec: 720 });
    expect(entryHeadline(steps)).toEqual({ kind: 'effort', zone: 'interval', fastPct: ZONE_INTENSITY.interval.fastPct });
  });

  it('resolves to real paces off a real threshold', () => {
    // The whole round trip: a coach picks "אינטרוולים" from a list of six words, and a watch
    // gets seconds per kilometre derived from one trainee's own test.
    const resolved = resolveLibraryWorkout(
      { name: '6×1000', notes: null, steps: toLibrarySteps(CLASSIC) },
      { thresholdPaceSec: 300, dayOfWeek: 2 },
    )!;
    const rep = resolved.steps[1].repeatSteps![0];
    expect(rep.targetPaceMinPerKm).toBe(273);
    expect(rep.targetPaceMaxPerKm).toBe(286);
    // Easy is SLOWER than threshold, which is the inversion this whole feature is built
    // around, asserted here once more at the point a coach's own input reaches it.
    expect(resolved.steps[0].targetPaceMinPerKm!).toBeGreaterThan(300);
  });

  it('omits the recovery when there is none', () => {
    const steps = toLibrarySteps([{ kind: 'reps', count: 4, measure: 'time', value: 180, zone: 'threshold', restSec: 0 }]);
    expect(steps[0].repeatSteps).toHaveLength(1);
  });

  it('leaves a test without a target instead of guessing one', () => {
    const steps = toLibrarySteps([{ kind: 'continuous', measure: 'time', value: 1800, zone: null }]);
    expect(steps[0].targetType).toBe('no_target');
    expect(steps[0].intensity).toBeUndefined();
    // And the list line then says nothing about the effort rather than something wrong.
    expect(entryHeadline(steps)).toBeNull();
  });
});

describe('reading an entry back into the form', () => {
  it('round-trips everything the form can draw', () => {
    const everything: DraftStep[] = [
      ...CLASSIC,
      { kind: 'continuous', measure: 'distance', value: 12000, zone: 'marathon_pace' },
      { kind: 'continuous', measure: 'time', value: 1800, zone: null },
      { kind: 'hr', seconds: 1800, minPct: 88, maxPct: 93 },
      { kind: 'reps', count: 10, measure: 'distance', value: 400, zone: 'sprint', restSec: 0 },
    ];
    expect(fromLibrarySteps(toLibrarySteps(everything))).toEqual(everything);
  });

  it('refuses a nested repeat rather than flattening it', () => {
    // A ladder is a real workout and this form cannot draw one. Opening it in the editor
    // would show three rows and save four fewer steps than it read.
    const ladder: LibraryStep[] = [{
      order: 1, type: 'interval', durationType: 'distance', targetType: 'no_target', repeatCount: 3,
      repeatSteps: [{
        order: 1, type: 'interval', durationType: 'distance', targetType: 'no_target', repeatCount: 2,
        repeatSteps: [{ order: 1, type: 'interval', durationType: 'distance', durationValue: 400, targetType: 'pace', targetZone: 'interval', intensity: ZONE_INTENSITY.interval }],
      }],
    }];
    expect(fromLibrarySteps(ladder)).toBeNull();
  });

  it('carries the recovery note that every parsed workout has', () => {
    // The screenshot's finding: the fixtures' rests all say `2:00 הליכה`, so refusing on a
    // note refused the whole book. It round-trips verbatim rather than being dropped —
    // walked and jogged recoveries are different sessions and `restSec` cannot tell them
    // apart — and it has no field in the form, so it is not a way to enter a pace.
    const withNote: DraftStep[] = [
      { kind: 'reps', count: 6, measure: 'distance', value: 800, zone: 'interval', restSec: 120, restNote: '2:00 הליכה' },
    ];
    const steps = toLibrarySteps(withNote);
    expect(steps[0].repeatSteps![1].notes).toBe('2:00 הליכה');
    expect(fromLibrarySteps(steps)).toEqual(withNote);
    // And a note on the WORK step is still a refusal: that one is the coach's instruction,
    // and the form has nowhere to put it.
    const onWork = toLibrarySteps(withNote);
    onWork[0].repeatSteps![0].notes = 'כל הכוח';
    expect(fromLibrarySteps(onWork)).toBeNull();
  });

  it('refuses a step carrying a note it would drop on save', () => {
    const noted = toLibrarySteps([{ kind: 'continuous', measure: 'time', value: 1800, zone: null }]);
    noted[0].notes = 'כל הכוח, קצב אחיד';
    expect(fromLibrarySteps(noted)).toBeNull();
  });

  it('refuses an effort outside the six the form offers', () => {
    const exotic: LibraryStep[] = [{
      order: 1, type: 'active', durationType: 'time', durationValue: 600,
      targetType: 'pace', targetZone: 'vo2max', intensity: { fastPct: 112, slowPct: 108 },
    }];
    expect(fromLibrarySteps(exotic)).toBeNull();
  });

  it('refuses an entry that somehow holds a pace', () => {
    // Belt and braces: such a row should not exist, but if one does, the editor must not be
    // the thing that shows it as an ordinary step and re-saves it.
    // Cast, because `LibraryStep` has no such field — which is exactly the point: the row
    // can only hold one if it arrived as JSONB from somewhere outside this type.
    const smuggled = toLibrarySteps(CLASSIC);
    (smuggled[0] as Record<string, unknown>).targetPaceMinPerKm = 245;
    expect(fromLibrarySteps(smuggled)).toBeNull();
  });
});

describe('what stops a save', () => {
  it('names the reason rather than just refusing', () => {
    expect(draftProblem('', CLASSIC)).toBe('no-name');
    expect(draftProblem('6×1000', [])).toBe('no-steps');
    expect(draftProblem('x', [{ kind: 'easy', role: 'warmup', metres: 0 }])).toBe('zero-value');
    expect(draftProblem('x', [{ ...(CLASSIC[1] as Extract<DraftStep, { kind: 'reps' }>), count: 1 }])).toBe('zero-count');
    expect(draftProblem('6×1000', CLASSIC)).toBeNull();
  });

  it('catches a heart-rate band written the wrong way round', () => {
    // Both fields hold two digits and sit next to each other; a watch given 93–88 has a zone
    // it can never be inside.
    expect(draftProblem('x', [{ kind: 'hr', seconds: 1800, minPct: 93, maxPct: 88 }])).toBe('hr-band');
    expect(draftProblem('x', [{ kind: 'hr', seconds: 1800, minPct: 88, maxPct: 88 }])).toBeNull();
  });

  it('starts every new row on a number a coach would actually write', () => {
    // A row that opens on 0 has to be filled in before it can be looked at, which makes
    // "add a step" a worse move than editing the one above it.
    for (const kind of ['easy', 'continuous', 'reps', 'hr'] as const) {
      expect(draftProblem('x', [blankStep(kind)])).toBeNull();
    }
  });
});
