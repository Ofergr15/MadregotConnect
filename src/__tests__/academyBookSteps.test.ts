import { describe, expect, it } from 'vitest';
import {
  absoluteToLibrary,
  addStep,
  bookTotals,
  effortFromPace,
  effortFromZone,
  effortPace,
  fieldValue,
  fromLibrarySteps,
  guessKind,
  mainStepIndex,
  nearestZone,
  nudgeField,
  paceInNote,
  profileBar,
  quickFields,
  setField,
  stripPaceText,
  structureKey,
  structureName,
  toLibrarySteps,
  toneOfPct,
  wheelOptions,
  type BookStep,
} from '@/lib/academy/book-steps';
import { hasAbsolutePaces, resolveLibraryWorkout } from '@/lib/academy/library';
import type { WorkoutStep } from '@/lib/ai/types';

const T = 270; // a 4:30 threshold

/** The mockup's session: 2 easy, 5 × 1000 at 4:05 with 2:00 jog, 2 easy. */
const mockup = (): BookStep[] => [
  { kind: 'run', role: 'warmup', length: { measure: 'distance', value: 2000 }, effort: effortFromZone('easy') },
  {
    kind: 'reps', count: 5, work: { measure: 'distance', value: 1000 }, effort: effortFromPace(245, T),
    rest: { length: { measure: 'time', value: 120 }, mode: 'jog' },
  },
  { kind: 'run', role: 'cooldown', length: { measure: 'distance', value: 2000 }, effort: effortFromZone('easy') },
];

describe('efforts', () => {
  it('a typed pace reads back exactly, and moves with the threshold', () => {
    const e = effortFromPace(245, T);
    expect(effortPace(e, T)).toBe(245);
    expect(effortPace(e, 300)).toBe(272);
    expect(e.zone).toBe('interval');
  });

  it('slower than threshold is a SMALLER share of speed', () => {
    expect(effortFromPace(330, 300).intensity.fastPct).toBeLessThan(100);
  });

  it('names the nearest zone', () => {
    expect(nearestZone(76)).toBe('easy');
    expect(nearestZone(107)).toBe('interval');
    expect(nearestZone(95)).toBe('marathon_pace');
  });

  it('tones match the mockup colours', () => {
    expect(toneOfPct(76)).toBe('e');
    expect(toneOfPct(98)).toBe('t');
    expect(toneOfPct(110)).toBe('f');
  });
});

describe('library round trip', () => {
  it('to the stored shape and back, losslessly', () => {
    const steps = mockup();
    const lib = toLibrarySteps(steps);
    expect(hasAbsolutePaces(lib)).toBe(false);
    expect(fromLibrarySteps(lib)).toEqual(steps);
  });

  it('stores a jog recovery as a recovery step with the word on it', () => {
    const lib = toLibrarySteps(mockup());
    expect(lib[1].repeatSteps?.[1]).toMatchObject({ type: 'recovery', notes: 'ג׳וג', durationValue: 120 });
  });

  it('resolves through the existing pipeline to the typed pace', () => {
    const workout = resolveLibraryWorkout({ name: 'x', notes: null, steps: toLibrarySteps(mockup()) }, { thresholdPaceSec: T, dayOfWeek: 2 });
    const work = workout!.steps[1].repeatSteps![0];
    expect(work.targetPaceMinPerKm).toBeLessThan(245);
    expect(work.targetPaceMaxPerKm).toBeGreaterThan(245);
    expect(Math.round((work.targetPaceMinPerKm! + work.targetPaceMaxPerKm!) / 2)).toBeGreaterThanOrEqual(244);
  });

  it('reads what the old book editor wrote', () => {
    const old = [
      { order: 1, type: 'warmup', durationType: 'distance', durationValue: 2000, targetType: 'pace', targetZone: 'easy', intensity: { fastPct: 80, slowPct: 72 } },
      { order: 2, type: 'interval', durationType: 'distance', targetType: 'no_target', repeatCount: 6, repeatSteps: [
        { order: 1, type: 'interval', durationType: 'distance', durationValue: 800, targetType: 'pace', targetZone: 'interval', intensity: { fastPct: 110, slowPct: 105 } },
        { order: 2, type: 'rest', durationType: 'time', durationValue: 90, targetType: 'no_target', notes: '2:00 הליכה' },
      ] },
    ] as never;
    const model = fromLibrarySteps(old)!;
    expect(model[1]).toMatchObject({ kind: 'reps', count: 6, rest: { mode: 'walk', note: '2:00 הליכה' } });
    expect(toLibrarySteps(model)[1].repeatSteps![1].notes).toBe('2:00 הליכה');
  });

  it('refuses what it cannot say exactly', () => {
    const nested = [{ order: 1, type: 'interval', durationType: 'distance', targetType: 'no_target', repeatCount: 3, repeatSteps: [
      { order: 1, type: 'interval', durationType: 'distance', targetType: 'no_target', repeatCount: 4, repeatSteps: [] },
      { order: 2, type: 'interval', durationType: 'distance', durationValue: 200, targetType: 'no_target' },
      { order: 3, type: 'rest', durationType: 'time', durationValue: 60, targetType: 'no_target' },
    ] }] as never;
    expect(fromLibrarySteps(nested)).toBeNull();
  });
});

describe('absolute → relative', () => {
  const club: WorkoutStep[] = [
    { order: 1, type: 'warmup', durationType: 'distance', durationValue: 3000, targetType: 'pace', targetPaceMinPerKm: 280, targetPaceMaxPerKm: 280, notes: '4:40' },
    { order: 2, type: 'interval', durationType: 'distance', targetType: 'no_target', repeatCount: 5, repeatSteps: [
      { order: 1, type: 'interval', durationType: 'distance', durationValue: 1000, targetType: 'pace', targetPaceMinPerKm: 200, targetPaceMaxPerKm: 205, notes: '3:20 (3:30) ((3:40))', group2Pace: { min: 210, max: 210 } },
      { order: 2, type: 'rest', durationType: 'time', durationValue: 120, targetType: 'no_target', notes: 'הליכה' },
    ] },
  ];

  it('states every pace as reference ÷ pace and strips paces from notes', () => {
    const { steps, review } = absoluteToLibrary(club, 203);
    expect(review).toEqual([]);
    expect(hasAbsolutePaces(steps)).toBe(false);
    const work = steps[1].repeatSteps![0];
    expect(work.intensity).toEqual({ fastPct: 101.5, slowPct: 99 });
    expect(work.notes).toBeUndefined();
    expect(steps[0].notes).toBeUndefined();
    expect(steps[1].repeatSteps![1].notes).toBe('הליכה');
  });

  it('a lane step resolves to the same pace for a trainee at the reference', () => {
    const { steps } = absoluteToLibrary(club, 203);
    const resolved = resolveLibraryWorkout({ name: '', notes: null, steps }, { thresholdPaceSec: 203, dayOfWeek: 0 })!;
    expect(resolved.steps[1].repeatSteps![0]).toMatchObject({ targetPaceMinPerKm: 200, targetPaceMaxPerKm: 205 });
  });

  it('an open easy day with its pace in the note is read and flagged', () => {
    const { steps, review } = absoluteToLibrary([
      { order: 1, type: 'active', durationType: 'open', targetType: 'no_target', notes: '60-80 דקות 4:40-5:15 כל 10 דקות גומי' },
    ], 270);
    expect(review).toEqual(expect.arrayContaining(['pace-from-note', 'length-from-note']));
    expect(steps[0]).toMatchObject({ durationType: 'time', durationValue: 4200, targetType: 'pace' });
    expect(hasAbsolutePaces(steps)).toBe(false);
  });

  it('pace text helpers', () => {
    expect(stripPaceText('3:50 (4:00) ((4:10)) מתגברת')).toBe('מתגברת');
    expect(stripPaceText('4:40-5:15')).toBeUndefined();
    expect(paceInNote('בקצב 4:45-4:30')).toEqual({ min: 270, max: 285 });
  });
});

describe('totals and the bar', () => {
  it('prices the mockup session at about 10 km and under an hour', () => {
    const t = bookTotals(mockup(), T);
    // 4 km easy + 5 km of reps + four 2:00 jogs.
    expect(t.distanceM).toBeGreaterThan(9900);
    expect(t.distanceM).toBeLessThan(10600);
    expect(t.durationSec).toBeGreaterThan(45 * 60);
    expect(t.durationSec).toBeLessThan(60 * 60);
    expect(t.estimated).toBe(false);
  });

  it('marks an estimate when there is no test', () => {
    expect(bookTotals(mockup(), null).estimated).toBe(true);
  });

  it('draws e, then alternating f and r, then e — no rest after the last rep', () => {
    const tones = profileBar(mockup(), T).map(s => s.tone).join('');
    expect(tones).toBe('efrfrfrfrfe');
  });
});

describe('adjusting', () => {
  it('the quick row edits the main set', () => {
    const steps = mockup();
    expect(mainStepIndex(steps)).toBe(1);
    expect(quickFields(steps).map(f => f.field)).toEqual(['count', 'length', 'pace']);
    expect(fieldValue(steps, { step: 1, field: 'pace' }, T)).toBe(245);
  });

  it('± walks the coaching grids', () => {
    let steps = mockup();
    steps = nudgeField(steps, { step: 1, field: 'count' }, 1, T);
    expect(fieldValue(steps, { step: 1, field: 'count' }, T)).toBe(6);
    steps = nudgeField(steps, { step: 1, field: 'length' }, 1, T);
    expect(fieldValue(steps, { step: 1, field: 'length' }, T)).toBe(1200);
    steps = nudgeField(steps, { step: 1, field: 'length' }, -1, T);
    expect(fieldValue(steps, { step: 1, field: 'length' }, T)).toBe(1000);
    steps = nudgeField(steps, { step: 1, field: 'length' }, -1, T);
    expect(fieldValue(steps, { step: 1, field: 'length' }, T)).toBe(900);
    steps = nudgeField(steps, { step: 1, field: 'rest' }, 1, T);
    expect(fieldValue(steps, { step: 1, field: 'rest' }, T)).toBe(150);
    steps = nudgeField(steps, { step: 0, field: 'length' }, 1, T);
    expect(fieldValue(steps, { step: 0, field: 'length' }, T)).toBe(2500);
  });

  it('pace + is five seconds slower, and stays a share of threshold', () => {
    const steps = nudgeField(mockup(), { step: 1, field: 'pace' }, 1, T);
    expect(fieldValue(steps, { step: 1, field: 'pace' }, T)).toBe(250);
    const reps = steps[1];
    if (reps.kind !== 'reps' || !reps.effort) throw new Error();
    expect(reps.effort.intensity.fastPct - reps.effort.intensity.slowPct).toBeCloseTo(3, 5);
  });

  it('pace with no threshold moves the percentage, never invents a pace', () => {
    const before = fieldValue(mockup(), { step: 1, field: 'pace' }, null)!;
    const after = fieldValue(nudgeField(mockup(), { step: 1, field: 'pace' }, 1, null), { step: 1, field: 'pace' }, null)!;
    expect(after).toBeCloseTo(before - 1, 5);
  });

  it('never edits the steps it was given', () => {
    const steps = mockup();
    const copy = JSON.parse(JSON.stringify(steps));
    setField(steps, { step: 1, field: 'count' }, 9, T);
    expect(steps).toEqual(copy);
  });

  it('wheel options contain the current value', () => {
    expect(wheelOptions(mockup(), { step: 1, field: 'pace' }, T)).toContain(245);
    expect(wheelOptions(mockup(), { step: 1, field: 'length' }, T)).toContain(1000);
    expect(wheelOptions(mockup(), { step: 1, field: 'count' }, T)).toContain(5);
  });

  it('+ שלב goes before the cooldown', () => {
    const steps = addStep(mockup(), 'rest');
    expect(steps[2]).toMatchObject({ kind: 'rest' });
    expect(steps[3]).toMatchObject({ kind: 'run', role: 'cooldown' });
  });
});

describe('identity', () => {
  it('two paces of the same session share a key', () => {
    const a = toLibrarySteps(mockup());
    const b = toLibrarySteps(setField(mockup(), { step: 1, field: 'pace' }, 240, T));
    expect(structureKey(a)).toBe(structureKey(b));
  });

  it('a different rep count is a different session', () => {
    const b = toLibrarySteps(setField(mockup(), { step: 1, field: 'count' }, 6, T));
    expect(structureKey(toLibrarySteps(mockup()))).not.toBe(structureKey(b));
  });

  it('names sessions the way the mockup does', () => {
    expect(structureName(mockup())).toBe('5 × 1 ק״מ');
    expect(structureName(setField(mockup(), { step: 1, field: 'length' }, 800, T))).toBe('5 × 800 מ׳');
    expect(structureName([{ kind: 'run', role: 'main', length: { measure: 'time', value: 1200 }, effort: effortFromZone('tempo') }])).toBe('טמפו 20 דקות');
    expect(structureName([{ kind: 'run', role: 'main', length: { measure: 'distance', value: 16000 }, effort: effortFromZone('easy') }])).toBe('16 ק״מ ארוכה');
    expect(structureName([
      { kind: 'run', role: 'warmup', length: { measure: 'distance', value: 2000 }, effort: effortFromZone('easy') },
      { kind: 'reps', count: 3, work: { measure: 'distance', value: 2000 }, effort: effortFromZone('tempo'), rest: null },
    ])).toBe('3 × 2 ק״מ טמפו');
  });

  it('guesses the chip', () => {
    expect(guessKind(mockup())).toBe('intervals');
    expect(guessKind(mockup(), 'גבעות')).toBe('hills');
    expect(guessKind([{ kind: 'run', role: 'main', length: { measure: 'distance', value: 16000 }, effort: effortFromZone('easy') }])).toBe('long');
  });
});
