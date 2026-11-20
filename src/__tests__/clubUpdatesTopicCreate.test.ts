import { beforeEach, describe, expect, it, vi } from 'vitest';

/** POST /api/club-updates/topics — admin only, validated, sends nothing. Synthetic fixtures only. */

const h = vi.hoisted(() => ({
  caller: vi.fn(),
  inserted: [] as Record<string, unknown>[],
  events: new Set<string>(),
  missingTopics: false,
  outbound: vi.fn(),
}));
vi.mock('@/lib/club-updates/access', () => ({
  clubUpdatesCaller: () => h.caller(),
  forbidden: () => new Response(JSON.stringify({ error: 'Not allowed' }), { status: 403 }),
}));
vi.mock('@/lib/push', () => ({ notifyAthlete: h.outbound, sendPushLocalized: h.outbound, resolveAudience: h.outbound }));

const EV = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const db = {
  from: (t: string) => {
    let id = '';
    const c: any = {};
    c.select = () => c;
    c.eq = (_: string, v: string) => { id = v; return c; };
    c.maybeSingle = async () => ({ data: h.events.has(id) ? { id } : null, error: null });
    c.insert = (row: Record<string, unknown>) => ({
      select: () => ({
        single: async () => {
          if (t === 'club_update_topics' && h.missingTopics) return { data: null, error: { code: '42P01', message: 'missing' } };
          h.inserted.push(row);
          return { data: { id: 'topic-1', opens_at: '2026-11-20T00:00:00Z', closes_at: null, ...row }, error: null };
        },
      }),
    });
    return c;
  },
};
const { POST } = await import('@/app/api/club-updates/topics/route');
const post = (b: unknown) => POST(new Request('http://x/api/club-updates/topics', { method: 'POST', body: JSON.stringify(b) }));
const as = (admin: boolean, canWrite = admin) =>
  h.caller.mockResolvedValue({ denied: null, db, athleteId: 'me', access: { admin, canRead: true, canWrite }, cfg: { enabled: true, writerIds: [] } });

beforeEach(() => {
  h.caller.mockReset(); h.inserted = []; h.events = new Set([EV]); h.missingTopics = false; h.outbound.mockClear();
});

describe('POST /api/club-updates/topics', () => {
  it('unauthenticated → the gate\'s 401, nothing written', async () => {
    h.caller.mockResolvedValue({ denied: new Response('{}', { status: 401 }) });
    expect((await post({ name: 'Test race' })).status).toBe(401);
    expect(h.inserted).toHaveLength(0);
  });
  it('a writer who is not admin → 403, nothing written', async () => {
    as(false, true);
    expect((await post({ name: 'Test race', eventId: EV })).status).toBe(403);
    expect(h.inserted).toHaveLength(0);
  });
  it('admin creates a topic for an existing event; nothing is sent', async () => {
    as(true);
    const res = await post({ name: '  Test race  ', eventId: EV, pinnedText: 'Meet at the lobby' });
    expect(res.status).toBe(200);
    expect((await res.json()).topic).toEqual({
      id: 'topic-1', eventId: EV, name: 'Test race', pinnedText: 'Meet at the lobby', opensAt: '2026-11-20T00:00:00Z', closesAt: null,
    });
    expect(h.inserted[0]).toEqual({ name: 'Test race', event_id: EV, pinned_text: 'Meet at the lobby', created_by: 'me' });
    expect(h.outbound).not.toHaveBeenCalled();
  });
  it('a topic without an event is allowed', async () => {
    as(true);
    expect((await post({ name: 'General' })).status).toBe(200);
    expect(h.inserted[0]).toMatchObject({ event_id: null, pinned_text: null });
  });
  it('validation: name, eventId, unknown event, pinnedText type → 400, nothing written', async () => {
    as(true);
    for (const b of [{}, { name: '' }, { name: 'x'.repeat(81) }, { name: 'A', eventId: 'nope' },
      { name: 'A', eventId: 'ffffffff-ffff-4fff-8fff-ffffffffffff' }, { name: 'A', pinnedText: 5 }]) {
      expect((await post(b)).status).toBe(400);
    }
    expect(h.inserted).toHaveLength(0);
  });
  it('before migration 154 → 503 naming it', async () => {
    as(true); h.missingTopics = true;
    const res = await post({ name: 'A' });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'migration 154 not applied' });
  });
});
