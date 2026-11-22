import { describe, it, expect, vi } from 'vitest';

// volume-history input rules (behaviour from 8bf0c1c0): unknown granularity → 400 before any
// read or auth; fractional counts are floored. Synthetic: auth + DB mocked.
const reads: string[] = [];
vi.mock('@/lib/auth/self-or-staff', () => ({
  resolveVerifiedCaller: async () => { reads.push('auth'); return { denied: new Response('{}', { status: 401 }), caller: {} }; },
  mayActFor: () => true,
}));
// Constructing the client is not a read; any table access is.
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => ({ from: (t: string) => { reads.push(`db:${t}`); throw new Error('no reads'); } }) }));

const call = async (q: string) => {
  const { GET } = await import('@/app/api/athletes/volume-history/route');
  return GET(new Request(`http://x/api/athletes/volume-history?${q}`) as any);
};

describe('volume-history inputs', () => {
  it('unknown granularity is 400 before auth or any table read', async () => {
    reads.length = 0;
    const r = await call('athleteId=a&granularity=bogus');
    expect(r.status).toBe(400);
    expect(reads).toEqual([]);
  });
  it('valid granularities pass the input check (reach auth)', async () => {
    for (const g of ['week', 'month', 'year']) {
      reads.length = 0;
      const r = await call(`athleteId=a&granularity=${g}&weeks=1.5`);
      expect(r.status).toBe(401);
      expect(reads).toContain('auth');
    }
  });
  it('the route floors counts and keeps the 53-week cap', async () => {
    const { readFileSync } = await import('fs');
    const src = readFileSync('src/app/api/athletes/volume-history/route.ts', 'utf8');
    expect(src).toMatch(/Math\.floor\(Number\(searchParams\.get\('weeks'\)\)\) \|\| 12, 1\), 53\)/);
    expect(src).toMatch(/Math\.floor\(Number\(searchParams\.get\('periods'\)\)\)/);
  });
});
