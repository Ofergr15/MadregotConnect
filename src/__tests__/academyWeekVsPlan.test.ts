import { describe, it, expect, vi, beforeEach } from 'vitest';
import { toWeekVsPlanRow, toWeekVsPlan } from '@/lib/academy/week-vs-plan';
import type { WorkoutAdherenceRow } from '@/lib/academy/report';

// Fixtures shaped like computeAcademyWeekAdherence({ keepDetail: true }) rows.
type Scope = { label: string; source: 'watch' | 'stream' | 'laps'; truncated: boolean };
function row(o: {
  completed?: boolean; scope?: Scope | null; efforts?: { needed: number; attempted: number; found: number } | null;
  graded?: boolean; direction?: string; dev?: number | null; distance?: string;
}): WorkoutAdherenceRow {
  const completed = o.completed ?? true;
  const verdict = o.graded === false || !completed ? null : {
    direction: o.direction ?? 'on_target', paceDeviationSec: o.dev ?? 2, paceScope: o.scope ?? null, effortCounts: o.efforts ?? null,
  };
  return {
    date: '2026-11-24', name: 'Tue', completed,
    actual: completed ? { id: 'act-1' } : null,
    distance: { status: o.distance ?? 'on_target', plannedMin: 10, plannedMax: 12, actual: completed ? 11 : null, pct: completed ? 100 : null },
    duration: { status: 'on_target', planned: 3600, actual: 3500, pct: 97, estimated: false },
    execution: completed ? { activityId: 'act-1', status: 'graded', score: 92, direction: o.direction ?? 'on_target', workoutName: 'Tue' } : null,
    detail: { workout: {}, laps: [{ secret: 'raw laps' }], verdict, efforts: null },
  } as unknown as WorkoutAdherenceRow;
}

describe('toWeekVsPlanRow — four engines kept apart', () => {
  it('a block session graded off the trace answers distance + pace, not watch', () => {
    const r = toWeekVsPlanRow(row({ scope: { label: '20 ק״מ 4:25', source: 'stream', truncated: false } }));
    expect(r.distance).toMatchObject({ answered: true, value: { status: 'on_target', pct: 100 } });
    expect(r.pace).toMatchObject({ answered: true, value: { label: '20 ק״מ 4:25', direction: 'on_target', deviationSec: 2 } });
    expect(r.watch).toEqual({ answered: false, reason: 'not_a_watch_workout' });
    expect(r.reps).toEqual({ answered: false, reason: 'no_reps_planned' });
    expect(r.overall).toEqual({ score: 92, direction: 'on_target', status: 'graded' });
  });

  it("a structured workout is answered by the watch, and pace says so instead of guessing", () => {
    const r = toWeekVsPlanRow(row({ scope: { label: 'Run 5km', source: 'watch', truncated: true }, direction: 'slower', dev: 9 }));
    expect(r.watch).toMatchObject({ answered: true, value: { label: 'Run 5km', truncated: true, direction: 'slower', deviationSec: 9 } });
    expect(r.pace).toEqual({ answered: false, reason: 'watch_answered' });
  });

  it('a rep session reports needed / attempted / found', () => {
    const r = toWeekVsPlanRow(row({ efforts: { needed: 8, attempted: 8, found: 7 } }));
    expect(r.reps).toEqual({ answered: true, value: { needed: 8, attempted: 8, found: 7 } });
    expect(r.pace).toEqual({ answered: false, reason: 'no_block' });
  });

  it('a session not run answers nothing — never a confident zero', () => {
    const r = toWeekVsPlanRow(row({ completed: false }));
    for (const k of ['distance', 'pace', 'reps', 'watch'] as const) expect(r[k]).toEqual({ answered: false, reason: 'not_run' });
    expect(r.overall).toBeNull();
    expect(r.activityId).toBeNull();
  });

  it('a run without laps (ungraded) still answers distance', () => {
    const r = toWeekVsPlanRow(row({ graded: false, distance: 'under' }));
    expect(r.distance).toMatchObject({ answered: true, value: { status: 'under' } });
    expect(r.pace).toEqual({ answered: false, reason: 'ungraded' });
  });

  it('never carries raw laps or the full verdict', () => {
    const out = JSON.stringify(toWeekVsPlan('a1', '2026-11-22', { plannedCount: 1, completedCount: 1, workouts: [row({})] }));
    expect(out).not.toContain('raw laps');
    expect(out).not.toContain('detail');
  });
});

describe('GET /api/academy/week-vs-plan', () => {
  const requireCallerForAthlete = vi.fn();
  const mayCoach = vi.fn();
  const compute = vi.fn();
  beforeEach(() => {
    vi.resetModules();
    vi.doMock('@/lib/auth/self-or-staff', () => ({ requireCallerForAthlete: (...a: unknown[]) => requireCallerForAthlete(...a) }));
    vi.doMock('@/lib/academy/pairing-server', () => ({ mayCoach: (...a: unknown[]) => mayCoach(...a) }));
    vi.doMock('@/lib/academy/report', () => ({ computeAcademyWeekAdherence: (...a: unknown[]) => compute(...a) }));
    requireCallerForAthlete.mockResolvedValue({ denied: null, caller: { athleteId: 'coach', isStaff: true } });
    mayCoach.mockResolvedValue(true);
    compute.mockResolvedValue({ weekStart: '2026-11-22', athletes: [{ athleteId: 'a1', week: { plannedCount: 1, completedCount: 1, workouts: [row({})] } }] });
  });
  const get = async (q: string) => (await import('@/app/api/academy/week-vs-plan/route')).GET(new Request(`http://x/api/academy/week-vs-plan${q}`));

  it('requires athleteId', async () => { expect((await get('')).status).toBe(400); });
  it('a coach not paired with the trainee is refused', async () => {
    mayCoach.mockResolvedValue(false);
    expect((await get('?athleteId=a1')).status).toBe(403);
  });
  it('returns the reduced rows for one trainee, private', async () => {
    const res = await get('?athleteId=a1&weekStart=2026-11-22');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toContain('no-store');
    const body = await res.json();
    expect(body.rows).toHaveLength(1);
    expect(compute).toHaveBeenCalledWith(expect.objectContaining({ onlyAthleteId: 'a1', weekStart: '2026-11-22' }));
    expect(JSON.stringify(body)).not.toContain('raw laps');
  });
});
