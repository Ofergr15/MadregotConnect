// Task 75: the staff attendance calendar summed RSVPs from ONE capped read, so a
// month view past 1000 rows undercounted its last days.
import { describe, expect, it, vi } from 'vitest';

// 1200 RSVPs, all on Tuesday 2026-11-24 (week 2026-11-22, day 2).
const ROWS = Array.from({ length: 1200 }, (_, i) => ({ week_start_date: '2026-11-22', day_of_week: 2, attending: i % 4 !== 0 }));

function builder() {
  let lo = 0; let hi = Infinity;
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  Object.assign(chain, {
    select: self, eq: self, gte: self, lte: self, order: self,
    range: (a: number, b: number) => { lo = a; hi = b; return chain; },
    then: (res: (v: unknown) => unknown) =>
      Promise.resolve({ data: ROWS.slice(lo, Math.min(hi, lo + 999) + 1), error: null }).then(res),
  });
  return chain;
}
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => ({ from: builder }) }));
vi.mock('@/lib/auth/self-or-staff', async (orig) => ({
  ...(await orig<typeof import('@/lib/auth/self-or-staff')>()),
  resolveVerifiedCaller: async () => ({ denied: null, caller: { email: 'c@x', athleteId: 'c', isStaff: true, isSuperUser: false, role: 'coach' } }),
}));

describe('attendance calendar counts every RSVP', () => {
  it('1200 rows → total 1200 on the day', async () => {
    const { GET } = await import('@/app/api/attendance/route');
    const res = await GET(new Request('http://x/api/attendance?calendar=1&from=2026-11-01&to=2026-11-30'));
    expect(res.status).toBe(200);
    const { days } = await res.json();
    expect(days['2026-11-24']).toEqual({ going: 900, notGoing: 300, total: 1200 });
  });
});
