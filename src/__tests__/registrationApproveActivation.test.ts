import { describe, expect, it, vi, beforeEach } from 'vitest';
import { COACH_ID } from '@/lib/constants';

/**
 * POST /api/admin/registrations/approve, for the applicant who is ALREADY signed in.
 *
 * A Strava sign-in creates its own athlete row and queues itself (see
 * src/lib/signup-queue.ts), so by the time the coach taps Approve the person has a
 * working login and a name — they are sitting on the waiting screen. The route used
 * to treat every approval identically: mint a token, mail /join/{token}, leave them
 * 'invited'. For this applicant all three are wrong. The address on the row is ours
 * (strava_1234@strava.madregot.local), so the mail bounces and the queue reports a
 * delivery problem; and /join would only ask them for a name they already gave and a
 * group this approval just set.
 *
 * These pin the two halves that must stay apart: connected → activated outright and
 * pushed, form applicant → 'invited' and mailed, exactly as before.
 */

type Update = { table: string; patch: Record<string, unknown> };
let updates: Update[];
let inserted: Array<{ table: string; row: Record<string, unknown> }>;
/** Rows the fake DB answers with, matched on the eq() filters. */
let rows: Record<string, Array<Record<string, unknown>>>;
let mailedTo: string[];
let pushes: Array<Record<string, unknown>>;

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({
    from(table: string) {
      const filters: Array<[string, unknown]> = [];
      const find = () => (rows[table] || []).find((r) => filters.every(([c, v]) => r[c] === v)) || null;
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: (col: string, val: unknown) => { filters.push([col, val]); return chain; },
        maybeSingle: () => Promise.resolve({ data: find(), error: null }),
        single: () => Promise.resolve({ data: find(), error: null }),
        insert: (row: Record<string, unknown>) => {
          inserted.push({ table, row });
          (rows[table] ||= []).push({ ...row, id: `new-${table}` });
          return chain;
        },
        update: (patch: Record<string, unknown>) => {
          updates.push({ table, patch });
          return chain;
        },
        then: (res: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(res),
      };
      return chain;
    },
  }),
}));

vi.mock('@/lib/auth-session', () => ({
  requireSession: async () => ({
    ok: true as const,
    user: { email: 'grosfeldofer@gmail.com', athleteId: 'admin-1', role: 'admin' },
  }),
  authError: (r: { status: number; error: string }) =>
    new Response(JSON.stringify({ error: r.error }), { status: r.status }),
}));

vi.mock('@/lib/email', () => ({
  notifyRegistrationApproved: vi.fn(async ({ email }: { email: string }) => {
    mailedTo.push(email);
    return { ok: true as const };
  }),
}));

vi.mock('@/lib/push', () => ({
  notifyAthlete: vi.fn(async (p: Record<string, unknown>) => { pushes.push(p); }),
}));

const { POST } = await import('@/app/api/admin/registrations/approve/route');

const GROUP = 'group-1';
const approve = () =>
  POST(new Request('https://example.test/api/admin/registrations/approve', {
    method: 'POST',
    body: JSON.stringify({ id: 'req-1', action: 'approve', groupId: GROUP }),
  }));

const athleteUpdate = () => updates.find((u) => u.table === 'athletes')?.patch;

beforeEach(() => {
  updates = [];
  inserted = [];
  mailedTo = [];
  pushes = [];
  rows = {
    signup_requests: [{ id: 'req-1', email: 'dana@gmail.com', status: 'pending', group_id: null, athlete_id: null }],
    groups: [{ id: GROUP, name: 'דבוקה 1', coach_id: COACH_ID }],
    athletes: [],
  };
});

describe('approving somebody who signed in with Strava', () => {
  beforeEach(() => {
    // What signup-queue.ts leaves behind: a real account, a synthetic address, and
    // the link from the request back to it.
    rows.signup_requests[0].email = 'strava_98765@strava.madregot.local';
    rows.signup_requests[0].athlete_id = 'athlete-strava';
    rows.athletes = [{ id: 'athlete-strava', name: 'דנה כהן', strava_auth: 'enc:...' }];
  });

  it('lets them in outright instead of leaving them invited', async () => {
    const res = await approve();
    expect(await res.json()).toMatchObject({ ok: true, status: 'approved', activated: true });
    expect(athleteUpdate()).toMatchObject({ approved: true, status: 'active', group_id: GROUP });
  });

  it('adopts the existing row — it must not create a second athlete', async () => {
    await approve();
    expect(inserted.filter((i) => i.table === 'athletes')).toHaveLength(0);
  });

  it('pushes them the approval rather than mailing a synthetic address', async () => {
    const res = await approve();
    expect(mailedTo).toEqual([]);
    // 'no-address' and not a failure: the queue must not show a delivery problem to
    // go and fix when nothing needed sending.
    expect(await res.json()).toMatchObject({ emailed: false, emailReason: 'no-address' });
    expect(pushes).toHaveLength(1);
    expect(pushes[0]).toMatchObject({ athleteId: 'athlete-strava', kind: 'approval', url: '/feed' });
    // ⚠️ No category, deliberately. This is the one notification a just-approved
    // account gets, and a muted management/social preference must not eat it.
    expect(pushes[0].category).toBeUndefined();
  });
});

describe('approving somebody who filled in the form', () => {
  it('creates the athlete, keeps them invited, and mails the join link', async () => {
    const res = await approve();
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, activated: false, emailed: true });
    expect(body.joinUrl).toContain(`/join/${body.inviteToken}`);
    expect(inserted.find((i) => i.table === 'athletes')?.row).toMatchObject({
      email: 'dana@gmail.com',
      status: 'invited',
      approved: true,
      group_id: GROUP,
    });
    expect(mailedTo).toEqual(['dana@gmail.com']);
    // No push: there is no account signed in anywhere to receive it.
    expect(pushes).toEqual([]);
  });

  it('does not activate an adopted row that has no way to sign in', async () => {
    // Same collision path as the Strava case, minus the credential: they exist
    // (some other door made the row) but still owe us a watch, so 'active' here
    // would end the onboarding before it started.
    rows.athletes = [{ id: 'athlete-form', email: 'dana@gmail.com', name: null, strava_auth: null }];
    rows.signup_requests[0].athlete_id = 'athlete-form';

    const res = await approve();
    expect(await res.json()).toMatchObject({ activated: false, emailed: true });
    expect(athleteUpdate()).toMatchObject({ approved: true });
    expect(athleteUpdate()).not.toHaveProperty('status');
    expect(pushes).toEqual([]);
  });
});
