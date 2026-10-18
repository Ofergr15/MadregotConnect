import { describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => ({}) }));
import { runnerWeek } from '@/lib/plans/watch-status';

// The planner's tracking of a week's send, one runner's week (lib/plans/watch-status.ts).

const W = '2026-10-18';
const row = (date: string, status: string, at: string, extra: Record<string, unknown> = {}) =>
  ({ athlete_id: 'a', workout_date: date, status, garmin_workout_id: 'g', error_message: null, created_at: at, ...extra });
const DAYS = [0, 1, 2, 4, 5];

describe('a runner\'s week on the watch', () => {
  it('every session confirmed → ok, 5/5, a green square on each session day', () => {
    const w = runnerWeek(['2026-10-18', '2026-10-19', '2026-10-20', '2026-10-22', '2026-10-23'].map((d) => row(d, 'success', '2026-10-18T08:00:00Z')), W, DAYS);
    expect(w).toMatchObject({ state: 'ok', ok: 5, total: 5 });
    expect(w.days).toEqual(['ok', 'ok', 'ok', 'none', 'ok', 'ok', 'none']);
  });
  it('rows still pending → on the way', () => {
    const w = runnerWeek([row('2026-10-18', 'success', '2026-10-18T08:00:00Z'), row('2026-10-19', 'pending', '2026-10-18T08:00:05Z')], W, DAYS);
    expect(w.state).toBe('sending');
    expect(w.days.slice(0, 2)).toEqual(['ok', 'sending']);
  });
  it('a failure newer than the sessions is the outcome, with its reason, and the plan days go red', () => {
    const w = runnerWeek([row(W, 'failed', '2026-10-18T08:01:00Z', { error_message: '401 Unauthorized', garmin_workout_id: null })], W, DAYS);
    expect(w).toMatchObject({ state: 'failed', error: '401 Unauthorized' });
    expect(w.days).toEqual(['failed', 'failed', 'failed', 'none', 'failed', 'failed', 'none']);
  });
  it('a retry that succeeded after the failure wins', () => {
    const w = runnerWeek([row(W, 'failed', '2026-10-18T08:01:00Z'), row('2026-10-18', 'success', '2026-10-18T08:05:00Z')], W, DAYS);
    expect(w.state).toBe('ok');
  });
  it('Apple waits for the phone; superseded rows do not count', () => {
    expect(runnerWeek([row('2026-10-18', 'pending', '2026-10-18T08:00:00Z', { provider: 'apple' })], W, DAYS).state).toBe('waiting');
    expect(runnerWeek([row('2026-10-18', 'success', '2026-10-18T08:00:00Z', { superseded_at: '2026-10-18T09:00:00Z' })], W, DAYS).total).toBe(0);
  });
});
