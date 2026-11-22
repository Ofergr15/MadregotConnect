import { describe, expect, it, vi, beforeEach } from 'vitest';

// GET /api/athletes/[id]/stats?as=member — "how members see me" (settings rev 3): the owner
// gets exactly what a teammate gets, with no owner-only reads (wellness).
const ME = '11111111-1111-1111-1111-111111111111';
let caller = { athleteId: ME, isStaff: false, isSuperUser: false, role: 'runner' };
const readWellnessNights = vi.fn(async () => [{ date: '2026-11-20', sleepSeconds: 27000, restingHr: 48 }]);

vi.mock('@/lib/auth/self-or-staff', () => ({ resolveVerifiedCaller: async () => ({ denied: null, caller }) }));
vi.mock('@/lib/auth/pending-athletes', () => ({ isPendingAthlete: async () => false, seesPending: () => true }));
vi.mock('@/lib/wellness/read', () => ({ readWellnessNights: () => readWellnessNights() }));
vi.mock('@/lib/supabase/paginate', () => ({ fetchAllRows: async () => [] }));
vi.mock('@/lib/athletes/week-pref', () => ({ readWeekStartDay: async () => 1 }));
vi.mock('@/lib/prs/attach-laps', () => ({ loadPrLaps: async () => new Map(), applyPrLaps: (x: unknown) => x }));
vi.mock('@/lib/prs/overrides-store', () => ({ readPrOverrides: async () => [] }));
vi.mock('@/lib/prs/exclusions-store', () => ({ readPrExclusions: async () => [], excludedRunsByBucket: () => new Map() }));
vi.mock('@/lib/supabase/server', () => {
  const q: any = new Proxy({}, { get: (_t, k) => (k === 'then' ? (r: (v: unknown) => void) => r({ data: [], error: null }) : () => q) });
  return { createServerClient: () => ({ from: () => q }) };
});

const { GET } = await import('@/app/api/athletes/[id]/stats/route');
const call = (qs = '') => GET(new Request(`https://x.test/api/athletes/${ME}/stats${qs}`), { params: Promise.resolve({ id: ME }) } as never);

describe('stats ?as=member', () => {
  beforeEach(() => { readWellnessNights.mockClear(); caller = { athleteId: ME, isStaff: false, isSuperUser: false, role: 'runner' }; });

  it('the owner normally gets their own wellness folded in', async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(readWellnessNights).toHaveBeenCalledTimes(1);
  });

  it('?as=member skips the owner-only read and ships the teammate shape', async () => {
    const own = await (await call()).json();
    const asMember = await (await call('?as=member')).json();
    expect(readWellnessNights).toHaveBeenCalledTimes(1); // only the first call
    caller = { athleteId: '22222222-2222-2222-2222-222222222222', isStaff: false, isSuperUser: false, role: 'runner' };
    const mate = await (await call()).json();
    expect(Object.keys(asMember.last7 ?? {}).sort()).toEqual(Object.keys(mate.last7 ?? {}).sort());
    expect(JSON.stringify(asMember.last7)).toBe(JSON.stringify(mate.last7));
    expect(own).toBeTruthy();
  });
});
