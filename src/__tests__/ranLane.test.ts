// The pack a run is graded on (ran-lane.ts): the runner's own say-so, a stored
// resolution, a leader's attendance mark, the watch's paces, else the assigned pack.
// Never the pace alone (Q27-2). Synthetic workouts and traces only.
import { describe, expect, it } from 'vitest';
import type { ParsedWorkout } from '@/lib/ai/types';
import type { Lane } from '@/lib/academy/group-lane';
import type { Trace } from '@/lib/academy/execution';
import type { ExecutedWorkout } from '@/lib/garmin/executed-workout';
import { laneFromWatch, pickPlanned, resolveRanLane, retargetToLane } from '@/lib/plan-execution/ran-lane';
import { dominantBlock, gradePlanBlocks } from '@/lib/academy/execution';
import { flattenPlannedSteps } from '@/lib/academy/segments';

const block = (min: number, max: number, extra: Partial<ParsedWorkout> = {}): ParsedWorkout => ({
  dayOfWeek: 4, name: 'tempo', workoutKey: 'day-4-part-1-single', partIndex: 1, partCount: 1,
  steps: [{ order: 1, type: 'active', durationType: 'distance', durationValue: 10000, targetType: 'pace', targetPaceMinPerKm: min, targetPaceMaxPerKm: max }],
  ...extra,
} as ParsedWorkout);
// Pack 1 4:00-4:05, pack 2 4:10-4:15, pack 3 4:20-4:25.
const byLane: Record<Lane, ParsedWorkout> = { 1: block(240, 245), 2: block(250, 255), 3: block(260, 265) };
const plannedFor = (l: Lane) => byLane[l];
const steady = (paceSec: number, km = 10): Trace => ({
  d: Array.from({ length: km + 1 }, (_, i) => i * 1000),
  t: Array.from({ length: km + 1 }, (_, i) => i * paceSec),
  resolutionM: 1000,
  source: 'laps',
});
const watch = (notes: string): ExecutedWorkout => ({
  name: 'Tempo', createdAt: null,
  steps: [{ stepIndex: 0, intensity: 'ACTIVE', durationType: 'DISTANCE', distanceM: 10000, notes }],
} as ExecutedWorkout);

describe('the pack a run was run with — evidence, never pace (Q27-2)', () => {
  // Q27-2: a pack-2 runner asked for 3:45 (225) who ran 3:55 (235) used to be "detected"
  // as pack 3 and scored 100. Same shape at these packs: pack 2 asked 4:10-4:15, ran 4:22.
  it('a pack-2 runner who ran slower than asked stays on pack 2 — and is graded as a miss', () => {
    const ran = resolveRanLane({ assigned: 2, plannedFor });
    expect(ran).toEqual({ lane: 2, source: 'assigned' });
    const block = dominantBlock(gradePlanBlocks(flattenPlannedSteps(plannedFor(ran.lane)), steady(262), 5));
    expect(block?.status).toBe('slower');
  });
  it('the 3:45 → 3:55 case from the report', () => {
    const asked: Record<Lane, ParsedWorkout> = { 1: block(215, 215), 2: block(225, 225), 3: block(235, 235) };
    const ran = resolveRanLane({ assigned: 2, plannedFor: (l) => asked[l] });
    expect(ran.lane).toBe(2);
    const b = dominantBlock(gradePlanBlocks(flattenPlannedSteps(asked[ran.lane]), steady(235), 5));
    expect(b?.status).toBe('slower');
  });
  it('the runner\'s own "I ran with pack N" moves it, and wins over everything', () => {
    expect(resolveRanLane({ assigned: 2, override: 3, plannedFor })).toEqual({ lane: 3, source: 'manual' });
    expect(resolveRanLane({ assigned: 2, override: 1, attended: 3, executed: watch('4:20-4:25'), plannedFor }))
      .toEqual({ lane: 1, source: 'manual' });
  });
  it('an override outside 1-3 is ignored', () => {
    expect(resolveRanLane({ assigned: 2, override: 7, plannedFor }).source).toBe('assigned');
  });
  it('a leader\'s attendance mark with another pack moves it', () => {
    expect(resolveRanLane({ assigned: 2, attended: 3, plannedFor })).toEqual({ lane: 3, source: 'attendance' });
  });
  it('the watch carrying one pack\'s pace names that pack', () => {
    expect(laneFromWatch(watch('4:20-4:25'), plannedFor)).toBe(3);
    expect(resolveRanLane({ assigned: 2, executed: watch('4:20-4:25'), pushedLane: 2, plannedFor }))
      .toEqual({ lane: 3, source: 'watch' });
  });
  it('a watch note listing every pack is no evidence of which one was followed', () => {
    expect(laneFromWatch(watch('4:00 (4:10) ((4:20))'), plannedFor)).toBeNull();
  });
  it('identical packs (one pace for everybody) cannot be told apart', () => {
    const same = (l: Lane) => (void l, byLane[2]);
    expect(laneFromWatch(watch('4:10-4:15'), same)).toBeNull();
  });
  it('a stored evidence answer is read back; a stored "assigned" yields to new evidence', () => {
    expect(resolveRanLane({ assigned: 2, stored: { lane: 3, source: 'watch' }, plannedFor })).toEqual({ lane: 3, source: 'watch' });
    expect(resolveRanLane({ assigned: 2, stored: { lane: 2, source: 'assigned' }, attended: 1, plannedFor })).toEqual({ lane: 1, source: 'attendance' });
  });
});

describe('the feed ring and the run detail grade one lane (Q27-3)', () => {
  it('the detail resolved from the watch; the feed, without the step list, reads the stored lane', () => {
    // Run detail: has executed_workout (fetched on demand) → watch says pack 3, saved.
    const detail = resolveRanLane({ assigned: 2, executed: watch('4:20-4:25'), pushedLane: 2, plannedFor });
    // Feed: no step list on hand, but the match row now carries the detail's answer.
    const feed = resolveRanLane({ assigned: 2, executed: null, stored: { lane: detail.lane, source: detail.source }, plannedFor });
    expect(feed).toEqual(detail);
  });
  it('the trace no longer takes part, so a 45-point lap trace and a 1 Hz stream cannot disagree', () => {
    const a = resolveRanLane({ assigned: 2, plannedFor });
    const b = resolveRanLane({ assigned: 2, plannedFor });
    expect(a).toEqual(b);
  });
});

describe('the plan day a run is graded on', () => {
  const week = [
    block(250, 255, { dayOfWeek: 4, workoutKey: 'day-4-part-1-single', name: 'thursday' }),
    block(250, 255, { dayOfWeek: 5, workoutKey: 'day-5-part-1-single', name: 'friday' }),
  ];
  it('a run matched to tomorrow\'s slot is graded on tomorrow\'s workout', () => {
    expect(pickPlanned(week, 4, 'day-5-part-1-single')?.name).toBe('friday');
  });
  it('an un-normalized plan with no keys still resolves the slot from the key', () => {
    const bare = week.map(({ workoutKey: _k, ...w }) => w as ParsedWorkout);
    expect(pickPlanned(bare, 4, 'day-5-part-1-single')?.name).toBe('friday');
  });
  it('no match: the run\'s own day', () => {
    expect(pickPlanned(week, 4, null)?.name).toBe('thursday');
  });
});

// Owner's run 2026-11-26 (a261280c): pushed as pack 2 (5:00 / 3:53 / 3:45 / 3:38), run with
// pack 3 at 4:58 / 4:02 / 3:55 / 3:46. Graded on pack 3, the watch's steps keep their shape
// and take pack 3's targets: 5:00 / 4:03 / 3:55 / 3:48.
describe('a watch workout pushed for another pack', () => {
  const ladder = (paces: number[]): ParsedWorkout => ({
    dayOfWeek: 5, name: 'ladder', workoutKey: 'day-5-part-1-single', partIndex: 1, partCount: 1,
    steps: [1000, 4000, 8000, 4000].map((m, i) => ({
      order: i + 1, type: i === 0 ? 'warmup' : 'active', durationType: 'distance', durationValue: m,
      targetType: 'pace', targetPaceMinPerKm: paces[i], targetPaceMaxPerKm: paces[i],
    })),
  } as ParsedWorkout);
  const lanes: Record<Lane, ParsedWorkout> = {
    1: ladder([300, 223, 215, 208]), 2: ladder([300, 233, 225, 218]), 3: ladder([300, 243, 235, 228]),
  };
  const pf = (l: Lane) => lanes[l];
  const pushed: ExecutedWorkout = {
    name: 'Ladder', createdAt: null,
    steps: [['5:00', 1000], ['3:53', 4000], ['3:45', 8000], ['3:38', 4000]].map(([n, m], i) => ({
      stepIndex: i, intensity: i === 0 ? 'WARMUP' : 'ACTIVE', durationType: 'DISTANCE', distanceM: m as number, notes: n as string,
    })),
  } as ExecutedWorkout;
  // 1 km 4:58, 4 km 4:02, 8 km 3:55, 4 km 3:46.
  const ran = (() => {
    const d = [0]; const t = [0];
    for (const [km, p] of [[1, 298], [4, 242], [8, 235], [4, 226]]) for (let k = 0; k < km; k++) { d.push(d[d.length - 1] + 1000); t.push(t[t.length - 1] + p); }
    return { d, t, resolutionM: 1000, source: 'laps' } as Trace;
  })();

  it('moved to pack 3 that morning: the stale pack-2 push is not evidence against the assigned pack', () => {
    expect(laneFromWatch(pushed, pf)).toBe(2);
    expect(resolveRanLane({ assigned: 3, executed: pushed, pushedLane: 2, plannedFor: pf }))
      .toEqual({ lane: 3, source: 'assigned' });
    void ran;
  });
  it('the targets come out as pack 3\'s', () => {
    const steps = retargetToLane(pushed, 3, pf)!.steps;
    expect(steps.map(s => s.paceMin)).toEqual([300, 243, 235, 228]);
    expect(steps.map(s => s.distanceM)).toEqual([1000, 4000, 8000, 4000]);
  });
  it('graded on the watch\'s own pack nothing changes', () => {
    expect(retargetToLane(pushed, 2, pf)).toBe(pushed);
  });
});
