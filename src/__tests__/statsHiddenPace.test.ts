import { describe, expect, it, vi, beforeEach } from 'vitest';
import { israelToday } from '@/lib/utils';

// GET /api/athletes/[id]/stats — pace / calories the runner hid in the share sheet are
// withheld from teammates (and the owner's ?as=member preview); a failed read hides all.
const ME = '11111111-1111-1111-1111-111111111111';
const MATE = '22222222-2222-2222-2222-222222222222';
let caller = { athleteId: ME, isStaff: false, isSuperUser: false, role: 'runner' };
const today = israelToday();
const acts = [
  { id: 'hid', activity_name: 'H', activity_type: 'running', start_time: `${today}T07:00:00`, distance: 10000, duration: 3000, calories: 700 },
  { id: 'vis', activity_name: 'V', activity_type: 'running', start_time: `${today}T06:00:00`, distance: 5000, duration: 1500, calories: 300 },
];
let feed: { data: unknown; error: unknown } = { data: [], error: null };

vi.mock('@/lib/auth/self-or-staff', () => ({
  resolveVerifiedCaller: async () => ({ denied: null, caller }),
  mayActFor: (c: typeof caller, t: string) => c.isStaff || c.isSuperUser || c.athleteId === t,
}));
vi.mock('@/lib/auth/pending-athletes', () => ({ isPendingAthlete: async () => false, seesPending: () => true }));
vi.mock('@/lib/wellness/read', () => ({ readWellnessNights: async () => [] }));
vi.mock('@/lib/supabase/paginate', () => ({ fetchAllRows: async () => acts }));
vi.mock('@/lib/athletes/week-pref', () => ({ readWeekStartDay: async () => 1 }));
vi.mock('@/lib/prs/attach-laps', () => ({ loadPrLaps: async () => new Map(), applyPrLaps: (x: unknown) => x }));
vi.mock('@/lib/prs/overrides-store', () => ({ readPrOverrides: async () => [] }));
vi.mock('@/lib/prs/exclusions-store', () => ({ readPrExclusions: async () => [], excludedRunsByBucket: () => new Map(), isExcluded: () => false }));
vi.mock('@/lib/supabase/server', () => {
  const mk = (table: string): any => new Proxy({}, {
    get: (_t, k) => (k === 'then'
      ? (r: (v: unknown) => void) => r(table === 'feed_items' ? feed : { data: [], error: null })
      : () => mk(table)),
  });
  return { createServerClient: () => ({ from: (t: string) => mk(t) }) };
});

const { GET } = await import('@/app/api/athletes/[id]/stats/route');
const call = async (qs = '') =>
  (await GET(new Request(`https://x.test/api/athletes/${ME}/stats${qs}`), { params: Promise.resolve({ id: ME }) } as never)).json();
const run = (b: any, id: string) => b.recentRuns.find((r: any) => r.id === id);

describe('stats hidden pace / calories', () => {
  beforeEach(() => {
    caller = { athleteId: MATE, isStaff: false, isSuperUser: false, role: 'runner' };
    feed = { data: [{ activity_id: 'hid', payload: { hiddenFields: ['pace', 'calories'] } }], error: null };
  });

  it('a teammate gets null pace and no calories for the hidden run, real pace for the visible one', async () => {
    const b = await call();
    expect(run(b, 'hid')).toMatchObject({ paceSecPerKm: null, paceHidden: true, km: 10, durationSec: 3000 });
    expect(run(b, 'vis').paceSecPerKm).toBe(300);
    expect(run(b, 'vis').paceHidden).toBeUndefined();
    expect(b.last7.calories).toBe(300);
    expect(b.last7.caloriesHidden).toBe(true);
  });

  it('the owner and staff see everything', async () => {
    for (const c of [{ athleteId: ME, isStaff: false }, { athleteId: 'staff', isStaff: true }]) {
      caller = { ...caller, ...c };
      const b = await call();
      expect(run(b, 'hid').paceSecPerKm).toBe(300);
      expect(b.last7.calories).toBe(1000);
    }
  });

  it('?as=member gives the owner the masked view', async () => {
    caller = { ...caller, athleteId: ME };
    const b = await call('?as=member');
    expect(run(b, 'hid').paceSecPerKm).toBeNull();
    expect(b.last7.calories).toBe(300);
  });

  it('a failed hiddenFields read masks every run', async () => {
    feed = { data: null, error: { message: 'boom' } };
    const b = await call();
    expect(run(b, 'hid').paceSecPerKm).toBeNull();
    expect(run(b, 'vis').paceSecPerKm).toBeNull();
    expect(b.last7.calories).toBe(0);
  });
});
