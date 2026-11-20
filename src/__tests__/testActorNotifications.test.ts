import { beforeEach, describe, expect, it, vi } from 'vitest';

// Item 8: an action BY a QA test account (migration 182) must notify nobody else.
// Pinned at the two central senders (notifyAthlete, notifyStaff) and at the email
// call site that has no central sender (signup-queue → notifyAdminNewSignupRequest).
// No real sends: the database is a fake, push/email/routing are mocked.

const TEST = 'test-athlete';
const REAL = 'real-athlete';
const COACH = 'coach-1';

const h = vi.hoisted(() => ({
  inbox: [] as Array<{ audience_id: string; kind: string }>,
  emails: [] as string[],
  testColumn: true,
}));

function fakeDb(): unknown {
  let table = '';
  let filterTest = false;
  const result = () => {
    if (table === 'athletes' && filterTest) {
      return h.testColumn
        ? { data: [{ id: TEST, is_test_account: true }], error: null }
        : { data: null, error: { code: '42703', message: 'column athletes.is_test_account does not exist' } };
    }
    if (table === 'athletes') return { data: { name: 'Someone', email: 'x@y.z' }, error: null, count: 1 };
    return { data: [], error: null, count: 1 };
  };
  const q: Record<string, unknown> = {};
  const chain = new Proxy(q, {
    get(_t, prop: string) {
      if (prop === 'then') return (res: (v: unknown) => unknown) => Promise.resolve(result()).then(res);
      if (prop === 'from') return (t: string) => { table = t; filterTest = false; return chain; };
      if (prop === 'eq') return (col: string) => { if (col === 'is_test_account') filterTest = true; return chain; };
      if (prop === 'maybeSingle' || prop === 'single') return () => Promise.resolve(result());
      if (prop === 'insert') return (rows: unknown) => {
        if (table === 'scheduled_notifications') {
          for (const r of (Array.isArray(rows) ? rows : [rows]) as Array<{ audience_id: string; kind: string }>) h.inbox.push(r);
        }
        return chain;
      };
      return () => chain;
    },
  });
  return chain;
}

vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => fakeDb() }));
vi.mock('@/lib/notifications/routing', () => ({ recipientsForKind: async () => [COACH, TEST] }));
vi.mock('@/lib/email', () => ({
  notifyAdminNewSignupRequest: async (o: { email: string }) => { h.emails.push(o.email); },
}));

import { notifyAthlete } from '@/lib/push';
import { notifyStaff } from '@/lib/notifications/staff';
import { announceSignupRequest } from '@/lib/signup-queue';

const recipients = () => h.inbox.map((r) => r.audience_id);

beforeEach(() => {
  h.inbox = [];
  h.emails = [];
  h.testColumn = true;
});

describe('notifyAthlete — mentions, follows, replies, meetups, academy, feedback alerts …', () => {
  const send = (athleteId: string, actorAthleteId: string | null) =>
    notifyAthlete({ athleteId, actorAthleteId, kind: 'mention', url: '/feed', title: 't', body: 'b' });

  it('a test actor notifies nobody else', async () => {
    await send(REAL, TEST);
    expect(recipients()).toEqual([]);
  });

  it('a real actor is unchanged', async () => {
    await send(TEST, REAL);
    await send(COACH, REAL);
    expect(recipients()).toEqual([TEST, COACH]);
  });

  it('a test account still hears about its own action', async () => {
    await send(TEST, TEST);
    expect(recipients()).toEqual([TEST]);
  });

  it('no actor (cron/system) is never suppressed', async () => {
    await send(REAL, null);
    expect(recipients()).toEqual([REAL]);
  });

  it('fails open when the column is missing', async () => {
    h.testColumn = false;
    await send(REAL, TEST);
    expect(recipients()).toEqual([REAL]);
  });
});

describe('notifyStaff — problem_report, feedback_alert (pain), store_order, academy_applicant, signup_request', () => {
  const send = (actorAthleteId: string | null) =>
    notifyStaff({ kind: 'problem_report', url: '/x', tag: 't', category: 'management', actorAthleteId, copy: () => ({ title: 't', body: 'b' }) });

  it('a test actor reaches no other staff member', async () => {
    const r = await send(TEST);
    // TEST is itself routed here, so it alone keeps its own row.
    expect(recipients()).toEqual([TEST]);
    expect(r.recipients).toBe(1);
  });

  it('a real actor reaches every routed recipient', async () => {
    await send(REAL);
    expect(recipients().sort()).toEqual([COACH, TEST].sort());
  });

  it('a system alert (no actor) is untouched', async () => {
    await send(null);
    expect(recipients().sort()).toEqual([COACH, TEST].sort());
  });
});

describe('signup-queue — approver email + push for a pending sign-up', () => {
  it('a test account emails and pushes nobody else', async () => {
    await announceSignupRequest({ athleteId: TEST, email: 'qa@test' });
    expect(h.emails).toEqual([]);
    expect(recipients()).toEqual([TEST]);
  });

  it('a real sign-up is unchanged', async () => {
    await announceSignupRequest({ athleteId: REAL, email: 'real@x' });
    expect(h.emails).toEqual(['real@x']);
    expect(recipients().sort()).toEqual([COACH, TEST].sort());
  });
});
