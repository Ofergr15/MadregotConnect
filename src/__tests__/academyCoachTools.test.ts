import { describe, it, expect } from 'vitest';
import {
  activeAdjust, adjustFor, applyPaceAdjust, checkKind, copyDefaults, copyWeek, copyWorkout, detectMissed,
  detectPaceSuggestion, hrVerdict, isLongRun, isMissedDecided, isPaceSnoozed, mainPaceOf, noteReason, paceKindOf,
  pickNote, preselectMissed, progressModel, squareLabel, targetWeeks, PACE_SNOOZE_DAYS,
  type CoachDecision, type PaceSession, type WeekOfSessions,
} from '../lib/academy/coach-tools';
import { absoluteToLibrary, bookTotals, fromLibrarySteps, type BookStep } from '../lib/academy/book-steps';
import type { ParsedWorkout, WorkoutStep } from '../lib/ai/types';

const T = 268; // 4:28 threshold: 4:05 reps, 4:25 tempo, 5:30 easy

function pace(sec: number, rng = 0, zone?: string) {
  return { targetType: 'pace' as const, targetPaceMinPerKm: sec - rng, targetPaceMaxPerKm: sec + rng, ...(zone ? { targetZone: zone } : {}) };
}
function run(order: number, type: WorkoutStep['type'], metres: number, p: object): WorkoutStep {
  return { order, type, durationType: 'distance', durationValue: metres, ...p } as WorkoutStep;
}
function reps(order: number, count: number, metres: number, p: object, restSec = 120): WorkoutStep {
  return {
    order, type: 'interval', durationType: 'distance', targetType: 'no_target', repeatCount: count,
    repeatSteps: [
      { order: 1, type: 'interval', durationType: 'distance', durationValue: metres, ...p } as WorkoutStep,
      { order: 2, type: 'recovery', durationType: 'time', durationValue: restSec, targetType: 'no_target', notes: 'ג׳וג' },
    ],
  };
}
const sixBy800: ParsedWorkout = {
  dayOfWeek: 0, name: 'ראשון',
  steps: [run(1, 'warmup', 2000, pace(330)), reps(2, 6, 800, pace(245, 2, 'interval')), run(3, 'cooldown', 1500, pace(330))],
};
const tempo3x2: ParsedWorkout = {
  dayOfWeek: 4, name: 'חמישי',
  steps: [run(1, 'warmup', 2000, pace(330)), reps(2, 3, 2000, pace(265, 3, 'tempo')), run(3, 'cooldown', 2000, pace(330))],
};
const long16: ParsedWorkout = { dayOfWeek: 6, name: 'שבת', steps: [run(1, 'active', 16000, pace(330, 5, 'easy'))] };

const model = (w: ParsedWorkout, ref = T): BookStep[] => fromLibrarySteps(absoluteToLibrary(w.steps, ref).steps)!;

const s = (date: string, kind: PaceSession['kind'], plannedSec: number, actualSec: number, avgHr: number | null = 150): PaceSession =>
  ({ date, kind, plannedSec, actualSec, avgHr });

// The mockup's five sessions: 3:58 4:06 3:57 3:59 3:56 against a 4:05 plan.
const MOCKUP: PaceSession[] = [
  s('2026-09-13', 'reps', 245, 238), s('2026-09-20', 'reps', 245, 246), s('2026-09-27', 'reps', 245, 237),
  s('2026-10-04', 'reps', 245, 239), s('2026-10-08', 'reps', 245, 236),
];

describe('kinds', () => {
  it('splits paces by tone against the threshold', () => {
    expect(paceKindOf(245, T)).toBe('reps');
    expect(paceKindOf(265, T)).toBe('tempo');
    expect(paceKindOf(330, T)).toBe('easy');
  });
});

describe('pace suggestion — the detector', () => {
  it('fires on the mockup case: 4 of 5 faster, median 7 s/km', () => {
    const c = checkKind(MOCKUP, 'reps');
    expect(c.qualifies).toBe(true);
    if (!c.qualifies) return;
    expect(c.evidence.direction).toBe('faster');
    expect(c.evidence.moved).toBe(4);
    expect(c.evidence.deltaSec).toBe(-7);
    expect(c.evidence.proposedSec).toBe(-7);
    expect(c.evidence.halfSec).toBe(-3);
    expect(c.evidence.currentSec).toBe(245);
  });

  it('needs at least four sessions of the kind', () => {
    expect(checkKind(MOCKUP.slice(0, 3), 'reps')).toMatchObject({ qualifies: false, reason: 'few' });
  });

  it('a bare 5 s/km is not "more than 5"', () => {
    const edge = MOCKUP.map((x) => ({ ...x, actualSec: x.plannedSec - 5 }));
    expect(checkKind(edge, 'reps')).toMatchObject({ qualifies: false, reason: 'mixed' });
  });

  it('needs MOST of them to move, one way', () => {
    const half = [s('2026-09-01', 'reps', 245, 236), s('2026-09-02', 'reps', 245, 236), s('2026-09-03', 'reps', 245, 245), s('2026-09-04', 'reps', 245, 246)];
    expect(checkKind(half, 'reps')).toMatchObject({ qualifies: false, reason: 'mixed' });
  });

  it('works the other way: slower than plan', () => {
    const slow = MOCKUP.map((x) => ({ ...x, actualSec: x.plannedSec + 9 }));
    const c = checkKind(slow, 'reps');
    expect(c.qualifies && c.evidence.direction).toBe('slower');
    expect(c.qualifies && c.evidence.proposedSec).toBe(9);
  });

  it('a rising HR blocks it: faster by pushing is not fitness', () => {
    const hrUp = MOCKUP.map((x, i) => ({ ...x, avgHr: 150 + i * 3 }));
    expect(hrVerdict(hrUp)).toBe('rose');
    expect(checkKind(hrUp, 'reps')).toMatchObject({ qualifies: false, reason: 'hr-rose' });
  });

  it('missing HR is said, and counts for nothing either way', () => {
    const noHr = MOCKUP.map((x) => ({ ...x, avgHr: null }));
    const c = checkKind(noHr, 'reps');
    expect(c.qualifies && c.evidence.hr).toBe('missing');
    const partial = MOCKUP.map((x, i) => ({ ...x, avgHr: i === 4 ? 175 : null }));
    expect(hrVerdict(partial)).toBe('missing');
    expect(checkKind(partial, 'reps').qualifies).toBe(true);
  });

  it('flat HR is flat', () => {
    expect(hrVerdict(MOCKUP)).toBe('flat');
  });

  it('caps a big gap at 15 s/km', () => {
    const big = MOCKUP.map((x) => ({ ...x, actualSec: x.plannedSec - 30 }));
    const c = checkKind(big, 'reps');
    expect(c.qualifies && c.evidence.proposedSec).toBe(-15);
  });

  it('suggests only the kinds that moved, and keeps the easy pace in the table', () => {
    const sessions = [
      ...MOCKUP,
      s('2026-09-17', 'easy', 330, 331), s('2026-09-24', 'easy', 330, 329), s('2026-10-01', 'easy', 330, 333), s('2026-10-07', 'easy', 330, 330),
    ];
    const sug = detectPaceSuggestion({ athleteId: 'a', name: 'A', basisTestDate: '2026-09-10', since: null, sessions })!;
    expect(sug.kinds.map((k) => k.kind)).toEqual(['reps']);
    expect(sug.current).toMatchObject({ reps: 245, easy: 330 });
    expect(adjustFor(sug, 'apply')).toEqual({ reps: -7 });
    expect(adjustFor(sug, 'half')).toEqual({ reps: -3 });
  });

  it('a new test resets it: sessions before the test do not count', () => {
    const sug = detectPaceSuggestion({ athleteId: 'a', name: 'A', basisTestDate: '2026-09-30', since: null, sessions: MOCKUP });
    expect(sug).toBeNull();
  });

  it('no test, no suggestion', () => {
    expect(detectPaceSuggestion({ athleteId: 'a', name: 'A', basisTestDate: null, since: null, sessions: MOCKUP })).toBeNull();
  });

  it('after an update, only sessions from the week it applied count', () => {
    const sug = detectPaceSuggestion({ athleteId: 'a', name: 'A', basisTestDate: '2026-09-01', since: '2026-09-27', sessions: MOCKUP });
    expect(sug).toBeNull();
  });

  it('the key is the test: a new test is a new suggestion', () => {
    const a = detectPaceSuggestion({ athleteId: 'a', name: 'A', basisTestDate: '2026-09-01', since: null, sessions: MOCKUP })!;
    expect(a.key).toBe('pace:a:2026-09-01');
  });
});

describe('pace suggestion — snooze and decisions', () => {
  const now = Date.parse('2026-10-10T08:00:00Z');
  const snooze = (createdAt: string, basis = '2026-09-01'): CoachDecision =>
    ({ athleteId: 'a', kind: 'pace', action: 'snooze', basisTestDate: basis, weekStart: null, createdAt });

  it('"לא עכשיו" is quiet for 14 days', () => {
    expect(isPaceSnoozed([snooze('2026-10-01T08:00:00Z')], 'a', '2026-09-01', now)).toBe(true);
    const old = new Date(now - (PACE_SNOOZE_DAYS + 1) * 86_400_000).toISOString();
    expect(isPaceSnoozed([snooze(old)], 'a', '2026-09-01', now)).toBe(false);
  });

  it('a new test clears the snooze', () => {
    expect(isPaceSnoozed([snooze('2026-10-08T08:00:00Z', '2026-09-01')], 'a', '2026-10-05', now)).toBe(false);
  });

  it('the active update sums the decisions on the current test, and a new test drops them', () => {
    const d = (action: string, changes: object, basis: string, createdAt: string, weekStart = '2026-10-11'): CoachDecision =>
      ({ athleteId: 'a', kind: 'pace', action, basisTestDate: basis, weekStart, changes, createdAt });
    const list = [
      d('apply', { reps: -7, tempo: -6 }, '2026-09-01', '2026-10-01T00:00:00Z', '2026-10-04'),
      d('half', { reps: -3 }, '2026-09-01', '2026-10-09T00:00:00Z'),
      d('snooze', {}, '2026-09-01', '2026-10-09T01:00:00Z'),
      d('apply', { reps: -20 }, '2026-08-01', '2026-08-20T00:00:00Z'),
    ];
    const a = activeAdjust(list, '2026-09-01');
    expect(a.adjust).toEqual({ reps: -10, tempo: -6 });
    expect(a.fromWeek).toBe('2026-10-11');
    expect(activeAdjust(list, '2026-10-05').adjust).toEqual({});
  });

  it('a decided missed week stays decided', () => {
    const d: CoachDecision = { athleteId: 'a', kind: 'missed', action: 'talk', basisTestDate: null, weekStart: '2026-10-04', createdAt: '2026-10-10T00:00:00Z' };
    expect(isMissedDecided([d], 'a', '2026-10-04')).toBe(true);
    expect(isMissedDecided([d], 'a', '2026-10-11')).toBe(false);
  });
});

describe('pace update — re-resolving a planned session', () => {
  it('moves reps and tempo, leaves easy, and records what it applied', () => {
    const out = applyPaceAdjust(sixBy800, T, { reps: -7 });
    const rep = out.steps[1].repeatSteps![0];
    expect([rep.targetPaceMinPerKm, rep.targetPaceMaxPerKm]).toEqual([236, 240]);
    expect(out.steps[0].targetPaceMinPerKm).toBe(330);
    expect(out.paceAdjust).toEqual({ reps: -7 });
  });

  it('is idempotent, and a second update shifts only by the difference', () => {
    const once = applyPaceAdjust(sixBy800, T, { reps: -7 });
    expect(applyPaceAdjust(once, T, { reps: -7 })).toBe(once);
    const twice = applyPaceAdjust(once, T, { reps: -10 });
    expect(twice.steps[1].repeatSteps![0].targetPaceMinPerKm).toBe(233);
    const back = applyPaceAdjust(twice, T, {});
    expect(back.steps[1].repeatSteps![0].targetPaceMinPerKm).toBe(243);
    expect(back.paceAdjust).toBeUndefined();
  });

  it('shifts the pace written in a note, which the watch prints verbatim', () => {
    const w: ParsedWorkout = { dayOfWeek: 2, name: 'x', steps: [run(1, 'active', 6000, { ...pace(265), notes: 'בקצב 4:25' })] };
    expect(applyPaceAdjust(w, T, { tempo: -6 }).steps[0].notes).toBe('בקצב 4:19');
  });

  it('no threshold, no kinds: untouched', () => {
    expect(applyPaceAdjust(sixBy800, null, { reps: -7 })).toBe(sixBy800);
  });

  it('reads the main work pace', () => {
    expect(mainPaceOf(sixBy800)).toBe(245);
    expect(mainPaceOf(long16)).toBe(330);
  });
});

describe('missed workouts', () => {
  const week = (weekStart: string, colors: Array<[string, string, boolean?]>): WeekOfSessions => ({
    weekStart,
    sessions: colors.map(([date, color, isLong]) => ({
      date, dayOfWeek: new Date(`${date}T12:00:00Z`).getUTCDay(), label: 'x', color: color as never, isLong: !!isLong, plannedM: 10000,
    })),
  });

  it('two missed in this week', () => {
    const f = detectMissed([week('2026-10-04', [['2026-10-04', 'green'], ['2026-10-06', 'red'], ['2026-10-08', 'red'], ['2026-10-10', 'grey', true]])], '2026-10-10');
    expect(f).toEqual({ weekStart: '2026-10-04', missed: 2, planned: 4, rule: 'week' });
  });

  it('one missed is not enough, and today is not missed yet', () => {
    expect(detectMissed([week('2026-10-04', [['2026-10-06', 'red'], ['2026-10-10', 'red']])], '2026-10-10')).toBeNull();
  });

  it('two long runs missed in a row, across weeks', () => {
    const f = detectMissed([
      week('2026-09-27', [['2026-09-29', 'green'], ['2026-10-03', 'red', true]]),
      week('2026-10-04', [['2026-10-06', 'green'], ['2026-10-09', 'red', true]]),
    ], '2026-10-10');
    expect(f?.rule).toBe('long');
    expect(f?.weekStart).toBe('2026-10-04');
  });

  it('a long run in between that was run breaks the streak', () => {
    expect(detectMissed([
      week('2026-09-20', [['2026-09-26', 'red', true]]),
      week('2026-09-27', [['2026-10-03', 'green', true]]),
      week('2026-10-04', [['2026-10-09', 'red', true]]),
    ], '2026-10-10')).toBeNull();
  });

  it('the trainee\'s note picks the preselected option', () => {
    expect(noteReason('חולה, חום. אחזור כשאוכל.')).toBe('sick');
    expect(noteReason('כואב לי בברך')).toBe('pain');
    expect(noteReason('עבודה מטורפת השבוע')).toBeNull();
    expect(noteReason('', true)).toBe('pain');
    expect(preselectMissed('sick')).toBe('light');
    expect(preselectMissed('pain')).toBe('light');
    expect(preselectMissed(null)).toBe('talk');
  });

  it('quotes the newest note with a reason, inside the window', () => {
    const n = pickNote([
      { text: 'יופי של ריצה', at: '2026-10-09T10:00:00Z' },
      { text: 'חולה, חום', at: '2026-10-08T10:00:00Z' },
      { text: 'כואב', at: '2026-09-01T10:00:00Z' },
    ], '2026-10-04');
    expect(n).toMatchObject({ text: 'חולה, חום', reason: 'sick' });
    expect(pickNote([{ text: 'עמוס', at: '2026-10-09T10:00:00Z' }], '2026-10-04')).toMatchObject({ reason: null });
    expect(pickNote([], '2026-10-04')).toBeNull();
  });
});

describe('progression', () => {
  it('+5%: a short rep is added whole (6×800 → 7×800), never a pace', () => {
    const m = model(sixBy800);
    const { steps, changes } = progressModel(m, 'plus5', T);
    expect(changes).toEqual([{ type: 'count', from: 6, to: 7 }]);
    const r = steps[1];
    expect(r.kind === 'reps' && r.effort).toEqual(m[1].kind === 'reps' && m[1].effort);
  });

  it('+5%: a long rep is lengthened (3×2 ק״מ → 3×2.2 ק״מ)', () => {
    const { changes } = progressModel(model(tempo3x2), 'plus5', T);
    expect(changes).toEqual([{ type: 'repLength', measure: 'distance', from: 2000, to: 2200 }]);
  });

  it('+5%: a run is lengthened to the half-km (16 → 17)', () => {
    expect(progressModel(model(long16), 'plus5', T).changes).toEqual([{ type: 'length', measure: 'distance', from: 16000, to: 17000 }]);
  });

  it('+10% is bigger than +5%', () => {
    expect(progressModel(model(long16), 'plus10', T).changes).toEqual([{ type: 'length', measure: 'distance', from: 16000, to: 17500 }]);
  });

  it('several weeks compound: week 2 gets it twice', () => {
    expect(progressModel(model(long16), 'plus5', T, 2).changes).toEqual([{ type: 'length', measure: 'distance', from: 16000, to: 18000 }]);
  });

  it('light week: ~70% of the volume, fast reps become an easy run', () => {
    const before = bookTotals(model(sixBy800), T).distanceM;
    const { steps, changes } = progressModel(model(sixBy800), 'light', T);
    expect(changes[0]).toMatchObject({ type: 'easyInstead', measure: 'distance' });
    expect(steps.some((x) => x.kind === 'reps')).toBe(false);
    const after = bookTotals(steps, T).distanceM;
    expect(after / before).toBeGreaterThan(0.6);
    expect(after / before).toBeLessThan(0.8);
  });

  it('light week: slower reps keep their shape, fewer of them', () => {
    const { changes } = progressModel(model(tempo3x2), 'light', T);
    expect(changes).toEqual([{ type: 'count', from: 3, to: 2 }]);
  });

  it('as-is changes nothing', () => {
    const m = model(sixBy800);
    expect(progressModel(m, 'same', T)).toEqual({ steps: m, changes: [] });
  });
});

describe('copy', () => {
  it('each trainee gets their own paces', () => {
    const faster = 250; // a faster runner
    const c = copyWorkout({ workout: sixBy800, sourceThresholdSec: T, targetThresholdSec: faster, mode: 'same' });
    expect(c.paced).toBe(true);
    const own = mainPaceOf(c.workout)!;
    expect(own).toBeLessThan(245);
    expect(Math.abs(own - Math.round(245 * faster / T))).toBeLessThanOrEqual(2);
  });

  it('carries the target\'s pace update', () => {
    const plain = copyWorkout({ workout: sixBy800, sourceThresholdSec: T, targetThresholdSec: T, mode: 'same' });
    const upd = copyWorkout({ workout: sixBy800, sourceThresholdSec: T, targetThresholdSec: T, targetAdjust: { reps: -7 }, mode: 'same' });
    expect(mainPaceOf(upd.workout)! - mainPaceOf(plain.workout)!).toBe(-7);
    expect(upd.workout.paceAdjust).toEqual({ reps: -7 });
  });

  it('does not carry the SOURCE\'s pace update to someone else', () => {
    const src = applyPaceAdjust(sixBy800, T, { reps: -7 });
    const c = copyWorkout({ workout: src, sourceThresholdSec: T, targetThresholdSec: T, mode: 'same' });
    const plain = copyWorkout({ workout: sixBy800, sourceThresholdSec: T, targetThresholdSec: T, mode: 'same' });
    expect(mainPaceOf(c.workout)).toBe(mainPaceOf(plain.workout));
    expect(c.workout.paceAdjust).toBeUndefined();
    const self = copyWorkout({ workout: src, sourceThresholdSec: T, targetThresholdSec: T, targetAdjust: { reps: -7 }, sameTrainee: true, mode: 'same' });
    expect(mainPaceOf(self.workout)).toBe(mainPaceOf(src));
  });

  it('a trainee with no test gets the workout without paces', () => {
    const c = copyWorkout({ workout: sixBy800, sourceThresholdSec: T, targetThresholdSec: null, mode: 'plus5' });
    expect(c.paced).toBe(false);
    expect(mainPaceOf(c.workout)).toBeNull();
    expect(c.workout.steps[1].repeatCount).toBe(7);
  });

  it('a source with no test: others get no paces, the source keeps theirs', () => {
    expect(copyWorkout({ workout: sixBy800, sourceThresholdSec: null, targetThresholdSec: T, mode: 'same' }).paced).toBe(false);
    const self = copyWorkout({ workout: sixBy800, sourceThresholdSec: null, targetThresholdSec: null, sameTrainee: true, mode: 'same' });
    expect(self.paced).toBe(true);
    expect(Math.abs(mainPaceOf(self.workout)! - 245)).toBeLessThanOrEqual(1);
  });

  it('a week copy keeps the days and names the club\'s day-named sessions by their shape', () => {
    const out = copyWeek({ workouts: [long16, sixBy800], sourceThresholdSec: T, targetThresholdSec: T, mode: 'plus5' });
    expect(out.map((o) => o.workout.dayOfWeek)).toEqual([0, 6]);
    expect(out[0].workout.name).toBe('7 × 800 מ׳');
    // +5% of this 26 km week is ~1.3 km: the extra rep alone is the closest, so the long
    // run is left as it was (and still gets a name from its shape).
    expect(out[1].workout.name).toBe('16 ק״מ ארוכה');
    expect(out[1].changes).toEqual([]);
  });

  it('+5% / +10% land near that share of the WEEK, not each session rounding up', () => {
    const fiveBy1k: ParsedWorkout = { dayOfWeek: 2, name: 'שלישי', steps: [run(1, 'warmup', 2000, pace(330)), reps(2, 5, 1000, pace(245, 2, 'interval')), run(3, 'cooldown', 2000, pace(330))] };
    const week = [sixBy800, fiveBy1k, tempo3x2, long16];
    const km = (xs: { distanceM: number }[]) => xs.reduce((a, b) => a + b.distanceM, 0);
    const base = km(copyWeek({ workouts: week, sourceThresholdSec: T, targetThresholdSec: T, mode: 'same' }));
    for (const [mode, share] of [['plus5', 0.05], ['plus10', 0.1]] as const) {
      const out = copyWeek({ workouts: week, sourceThresholdSec: T, targetThresholdSec: T, mode });
      const grew = km(out) / base - 1;
      expect(Math.abs(grew - share)).toBeLessThan(0.02);
      // Never a pace: every main pace is what the plain copy gives.
      const plain = copyWeek({ workouts: week, sourceThresholdSec: T, targetThresholdSec: T, mode: 'same' });
      out.forEach((o, i) => expect(mainPaceOf(o.workout)).toBe(mainPaceOf(plain[i].workout)));
    }
  });

  it('collisions: whoever already has workouts starts unticked, with the count to replace', () => {
    const weeks = ['2026-10-11', '2026-10-18'];
    expect(copyDefaults([
      { id: 'a', name: 'A', existing: {} },
      { id: 'b', name: 'B', existing: { '2026-10-11': 2 } },
      { id: 'c', name: 'C', existing: { '2026-10-25': 3 } },
    ], weeks)).toEqual([
      { id: 'a', ticked: true, replaces: 0 },
      { id: 'b', ticked: false, replaces: 2 },
      { id: 'c', ticked: true, replaces: 0 },
    ]);
  });

  it('target weeks: next, or the next n (max 4)', () => {
    expect(targetWeeks('2026-10-04', 1)).toEqual(['2026-10-11']);
    expect(targetWeeks('2026-10-04', 3)).toEqual(['2026-10-11', '2026-10-18', '2026-10-25']);
    expect(targetWeeks('2026-10-04', 9)).toHaveLength(4);
  });
});

describe('labels', () => {
  it('names the squares like the mockup', () => {
    expect(squareLabel(sixBy800, T)).toBe('6×800');
    expect(squareLabel(tempo3x2, T)).toBe('טמפו');
    expect(squareLabel(long16, T)).toBe('16K');
    const k = { ...sixBy800, steps: [reps(1, 5, 1000, pace(245, 2, 'interval'))] };
    expect(squareLabel(k, T)).toBe('5×1K');
  });

  it('knows a long run', () => {
    expect(isLongRun(long16, T)).toBe(true);
    expect(isLongRun(sixBy800, T)).toBe(false);
  });
});
