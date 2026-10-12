import { describe, expect, it } from 'vitest';
import { buildLineup, packIndexFromLabel } from '@/lib/attendance/lineup';
import { packPace, paceRangeText, profileSegments } from '@/lib/plans/session-profile';
import type { WorkoutStep } from '@/lib/ai/types';

const row = (id: string, attending: boolean, label: string | null, home = 0) => ({ athlete_id: id, attending, group_label: label, name: id, avatar_url: null, home });

describe('buildLineup', () => {
  it('counts by the picked pack; a bare yes counts in the member\'s own pack', () => {
    const l = buildLineup([row('a', true, 'דבוקה 1'), row('b', true, null, 1), row('c', true, 'דבוקה 3'), row('d', false, null)], 'x');
    expect(l.total).toBe(3);
    expect(l.packs.map((p) => p.count)).toEqual([1, 1, 1]);
  });
  it('the viewer comes first in their pack, and their answer is reported', () => {
    const l = buildLineup([row('a', true, 'דבוקה 2'), row('me', true, 'דבוקה 2')], 'me');
    expect(l.packs[1].faces[0].id).toBe('me');
    expect(l.mine).toEqual({ attending: true, index: 1 });
  });
  it('a "not this time" is mine but not counted', () => {
    const l = buildLineup([row('me', false, null)], 'me');
    expect(l.total).toBe(0);
    expect(l.mine).toEqual({ attending: false, index: -1 });
  });
  it('labels', () => {
    expect(packIndexFromLabel('דבוקה 3')).toBe(2);
    expect(packIndexFromLabel('סתם')).toBeNull();
  });
});

describe('session profile', () => {
  const steps = [
    { order: 1, type: 'warmup', durationType: 'distance', durationValue: 1500, targetType: 'no_target' },
    { order: 2, type: 'active', durationType: 'distance', durationValue: 8000, targetType: 'pace', targetZone: 'easy', targetPaceMinPerKm: 305, targetPaceMaxPerKm: 315, group2Pace: { min: 315, max: 325 }, group3Pace: { min: 335, max: 345 } },
    { order: 3, type: 'active', durationType: 'open', targetType: 'no_target', repeatCount: 3, repeatSteps: [
      { order: 1, type: 'interval', durationType: 'distance', durationValue: 100, targetType: 'pace', targetPaceMinPerKm: 220, targetPaceMaxPerKm: 220 },
      { order: 2, type: 'rest', durationType: 'time', durationValue: 30, targetType: 'no_target' },
    ] },
    { order: 4, type: 'cooldown', durationType: 'distance', durationValue: 500, targetType: 'no_target' },
  ] as unknown as WorkoutStep[];
  it('warm, easy, 3 reps with rests, cool — shares sum to 1', () => {
    const seg = profileSegments(steps);
    expect(seg[0].kind).toBe('warm');
    expect(seg[1].kind).toBe('easy');
    expect(seg.filter((s) => s.kind === 'hard')).toHaveLength(3);
    expect(seg[seg.length - 1].kind).toBe('cool');
    expect(seg.reduce((a, s) => a + s.share, 0)).toBeCloseTo(1, 5);
  });
  it('each pack gets the main block pace', () => {
    expect(paceRangeText(packPace(steps, 0)!)).toBe('5:05–5:15');
    expect(paceRangeText(packPace(steps, 1)!)).toBe('5:15–5:25');
    expect(paceRangeText(packPace(steps, 2)!)).toBe('5:35–5:45');
  });
});
