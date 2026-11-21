import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';

/**
 * Events v2 gates: drafts never reach a member or an anonymous caller (list and
 * single read), blocks only reach a verified member, and the pace-group roster
 * (named goals + race times) is staff-only.
 */

let caller: any = null; // null = denied
vi.mock('@/lib/auth/self-or-staff', () => ({
  resolveVerifiedCaller: async () =>
    caller ? { denied: null, caller } : { denied: NextResponse.json({ error: 'no' }, { status: 401 }), caller: {} },
  requireStaff: async () =>
    !caller ? NextResponse.json({}, { status: 401 }) : caller.isStaff ? null : NextResponse.json({}, { status: 403 }),
  mayActFor: (c: any, id: string) => c.isStaff || c.athleteId === id,
}));
vi.mock('@/lib/push', () => ({ resolveAudience: async () => [], sendPushLocalized: async () => ({ sent: 0 }) }));

let tables: Record<string, unknown[]> = {};
function chain(table: string): any {
  const p: any = new Proxy({}, {
    get(_t, prop) {
      if (prop === 'then') return (res: any, rej: any) => Promise.resolve({ data: tables[table] ?? [], error: null }).then(res, rej);
      if (prop === 'maybeSingle' || prop === 'single') return async () => ({ data: (tables[table] ?? [])[0] ?? null, error: null });
      return () => p;
    },
  });
  return p;
}
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => ({ from: (t: string) => chain(t) }) }));

const list = await import('@/app/api/events/route');
const one = await import('@/app/api/events/[id]/route');
const groups = await import('@/app/api/events/[id]/pace-groups/route');

const authed = (url: string) => new Request(url, { headers: { authorization: 'Bearer x' } });
const member = { athleteId: 'a1', isStaff: false, isSuperUser: false };
const staff = { athleteId: 's1', isStaff: true, isSuperUser: false };
const params = { params: Promise.resolve({ id: 'e1' }) };

beforeEach(() => {
  caller = null;
  tables = {
    events: [
      { id: 'e1', name: 'draft', status: 'draft', pending: null },
      { id: 'e2', name: 'live', status: 'published', pending: { fields: { name: 'secret' } } },
    ],
    event_blocks: [{ id: 'b1', kind: 'free_text', position: 0, enabled: true, config: {} }],
  };
});

describe('GET /api/events', () => {
  it('anonymous: published only, no pending', async () => {
    const r = await (await list.GET(new Request('http://x/api/events'))).json();
    expect(r.events.map((e: any) => e.id)).toEqual(['e2']);
    expect(r.events[0].pending).toBeUndefined();
  });
  it('member: same as anonymous', async () => {
    caller = member;
    const r = await (await list.GET(authed('http://x/api/events'))).json();
    expect(r.events.map((e: any) => e.id)).toEqual(['e2']);
  });
  it('staff: drafts and pending', async () => {
    caller = staff;
    const r = await (await list.GET(authed('http://x/api/events'))).json();
    expect(r.events).toHaveLength(2);
    expect(r.events[1].has_pending).toBe(true);
  });
});

describe('GET /api/events/[id]', () => {
  it('a draft is 404 for a member', async () => {
    caller = member;
    expect((await one.GET(authed('http://x/api/events/e1'), params)).status).toBe(404);
  });
  it('staff read a draft with blocks', async () => {
    caller = staff;
    const r = await (await one.GET(authed('http://x/api/events/e1'), params)).json();
    expect(r.event.id).toBe('e1');
    expect(r.blocks).toHaveLength(1);
  });
  it('anonymous gets a published event without blocks', async () => {
    tables.events = [tables.events[1]];
    const r = await (await one.GET(new Request('http://x/api/events/e2'), params)).json();
    expect(r.blocks).toBeNull();
  });
});

describe('pace-groups roster', () => {
  it('is 403 for a member', async () => {
    caller = member;
    expect((await groups.GET(authed('http://x'), params)).status).toBe(403);
  });
});
