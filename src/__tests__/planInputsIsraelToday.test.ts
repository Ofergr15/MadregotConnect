import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMemoryDb } from './helpers/memory-db';

let db: ReturnType<typeof createMemoryDb>;
const seen: string[] = [];
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => db.client }));
vi.mock('@/lib/auth/self-or-staff', () => ({
  resolveVerifiedCaller: async () => ({ denied: null, caller: { athleteId: 'coach', isStaff: true, isSuperUser: true } }),
}));
vi.mock('@/lib/academy/pairing-server', () => ({ visibleTraineeIds: async () => null }));
vi.mock('@/lib/academy/characterization', async (orig) => {
  const real = await orig<typeof import('@/lib/academy/characterization')>();
  return { ...real, planInputsFrom: (c: never, today: string) => { seen.push(today); return real.planInputsFrom(c, today); } };
});
const { GET } = await import('@/app/api/academy/plan-inputs/route');

const COLS = ['candidate_id', 'goal_type', 'target_race', 'target_race_date', 'weekly_km', 'years_running',
  'available_days', 'limitations', 'watch', 'pr_distance_m', 'pr_time_sec', 'fit', 'recorded_by'];

describe('/api/academy/plan-inputs counts down from Israel\'s day', () => {
  afterEach(() => vi.useRealTimers());
  it('at 2026-10-24T22:30Z (01:30 Sunday in Israel) today is 2026-10-25, not the UTC date', async () => {
    db = createMemoryDb({
      schema: { academy_candidates: ['id', 'athlete_id'], academy_characterizations: COLS },
    });
    (db.tables.academy_candidates as unknown[]).push({ id: 'c1', athlete_id: 'a1' });
    (db.tables.academy_characterizations as unknown[]).push({ candidate_id: 'c1', target_race_date: '2026-11-01' });
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-24T22:30:00Z'));
    seen.length = 0;
    const res = await GET(new Request('http://x/api/academy/plan-inputs?athleteIds=a1'));
    expect(res.status).toBe(200);
    expect(seen).toEqual(['2026-10-25']);
  });
});
