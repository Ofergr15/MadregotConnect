import { describe, it, expect, vi, beforeEach } from 'vitest';

// Task 107: the hot POST/PATCH routes run their JSON body through a zod schema
// (src/lib/api/parse-body.ts) after the auth gate and before any DB work. Auth
// is stubbed to "signed in as a1 (staff)", and the DB client is a spy that
// throws: an invalid body must 400 without ever reaching it, a valid body must
// get past validation (i.e. reach the DB, which here surfaces as a 500).

const db = vi.hoisted(() => ({
  createServerClient: vi.fn(() => {
    throw new Error('db reached');
  }),
}));
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: db.createServerClient,
  createServerClientWithAuth: db.createServerClient,
}));
vi.mock('@/lib/feed/notify', () => ({
  loadFeedItemMeta: () => db.createServerClient(),
  notifyFeedInteraction: vi.fn(),
  notifyMentions: vi.fn(),
}));

const user = { athleteId: 'a1', name: 'A', email: 'a@x.io', isStaff: true, isSuperUser: true };
vi.mock('@/lib/auth-session', async (orig) => ({
  ...(await orig<object>()),
  requireSession: async () => ({ ok: true, user }),
  requireAthlete: async () => ({ ok: true, user }),
}));
vi.mock('@/lib/auth/self-or-staff', async (orig) => ({
  ...(await orig<object>()),
  resolveVerifiedCaller: async () => ({ denied: null, caller: user }),
  requireCallerForAthlete: async () => ({ denied: null, caller: user }),
  mayActFor: () => true,
}));

import { parseJsonBody } from '@/lib/api/parse-body';
import { z } from 'zod';

type Handler = (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;
interface Case {
  route: string;
  load: () => Promise<Record<string, unknown>>;
  method: 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  bad: unknown;
  good: unknown;
}

const CASES: Case[] = [
  { route: 'feed/like', load: () => import('@/app/api/feed/like/route'), method: 'POST', bad: { itemId: 5 }, good: { itemId: 'i1' } },
  { route: 'feed/comments', load: () => import('@/app/api/feed/comments/route'), method: 'POST', bad: { itemId: 'i1', body: ['x'] }, good: { itemId: 'i1', body: 'hi' } },
  { route: 'feed/posts', load: () => import('@/app/api/feed/posts/route'), method: 'POST', bad: { body: 'x', media: 'img' }, good: { body: 'hello' } },
  { route: 'feed/items/[id]', load: () => import('@/app/api/feed/items/[id]/route'), method: 'PATCH', bad: { body: 7 }, good: { body: 'caption' } },
  { route: 'attendance', load: () => import('@/app/api/attendance/route'), method: 'POST', bad: { athleteId: 'a1', weekStart: '2026-11-22', day: 1, attending: 'yes' }, good: { athleteId: 'a1', weekStart: '2026-11-22', day: 1, attending: true, groupLabel: null } },
  { route: 'shoes POST', load: () => import('@/app/api/shoes/route'), method: 'POST', bad: { athleteId: 'a1', name: { n: 1 } }, good: { athleteId: 'a1', name: 'Pegasus', distanceLimitKm: null, alertBeforeKm: 50 } },
  { route: 'shoes PATCH', load: () => import('@/app/api/shoes/route'), method: 'PATCH', bad: { id: 's1', athleteId: 'a1', retired: 'true' }, good: { id: 's1', athleteId: 'a1', setActive: true } },
  { route: 'notification-prefs PUT', load: () => import('@/app/api/athletes/notification-prefs/route'), method: 'PUT', bad: { athleteId: 'a1', language: 1 }, good: { athleteId: 'a1', language: 'he' } },
  { route: 'notification-prefs PATCH', load: () => import('@/app/api/athletes/notification-prefs/route'), method: 'PATCH', bad: { athleteId: 42 }, good: { athleteId: 'a1', morningReminder: { enabled: true, time: '07:00' } } },
  { route: 'records/privacy', load: () => import('@/app/api/records/privacy/route'), method: 'PATCH', bad: { squadCompare: 'no' }, good: { squadCompare: false } },
  { route: 'workout-feedback', load: () => import('@/app/api/workout-feedback/route'), method: 'POST', bad: { athleteId: 'a1', activityId: { id: 1 } }, good: { athleteId: 'a1', activityId: null } },
  { route: 'workout-feedback/[id]/messages', load: () => import('@/app/api/workout-feedback/[id]/messages/route'), method: 'POST', bad: { body: 3 }, good: { body: 'thanks' } },
  { route: 'workout-feedback/reply POST', load: () => import('@/app/api/workout-feedback/reply/route'), method: 'POST', bad: { feedbackId: 'f1', reply: true }, good: { feedbackId: 'f1', reply: 'nice' } },
  { route: 'workout-feedback/reply PATCH', load: () => import('@/app/api/workout-feedback/reply/route'), method: 'PATCH', bad: { feedbackId: ['f1'], athleteId: 'a1' }, good: { feedbackId: 'f1', athleteId: 'a1' } },
  { route: 'group-chat/messages POST', load: () => import('@/app/api/group-chat/messages/route'), method: 'POST', bad: { groupId: 'g1', text: 9 }, good: { groupId: 'g1', text: 'hi', id: null } },
  { route: 'group-chat/messages PATCH', load: () => import('@/app/api/group-chat/messages/route'), method: 'PATCH', bad: { groupId: 'g1', messageId: 1, text: 'x' }, good: { groupId: 'g1', messageId: 'm1', text: 'x' } },
  { route: 'athletes/follow POST', load: () => import('@/app/api/athletes/follow/route'), method: 'POST', bad: { followerId: 'a1', followeeId: 7 }, good: { followerId: 'a1', followeeId: 'a2' } },
  { route: 'athletes/follow DELETE', load: () => import('@/app/api/athletes/follow/route'), method: 'DELETE', bad: { followerId: ['a1'], followeeId: 'a2' }, good: { followerId: 'a1', followeeId: 'a2' } },
  { route: 'feedback POST', load: () => import('@/app/api/feedback/route'), method: 'POST', bad: { message: { text: 'x' } }, good: { message: 'broken button', category: 'bug', context: { page: '/home' } } },
  { route: 'run-chat', load: () => import('@/app/api/run-chat/route'), method: 'POST', bad: { activityId: 12 }, good: { activityId: 'act1' } },
];

function call(c: Case, body: string) {
  const req = new Request('http://localhost/api/x', {
    method: c.method,
    headers: { 'content-type': 'application/json' },
    body,
  });
  return c.load().then((m) => (m[c.method] as Handler)(req, { params: Promise.resolve({ id: 'x1' }) }));
}

beforeEach(() => {
  db.createServerClient.mockClear();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

describe.each(CASES)('$route body validation', { timeout: 30_000 }, (c) => {
  it('wrong type → 400 Invalid body, no DB', async () => {
    const res = await call(c, JSON.stringify(c.bad));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('Invalid body');
    expect(Array.isArray(json.details)).toBe(true);
    expect(db.createServerClient).not.toHaveBeenCalled();
  });

  it('non-JSON → 400, no DB', async () => {
    const res = await call(c, 'not json{');
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Invalid body');
    expect(db.createServerClient).not.toHaveBeenCalled();
  });

  it('valid body passes validation and reaches the DB', async () => {
    const res = await call(c, JSON.stringify(c.good));
    expect(db.createServerClient).toHaveBeenCalled();
    expect(res.status).not.toBe(400);
  });
});

describe('parseJsonBody', () => {
  const schema = z.looseObject({ n: z.number(), s: z.string().optional() });
  const req = (b: string) => new Request('http://l/', { method: 'POST', body: b });

  it('returns data and keeps unknown keys', async () => {
    const r = await parseJsonBody(req('{"n":1,"extra":true}'), schema);
    expect(r).toEqual({ ok: true, data: { n: 1, extra: true } });
  });

  it('lists field paths without echoing submitted values', async () => {
    const r = await parseJsonBody(req('{"n":"secret-value","s":5}'), schema);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    const text = JSON.stringify(await r.response.json());
    expect(text).not.toContain('secret-value');
    expect(text).toContain('n:');
    expect(text).toContain('s:');
  });

  it('rejects a non-object top level (null, array)', async () => {
    expect((await parseJsonBody(req('null'), schema)).ok).toBe(false);
    expect((await parseJsonBody(req('[1]'), schema)).ok).toBe(false);
  });
});
