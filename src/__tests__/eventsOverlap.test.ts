import { describe, expect, it, vi } from 'vitest';

/** /api/events filters by overlap: a camp that began last month is in this month. */

const h = vi.hoisted(() => ({ calls: [] as string[] }));
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => {
    const q: Record<string, unknown> = {};
    const rec = (name: string) => (...a: unknown[]) => { h.calls.push(`${name}:${a.join('|')}`); return q; };
    q.select = rec('select'); q.eq = rec('eq'); q.or = rec('or'); q.lte = rec('lte'); q.gte = rec('gte');
    q.order = async () => ({ data: [], error: null });
    return { from: () => q };
  },
}));
vi.mock('@/lib/auth-session', () => ({ requireSession: async () => ({ ok: true, user: {} }), requireStaff: async () => ({ ok: true }), authError: () => new Response(null, { status: 401 }) }));

import { GET } from '@/app/api/events/route';

describe('events in a month', () => {
  it('asks for every event still on when the month begins', async () => {
    h.calls = [];
    await GET(new Request('http://x/api/events?from=2026-02-01&to=2026-02-28'));
    expect(h.calls).toContain('or:end_date.gte.2026-02-01,and(end_date.is.null,date.gte.2026-02-01)');
    expect(h.calls).toContain('lte:date|2026-02-28');
    expect(h.calls.some((c) => c.startsWith('gte:date'))).toBe(false);
  });

  it('refuses a from that is not a plain date (it reaches a filter string)', async () => {
    const res = await GET(new Request('http://x/api/events?from=2026-01-01),id.not.is.null'));
    expect(res.status).toBe(400);
  });
});
