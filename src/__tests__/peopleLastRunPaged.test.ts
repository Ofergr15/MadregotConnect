import { describe, expect, it, vi } from 'vitest';

/**
 * The people list's "last run" reads every run in 60 days. It asked for .limit(5000)
 * and got PostgREST's 1000; at ~1,600 runs a quiet member's last run fell outside
 * the newest thousand and they showed as "no run in 60 days".
 */

// 1,500 runs by 'busy', newest first, then one older run by 'quiet'.
const RUNS = [
  ...Array.from({ length: 1500 }, (_, i) => ({ athlete_id: 'busy', start_time: `2026-10-${String(10 - Math.floor(i / 200)).padStart(2, '0')}T06:00:00+00:00` })),
  { athlete_id: 'quiet', start_time: '2026-09-20T06:00:00+00:00' },
];

vi.mock('@/lib/auth/self-or-staff', () => ({ requireStaff: async () => null }));
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({
    from: (table: string) => {
      const q: Record<string, unknown> = {};
      let range: [number, number] | null = null;
      q.select = () => q; q.eq = () => q; q.or = () => q; q.in = () => q; q.gte = () => q;
      q.order = () => q;
      q.range = (a: number, b: number) => { range = [a, b]; return q; };
      q.limit = () => q;
      q.then = (res: (v: unknown) => unknown) => {
        let data: unknown[] = [];
        if (table === 'athletes') data = [{ id: 'busy', name: 'Busy', status: 'active', approved: true }, { id: 'quiet', name: 'Quiet', status: 'active', approved: true }];
        if (table === 'athlete_activities') data = range ? RUNS.slice(range[0], Math.min(range[1] + 1, range[0] + 1000)) : RUNS.slice(0, 1000);
        return Promise.resolve({ data, error: null }).then(res);
      };
      return q;
    },
  }),
}));

import { GET } from '@/app/api/admin/people/route';

describe('people list', () => {
  it("finds a member's last run beyond the first thousand", async () => {
    const res = await GET(new Request('http://x/api/admin/people'));
    const body = await res.json();
    const people = (body.people || body) as Array<{ id: string; lastRunDay: string | null }>;
    expect(people.find((p) => p.id === 'quiet')?.lastRunDay).toBe('2026-09-20');
  });
});
