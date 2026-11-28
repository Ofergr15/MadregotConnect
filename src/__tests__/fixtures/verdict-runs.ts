/**
 * Ten anonymised runs in the shapes production stores, for the four verdict
 * engines' snapshot test (verdictSnapshots.test.ts). No names, no ids, no GPS:
 * only distances, durations, the watch's lap stamps and the plan.
 *
 * Two are real lap lists already in this folder (Tuesday 29.9 and Tuesday 20.10);
 * the other eight rebuild the stories CLAUDE.md records ("Did they do the workout"),
 * with the numbers quoted there — the 6×2 km double, the 228 s stop at 22 km, the
 * ladder abandoned at rep 5, the 10 km of a 20 km block, the open 22 km step nobody
 * pushed, the strides run off pace.
 */
import { readFileSync } from 'node:fs';
import type { ParsedWorkout, WorkoutStep } from '@/lib/ai/types';
import type { ActualActivity } from '@/lib/academy/adherence';
import type { Lane } from '@/lib/academy/group-lane';
import type { StoredLap } from '@/lib/garmin/laps';
import type { ActivityStream } from '@/lib/garmin/streams';

export interface VerdictRun {
  id: string;
  story: string;
  lane: Lane;
  workout: ParsedWorkout;
  /** `athlete_activities.laps`, as stored (StoredLap, maybe stamped). */
  laps: StoredLap[];
  /** `athlete_activities.executed_workout` (raw Garmin shape), when the run drove the watch. */
  executed: unknown | null;
  /** `activity_streams.series` (t/d only), when one was fetched. */
  stream: Pick<ActivityStream, 't' | 'd'> | null;
  actual: ActualActivity;
}

const read = (name: string) => JSON.parse(readFileSync(`src/__tests__/fixtures/${name}`, 'utf8'));

let order = 0;
const step = (over: Partial<WorkoutStep>): WorkoutStep => ({
  order: order++, type: 'active', durationType: 'distance', targetType: 'pace', ...over,
});
const pace = (min: number, max = min) => ({ targetPaceMinPerKm: min, targetPaceMaxPerKm: max });
const repeat = (n: number, steps: WorkoutStep[]): WorkoutStep =>
  step({ type: 'interval', targetType: 'no_target', repeatCount: n, repeatSteps: steps });
const workout = (name: string, steps: WorkoutStep[], over: Partial<ParsedWorkout> = {}): ParsedWorkout =>
  ({ dayOfWeek: 2, name, steps, ...over });

const slap = (distance: number, duration: number, wktStepIndex?: number): StoredLap => ({
  distance, duration,
  averagePace: distance > 0 ? Math.round(duration / (distance / 1000)) : null,
  averageHR: null, maxHR: null,
  ...(wktStepIndex != null ? { wktStepIndex } : {}),
});
const times = <T>(n: number, f: (i: number) => T[]): T[] => Array.from({ length: n }, (_, i) => f(i)).flat();

/** A 50 m-resolution stream at constant pace per segment, with optional standstills. */
function stream(segments: { m: number; pace: number }[], pauses: { atM: number; sec: number }[] = [], startM = 2) {
  const t: number[] = []; const d: number[] = [];
  let sec = 0; let m = startM;
  const todo = [...pauses];
  for (const seg of segments) {
    const end = m + seg.m;
    for (; m < end; m += 50) {
      if (todo.length && m >= todo[0].atM) { t.push(Math.round(sec)); d.push(m); sec += todo.shift()!.sec; }
      t.push(Math.round(sec)); d.push(m);
      sec += (seg.pace * 50) / 1000;
    }
  }
  t.push(Math.round(sec)); d.push(m);
  return { t, d };
}

const sum = (laps: StoredLap[], k: 'distance' | 'duration') => laps.reduce((s, l) => s + l[k], 0);
const actualOf = (id: string, date: string, laps: StoredLap[], extra: Partial<ActualActivity> = {}): ActualActivity => {
  const distance = Math.round(sum(laps, 'distance'));
  const duration = Math.round(sum(laps, 'duration'));
  return { id, date, distance, duration, movingDuration: duration, averagePace: Math.round(duration / (distance / 1000)), activityType: 'running', ...extra };
};

// 1. Tuesday 20.10 "long intervals", pack 2 — real stamped laps + the real plan day.
const tue1020 = read('week-story-tuesday-1020.json');
const tue1020Laps: StoredLap[] = tue1020.laps.map((l: { distance: number; duration: number; wktStepIndex?: number }) => slap(l.distance, l.duration, l.wktStepIndex));

// 2. Tuesday 29.9 fartlek — real laps (laps only, no stamps).
const tue0929Laps: StoredLap[] = (read('quality-session-0929-laps.json').full as [number, number, string][]).map(([d, t]) => slap(d, t));
const TUE0929 = workout('פרטלק', [
  step({ type: 'warmup', durationValue: 3600, ...pace(270, 300) }),
  repeat(4, [step({ type: 'interval', durationType: 'time', durationValue: 45, ...pace(220) }), step({ type: 'recovery', durationType: 'time', durationValue: 45, targetType: 'no_target' })]),
  repeat(2, [step({ type: 'interval', durationType: 'time', durationValue: 20, targetType: 'no_target' }), step({ type: 'recovery', durationType: 'time', durationValue: 40, targetType: 'no_target' })]),
  repeat(10, [step({ type: 'interval', durationValue: 1000, ...pace(212) }), step({ type: 'recovery', durationValue: 1000, ...pace(270) })]),
  repeat(5, [step({ type: 'interval', durationValue: 300, ...pace(200) }), step({ type: 'recovery', durationType: 'time', durationValue: 60, targetType: 'no_target' })]),
  step({ type: 'cooldown', durationValue: 3000, targetType: 'no_target' }),
]);

// 3. Sunday "2 km easy, 20 km at 4:25, 8×15 s strides" with a 228 s stop at 22 km.
const SUNDAY = workout('ארוכה', [
  step({ type: 'warmup', durationValue: 2000, ...pace(300, 330) }),
  step({ durationValue: 20000, ...pace(265) }),
  repeat(8, [step({ type: 'interval', durationType: 'time', durationValue: 15, ...pace(200, 210) }), step({ type: 'recovery', durationType: 'time', durationValue: 45, targetType: 'no_target' })]),
], { dayOfWeek: 0 });
const SUNDAY_EXEC = [{
  workoutName: 'ארוכה',
  steps: [
    { stepIndex: 0, intensity: 'WARMUP', durationType: 'DISTANCE', durationValue: 2000, notes: '5:00-5:30' },
    { stepIndex: 1, intensity: 'ACTIVE', durationType: 'DISTANCE', durationValue: 20000, notes: '4:25 (4:35) ((4:45))' },
    { stepIndex: 2, intensity: 'INTERVAL', durationType: 'TIME', durationValue: 15, notes: 'סטרייד' },
    { stepIndex: 3, intensity: 'RECOVERY', durationType: 'TIME', durationValue: 45, notes: 'ג׳וג' },
    { stepIndex: 4, durationType: 'REPEAT_UNTIL_STEPS_CMPLT', durationValue: 2, targetValue: 8 },
  ],
}];
const sundayLaps = [slap(2000, 610, 0), ...times(20, () => [slap(1000, 263, 1)]), ...times(8, () => [slap(78, 15, 2), slap(60, 45, 3)])];

// 4./5. Tuesday double, 6×2 km at 3:30 (3:40) with 500 m jogs — Garmin's stamped copy and Strava's km splits.
const DOUBLE = workout('כפול 6×2', [
  step({ type: 'warmup', durationValue: 3000, targetType: 'no_target' }),
  repeat(6, [step({ type: 'interval', durationValue: 2000, ...pace(210) }), step({ type: 'recovery', durationValue: 500, targetType: 'no_target' })]),
  step({ type: 'cooldown', durationValue: 2000, targetType: 'no_target' }),
]);
const DOUBLE_EXEC = [{
  workoutName: 'שלישי כפול',
  steps: [
    { stepIndex: 0, intensity: 'WARMUP', durationType: 'DISTANCE', durationValue: 3000, notes: 'קל' },
    { stepIndex: 1, intensity: 'INTERVAL', durationType: 'DISTANCE', durationValue: 2000, notes: '3:30 (3:40)' },
    { stepIndex: 2, intensity: 'RECOVERY', durationType: 'DISTANCE', durationValue: 500, notes: 'ג׳וג' },
    { stepIndex: 3, durationType: 'REPEAT_UNTIL_STEPS_CMPLT', durationValue: 1, targetValue: 6 },
    { stepIndex: 4, intensity: 'COOLDOWN', durationType: 'DISTANCE', durationValue: 2000, notes: 'קל' },
  ],
}];
const doublePaces = [214, 215, 210, 210, 205, 217];
const doubleLaps = [slap(3000, 900, 0), ...doublePaces.flatMap(p => [slap(2000, p * 2, 1), slap(522, 200, 2)]), slap(2000, 620, 4)];
// Strava: the same run as 1 km splits — the 45-point trace the lap search cannot place 2 km blocks in.
const stravaKm: StoredLap[] = (() => {
  const out: StoredLap[] = [];
  let carryM = 0; let carryS = 0;
  for (const l of doubleLaps) {
    let m = l.distance; let s = l.duration;
    while (carryM + m >= 1000) {
      const take = 1000 - carryM; const ts = s * (take / m);
      out.push(slap(1000, Math.round(carryS + ts)));
      m -= take; s -= ts; carryM = 0; carryS = 0;
    }
    carryM += m; carryS += s;
  }
  if (carryM > 0) out.push(slap(Math.round(carryM), Math.round(carryS)));
  return out;
})();

// 6. Ladder of 6×1 km, abandoned at rep 5.
const LADDER = workout('סולם', [repeat(6, [step({ type: 'interval', durationValue: 1000, ...pace(220) }), step({ type: 'recovery', durationType: 'time', durationValue: 90, targetType: 'no_target' })])]);
const LADDER_EXEC = [{
  workoutName: 'סולם',
  steps: [
    { stepIndex: 0, intensity: 'INTERVAL', durationType: 'DISTANCE', durationValue: 1000, notes: '3:40 (3:50)' },
    { stepIndex: 1, intensity: 'RECOVERY', durationType: 'TIME', durationValue: 90, notes: 'ג׳וג' },
    { stepIndex: 2, durationType: 'REPEAT_UNTIL_STEPS_CMPLT', durationValue: 0, targetValue: 6 },
  ],
}];
const ladderLaps = [...times(4, () => [slap(1000, 220, 0), slap(250, 90, 1)]), slap(400, 95, 0)];

// 7. 2 km warm-up then a 20 km block at 4:35, stopped 10 km into it at 4:36.
const CUT = workout('טמפו ארוך', [
  step({ type: 'warmup', durationValue: 2000, ...pace(300, 330) }),
  step({ durationValue: 20000, ...pace(275) }),
], { dayOfWeek: 4 });
const CUT_EXEC = [{
  workoutName: 'טמפו ארוך',
  steps: [
    { stepIndex: 0, intensity: 'WARMUP', durationType: 'DISTANCE', durationValue: 2000, notes: '5:00-5:30' },
    { stepIndex: 1, intensity: 'ACTIVE', durationType: 'DISTANCE', durationValue: 20000, notes: '4:25 (4:35) ((4:45))' },
  ],
}];
const cutLaps = [slap(2000, 620, 0), ...times(10, () => [slap(1000, 276, 1)])];

// 8. An open 22 km step nobody pushed, on the day the club plan was 2 km + 20 km.
const OWN_EXEC = [{ workoutName: 'הריצה שלי', steps: [{ stepIndex: 0, intensity: 'ACTIVE', durationType: 'OPEN', notes: '2 קל, 20 ב-4:25 (4:35)' }] }];
const ownLaps = times(22, () => [slap(1000, 270, 0)]);

// 9. An easy 8-10 km day with no pace target, run as 9.4 km of auto-laps.
const EASY = workout('שחרור', [step({ durationValue: 9000, targetType: 'no_target' })], { dayOfWeek: 3, distanceMinKm: 8, distanceMaxKm: 10 });
const easyLaps = [...times(9, (i) => [slap(1000, 330 + (i % 3) * 4)]), slap(412, 140)];

// 10. 10 km easy + 8×15 s strides run off pace (4:10, so 60 m each — "never run" before matchBy).
const STRIDES = workout('קל + סטריידים', [
  step({ durationValue: 10000, ...pace(300, 330) }),
  repeat(8, [step({ type: 'interval', durationType: 'time', durationValue: 15, ...pace(200) }), step({ type: 'recovery', durationType: 'time', durationValue: 45, targetType: 'no_target' })]),
], { dayOfWeek: 5 });
const stridesLaps = [...times(10, () => [slap(1000, 312)]), ...times(8, () => [slap(60, 15), slap(70, 45)])];

export const VERDICT_RUNS: VerdictRun[] = [
  { id: 'tue-1020-pyramid', story: 'real stamped laps, pack 2; no step list stored', lane: 2, workout: tue1020.plan.group2.workouts[0], laps: tue1020Laps, executed: null, stream: null, actual: actualOf('r1', '2026-10-20', tue1020Laps) },
  { id: 'tue-0929-fartlek', story: 'real laps, laps only', lane: 1, workout: TUE0929, laps: tue0929Laps, executed: null, stream: null, actual: actualOf('r2', '2026-09-29', tue0929Laps) },
  { id: 'sun-long-pause', story: '228 s stop at 22 km, between the block and the strides', lane: 1, workout: SUNDAY, laps: sundayLaps, executed: SUNDAY_EXEC,
    stream: stream([{ m: 2000, pace: 305 }, { m: 20000, pace: 263 }, ...times(8, () => [{ m: 78, pace: 192 }, { m: 60, pace: 750 }])], [{ atM: 22000, sec: 228 }]),
    actual: actualOf('r3', '2026-09-13', sundayLaps, { duration: Math.round(sum(sundayLaps, 'duration')) + 228 }) },
  { id: 'tue-double-garmin', story: '6×2 km, Garmin copy with stamps', lane: 1, workout: DOUBLE, laps: doubleLaps, executed: DOUBLE_EXEC, stream: null, actual: actualOf('r4', '2026-09-15', doubleLaps) },
  { id: 'tue-double-strava', story: 'the same run as Strava km splits: no stamps, no step list', lane: 1, workout: DOUBLE, laps: stravaKm, executed: null, stream: null, actual: actualOf('r5', '2026-09-15', stravaKm) },
  { id: 'ladder-abandoned', story: '6×1 km, stopped during rep 5', lane: 1, workout: LADDER, laps: ladderLaps, executed: LADDER_EXEC, stream: null, actual: actualOf('r6', '2026-09-08', ladderLaps) },
  { id: 'block-cut-short', story: '10 km of a 20 km block at 4:36', lane: 2, workout: CUT, laps: cutLaps, executed: CUT_EXEC,
    stream: stream([{ m: 2000, pace: 310 }, { m: 10000, pace: 276 }]), actual: actualOf('r7', '2026-10-08', cutLaps) },
  { id: 'open-22k-unpushed', story: 'one open step the athlete built; club plan was 2 + 20', lane: 1, workout: SUNDAY, laps: ownLaps, executed: OWN_EXEC, stream: null, actual: actualOf('r8', '2026-09-20', ownLaps) },
  { id: 'easy-no-target', story: 'easy day, distance band only', lane: 3, workout: EASY, laps: easyLaps, executed: null, stream: null, actual: actualOf('r9', '2026-09-16', easyLaps) },
  { id: 'strides-off-pace', story: 'timed strides run at 4:10', lane: 2, workout: STRIDES, laps: stridesLaps, executed: null, stream: null, actual: actualOf('r10', '2026-09-18', stridesLaps) },
];
