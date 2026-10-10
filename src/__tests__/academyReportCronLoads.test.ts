import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * cron/academy-report's nightly load step: it runs every day (report day or not), within
 * a 25 s budget, over every academy trainee, and neither it nor the report can fail the
 * other.
 */

vi.mock('@/lib/cron-pause', () => ({ cronPaused: async () => false }));
const loadAcademySettings = vi.fn();
vi.mock('@/lib/academy/settings-server', () => ({ loadAcademySettings: () => loadAcademySettings() }));
vi.mock('@/lib/email', () => ({ sendAcademyWeeklyReport: async () => ({ ok: true }) }));
vi.mock('@/lib/academy/report', () => ({
  computeAcademyWeekAdherence: async () => ({ athletes: [], weekStart: '2026-10-04', weekEnd: '2026-10-10' }),
  addDaysStr: (d: string) => d,
  sundayOf: () => '2026-10-11',
}));
vi.mock('@/lib/utils', () => ({ israelNow: () => ({ weekday: 2 }) }));
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => ({}) }));
vi.mock('@/lib/academy/book-server', () => ({ allAcademyTraineeIds: async () => ['t1', 't2'] }));
const sweepActivityLoads = vi.fn();
vi.mock('@/lib/academy/load-server', () => ({ sweepActivityLoads: (db: unknown, o: unknown) => sweepActivityLoads(db, o) }));

const { GET } = await import('@/app/api/cron/academy-report/route');

beforeEach(() => {
  delete process.env.CRON_SECRET;
  loadAcademySettings.mockResolvedValue({ report: { recipients: [], day: 0 } });
  sweepActivityLoads.mockReset();
  sweepActivityLoads.mockResolvedValue({ athletes: 2, priced: 7, pending: 0, timedOut: false });
});

describe('the nightly load sweep', () => {
  it('runs on a day with no report, over every trainee, within 25 s', async () => {
    const res = await GET(new Request('http://x/api/cron/academy-report'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ sent: false, reason: 'not the configured report day', loads: { athletes: 2, priced: 7 } });
    expect(sweepActivityLoads).toHaveBeenCalledWith({}, { athletes: ['t1', 't2'], budgetMs: 25_000 });
  });

  it('a failing sweep is logged, not fatal', async () => {
    sweepActivityLoads.mockRejectedValue(new Error('boom'));
    const res = await GET(new Request('http://x/api/cron/academy-report'));
    expect(res.status).toBe(200);
    expect((await res.json()).loads).toEqual({ error: 'boom' });
  });

  it('a failing report still lets the sweep run', async () => {
    loadAcademySettings.mockRejectedValue(new Error('settings down'));
    const res = await GET(new Request('http://x/api/cron/academy-report'));
    expect(res.status).toBe(500);
    expect(sweepActivityLoads).toHaveBeenCalled();
    expect((await res.json()).loads).toMatchObject({ priced: 7 });
  });

  it('an unauthorised call does neither', async () => {
    process.env.CRON_SECRET = 's3cret';
    const res = await GET(new Request('http://x/api/cron/academy-report'));
    expect(res.status).toBe(401);
    expect(sweepActivityLoads).not.toHaveBeenCalled();
  });
});
