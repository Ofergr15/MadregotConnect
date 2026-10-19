import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * One approval, whichever door (lib/onboarding/approval-sync, 2026-10-19). The case
 * that started it: Yoav Shachaf filled in the form, then a coach "invited" him —
 * approved on his row, request still pending, no link ever sent.
 */
type Row = Record<string, unknown>;
let tables: Record<string, Row[]>;
const mails: Array<Record<string, unknown>> = [];

function query(table: string) {
  const filters: Array<(r: Row) => boolean> = [];
  let head = false;
  const api: Record<string, unknown> = {};
  const rows = () => (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
  Object.assign(api, {
    select: (_c?: string, opts?: { head?: boolean }) => { head = !!opts?.head; return api; },
    eq: (c: string, v: unknown) => { filters.push((r) => r[c] === v); return api; },
    is: (c: string, v: unknown) => { filters.push((r) => (r[c] ?? null) === v); return api; },
    ilike: (c: string, v: string) => { filters.push((r) => String(r[c] ?? '').toLowerCase() === v.toLowerCase()); return api; },
    in: (c: string, vs: unknown[]) => { filters.push((r) => vs.includes(r[c])); return api; },
    maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
    update: (values: Row) => {
      const upd: Record<string, unknown> = {};
      const run = async () => { for (const r of rows()) Object.assign(r, values); return { error: null }; };
      Object.assign(upd, {
        eq: (c: string, v: unknown) => { filters.push((r) => r[c] === v); return run(); },
        in: (c: string, vs: unknown[]) => { filters.push((r) => vs.includes(r[c])); return run(); },
      });
      return upd;
    },
    then: (resolve: (v: unknown) => void) => resolve(head ? { count: rows().length, error: null } : { data: rows(), error: null }),
  });
  return api;
}

vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => ({ from: (t: string) => query(t) }) }));
vi.mock('@/lib/onboarding/events', () => ({ recordOnbEvent: vi.fn(async () => undefined) }));
vi.mock('@/lib/email', () => ({ notifyRegistrationApproved: vi.fn(async (m: Record<string, unknown>) => { mails.push(m); return { ok: true }; }) }));

const { syncApprovedJoiner } = await import('@/lib/onboarding/approval-sync');

beforeEach(() => {
  mails.length = 0;
  tables = {
    athletes: [{ id: 'y1', email: 'yoav01233@gmail.com', name: 'Yoav Shachaf', status: 'invited', approved: true, approved_at: null, approved_by: null, invite_token: 'tok-yoav', group_id: 'g2', first_seen_at: null, strava_auth: null }],
    signup_requests: [{ id: 'r1', email: 'Yoav01233@gmail.com', status: 'pending', athlete_id: null }],
    groups: [{ id: 'g2', name: 'Group 2' }],
    email_log: [],
  };
});

describe('an approval another door left half done', () => {
  it('closes the form request by address, links it, and mails the personal link', async () => {
    const r = await syncApprovedJoiner({ athleteId: 'y1', approverEmail: 'coach@x.com', approverIsSuperUser: false });
    expect(r).toMatchObject({ closedRequests: 1, emailed: true });
    expect(tables.signup_requests[0]).toMatchObject({ status: 'approved', athlete_id: 'y1', invite_token: 'tok-yoav', approved_by: 'coach@x.com' });
    expect(tables.athletes[0].approved_at).toBeTruthy();
    expect(mails[0]).toMatchObject({ email: 'yoav01233@gmail.com', token: 'tok-yoav', athleteId: 'y1', signupRequestId: 'r1' });
  });

  it('does not mail somebody who has already signed in', async () => {
    tables.athletes[0].first_seen_at = '2026-10-14T10:00:00Z';
    const r = await syncApprovedJoiner({ athleteId: 'y1', approverEmail: null, approverIsSuperUser: false });
    expect(r.closedRequests).toBe(1);
    expect(r.emailReason).toBe('signed-in');
    expect(mails).toHaveLength(0);
  });

  it('does not mail the link twice when nothing new was closed', async () => {
    tables.signup_requests = [];
    tables.email_log = [{ template: 'registration_approved', athlete_id: 'y1' }];
    const r = await syncApprovedJoiner({ athleteId: 'y1', approverEmail: null, approverIsSuperUser: false });
    expect(r).toMatchObject({ closedRequests: 0, emailed: false });
    expect(mails).toHaveLength(0);
  });

  it('leaves somebody not approved alone', async () => {
    tables.athletes[0].approved = false;
    const r = await syncApprovedJoiner({ athleteId: 'y1', approverEmail: null, approverIsSuperUser: false });
    expect(r.closedRequests).toBe(0);
    expect(tables.signup_requests[0].status).toBe('pending');
  });
});
