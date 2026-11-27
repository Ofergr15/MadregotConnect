import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { yourWeekWindows, yourWeekNumbers, shouldSend, yourWeekCopy, isSunday } from '@/lib/weekly-summary/your-week';
import { FEATURES } from '@/lib/features/flags';

// 2026-11-29 is a Sunday. Activity week closing tonight: Mon 11-23 … Sun 11-29.
// Plan week that closed last night: Sun 11-22 … Sat 11-28.
const SUNDAY = '2026-11-29';
const run = (start_time: string, km: number, activity_type: string | null = 'running') => ({ start_time, distance: km * 1000, activity_type });

describe('your week — windows', () => {
  it('splits the two anchors around Sunday', () => {
    expect(yourWeekWindows(SUNDAY)).toEqual({
      activityWeekStart: '2026-11-23', activityWeekEnd: '2026-11-30',
      planWeekStart: '2026-11-22', planWeekEnd: '2026-11-29',
    });
  });
  it('refuses a non-Sunday', () => {
    expect(isSunday('2026-11-28')).toBe(false);
    expect(() => yourWeekWindows('2026-11-28')).toThrow();
  });
});

describe('your week — plan week vs activity week', () => {
  it('this Sunday morning counts for the activity week only (it opens the NEXT plan week)', () => {
    const n = yourWeekNumbers(SUNDAY, [run('2026-11-29T07:00:00+00:00', 10)]);
    expect(n).toEqual({ activityKm: 10, activityRuns: 1, planWeekKm: 0, planWeekRuns: 0 });
  });
  it("last Sunday's long run counts for the plan week only (previous activity week)", () => {
    const n = yourWeekNumbers(SUNDAY, [run('2026-11-22T06:00:00+00:00', 30)]);
    expect(n).toEqual({ activityKm: 0, activityRuns: 0, planWeekKm: 30, planWeekRuns: 1 });
  });
  it('Monday–Saturday counts in both', () => {
    const n = yourWeekNumbers(SUNDAY, [run('2026-11-23T06:00:00+00:00', 8), run('2026-11-28T06:00:00+00:00', 12.25)]);
    expect(n.activityKm).toBe(20.3);
    expect(n.planWeekKm).toBe(20.3);
    expect(n.activityRuns).toBe(2);
  });
  it('a 22:30 Saturday wall-clock run stays on Saturday (no timezone double-shift)', () => {
    const n = yourWeekNumbers(SUNDAY, [run('2026-11-28T22:30:00+00:00', 5)]);
    expect(n.planWeekRuns).toBe(1);
    expect(n.activityRuns).toBe(1);
  });
  it('a 23:30 Sunday wall-clock run is still this activity week, not next', () => {
    expect(yourWeekNumbers(SUNDAY, [run('2026-11-29T23:30:00+00:00', 5)]).activityRuns).toBe(1);
  });
  it('ignores non-runs and zero distance; nothing to send for an empty week', () => {
    const n = yourWeekNumbers(SUNDAY, [run('2026-11-24T06:00:00+00:00', 40, 'cycling'), run('2026-11-24T07:00:00+00:00', 0)]);
    expect(shouldSend(n)).toBe(false);
  });
  it('copy names both weeks in both languages', () => {
    const n = { activityKm: 52.3, activityRuns: 5, planWeekKm: 48, planWeekRuns: 5 };
    expect(yourWeekCopy('he', n).body).toContain('52.3');
    expect(yourWeekCopy('he', n).body).toContain('48');
    expect(yourWeekCopy('en', n).body).toMatch(/Mon–Sun.*Sun–Sat/);
  });
});

describe('GET /api/cron/your-week — dry run, gated', () => {
  const ORIG = process.env.CRON_SECRET;
  beforeEach(() => { vi.resetModules(); vi.doMock('@/lib/cron-pause', () => ({ cronPaused: async () => false })); });
  afterEach(() => { process.env.CRON_SECRET = ORIG; });

  it('flag is default-off', () => {
    expect(FEATURES.your_week_push.defaultEnabled).toBe(false);
  });

  it('fails closed without CRON_SECRET configured', async () => {
    delete process.env.CRON_SECRET;
    vi.doMock('@/lib/supabase/server', () => ({ createServerClient: () => { throw new Error('must not touch the db'); } }));
    const { GET } = await import('@/app/api/cron/your-week/route');
    expect((await GET(new Request('http://x/api/cron/your-week'))).status).toBe(401);
  });

  it('only opted-in athletes, returns dryRun and never sends', async () => {
    process.env.CRON_SECRET = 's';
    const { createMemoryDb } = await import('./helpers/memory-db');
    const db = createMemoryDb({
      schema: { athletes: ['id', 'status'], athlete_activities: ['athlete_id', 'start_time', 'distance', 'duration', 'activity_type'] },
    });
    db.tables.athletes.push({ id: 'a1', status: 'active' }, { id: 'a2', status: 'active' });
    db.tables.athlete_activities.push(
      { athlete_id: 'a1', start_time: '2026-11-25T06:00:00+00:00', distance: 10000, duration: 3000, activity_type: 'running' },
      { athlete_id: 'a2', start_time: '2026-11-25T06:00:00+00:00', distance: 10000, duration: 3000, activity_type: 'running' },
    );
    vi.doMock('@/lib/supabase/server', () => ({ createServerClient: () => db.client }));
    vi.doMock('@/lib/features/server', () => ({
      featureResolutions: async (_k: string[], id: string) => ({ your_week_push: { enabled: id === 'a1', source: null } }),
    }));
    const send = vi.fn();
    vi.doMock('@/lib/push', () => ({ sendPushLocalized: send, notifyAthlete: send, sendPushDetailed: send }));
    const { GET } = await import('@/app/api/cron/your-week/route');
    const res = await GET(new Request(`http://x/api/cron/your-week?sunday=${SUNDAY}`, { headers: { authorization: 'Bearer s' } }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.dryRun).toBe(true);
    expect(body.optedIn).toBe(1);
    expect(body.wouldSend.map((w: { athleteId: string }) => w.athleteId)).toEqual(['a1']);
    expect(send).not.toHaveBeenCalled();
  });

  it('is not scheduled in vercel.json', async () => {
    const { readFileSync } = await import('node:fs');
    expect(readFileSync('vercel.json', 'utf8')).not.toContain('your-week');
  });
});
