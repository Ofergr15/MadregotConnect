import { describe, it, expect } from 'vitest';
import { isRouteHdTester, loadHdRoutes, parseTesterIds, withHdRoutes } from '@/lib/feed/route-hd';
import type { FeedItem } from '@/lib/feed/project';

// A stand-in for the Supabase builder: every chain step returns itself, and the
// terminal call answers with what the test asks for.
function db(answer: { data: unknown; error: unknown }) {
  const q: Record<string, unknown> = {};
  for (const m of ['from', 'select', 'eq', 'in']) q[m] = () => q;
  q.maybeSingle = async () => answer;
  q.then = (res: (v: unknown) => unknown) => Promise.resolve(answer).then(res);
  return q as never;
}

const pts = (n: number) => Array.from({ length: n }, (_, i) => ({ lat: 32 + i / 1e4, lng: 34.8 + i / 1e4 }));
const item = (id: string | null) =>
  ({ id: `f-${id}`, activity: id ? { id, routePreview: pts(60) } : null }) as unknown as FeedItem;

describe('route HD trial', () => {
  it('reads the tester list leniently', () => {
    expect(parseTesterIds('["a","b",3]')).toEqual(['a', 'b']);
    expect(parseTesterIds('not json')).toEqual([]);
    expect(parseTesterIds(null)).toEqual([]);
    expect(parseTesterIds('{"a":1}')).toEqual([]);
  });

  it('lets in the super user and the listed runners only', async () => {
    const listed = db({ data: { value: '["a1"]' }, error: null });
    expect(await isRouteHdTester(listed, { athleteId: 'zz', isSuperUser: true })).toBe(true);
    expect(await isRouteHdTester(listed, { athleteId: 'a1', isSuperUser: false })).toBe(true);
    expect(await isRouteHdTester(listed, { athleteId: 'a2', isSuperUser: false })).toBe(false);
    expect(await isRouteHdTester(listed, { athleteId: null, isSuperUser: false })).toBe(false);
    expect(await isRouteHdTester(db({ data: null, error: null }), { athleteId: 'a1', isSuperUser: false })).toBe(false);
  });

  it('reads a missing column (130 not pasted) as no HD routes', async () => {
    const missing = db({ data: null, error: { code: '42703' } });
    expect((await loadHdRoutes(missing, ['x'])).size).toBe(0);
  });

  it('swaps the route in and marks the card, leaving the rest alone', async () => {
    const hd = await loadHdRoutes(db({ data: [{ id: 'x', route_preview_hd: pts(300) }, { id: 'y', route_preview_hd: [] }], error: null }), ['x', 'y']);
    const [a, b, c] = withHdRoutes([item('x'), item('y'), item(null)], hd);
    expect(a.activity!.routePreview).toHaveLength(300);
    expect(a.activity!.routeHd).toBe(true);
    expect(b.activity!.routePreview).toHaveLength(60);
    expect(b.activity!.routeHd).toBeUndefined();
    expect(c.activity).toBeNull();
  });
});
