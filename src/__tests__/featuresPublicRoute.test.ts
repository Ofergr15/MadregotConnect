import { describe, expect, it, vi, beforeEach } from 'vitest';

/** GET /api/features/public — one query for all public keys, CDN-cacheable, Server-Timing. */

let rows: unknown[] | null = [];
let fail: { code?: string; message: string } | null = null;
const calls: { table: string; inArg?: unknown; eqArg?: unknown }[] = [];

function client() {
  return {
    from(table: string) {
      const c: { table: string; inArg?: unknown; eqArg?: unknown } = { table };
      calls.push(c);
      const q = {
        select: () => q,
        in: (_col: string, v: unknown) => { c.inArg = v; return Promise.resolve({ data: rows, error: fail }); },
        eq: (_col: string, v: unknown) => { c.eqArg = v; return Promise.resolve({ data: rows, error: fail }); },
      };
      return q;
    },
  };
}
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => client() }));

const { GET } = await import('@/app/api/features/public/route');
const { PUBLIC_FEATURE_KEYS } = await import('@/lib/features/flags');

const club = (feature: string, enabled: boolean) =>
  ({ feature, scope_type: 'club', scope_id: 'club', enabled, set_by: 'x', set_at: 'now' });

beforeEach(() => { rows = []; fail = null; calls.length = 0; });

describe('GET /api/features/public', () => {
  it('reads every public key in one round trip', async () => {
    await GET();
    expect(calls).toHaveLength(1);
    expect(calls[0].inArg).toEqual([...PUBLIC_FEATURE_KEYS]);
  });

  it('is shareable by the CDN and carries Server-Timing', async () => {
    const r = await GET();
    expect(r.headers.get('cache-control')).toBe('public, s-maxage=60, stale-while-revalidate=300');
    expect(r.headers.get('server-timing')).toMatch(/^db;dur=\d+(\.\d)?, total;dur=\d+(\.\d)?$/);
  });

  it('answers only club rows, every key present, off by default', async () => {
    const { CLUB_SCOPE_ID } = await import('@/lib/features/flags');
    rows = [
      { ...club(PUBLIC_FEATURE_KEYS[0], true), scope_id: CLUB_SCOPE_ID },
      { feature: PUBLIC_FEATURE_KEYS[1], scope_type: 'athlete', scope_id: 'a1', enabled: true, set_by: 'x', set_at: 'now' },
    ];
    const body = await (await GET()).json();
    expect(Object.keys(body.features).sort()).toEqual([...PUBLIC_FEATURE_KEYS].sort());
    expect(body.features[PUBLIC_FEATURE_KEYS[0]]).toBe(true);
    expect(body.features[PUBLIC_FEATURE_KEYS[1]]).toBe(false);
    expect(JSON.stringify(body)).not.toContain('a1');
  });

  it('fails closed on a missing table or an error', async () => {
    fail = { code: '42P01', message: 'relation "feature_enablements" does not exist' };
    const a = await (await GET()).json();
    fail = { message: 'boom' };
    const b = await (await GET()).json();
    for (const body of [a, b]) for (const k of PUBLIC_FEATURE_KEYS) expect(body.features[k]).toBe(false);
  });

  it('Q24-5: the fail-closed answer is never cacheable by the CDN', async () => {
    fail = { message: 'boom' };
    const r = await GET();
    expect(r.headers.get('cache-control')).toBe('no-store');
  });
});
