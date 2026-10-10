import { describe, expect, it } from 'vitest';
import type { ParsedWorkout } from '@/lib/ai/types';
import { laneForBand } from '@/lib/academy/group-lane';
import {
  DEFAULT_LANE_GOAL_SEC, goalFromGroupName, laneReferences, pickSeniorDay, referenceFromGoal,
} from '@/lib/academy/senior-pick';
import { COMPLIANCE_HEX, complianceOf, meterFraction, weekTotals } from '@/lib/academy/compliance';
import { buildImport, importSummary } from '@/lib/academy/book-import';
import { effortPace, fromLibrarySteps } from '@/lib/academy/book-steps';
import { hasAbsolutePaces, resolveLibraryWorkout } from '@/lib/academy/library';

// ── Fixtures: a club week in both stored shapes ────────────────────────────────────────

const intervals = (lanePaces: [number, number, number]): ParsedWorkout => ({
  dayOfWeek: 2,
  name: 'שלישי',
  steps: [
    { order: 1, type: 'warmup', durationType: 'distance', durationValue: 2000, targetType: 'pace', targetPaceMinPerKm: 300, targetPaceMaxPerKm: 300, notes: '5:00' },
    { order: 2, type: 'interval', durationType: 'distance', targetType: 'no_target', repeatCount: 5, repeatSteps: [
      {
        order: 1, type: 'interval', durationType: 'distance', durationValue: 1000, targetType: 'pace',
        targetPaceMinPerKm: lanePaces[0], targetPaceMaxPerKm: lanePaces[0],
        group2Pace: { min: lanePaces[1], max: lanePaces[1] }, group3Pace: { min: lanePaces[2], max: lanePaces[2] },
        notes: `${Math.floor(lanePaces[0] / 60)}:${String(lanePaces[0] % 60).padStart(2, '0')}`,
      },
      { order: 2, type: 'rest', durationType: 'time', durationValue: 120, targetType: 'no_target', notes: 'הליכה' },
    ] },
    { order: 3, type: 'cooldown', durationType: 'distance', durationValue: 2000, targetType: 'pace', targetPaceMinPerKm: 300, targetPaceMaxPerKm: 300 },
  ],
});

const tempo: ParsedWorkout = {
  dayOfWeek: 4,
  name: 'חמישי',
  steps: [
    { order: 1, type: 'warmup', durationType: 'distance', durationValue: 2000, targetType: 'pace', targetZone: 'easy' },
    { order: 2, type: 'active', durationType: 'time', durationValue: 1200, targetType: 'pace', targetZone: 'tempo', targetPaceMinPerKm: 210, targetPaceMaxPerKm: 215 },
  ],
};

const easy: ParsedWorkout = {
  dayOfWeek: 1,
  name: 'שני',
  steps: [{ order: 1, type: 'active', durationType: 'distance', durationValue: 10000, targetType: 'pace', targetZone: 'easy' }],
};

const long: ParsedWorkout = {
  dayOfWeek: 6,
  name: 'שבת',
  steps: [{ order: 1, type: 'active', durationType: 'distance', durationValue: 16000, targetType: 'pace', targetPaceMinPerKm: 260, targetPaceMaxPerKm: 280 }],
};

const unified = { workouts: [easy, intervals([200, 210, 220]), tempo, long] };
const split = {
  group1: { workouts: [intervals([200, 200, 200])] },
  group2: { workouts: [intervals([210, 210, 210])] },
  group3: { workouts: [intervals([220, 220, 220])] },
};

describe('lane references', () => {
  it('reads the squad goal out of the group name', () => {
    expect(goalFromGroupName('Group A - SUB 2:30')).toBe(9000);
    expect(goalFromGroupName('sub 2:45')).toBe(9900);
    expect(goalFromGroupName('קבוצה 1')).toBeNull();
  });

  it('turns a marathon goal into the threshold it was written for', () => {
    // 2:30 marathon → 3:33/km → ÷0.95 speed → 3:23/km threshold.
    expect(referenceFromGoal(DEFAULT_LANE_GOAL_SEC[1])).toBe(203);
    const refs = laneReferences();
    expect(refs[1]).toBeLessThan(refs[2]);
    expect(refs[2]).toBeLessThan(refs[3]);
  });

  it('a group name overrides the default', () => {
    expect(laneReferences([{ name: 'SUB 3:00', lane: 3 }])[3]).toBe(referenceFromGoal(3 * 3600));
  });
});

describe('the senior-group pick', () => {
  it('takes the trainee\'s lane from their band', () => {
    expect(laneForBand(4)).toBe(1);
    expect(laneForBand(7)).toBe(2);
    expect(laneForBand(9)).toBe(3);
  });

  it('finds the session on the trainee\'s day in their lane, at their pace', () => {
    const pick = pickSeniorDay(unified, 2, 2, 210);
    expect(pick.today?.name).toBe('5 × 1 ק״מ');
    expect(hasAbsolutePaces(pick.today!.steps)).toBe(false);
    // Lane 2's rep pace (210) against lane 2's reference (210) is exactly threshold: a
    // trainee with a 4:30 threshold runs it at 4:30.
    const resolved = resolveLibraryWorkout({ name: '', notes: null, steps: pick.today!.steps }, { thresholdPaceSec: 270, dayOfWeek: 2 })!;
    expect(resolved.steps[1].repeatSteps![0]).toMatchObject({ targetPaceMinPerKm: 270, targetPaceMaxPerKm: 270 });
  });

  it('reads the older three-bucket shape the same way', () => {
    const pick = pickSeniorDay(split, 3, 2, 220);
    const reps = pick.today!.model![1];
    if (reps.kind !== 'reps' || !reps.effort) throw new Error();
    expect(effortPace(reps.effort, 300)).toBe(300);
  });

  it('lists the week\'s other real sessions, by day, without the easy days', () => {
    const pick = pickSeniorDay(unified, 1, 2, 203);
    expect(pick.others.map(o => o.dayOfWeek)).toEqual([4, 6]);
    expect(pick.others[0].name).toBe('טמפו 20 דקות');
  });

  it('a day the club rests is null, not a guess', () => {
    const pick = pickSeniorDay(unified, 1, 3, 203);
    expect(pick.today).toBeNull();
  });

  it('prefers the prescribed main part of a split day', () => {
    const day: ParsedWorkout[] = [
      { ...easy, dayOfWeek: 2, partKind: 'evening', optional: true, name: 'ערב' },
      { ...intervals([200, 200, 200]), partKind: 'morning', name: 'בוקר' },
    ];
    expect(pickSeniorDay({ workouts: day }, 1, 2, 203).today?.clubName).toBe('בוקר');
  });

  it('no plan at all', () => {
    expect(pickSeniorDay(null, 1, 2, 203)).toEqual({ lane: 1, today: null, others: [] });
  });
});

describe('compliance', () => {
  const base = { date: '2026-10-11', today: '2026-10-13', completed: true, plannedSec: 3000, actualSec: 3000 };

  it('green within ±20%', () => {
    expect(complianceOf({ ...base, plannedM: 10000, actualM: 8000 }).color).toBe('green');
    expect(complianceOf({ ...base, plannedM: 10000, actualM: 12000 }).color).toBe('green');
  });

  it('yellow with a caret just outside', () => {
    expect(complianceOf({ ...base, plannedM: 10000, actualM: 7900 })).toMatchObject({ color: 'yellow', caret: 'down' });
    expect(complianceOf({ ...base, plannedM: 10000, actualM: 5000 })).toMatchObject({ color: 'yellow', caret: 'down' });
    expect(complianceOf({ ...base, plannedM: 10000, actualM: 12100 })).toMatchObject({ color: 'yellow', caret: 'up' });
    expect(complianceOf({ ...base, plannedM: 10000, actualM: 15000 })).toMatchObject({ color: 'yellow', caret: 'up' });
  });

  it('orange beyond', () => {
    expect(complianceOf({ ...base, plannedM: 10000, actualM: 4900 })).toMatchObject({ color: 'orange', caret: 'down' });
    expect(complianceOf({ ...base, plannedM: 10000, actualM: 15100 })).toMatchObject({ color: 'orange', caret: 'up' });
  });

  it('red when the day has passed with no run; grey today and later', () => {
    expect(complianceOf({ ...base, completed: false, plannedM: 10000, actualM: null }).color).toBe('red');
    expect(complianceOf({ ...base, date: '2026-10-13', completed: false, plannedM: 10000, actualM: null }).color).toBe('grey');
    expect(complianceOf({ ...base, date: '2026-10-15', completed: false, plannedM: 10000, actualM: null }).color).toBe('grey');
  });

  it('a session planned in time is judged on time', () => {
    expect(complianceOf({ ...base, plannedInTime: true, plannedM: 10000, actualM: 4000, plannedSec: 3000, actualSec: 2900 }).measure).toBe('time');
    expect(complianceOf({ ...base, plannedM: null, actualM: 9000, plannedSec: 3000, actualSec: 1200 })).toMatchObject({ color: 'orange', measure: 'time' });
  });

  it('done with nothing to compare is green', () => {
    expect(complianceOf({ ...base, plannedM: null, actualM: 5000, plannedSec: null, actualSec: 1500 }).color).toBe('green');
  });

  it('has a colour for each state', () => {
    expect(Object.keys(COMPLIANCE_HEX)).toHaveLength(5);
  });

  it('week totals, planned vs done', () => {
    const t = weekTotals([
      { completed: true, plannedM: 9900, actualM: 9900, plannedSec: 3000, actualSec: 3100 },
      { completed: true, plannedM: 10000, actualM: 8400, plannedSec: 3100, actualSec: 2600 },
      { completed: false, plannedM: 10500, actualM: null, plannedSec: 3300, actualSec: null },
      { completed: false, plannedM: 16000, actualM: null, plannedSec: 5400, actualSec: null },
    ]);
    expect(t).toEqual({ plannedKm: 46.4, doneKm: 18.3, plannedCount: 4, doneCount: 2, plannedSec: 14800, doneSec: 5700 });
    expect(meterFraction(t.doneKm, t.plannedKm)).toBeCloseTo(0.394, 2);
    expect(meterFraction(5, 0)).toBe(1);
    expect(meterFraction(50, 10)).toBe(1);
  });
});

describe('the import', () => {
  const plans = [
    { id: 'p1', athleteId: null, weekStart: '2026-09-06', parsed: unified },
    { id: 'p2', athleteId: null, weekStart: '2026-09-13', parsed: { workouts: [intervals([205, 215, 225])] } },
    { id: 'p3', athleteId: 'shahar', weekStart: '2026-09-20', parsed: { workouts: [intervals([245, 245, 245])] } },
    { id: 'p4', athleteId: 'noa', weekStart: '2026-09-20', parsed: { workouts: [tempo] } },
  ];

  const build = (existing: never[] = []) => buildImport({
    plans, thresholds: { shahar: 248, noa: null }, clubReferenceSec: 203, existing,
  });

  it('dedupes one session across weeks and sources into one entry with a count', () => {
    const list = build();
    const reps = list.find(c => c.name === '5 × 1 ק״מ')!;
    expect(reps.uses).toBe(3);
    expect(reps.sources.map(s => s.origin)).toEqual(['club', 'club', 'academy']);
    expect(reps.status).toBe('new');
    expect(hasAbsolutePaces(reps.steps!)).toBe(false);
    // The median of 203/200, 203/205 and 248/245 — all close to threshold.
    const model = fromLibrarySteps(reps.steps!)!;
    const work = model[1];
    if (work.kind !== 'reps' || !work.effort) throw new Error();
    expect(work.effort.intensity.fastPct).toBeCloseTo(101.2, 1);
  });

  it('sorts by use', () => {
    const list = build();
    expect(list[0].name).toBe('5 × 1 ק״מ');
  });

  it('never converts against a guess: no test is "needs review" and unsaveable', () => {
    const noTest = build().find(c => c.reasons.includes('no-test'))!;
    expect(noTest.status).toBe('review');
    expect(noTest.saveable).toBe(false);
    expect(noTest.steps).toBeNull();
  });

  it('marks what is already in the book', () => {
    const first = build().find(c => c.name === '5 × 1 ק״מ')!;
    const list = buildImport({
      plans, thresholds: { shahar: 248 }, clubReferenceSec: 203,
      existing: [{ id: 'e1', name: 'החמישייה', steps: first.steps! }],
    });
    const again = list.find(c => c.key === first.key)!;
    expect(again).toMatchObject({ status: 'existing', existingId: 'e1', saveable: false });
  });

  it('keeps names unique on the shelf', () => {
    const list = buildImport({
      plans: [{ id: 'p', athleteId: null, weekStart: '2026-09-06', parsed: unified }],
      thresholds: {}, clubReferenceSec: 203,
      existing: [{ id: 'e', name: 'טמפו 20 דקות', steps: [] }],
    });
    expect(list.find(c => c.key.includes('t1200'))!.name).toBe('טמפו 20 דקות (2)');
  });

  it('summarises the review list', () => {
    // The 5 × 1 km set, the tempo, the long run and the easy day; Noa's tempo has no test.
    expect(importSummary(build())).toEqual({ new: 4, existing: 0, review: 1 });
  });
});
