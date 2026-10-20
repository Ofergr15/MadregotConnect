import { describe, expect, it } from 'vitest';
import { workoutHeadline, type PlanSegment } from '@/lib/share/plan-segments';
import { availableWorkoutMetrics, workoutStats } from '@/lib/feed/share-image';
import { WORKOUT_CARD_TEXT } from '@/lib/share/card-text';
import type { FeedActivity } from '@/lib/feed/project';

const rep = (pace: number, target?: number): PlanSegment => ({ m: 1600, pace, kind: 'active', ...(target ? { target: { min: target - 5, max: target } } : {}) });
const jog: PlanSegment = { m: 400, pace: 330, kind: 'recovery' };
const session = (reps: PlanSegment[]): PlanSegment[] => [
  { m: 3000, pace: 300, kind: 'warmup' },
  ...reps.flatMap(r => [r, jog]),
  { m: 2000, pace: 300, kind: 'cooldown' },
];

describe('the workout headline on the share card', () => {
  it('names the run by its reps and scores them against the target', () => {
    const reps = [...Array(9)].map(() => rep(209, 210)).concat(rep(220, 210));
    const h = workoutHeadline(session(reps))!;
    expect(h.title).toBe('10 × 1600');
    expect(h.hit).toBe(9);
    expect(h.repPace).toBe(210);
  });

  it('takes the length that repeats most, not a lone longer block', () => {
    const segs = session([rep(210), rep(210), rep(210)]);
    segs.splice(1, 0, { m: 2000, pace: 230, kind: 'active' });
    expect(workoutHeadline(segs)!.title).toBe('3 × 1600');
  });

  it('has no score without targets, and no headline for one block', () => {
    expect(workoutHeadline(session([rep(210), rep(212)]))!.hit).toBeNull();
    expect(workoutHeadline(session([rep(210)]))).toBeNull();
    expect(workoutHeadline(null)).toBeNull();
  });

  it('writes long reps in K', () => {
    expect(workoutHeadline(session([5000, 5000, 5000].map(m => ({ m, pace: 240, kind: 'active' as const }))))!.title).toBe('3 × 5K');
  });

  it('offers the reps as numbers only when the run carries them', () => {
    const act = { distance: 21000, duration: 5400, averagePace: 257, stepBands: session([rep(209, 210), rep(209, 210)]) } as unknown as FeedActivity;
    expect(availableWorkoutMetrics(act).slice(0, 3)).toEqual(['km', 'reps', 'repPace']);
    expect(workoutStats(act, WORKOUT_CARD_TEXT.he, ['reps', 'repPace']).map(s => s.value)).toEqual(['2/2', '3:29']);
    expect(availableWorkoutMetrics({ ...act, stepBands: null })).not.toContain('reps');
  });
});

describe('a last rep the watch stopped inside', () => {
  it('is still a rep of the session', () => {
    const segs = session([rep(210), rep(210), rep(210)]).slice(0, -2);
    segs.push({ m: 1143, pace: 212, kind: 'active' });
    const h = workoutHeadline(segs)!;
    expect(h.title).toBe('4 × 1600');
    expect(h.reps).toBe(4);
  });
  it('but not a shorter block in the middle of a pyramid', () => {
    const segs = session([rep(210), { m: 1200, pace: 205, kind: 'active' }, rep(210)]);
    expect(workoutHeadline(segs)!.title).toBe('2 × 1600');
  });
});
