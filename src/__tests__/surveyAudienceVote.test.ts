import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryDb } from './helpers/memory-db';
import { surveyAudienceAllows } from '@/lib/survey-audience';

/**
 * Round 6 bug hunt: a member outside a poll's audience could answer it by opening its URL,
 * and the vote landed in that group's count and name list. Also: a fractional optionIndex
 * reached the INT column (500), and a malformed body was a 500.
 */
let caller = { athleteId: 'a1', isStaff: false, isSuperUser: false, email: 'a1@x.test' };
vi.mock('@/lib/auth/self-or-staff', async (orig) => ({
  ...(await orig() as object),
  resolveVerifiedCaller: async () => ({ denied: null, caller }),
}));
let db: ReturnType<typeof createMemoryDb>;
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => db.client }));
const respond = await import('@/app/api/surveys/[id]/respond/route');
const read = await import('@/app/api/surveys/[id]/route');

beforeEach(() => {
  caller = { athleteId: 'a1', isStaff: false, isSuperUser: false, email: 'a1@x.test' };
  db = createMemoryDb({
    schema: {
      surveys: ['id', 'options_he', 'closes_at', 'multi_answer', 'audience_type', 'audience_id'],
      survey_responses: ['survey_id', 'athlete_id', 'option_index'],
      athletes: ['id', 'group_id', 'is_academy', 'name', 'status', 'is_test_account'],
    },
  });
  db.tables.athletes.push({ id: 'a1', group_id: 'g1', is_academy: false, name: 'One', status: 'active', is_test_account: false }, { id: 'a2', group_id: 'g2', is_academy: true, name: 'Two', status: 'active', is_test_account: false });
  db.tables.surveys.push(
    { id: 'all', options_he: ['כן', 'לא'], closes_at: null, multi_answer: false, audience_type: 'all', audience_id: null },
    { id: 'g2poll', options_he: ['כן', 'לא'], closes_at: null, multi_answer: false, audience_type: 'group', audience_id: 'g2' },
  );
});

const post = (id: string, body: unknown) => respond.POST(
  new Request(`http://x/api/surveys/${id}/respond`, { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) }),
  { params: Promise.resolve({ id }) },
);

describe('POST /api/surveys/[id]/respond', () => {
  it('a club-wide poll takes the vote', async () => {
    const res = await post('all', { athleteId: 'a1', optionIndex: 0 });
    expect(res.status).toBe(200);
    expect(db.tables.survey_responses).toHaveLength(1);
  });

  it("refuses a vote on another group's poll", async () => {
    const res = await post('g2poll', { athleteId: 'a1', optionIndex: 0 });
    expect(res.status).toBe(403);
    expect(db.tables.survey_responses).toEqual([]);
  });

  it('the group itself votes; staff answering for a runner are held to that runner', async () => {
    caller = { athleteId: 'a2', isStaff: false, isSuperUser: false, email: 'a2@x.test' };
    expect((await post('g2poll', { athleteId: 'a2', optionIndex: 1 })).status).toBe(200);
    caller = { athleteId: 'staff', isStaff: true, isSuperUser: false, email: 's@x.test' };
    expect((await post('g2poll', { athleteId: 'a1', optionIndex: 1 })).status).toBe(403);
    expect((await post('g2poll', { athleteId: 'a2', optionIndex: 0 })).status).toBe(200);
  });

  it('a fractional or negative option and a malformed body are 400, not 500', async () => {
    expect((await post('all', { athleteId: 'a1', optionIndex: 0.5 })).status).toBe(400);
    expect((await post('all', { athleteId: 'a1', optionIndex: -1 })).status).toBe(400);
    expect((await post('all', '{not json')).status).toBe(400);
    expect((await post('all', { optionIndex: 0 })).status).toBe(400);
  });
});

describe('GET /api/surveys/[id] — who picked what', () => {
  const get = (id: string, athleteId: string) => read.GET(
    { nextUrl: new URL(`http://x/api/surveys/${id}?athleteId=${athleteId}`), headers: new Headers() } as never,
    { params: Promise.resolve({ id }) },
  ).then((r) => r.json());

  it("another group's member sees the question, not the names", async () => {
    db.tables.survey_responses.push({ survey_id: 'g2poll', athlete_id: 'a2', option_index: 0 });
    const body = await get('g2poll', 'a1');
    expect(body.survey.id).toBe('g2poll');
    expect(body.results).toBeNull();
  });

  it('the group itself gets the results', async () => {
    caller = { athleteId: 'a2', isStaff: false, isSuperUser: false, email: 'a2@x.test' };
    db.tables.survey_responses.push({ survey_id: 'g2poll', athlete_id: 'a2', option_index: 0 });
    const body = await get('g2poll', 'a2');
    // The result list is built (one entry per option); who is in it is surveyWhoPicked.test.ts's job.
    expect(body.results).toHaveLength(2);
  });
});

describe('surveyAudienceAllows', () => {
  const a = { id: 'a1', group_id: 'g1', is_academy: true };
  it.each([
    [{ audience_type: 'all', audience_id: null }, true],
    [{ audience_type: null, audience_id: null }, true],
    [{ audience_type: 'group', audience_id: 'g1' }, true],
    [{ audience_type: 'group', audience_id: 'g2' }, false],
    [{ audience_type: 'group', audience_id: null }, false],
    [{ audience_type: 'academy', audience_id: null }, true],
    [{ audience_type: 'athlete', audience_id: 'a1' }, true],
    [{ audience_type: 'athlete', audience_id: 'a9' }, false],
    [{ audience_type: 'pack', audience_id: 'x' }, false],
  ])('%j → %s', (s, ok) => expect(surveyAudienceAllows(s, a)).toBe(ok));
  it('a runner with no group is never in a group poll', () => {
    expect(surveyAudienceAllows({ audience_type: 'group', audience_id: 'g1' }, { id: 'a', group_id: null, is_academy: false })).toBe(false);
  });
});
