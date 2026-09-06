import { describe, it, expect } from 'vitest';
import {
  countSets,
  groupLadders,
  isPaceLadder,
  ladderPaces,
  paceCarrier,
  profileSegments,
  tableRows,
  workoutSections,
} from '@/lib/plans/workout-shape';
import type { WorkoutStep } from '@/lib/ai/types';

// The steps below are the real week of 2026-09-06, group ❶. Tuesday morning is
// the case that drove this: fifteen steps, twelve of them behind a "+12 more".

function step(over: Partial<WorkoutStep> = {}): WorkoutStep {
  return {
    order: 1,
    type: 'active',
    durationType: 'distance',
    durationValue: 1000,
    targetType: 'pace',
    ...over,
  } as WorkoutStep;
}

/** 45 seconds at `pace`, noted the way the program writes it ("3:50"). */
const rung = (pace: number) =>
  step({
    type: 'interval', durationType: 'time', durationValue: 45,
    targetPaceMinPerKm: pace, targetPaceMaxPerKm: pace,
    notes: `${Math.floor(pace / 60)}:${String(pace % 60).padStart(2, '0')}`,
  });

/** 2 × (2 km @pace + 3 min jog) — Tuesday has three of these at 3:35/3:30/3:25. */
const kmSet = (pace: number) =>
  step({
    type: 'interval',
    durationType: 'distance',
    durationValue: undefined,
    repeatCount: 2,
    repeatSteps: [
      step({ type: 'interval', durationValue: 2000, targetPaceMinPerKm: pace, targetPaceMaxPerKm: pace }),
      step({ type: 'recovery', durationType: 'time', durationValue: 180, targetType: 'no_target', notes: 'ג׳וג' }),
    ],
  });

const TUESDAY_MORNING: WorkoutStep[] = [
  step({ type: 'warmup', durationValue: 2000, targetPaceMinPerKm: 300, targetPaceMaxPerKm: 300 }),
  step({ type: 'warmup', durationValue: 2000, targetPaceMinPerKm: 280, targetPaceMaxPerKm: 280 }),
  step({ type: 'rest', durationType: 'time', durationValue: 120, targetType: 'no_target', notes: 'הליכה' }),
  rung(230), rung(220), rung(210), rung(200),
  step({ type: 'rest', durationType: 'time', durationValue: 120, targetType: 'no_target', notes: 'הליכה' }),
  step({
    type: 'interval', durationValue: undefined, repeatCount: 2,
    repeatSteps: [
      step({ type: 'interval', durationType: 'time', durationValue: 20, targetType: 'no_target', notes: 'מתגברת' }),
      step({ type: 'rest', durationType: 'time', durationValue: 40, targetType: 'no_target', notes: 'הליכה' }),
    ],
  }),
  kmSet(215), kmSet(210), kmSet(205),
  step({ durationValue: 1000, targetPaceMinPerKm: 300, targetPaceMaxPerKm: 330 }),
  step({
    type: 'interval', durationValue: undefined, repeatCount: 5,
    repeatSteps: [
      step({ type: 'interval', durationValue: 300, targetPaceMinPerKm: 210, notes: '3:30 לא מהר מזה!' }),
      step({ type: 'rest', durationType: 'time', durationValue: 60, targetType: 'no_target', notes: 'הליכה' }),
    ],
  }),
  step({ durationValue: 1000, targetPaceMinPerKm: 300, targetPaceMaxPerKm: 330 }),
];

describe('workoutSections', () => {
  it('splits Tuesday into warmup / main / cooldown', () => {
    const sections = workoutSections(TUESDAY_MORNING);
    expect(sections.map((s) => s.kind)).toEqual(['warmup', 'main', 'cooldown']);
    expect(sections[0].steps).toHaveLength(2);
    // The trailing 1 km at 5:00-5:30 is the jog home; the identical 1 km in the
    // MIDDLE of the session is not, and must stay in the main block.
    expect(sections[2].steps).toHaveLength(1);
    expect(sections[1].steps.filter((s) => s.durationValue === 1000)).toHaveLength(1);
  });

  it('never emits an empty section', () => {
    const sections = workoutSections([step({ durationType: 'open', durationValue: undefined })]);
    expect(sections).toHaveLength(1);
    expect(sections[0].kind).toBe('main');
  });

  it('does not label sections on a session that is one block', () => {
    // Monday is a single 60-minute run. One section means no headings at all.
    expect(workoutSections([step({ durationType: 'time', durationValue: 3600 })])).toHaveLength(1);
  });

  it('keeps a mid-session walk recovery out of the cooldown', () => {
    const steps = [
      step({ type: 'warmup', durationValue: 2000 }),
      step({ type: 'rest', durationType: 'time', durationValue: 120, targetType: 'no_target' }),
      rung(220),
    ];
    const sections = workoutSections(steps);
    expect(sections.map((s) => s.kind)).toEqual(['warmup', 'main']);
    expect(sections[1].steps).toHaveLength(2);
  });
});

describe('groupLadders', () => {
  it('merges the four 45-second reps into one ladder', () => {
    const items = groupLadders([rung(230), rung(220), rung(210), rung(200)]);
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe('ladder');
    expect(ladderPaces(items[0].kind === 'ladder' ? items[0].steps : [])).toEqual(['3:50', '3:40', '3:30', '3:20']);
  });

  it('merges the three 2 × 2 km sets, which differ only in pace', () => {
    const items = groupLadders([kmSet(215), kmSet(210), kmSet(205)]);
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe('ladder');
    expect(ladderPaces(items[0].kind === 'ladder' ? items[0].steps : [])).toEqual(['3:35', '3:30', '3:25']);
  });

  it('groups all of Tuesday morning without losing a step', () => {
    const items = groupLadders(TUESDAY_MORNING);
    const flat = items.flatMap((item) => (item.kind === 'ladder' ? item.steps : [item.step]));
    expect(flat).toEqual(TUESDAY_MORNING);
    // 15 steps become 10 rows: the 45-second ladder and the three 2 km sets each
    // collapse to one line, and nothing is behind a "+more".
    expect(items).toHaveLength(10);
    expect(items.filter((item) => item.kind === 'ladder')).toHaveLength(2);
  });

  it('leaves two in a row alone', () => {
    expect(groupLadders([rung(230), rung(220)]).map((i) => i.kind)).toEqual(['step', 'step']);
  });

  it('will not merge a set with two working legs', () => {
    // Thursday: 6 × (9 דק׳ @4:25 + 1 דק׳ @3:40). There is no single pace for a
    // rung, so it stays a set of its own however many follow it.
    const surge = () => step({
      type: 'interval', durationValue: undefined, repeatCount: 6,
      repeatSteps: [
        step({ type: 'interval', durationType: 'time', durationValue: 540, targetPaceMinPerKm: 265 }),
        step({ type: 'interval', durationType: 'time', durationValue: 60, targetPaceMinPerKm: 220 }),
      ],
    });
    expect(paceCarrier(surge())).toBeNull();
    expect(groupLadders([surge(), surge(), surge()]).map((i) => i.kind)).toEqual(['step', 'step', 'step']);
  });

  it('will not merge steps that carry group 2 / group 3 paces', () => {
    // Those would have to be stacked as "3:50 (4:00) ((4:10))" across four rungs.
    const banded = (pace: number) => step({
      ...rung(pace), group2Pace: { min: pace + 10, max: pace + 10 }, group3Pace: { min: pace + 20, max: pace + 20 },
    });
    expect(groupLadders([banded(230), banded(220), banded(210)]).map((i) => i.kind))
      .toEqual(['step', 'step', 'step']);
  });

  it('will not merge steps whose notes say different things', () => {
    const plain = rung(220);
    const shouted = step({ ...rung(220), notes: '3:40 לא מהר מזה!' });
    expect(groupLadders([plain, shouted, plain]).map((i) => i.kind)).toEqual(['step', 'step', 'step']);
  });

  it('never merges warmups or recoveries', () => {
    const warm = () => step({ type: 'warmup', durationValue: 2000, targetPaceMinPerKm: 300 });
    expect(groupLadders([warm(), warm(), warm()]).map((i) => i.kind)).toEqual(['step', 'step', 'step']);
  });
});

describe('tableRows', () => {
  it('gives every leg of a set its own row, under a header for the set', () => {
    const rows = tableRows([kmSet(215)]);
    expect(rows.map((r) => r.kind)).toEqual(['repeat', 'leg', 'leg']);
    expect(rows[0]).toMatchObject({ count: 2 });
    // The 2 km and the jog are separate rows, so each can carry its own paces.
    expect(rows[1].step.durationValue).toBe(2000);
    expect(rows[2].step.notes).toBe('ג׳וג');
  });

  it('leaves a plain step as one row', () => {
    expect(tableRows([step()]).map((r) => r.kind)).toEqual(['step']);
  });

  it('keeps the steps in the order the session runs them', () => {
    const rows = tableRows(TUESDAY_MORNING);
    // Fifteen steps in, nothing hidden: 10 plain + 5 blocks × (1 header + 2 legs).
    expect(rows).toHaveLength(10 + 5 * 3);
    expect(rows[0].kind).toBe('step');
    expect(rows.filter((r) => r.kind === 'repeat')).toHaveLength(5);
  });

  it('does not treat a repeatCount with no legs as a block', () => {
    // The zero-length wrapper the parser sometimes leaves behind.
    expect(tableRows([step({ repeatCount: 4, repeatSteps: [] })]).map((r) => r.kind)).toEqual(['step']);
  });
});

describe('isPaceLadder', () => {
  it('is true when the rungs climb', () => {
    expect(isPaceLadder([rung(230), rung(220), rung(210)])).toBe(true);
  });

  it('is false for three identical sets — that is "3 ×", not a ladder', () => {
    expect(isPaceLadder([rung(220), rung(220), rung(220)])).toBe(false);
  });
});

describe('countSets', () => {
  it('counts Tuesday morning as four sets, matching the four rows drawn', () => {
    expect(countSets(TUESDAY_MORNING)).toBe(4);
  });

  it('counts Sunday as one set', () => {
    const strides = step({
      type: 'interval', durationValue: undefined, repeatCount: 8,
      repeatSteps: [
        step({ type: 'interval', durationType: 'time', durationValue: 15, targetType: 'no_target', notes: 'מתגברת' }),
        step({ type: 'rest', durationType: 'time', durationValue: 45, targetType: 'no_target', notes: 'הליכה' }),
      ],
    });
    expect(countSets([step({ type: 'warmup', durationValue: 2000 }), step({ durationValue: 20000 }), strides])).toBe(1);
  });

  it('is zero for a steady run', () => {
    expect(countSets([step({ durationType: 'time', durationValue: 3600 })])).toBe(0);
  });
});

describe('profileSegments', () => {
  it('draws a repetition at a time, so eight reps look like eight reps', () => {
    const strides = step({
      type: 'interval', durationValue: undefined, repeatCount: 8,
      repeatSteps: [
        step({ type: 'interval', durationType: 'time', durationValue: 15, targetType: 'no_target' }),
        step({ type: 'rest', durationType: 'time', durationValue: 45, targetType: 'no_target' }),
      ],
    });
    const segments = profileSegments([strides]);
    expect(segments).toHaveLength(16);
    expect(segments[0]).toEqual({ type: 'interval', sec: 15 });
    expect(segments[1]).toEqual({ type: 'rest', sec: 45 });
  });

  it('collapses a set too dense to read into one segment per leg', () => {
    // Tuesday evening is 20 × (500 m + 60 s jog): 40 segments of hatching.
    const long = step({
      type: 'interval', durationValue: undefined, repeatCount: 20,
      repeatSteps: [
        step({ type: 'interval', durationValue: 500, targetPaceMinPerKm: 205, targetPaceMaxPerKm: 205 }),
        step({ type: 'recovery', durationType: 'time', durationValue: 60, targetType: 'no_target' }),
      ],
    });
    const segments = profileSegments([long]);
    expect(segments).toHaveLength(2);
    expect(segments[0].sec).toBe(Math.round(0.5 * 205) * 20);
    expect(segments[1].sec).toBe(1200);
  });

  it('drops steps with no measurable duration instead of drawing a zero-width sliver', () => {
    expect(profileSegments([step({ durationType: 'open', durationValue: undefined })])).toHaveLength(0);
  });
});
