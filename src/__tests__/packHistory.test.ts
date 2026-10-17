import { describe, it, expect } from 'vitest';
import { packOn, laneOfName, PACK_HISTORY_EPOCH, type PackHistoryRow } from '@/lib/groups/pack-history';
import { daysWithDifferentShape } from '@/lib/groups/pack-move';
import { packMovedCopy } from '@/lib/notifications/copy';
import type { ParsedWorkout } from '@/lib/ai/types';

/**
 * A member who changes pack keeps their past (plan: ~/.cache/madregot/pack-change).
 * Before migration 145 every grader read the pack TODAY, so a move from ❸ to ❷
 * re-scored every run the member ever did against ❷'s paces.
 */

const row = (group_id: string, from_date: string, created_at = `${from_date}T08:00:00Z`): PackHistoryRow =>
  ({ athlete_id: 'a', group_id, from_date, created_at });

describe('packOn', () => {
  // ❸ until Wednesday 14.10, then ❷ — the moved-mid-week case.
  const history = [row('g3', PACK_HISTORY_EPOCH), row('g2', '2026-10-14')];

  it('keeps the old pack for every day before the move', () => {
    expect(packOn(history, 'g2', '2026-10-11')).toBe('g3');
    expect(packOn(history, 'g2', '2026-09-01')).toBe('g3');
  });

  it('is the new pack from the day of the move on', () => {
    expect(packOn(history, 'g2', '2026-10-14')).toBe('g2');
    expect(packOn(history, 'g2', '2026-10-17')).toBe('g2');
  });

  it('a member who never moved reads their current pack, exactly as before', () => {
    expect(packOn([], 'g1', '2026-10-17')).toBe('g1');
  });

  it('two moves on one day: the later write wins', () => {
    const twice = [row('g3', PACK_HISTORY_EPOCH), row('g1', '2026-10-14', '2026-10-14T08:00:00Z'), row('g2', '2026-10-14', '2026-10-14T09:00:00Z')];
    expect(packOn(twice, 'g2', '2026-10-15')).toBe('g2');
  });
});

describe('laneOfName', () => {
  it('unknown or missing pack is lane 2, the old default', () => {
    expect(laneOfName(null)).toBe(2);
    expect(laneOfName('something else')).toBe(2);
  });
});

const w = (dayOfWeek: number, steps: unknown[], key = `day-${dayOfWeek}-0`): ParsedWorkout =>
  ({ dayOfWeek, workoutKey: key, name: 'x', steps } as unknown as ParsedWorkout);
const run = (min: number, pace: number, notes?: string) =>
  ({ type: 'active', durationType: 'time', durationValue: min * 60, targetType: 'pace', targetPaceMinPerKm: pace, targetPaceMaxPerKm: pace, notes });

describe('daysWithDifferentShape — does the watch need a re-send?', () => {
  it('other paces only: nothing to re-send (every week checked on prod looks like this)', () => {
    const p3 = [w(0, [run(40, 275, '4:35')]), w(3, [run(20, 280)])];
    const p2 = [w(0, [run(40, 265, '4:25')]), w(3, [run(20, 270)])];
    expect(daysWithDifferentShape(p3, p2, 0)).toEqual([]);
  });

  it('a different workout ahead of the move day is caught', () => {
    const p3 = [w(4, [{ type: 'repeat', repeatCount: 3, repeatSteps: [run(4, 250)] }])];
    const p2 = [w(4, [{ type: 'repeat', repeatCount: 4, repeatSteps: [run(4, 240)] }])];
    expect(daysWithDifferentShape(p3, p2, 3)).toEqual([4]);
  });

  it('days before the move are never re-sent', () => {
    const p3 = [w(1, [run(30, 275)])];
    const p2 = [w(1, [run(45, 265)])];
    expect(daysWithDifferentShape(p3, p2, 3)).toEqual([]);
  });
});

describe('packMovedCopy', () => {
  it('tells the member the watch stays as it is, in their language', () => {
    expect(packMovedCopy('he', { lane: 2, resent: false })).toEqual({
      title: '👟 עברת לדבוקה 2',
      body: 'האימונים בשעון לא משתנים — יש בהם את הקצבים של כל הדבוקות.',
    });
    expect(packMovedCopy('en', { lane: 2, resent: true }).body).toMatch(/updated on your watch/);
  });
});
