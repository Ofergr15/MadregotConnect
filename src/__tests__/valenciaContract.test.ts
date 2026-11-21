import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * CONTRACT for the native Valencia tab: the exact response shapes of the content routes it reads.
 * The real route handlers (and, for club updates, the real listUpdates/project) run against a
 * fake Supabase client; only auth and the DB are faked. If one of these breaks, the native
 * decoder breaks with it — change the app's models in the same change.
 */

type Op = [string, ...unknown[]];
type Q = { table: string; ops: Op[]; kind: 'select' | 'insert' | 'delete' | 'update' };
const log: Q[] = [];
let answer: (q: Q) => { data: unknown; error: unknown } = () => ({ data: null, error: null });

function builder(table: string) {
  const q: Q = { table, ops: [], kind: 'select' };
  log.push(q);
  const b: any = {};
  for (const m of ['select', 'eq', 'in', 'is', 'or', 'gte', 'lte', 'gt', 'order', 'limit', 'insert', 'delete', 'update']) {
    b[m] = (...args: unknown[]) => {
      if (m === 'insert' || m === 'delete' || m === 'update') q.kind = m;
      q.ops.push([m, ...args]);
      return b;
    };
  }
  b.maybeSingle = async () => answer(q);
  b.single = async () => answer(q);
  b.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(answer(q)).then(res, rej);
  return b;
}
const db = { from: (t: string) => builder(t) };
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => db }));

let caller: { athleteId: string | null; isStaff: boolean; isSuperUser: boolean } | null = null;
vi.mock('@/lib/auth/self-or-staff', () => ({
  resolveVerifiedCaller: async () => (caller
    ? { denied: null, caller }
    : { denied: new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 }), caller: null }),
  mayActFor: (c: { athleteId: string; isStaff: boolean }, id: string) => c.isStaff || c.athleteId === id,
}));
vi.mock('@/lib/club-updates/access', () => ({
  clubUpdatesCaller: async () => ({ denied: null, db, athleteId: 'me', access: { admin: false, canWrite: false, canRead: true }, cfg: { enabled: true, writerIds: [] } }),
  forbidden: () => new Response('{}', { status: 403 }),
}));

const events = await import('@/app/api/events/route');
const eventOne = await import('@/app/api/events/[id]/route');
const updates = await import('@/app/api/club-updates/route');
const surveysOpen = await import('@/app/api/surveys/open/route');
const surveyOne = await import('@/app/api/surveys/[id]/route');
const respond = await import('@/app/api/surveys/[id]/respond/route');
const { NextRequest } = await import('next/server');

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const EVENT = {
  id: 'e1', kind: 'race', name: 'מרתון ולנסיה', date: '2026-12-06', end_date: null, start_time: '08:15', location: 'Valencia',
  description: null, lat: 39.46, lng: -0.37, waze_url: null, distances: ['42.2'], race_class: null, website: null,
  agenda: null, gear: null, faqs: null, capacity: null, registration_deadline: null, created_by: 'a1',
  created_at: '2026-11-01T00:00:00Z', updated_at: null,
};
const SURVEY = {
  id: 's1', question_he: 'מי טס?', options_he: ['כן', 'לא'], closes_at: null, audience_type: 'all', audience_id: null,
  created_by: 'a1', created_at: new Date().toISOString(), anonymous: false, multi_answer: false,
};

beforeEach(() => { log.length = 0; caller = null; answer = () => ({ data: null, error: null }); });

describe('GET /api/events', () => {
  it('→ { events: Event[] } — the raw events row, snake_case, no auth', async () => {
    answer = () => ({ data: [EVENT], error: null });
    const res = await events.GET(new Request('http://x/api/events?kind=race'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ events: [EVENT] });
  });
  it('empty → { events: [] }, never null', async () => {
    expect(await (await events.GET(new Request('http://x/api/events'))).json()).toEqual({ events: [] });
  });
  it('from/to must be plain dates → 400 { error }', async () => {
    const res = await events.GET(new Request('http://x/api/events?from=2026-1-1'));
    expect(res.status).toBe(400);
    expect(Object.keys(await res.json())).toEqual(['error']);
  });
  it('a DB error → 500 { error } (no details leak)', async () => {
    answer = () => ({ data: null, error: { message: 'boom' } });
    const res = await events.GET(new Request('http://x/api/events'));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Failed to fetch events' });
  });
});

describe('GET /api/events/[id]', () => {
  it('→ { event: Event }', async () => {
    answer = () => ({ data: EVENT, error: null });
    expect(await (await eventOne.GET(new Request('http://x'), ctx('e1'))).json()).toEqual({ event: EVENT });
  });
  it('missing → 404 { error: "Event not found" }', async () => {
    const res = await eventOne.GET(new Request('http://x'), ctx('nope'));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Event not found' });
  });
});

describe('GET /api/club-updates', () => {
  const ROW = { id: 'u1', author_athlete_id: 'a1', topic_id: 'topic-valencia', body: 'נחתנו', image_url: null, breaking: false, pinned: false, notify_at: null, notified_at: null, edited_at: null, deleted_at: null, created_at: '2026-12-05T10:00:00Z' };
  it('→ { enabled, canWrite, admin, me, missing, updates: ClubUpdate[] } — camelCase, topicId is the only link', async () => {
    answer = (q) => {
      if (q.table === 'club_updates') return { data: q.ops.some(([m, k]) => m === 'eq' && k === 'pinned') ? [] : [ROW], error: null };
      if (q.table === 'athletes') return { data: [{ id: 'a1', name: 'עופר', avatar_url: null, role: 'coach', extra_roles: null }], error: null };
      if (q.table === 'club_update_reactions') return { data: [{ update_id: 'u1', athlete_id: 'me', emoji: '❤️' }], error: null };
      return { data: null, error: null };
    };
    const body = await (await updates.GET(new Request('http://x/api/club-updates'))).json();
    expect(body).toEqual({
      enabled: true, canWrite: false, admin: false, me: 'me', missing: false,
      updates: [{
        id: 'u1', author: { id: 'a1', name: 'עופר', avatarUrl: null, role: 'מאמן' }, body: 'נחתנו', imageUrl: null,
        breaking: false, pinned: false, topicId: 'topic-valencia', createdAt: '2026-12-05T10:00:00Z', editedAt: null,
        reactions: expect.any(Array),
      }],
    });
    // Contract surprise, pinned: no event id on an update, and the route takes no event filter.
    expect(Object.keys(body.updates[0])).not.toContain('eventId');
  });
  it('migration 154 missing → 200 with missing:true and no updates (not an error)', async () => {
    answer = (q) => (q.table === 'club_updates' ? { data: null, error: { code: '42P01' } } : { data: [], error: null });
    const body = await (await updates.GET(new Request('http://x/api/club-updates'))).json();
    expect(body).toMatchObject({ missing: true, updates: [] });
  });
});

describe('GET /api/surveys/open', () => {
  it('no session → 401', async () => {
    expect((await surveysOpen.GET(new Request('http://x'))).status).toBe(401);
  });
  it('→ { polls: [{ id, question, closesAt }] } — at most 3, unanswered, in my audience, cron polls excluded', async () => {
    caller = { athleteId: 'me', isStaff: false, isSuperUser: false };
    answer = (q) => {
      if (q.table === 'athletes') return { data: { group_id: 'g1', is_academy: false }, error: null };
      if (q.table === 'surveys') return { data: [SURVEY, { ...SURVEY, id: 's2', created_by: 'cron' }, { ...SURVEY, id: 's3', audience_type: 'group', audience_id: 'g2' }], error: null };
      if (q.table === 'survey_responses') return { data: [], error: null };
      return { data: null, error: null };
    };
    const res = await surveysOpen.GET(new Request('http://x'));
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(await res.json()).toEqual({ polls: [{ id: 's1', question: 'מי טס?', closesAt: null }] });
  });
  it('a failure is { polls: [] } with 200, not an error', async () => {
    caller = { athleteId: 'me', isStaff: false, isSuperUser: false };
    answer = () => { throw new Error('down'); };
    const res = await surveysOpen.GET(new Request('http://x'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ polls: [] });
  });
});

describe('GET /api/surveys/[id]', () => {
  const get = (q = '') => surveyOne.GET(new NextRequest(`http://x/api/surveys/s1${q}`), ctx('s1'));
  it('without athleteId → { survey (raw row), myResponse:null, myResponses:[], results:null }', async () => {
    answer = () => ({ data: SURVEY, error: null });
    expect(await (await get()).json()).toEqual({ survey: SURVEY, myResponse: null, myResponses: [], results: null });
  });
  it('athleteId but no session → only { survey, myResponse:null } (myResponses/results ABSENT)', async () => {
    answer = () => ({ data: SURVEY, error: null });
    expect(await (await get('?athleteId=me')).json()).toEqual({ survey: SURVEY, myResponse: null });
  });
  it('signed in as self → my answers plus who picked what, one entry per option', async () => {
    caller = { athleteId: 'me', isStaff: false, isSuperUser: false };
    answer = (q) => {
      if (q.table === 'surveys') return { data: SURVEY, error: null };
      if (q.ops.some(([m, k]) => m === 'eq' && k === 'athletes.status'))
        return { data: [{ option_index: 0, created_at: 't', athletes: { id: 'me', name: 'אני', status: 'active' } }], error: null };
      return { data: [{ option_index: 0 }], error: null };
    };
    expect(await (await get('?athleteId=me')).json()).toEqual({
      survey: SURVEY, myResponse: 0, myResponses: [0],
      results: [{ optionIndex: 0, people: [{ id: 'me', name: 'אני' }] }, { optionIndex: 1, people: [] }],
    });
  });
  it('signed in as someone else → 403', async () => {
    caller = { athleteId: 'other', isStaff: false, isSuperUser: false };
    answer = () => ({ data: SURVEY, error: null });
    expect((await get('?athleteId=me')).status).toBe(403);
  });
  it('anonymous poll: a member sees anon-N ids and empty names, except their own id', async () => {
    caller = { athleteId: 'me', isStaff: false, isSuperUser: false };
    answer = (q) => {
      if (q.table === 'surveys') return { data: { ...SURVEY, anonymous: true }, error: null };
      if (q.ops.some(([m, k]) => m === 'eq' && k === 'athletes.status'))
        return { data: [
          { option_index: 0, created_at: 't', athletes: { id: 'x', name: 'X', status: 'active' } },
          { option_index: 0, created_at: 't', athletes: { id: 'me', name: 'אני', status: 'active' } },
        ], error: null };
      return { data: [], error: null };
    };
    const { results } = await (await get('?athleteId=me')).json();
    expect(results[0].people).toEqual([{ id: 'anon-0', name: '' }, { id: 'me', name: '' }]);
  });
  it('missing → 404 { error: "Survey not found" }', async () => {
    const res = await get();
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Survey not found' });
  });
});

describe('POST /api/surveys/[id]/respond', () => {
  const post = (b: unknown) => respond.POST(new Request('http://x', { method: 'POST', body: JSON.stringify(b) }), ctx('s1'));
  const withSurvey = (s: object, mine: number[] = []) => {
    answer = (q) => {
      if (q.table === 'surveys') return { data: s, error: null };
      if (q.kind === 'select') return { data: mine.map((option_index) => ({ option_index })), error: null };
      return { data: null, error: null };
    };
  };
  it('→ { success: true, answers: number[] } (single answer replaces)', async () => {
    caller = { athleteId: 'me', isStaff: false, isSuperUser: false };
    withSurvey(SURVEY, [0]);
    expect(await (await post({ athleteId: 'me', optionIndex: 1 })).json()).toEqual({ success: true, answers: [1] });
  });
  it('validation errors are 400 { error } — athleteId, optionIndex, out of range, closed', async () => {
    caller = { athleteId: 'me', isStaff: false, isSuperUser: false };
    withSurvey(SURVEY);
    expect((await post({ optionIndex: 0 })).status).toBe(400);
    expect((await post({ athleteId: 'me' })).status).toBe(400);
    expect(await (await post({ athleteId: 'me', optionIndex: 5 })).json()).toEqual({ error: 'Invalid option' });
    withSurvey({ ...SURVEY, closes_at: '2020-01-01T00:00:00Z' });
    expect(await (await post({ athleteId: 'me', optionIndex: 0 })).json()).toEqual({ error: 'This survey is closed' });
  });
  it('no session → 401; voting as someone else → 403', async () => {
    withSurvey(SURVEY);
    expect((await post({ athleteId: 'me', optionIndex: 0 })).status).toBe(401);
    caller = { athleteId: 'other', isStaff: false, isSuperUser: false };
    expect((await post({ athleteId: 'me', optionIndex: 0 })).status).toBe(403);
  });
});
