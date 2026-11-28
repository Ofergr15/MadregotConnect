import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryDb } from './helpers/memory-db';

/**
 * checkAndAwardBadges end to end on an in-memory database (round 6, task 169 —
 * coverage of lib/badges/award-engine.ts). Every rule type, the "already earned"
 * skip, the quiet catch-up, the concurrent-award race and the degraded paths.
 */
const pushes: Array<{ athleteId: string; tag: string }> = [];
vi.mock('@/lib/push', () => ({ notifyAthlete: async (o: { athleteId: string; tag: string }) => { pushes.push(o); } }));
vi.mock('@/lib/prs/exclusions-store', async (orig) => ({ ...(await orig() as object), readPrExclusions: async () => undefined }));
vi.mock('@/lib/prs/attach-laps', () => ({ attachLapsForPrs: async (_db: unknown, _id: string, runs: unknown[]) => runs }));
let db: ReturnType<typeof createMemoryDb>;
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => db.client }));
const engine = await import('@/lib/badges/award-engine');

const A = 'ath-1';
const OLD = '2025-01-01T00:00:00Z';

function fresh(opts: { withRaces?: boolean; withBadges?: boolean } = {}) {
  const schema: Record<string, string[]> = {
    athlete_badges: ['athlete_id', 'badge_id', 'context'],
    athlete_activities: ['id', 'athlete_id', 'activity_name', 'activity_type', 'start_time', 'distance', 'duration'],
    athletes: ['id', 'created_at', 'approved'],
    feed_items: ['type', 'author_athlete_id', 'occurred_at', 'payload'],
    app_settings: ['key', 'value'],
    workout_attendance: ['athlete_id', 'week_start_date', 'day_of_week', 'attending'],
  };
  if (opts.withBadges !== false) schema.badges = ['id', 'code', 'name_he', 'name_en', 'icon', 'icon_url', 'rule_type', 'rule_params', 'active'];
  if (opts.withRaces) schema.race_matches = ['athlete_id', 'activity_id', 'is_race', 'created_at'];
  db = createMemoryDb({ schema, unique: { athlete_badges: [['athlete_id', 'badge_id']] } });
  db.tables.athletes.push({ id: A, created_at: OLD, approved: true });
}

let n = 0;
const badge = (rule_type: string, rule_params: Record<string, unknown>, code = `b${++n}`) => {
  const row = { id: `id-${code}`, code, name_he: code, name_en: code, icon: '🏅', icon_url: null, rule_type, rule_params, active: true };
  db.tables.badges.push(row);
  return row;
};
const run = (day: string, km: number, paceSec = 300, type = 'running') => db.tables.athlete_activities.push({
  id: `act-${day}-${km}`, athlete_id: A, activity_name: 'Run', activity_type: type,
  start_time: `${day}T06:00:00+00:00`, distance: km * 1000, duration: Math.round(km * paceSec),
});

beforeEach(() => { pushes.length = 0; fresh(); });

describe('checkAndAwardBadges', () => {
  it('cumulative distance and duration: awarded at the threshold, not below', async () => {
    badge('cumulative_distance', { km: 20 }, 'km20');
    badge('cumulative_distance', { km: 100 }, 'km100');
    badge('cumulative_duration', { hours: 1 }, 'h1');
    run('2026-11-02', 12); run('2026-11-04', 10);
    const { awarded } = await engine.checkAndAwardBadges(A);
    expect(awarded.map((b) => b.code).sort()).toEqual(['h1', 'km20']);
    expect(db.tables.athlete_badges.find((r) => r.badge_id === 'id-km20')?.context).toEqual({ totalKm: 22 });
    // Two earned in one pass is news (≤ BURST_LIMIT): a feed post and a push each.
    expect(db.tables.feed_items).toHaveLength(2);
    expect(pushes.map((p) => p.tag).sort()).toEqual([`badge-h1-${A}`, `badge-km20-${A}`]);
  });

  it('never re-awards a badge already earned', async () => {
    const b = badge('cumulative_distance', { km: 5 }, 'km5');
    db.tables.athlete_badges.push({ athlete_id: A, badge_id: b.id, context: {} });
    run('2026-11-02', 12);
    expect((await engine.checkAndAwardBadges(A)).awarded).toEqual([]);
    expect(db.tables.athlete_badges).toHaveLength(1);
  });

  it('a pass earning more than BURST_LIMIT is a quiet catch-up: rows only, no posts or pushes', async () => {
    for (const km of [1, 2, 3]) badge('cumulative_distance', { km }, `k${km}`);
    run('2026-11-02', 12);
    expect((await engine.checkAndAwardBadges(A)).awarded).toHaveLength(3);
    expect(db.tables.athlete_badges).toHaveLength(3);
    expect(db.tables.feed_items).toEqual([]);
    expect(pushes).toEqual([]);
  });

  it('a new or unapproved member is quiet too', async () => {
    db.tables.athletes[0].approved = false;
    badge('cumulative_distance', { km: 1 }, 'k1');
    run('2026-11-02', 5);
    expect((await engine.checkAndAwardBadges(A)).awarded).toHaveLength(1);
    expect(pushes).toEqual([]);
  });

  it('pr_bucket: awards on a qualifying 5K, not for an unknown bucket', async () => {
    badge('pr_bucket', { bucket: '5k' }, 'first5k');
    badge('pr_bucket', { bucket: 'nope' }, 'bogus');
    run('2026-11-02', 5.02);
    const { awarded } = await engine.checkAndAwardBadges(A);
    expect(awarded.map((b) => b.code)).toEqual(['first5k']);
    expect(db.tables.athlete_badges[0].context).toMatchObject({ activityId: 'act-2026-11-02-5.02' });
  });

  it('streak_weeks counts run weeks only (strength and zero-distance rows do not extend it)', async () => {
    badge('streak_weeks', { weeks: 2 }, 'streak2');
    badge('streak_weeks', { weeks: 4 }, 'streak4');
    const now = new Date();
    for (let w = 0; w < 3; w++) {
      const d = new Date(now.getTime() - w * 7 * 86_400_000).toISOString().slice(0, 10);
      run(d, 6);
    }
    run(new Date(now.getTime() - 3 * 7 * 86_400_000).toISOString().slice(0, 10), 0, 300, 'strength_training');
    const { awarded } = await engine.checkAndAwardBadges(A);
    expect(awarded.map((b) => b.code)).toEqual(['streak2']);
  });

  it('race_count: awarded at the count; a missing race_matches table degrades to not earned', async () => {
    badge('race_count', { count: 2 }, 'races2');
    expect((await engine.checkAndAwardBadges(A)).awarded).toEqual([]);
    fresh({ withRaces: true });
    badge('race_count', { count: 2 }, 'races2');
    db.tables.race_matches.push(
      { athlete_id: A, activity_id: 'r1', is_race: true, created_at: '2026-01-01' },
      { athlete_id: A, activity_id: 'r2', is_race: true, created_at: '2026-02-01' },
      { athlete_id: A, activity_id: 'x', is_race: false, created_at: '2026-03-01' },
    );
    const { awarded } = await engine.checkAndAwardBadges(A);
    expect(awarded.map((b) => b.code)).toEqual(['races2']);
    expect(db.tables.athlete_badges[0].context).toEqual({ raceCount: 2, activityId: 'r2' });
  });

  it('attendance_perfect_month: every team day needs a yes AND a same-day run', async () => {
    badge('attendance_perfect_month', {}, 'perfect');
    const { firstDayStr, lastDayNum } = engine.previousCompletedMonthRange();
    const month = firstDayStr.slice(0, 7);
    db.tables.app_settings.push({ key: 'reminder_config', value: JSON.stringify({ teamDays: [2] }) });
    const { getPlanWeekStart } = await import('@/lib/utils');
    const tuesdays: string[] = [];
    for (let d = 1; d <= lastDayNum; d++) {
      const s = `${month}-${String(d).padStart(2, '0')}`;
      if (new Date(`${s}T12:00:00`).getDay() === 2) tuesdays.push(s);
    }
    for (const t of tuesdays) {
      db.tables.workout_attendance.push({ athlete_id: A, week_start_date: getPlanWeekStart(new Date(`${t}T12:00:00`)), day_of_week: 2, attending: true });
      run(t, 8);
    }
    // One Tuesday without the run → not perfect.
    db.tables.athlete_activities.pop();
    expect((await engine.checkAndAwardBadges(A, { ruleTypes: ['attendance_perfect_month'] })).awarded).toEqual([]);
    run(tuesdays[tuesdays.length - 1], 8);
    const { awarded } = await engine.checkAndAwardBadges(A, { ruleTypes: ['attendance_perfect_month'] });
    expect(awarded.map((b) => b.code)).toEqual(['perfect']);
    expect(db.tables.athlete_badges[0].context).toEqual({ month, teamDaysConfirmed: tuesdays.length });
  });

  it('attendance_perfect_month with no team days in config earns nothing', async () => {
    badge('attendance_perfect_month', {}, 'perfect');
    db.tables.app_settings.push({ key: 'reminder_config', value: JSON.stringify({ teamDays: [] }) });
    expect((await engine.checkAndAwardBadges(A)).awarded).toEqual([]);
  });

  it('a missing badges table, an inactive or unknown rule, and a bad threshold award nothing', async () => {
    fresh({ withBadges: false });
    expect(await engine.checkAndAwardBadges(A)).toEqual({ awarded: [] });
    fresh();
    badge('challenge_completed', {}, 'other');
    badge('cumulative_distance', { km: 'lots' }, 'bad');
    badge('cumulative_distance', { km: 1 }, 'off').active = false;
    run('2026-11-02', 10);
    expect((await engine.checkAndAwardBadges(A)).awarded).toEqual([]);
  });
});

describe('awardBadge', () => {
  it('a concurrent award (unique violation) returns false and posts nothing', async () => {
    const b = badge('cumulative_distance', { km: 1 }, 'k1') as unknown as Parameters<typeof engine.awardBadge>[2];
    expect(await engine.awardBadge(db.client, A, b, {})).toBe(true);
    expect(await engine.awardBadge(db.client, A, b, {})).toBe(false);
    expect(db.tables.feed_items).toHaveLength(1);
    expect(pushes).toHaveLength(1);
  });

  it('quiet writes the row only', async () => {
    const b = badge('cumulative_distance', { km: 1 }, 'k1') as unknown as Parameters<typeof engine.awardBadge>[2];
    expect(await engine.awardBadge(db.client, A, b, {}, { quiet: true })).toBe(true);
    expect(db.tables.feed_items).toEqual([]);
    expect(pushes).toEqual([]);
  });
});

describe('helpers', () => {
  it('previousCompletedMonthRange rolls over the year in Israel time', () => {
    expect(engine.previousCompletedMonthRange(new Date('2026-01-15T10:00:00Z'))).toEqual({
      firstDayStr: '2025-12-01', lastDayStr: '2025-12-31', nextMonthFirstStr: '2026-01-01', lastDayNum: 31,
    });
    // 22:30 UTC on 31 Mar is already 1 Apr in Israel → March is the completed month.
    expect(engine.previousCompletedMonthRange(new Date('2026-03-31T22:30:00Z')).firstDayStr).toBe('2026-03-01');
    expect(engine.previousCompletedMonthRange(new Date('2028-03-10T12:00:00Z')).lastDayNum).toBe(29);
  });

  it('joinedRecently / isCatchUp', () => {
    const now = new Date('2026-11-28T00:00:00Z');
    expect(engine.joinedRecently('2026-11-25T00:00:00Z', now)).toBe(true);
    expect(engine.joinedRecently('2026-11-01T00:00:00Z', now)).toBe(false);
    expect(engine.joinedRecently(null, now)).toBe(false);
    expect(engine.joinedRecently('garbage', now)).toBe(false);
    expect(engine.isCatchUp(engine.BURST_LIMIT, false)).toBe(false);
    expect(engine.isCatchUp(engine.BURST_LIMIT + 1, false)).toBe(true);
    expect(engine.isCatchUp(0, true)).toBe(true);
  });
});
