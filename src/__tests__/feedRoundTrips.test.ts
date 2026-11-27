import { describe, expect, it, vi } from 'vitest';
import { createMemoryDb, uid } from './helpers/memory-db';

/**
 * Task 99 — the feed page's per-day and per-column lookups, measured as query counts on a seeded
 * club (each query is a function↔DB round trip, ~225 ms to the old Tokyo region).
 */

vi.mock('@/lib/features/server', () => ({ isFeatureEnabled: async () => true }));
const loadQualityWorkout = vi.fn(async (_db: unknown, date: string) => (date === '2026-11-24' ? { name: 'שלישי' } : null));
vi.mock('@/lib/quality-session/server', () => ({ loadQualityWorkout: (db: unknown, d: string) => loadQualityWorkout(db, d) }));

const { qualityNames } = await import('@/lib/activities/quality-name');
const { strengthForFeed } = await import('@/lib/activities/strength-feed');

function seededDb(opts: { withSuffer?: boolean } = {}) {
  const db = createMemoryDb({
    schema: {
      day_sessions: ['id', 'session_date', 'title', 'quality', 'published_at'],
      athlete_activities: ['id', 'athlete_id', 'start_time', 'distance', 'activity_type', 'training_effect',
        ...(opts.withSuffer === false ? [] : ['suffer_score']), 'exercise_sets'],
    },
  });
  return db;
}

// 12 runners × 14 days: one run each per day.
const days = Array.from({ length: 14 }, (_, i) => `2026-11-${String(10 + i).padStart(2, '0')}`).concat(['2026-11-24']);
const runners = Array.from({ length: 12 }, () => uid());
const runs = runners.flatMap((a, r) => days.map((d, i) => ({ id: `${a}-${i}`, athlete_id: a, start_time: `${d}T06:${String(r).padStart(2, '0')}:00`, distance: 5000 + r })));

describe('qualityNames: one day_sessions read for the whole page', () => {
  it('reads day_sessions once for 14 days (was 14)', async () => {
    const db = seededDb();
    db.tables.day_sessions.push({ id: uid(), session_date: '2026-11-20', title: 'פארטלק', quality: true, published_at: '2026-11-19T10:00:00Z' });
    db.tables.day_sessions.push({ id: uid(), session_date: '2026-11-21', title: 'draft', quality: true, published_at: null });
    loadQualityWorkout.mockClear();
    const names = await qualityNames(db.client, runs);
    expect(db.log.filter((q) => q.table === 'day_sessions')).toHaveLength(1);
    // The day with a quality day-session does not ask the plan; the 13 others do.
    expect(loadQualityWorkout).toHaveBeenCalledTimes(13);
    expect(loadQualityWorkout.mock.calls.map((c) => c[1])).not.toContain('2026-11-20');
    // Every runner's run that day takes the name; a draft session does not count.
    expect(names.get(`${runners[0]}-10`)).toBe('פארטלק');
    expect(names.get(`${runners[3]}-14`)).toBe('שלישי');
    expect([...names.values()].filter((n) => n === 'draft')).toEqual([]);
  });

  it('falls back to the plan for every day when day_sessions is missing', async () => {
    const db = createMemoryDb({ schema: {} });
    loadQualityWorkout.mockClear();
    const names = await qualityNames(db.client, runs.slice(0, 15));
    expect(loadQualityWorkout).toHaveBeenCalledTimes(14);
    expect(names.get(`${runners[0]}-14`)).toBe('שלישי');
  });

  it('no runs, no reads', async () => {
    const db = seededDb();
    expect((await qualityNames(db.client, [])).size).toBe(0);
    expect(db.log).toHaveLength(0);
  });
});

type FeedItemLike = Parameters<typeof strengthForFeed>[1][number];
const strengthItem = (id: string) => ({ activity: { id, activityType: 'strength_training', averageHr: 120 } }) as unknown as FeedItemLike;

describe('strengthForFeed: one activities read instead of three', () => {
  it('reads athlete_activities once when every column exists', async () => {
    const db = seededDb();
    db.tables.athlete_activities.push({ id: 's1', training_effect: { aerobic: 2.5 }, suffer_score: 30, exercise_sets: [{ exercise: 'squat', reps: 10, setType: 'ACTIVE' }] });
    const out = await strengthForFeed(db.client, [strengthItem('s1')], uid());
    expect(db.log.filter((q) => q.table === 'athlete_activities')).toHaveLength(1);
    expect(out[0].activity?.strength).toMatchObject({ aerobicTe: 2.5, relativeEffort: 30 });
  });

  it('a missing column falls back to per-column reads and keeps the others', async () => {
    const db = seededDb({ withSuffer: false });
    db.tables.athlete_activities.push({ id: 's1', training_effect: { aerobic: 3.1 }, exercise_sets: null });
    const out = await strengthForFeed(db.client, [strengthItem('s1')], uid());
    expect(db.log.filter((q) => q.table === 'athlete_activities')).toHaveLength(4);
    expect(out[0].activity?.strength).toMatchObject({ aerobicTe: 3.1, relativeEffort: null });
  });

  it('a page with no strength cards reads nothing', async () => {
    const db = seededDb();
    const run = { activity: { id: 'r', activityType: 'running' } } as unknown as FeedItemLike;
    await strengthForFeed(db.client, [run], uid());
    expect(db.log).toHaveLength(0);
  });
});
