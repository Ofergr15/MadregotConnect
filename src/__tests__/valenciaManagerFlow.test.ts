import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Valencia, end to end through the real route handlers over an in-memory DB:
 * admin creates the event silently → edits it → opens its topic → posts a silent update →
 * members read updates by event. Every outbound channel is a spy that must stay at zero.
 * Plus the refusals: non-staff, non-admin, view-as, and an event with no topic. No real DB/Stream/send.
 */

type Row = Record<string, unknown>;
const h = vi.hoisted(() => ({
  user: null as null | Record<string, unknown>,
  tables: {} as Record<string, Row[]>,
  push: { resolveAudience: vi.fn(async () => []), sendPushLocalized: vi.fn(), notifyAthlete: vi.fn() },
  after: vi.fn(),
  seq: 0,
}));

// requireSession as the real one behaves for these cases: no user → 401; a view-as session is
// read-only (non-GET → 403 view_as_read_only, pinned for the real code in sessionViewAs.test.ts).
vi.mock('@/lib/auth-session', async (orig) => ({
  ...(await orig<typeof import('@/lib/auth-session')>()),
  requireSession: async (req: Request) => {
    if (!h.user) return { ok: false, status: 401, error: 'unauthorized' };
    if (h.user.viewingAsBy && req.method !== 'GET') return { ok: false, status: 403, error: 'view_as_read_only' };
    return { ok: true, user: h.user };
  },
}));
vi.mock('@/lib/maintenance', () => ({ readMaintenance: async () => ({ on: false }), maintenanceBlocks: () => false }));
vi.mock('@/lib/push', () => h.push);
vi.mock('@/lib/email', () => { throw new Error('email must not load'); });
vi.mock('web-push', () => { throw new Error('web-push must not load'); });
vi.mock('next/server', async (orig) => ({ ...(await orig<typeof import('next/server')>()), after: h.after }));
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({
    from: (t: string) => {
      const filters: Array<(r: Row) => boolean> = [];
      let lim = Infinity;
      let patch: Row | null = null;
      const rows = () => (h.tables[t] ||= []);
      const run = async () => {
        const hit = rows().filter((r) => filters.every((f) => f(r)));
        if (patch) hit.forEach((r) => Object.assign(r, patch));
        return { data: hit.slice(0, lim), error: null };
      };
      const b: any = {
        select: () => b, order: () => b,
        eq: (k: string, v: unknown) => { filters.push((r) => r[k] === v); return b; },
        is: (k: string, v: unknown) => { filters.push((r) => (r[k] ?? null) === v); return b; },
        in: (k: string, vs: unknown[]) => { filters.push((r) => vs.includes(r[k])); return b; },
        gte: (k: string, v: string) => { filters.push((r) => String(r[k]) >= v); return b; },
        limit: (n: number) => { lim = n; return b; },
        update: (p: Row) => { patch = p; return b; },
        delete: () => { throw new Error('no deletes in this flow'); },
        insert: (row: Row) => {
          const full = { id: `00000000-0000-4000-8000-${String(++h.seq).padStart(12, '0')}`, created_at: '2026-11-20T10:00:00Z',
            opens_at: '2026-11-20T10:00:00Z', closes_at: null, deleted_at: null, edited_at: null, notified_at: null, ...row };
          rows().push(full);
          return { select: () => ({ single: async () => ({ data: full, error: null }) }) };
        },
        single: async () => { const r = await run(); return { data: r.data[0] ?? null, error: r.data[0] ? null : { code: 'PGRST116' } }; },
        maybeSingle: async () => { const r = await run(); return { data: r.data[0] ?? null, error: null }; },
        then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => run().then(res, rej),
      };
      return b;
    },
    storage: { from: () => { throw new Error('no storage'); } },
  }),
}));

const events = await import('@/app/api/events/route');
const eventById = await import('@/app/api/events/[id]/route');
const topics = await import('@/app/api/club-updates/topics/route');
const updates = await import('@/app/api/club-updates/route');

const base = { name: 'X', isSuperUser: false, canApprove: false, isCoreRunner: false, groupId: null, athleteStatus: 'active', athleteEmail: null };
const ADMIN = { ...base, email: 'admin@example.test', athleteId: 'ad-1', role: 'admin', roles: ['admin'], isStaff: true };
const COACH = { ...base, email: 'coach@example.test', athleteId: 'co-1', role: 'coach', roles: ['coach'], isStaff: true };
const RUNNER = { ...base, email: 'runner@example.test', athleteId: 'ru-1', role: 'runner', roles: ['runner'], isStaff: false };

const json = (method: string, url: string, body?: unknown) =>
  new Request(`http://x${url}`, { method, ...(body ? { body: JSON.stringify(body) } : {}), headers: { authorization: 'Bearer t' } });
const call = async (p: Promise<Response>) => { const r = await p; return { status: r.status, body: await r.json() }; };
const outboundCalls = () =>
  h.push.resolveAudience.mock.calls.length + h.push.sendPushLocalized.mock.calls.length + h.push.notifyAthlete.mock.calls.length + h.after.mock.calls.length;

const VALENCIA = { kind: 'race', name: 'Valencia Marathon (synthetic)', date: '2026-12-06', location: 'Valencia', notify: false };

beforeEach(() => {
  h.user = null; h.seq = 0;
  h.tables = { app_settings: [{ key: 'club_updates', value: JSON.stringify({ enabled: true, writerIds: [] }) }], athletes: [], club_update_reactions: [] };
  for (const f of Object.values(h.push)) f.mockClear();
  h.after.mockClear();
});

describe('Valencia manager flow (synthetic, no outbound)', () => {
  it('create silently → edit → topic → silent update → members read it by event', async () => {
    h.user = ADMIN;
    const created = await call(events.POST(json('POST', '/api/events', VALENCIA)));
    expect(created.status).toBe(200);
    expect(created.body.notified).toBe(false);
    const eventId = created.body.event.id as string;

    const edited = await call(eventById.PATCH(json('PATCH', `/api/events/${eventId}`, { location: 'Valencia, Spain' }),
      { params: Promise.resolve({ id: eventId }) }));
    expect(edited.status).toBe(200);
    expect(h.tables.events[0]).toMatchObject({ location: 'Valencia, Spain' });

    const topic = await call(topics.POST(json('POST', '/api/club-updates/topics', { name: 'Valencia', eventId, pinnedText: 'Bib pickup Friday' })));
    expect(topic.status).toBe(200);
    const topicId = topic.body.topic.id as string;

    const posted = await call(updates.POST(json('POST', '/api/club-updates', { body: 'Bus leaves 05:30 from the hotel', topicId })));
    expect(posted.status).toBe(200);
    expect(posted.body.push).toBe(false);

    h.user = RUNNER;
    const read = await call(updates.GET(json('GET', `/api/club-updates?event=${eventId}`)));
    expect(read.status).toBe(200);
    expect(read.body.topic).toMatchObject({ id: topicId, eventId, name: 'Valencia', pinnedText: 'Bib pickup Friday' });
    expect(read.body.updates.map((u: { body: string }) => u.body)).toEqual(['Bus leaves 05:30 from the hotel']);

    expect(outboundCalls()).toBe(0);
  });

  it('an event with no topic reads as an empty, non-error answer', async () => {
    h.user = ADMIN;
    const { body } = await call(events.POST(json('POST', '/api/events', VALENCIA)));
    h.user = RUNNER;
    const read = await call(updates.GET(json('GET', `/api/club-updates?event=${body.event.id}`)));
    expect(read).toMatchObject({ status: 200, body: { topic: null, updates: [] } });
    const t = await call(topics.GET(json('GET', `/api/club-updates/topics?event=${body.event.id}`)));
    expect(t).toMatchObject({ status: 200, body: { topics: [] } });
  });

  it('refusals write nothing and send nothing', async () => {
    h.user = null;
    expect((await events.POST(json('POST', '/api/events', VALENCIA))).status).toBe(401);
    h.user = RUNNER;
    expect((await events.POST(json('POST', '/api/events', VALENCIA))).status).toBe(403);
    expect((await topics.POST(json('POST', '/api/club-updates/topics', { name: 'Valencia' }))).status).toBe(403);
    expect((await updates.POST(json('POST', '/api/club-updates', { body: 'hi' }))).status).toBe(403);
    h.user = COACH; // staff may create events, but topics are admin-only
    expect((await topics.POST(json('POST', '/api/club-updates/topics', { name: 'Valencia' }))).status).toBe(403);
    expect(h.tables.events ?? []).toHaveLength(0);
    expect(h.tables.club_update_topics ?? []).toHaveLength(0);
    expect(h.tables.club_updates ?? []).toHaveLength(0);
    expect(outboundCalls()).toBe(0);
  });

  it('view-as: an admin viewing as someone can read but every write is refused', async () => {
    h.user = { ...ADMIN, viewingAsBy: 'admin@example.test' };
    expect((await events.POST(json('POST', '/api/events', VALENCIA))).status).toBe(403);
    expect((await topics.POST(json('POST', '/api/club-updates/topics', { name: 'Valencia' }))).status).toBe(403);
    expect((await updates.POST(json('POST', '/api/club-updates', { body: 'hi' }))).status).toBe(403);
    expect((await updates.GET(json('GET', '/api/club-updates'))).status).toBe(200);
    expect(h.tables.events ?? []).toHaveLength(0);
    expect(outboundCalls()).toBe(0);
  });

  it('control: the same create WITHOUT notify:false does reach the push path (the spy works)', async () => {
    h.user = ADMIN;
    const { notify: _drop, ...loud } = VALENCIA;
    await call(events.POST(json('POST', '/api/events', loud)));
    expect(h.push.resolveAudience).toHaveBeenCalledWith('all', null);
  });
});
