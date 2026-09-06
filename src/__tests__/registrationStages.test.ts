import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * "אישרתי אותם — איפה הם עומדים?"
 *
 * Approval is not the end of the registration; it sends a link, and the person then
 * has to open it, give a name and connect Strava. The queue used to go silent at
 * exactly that point: every approved row read "אושר" whether the mail bounced,
 * whether they never opened it, or whether they finished an hour ago.
 *
 * So GET /api/admin/registrations now derives a stage per row, and the אושרו tab is
 * built out of it. These pin the derivation, because every one of the three answers
 * leads to a different action and getting one wrong means a person is left stranded
 * with the screen saying they are fine:
 *
 *   emailed   → chase them (or send the link by hand)
 *   connected → they started and are STUCK: no Strava, and Strava is the only door
 *   done      → in
 *
 * The second half covers POST …/resend, which exists because on 2026-09-06 an
 * approval sent no mail and reported success (Resend's SDK resolves with `{ error }`
 * instead of throwing), leaving the link recoverable only from the SQL editor.
 */

const requireSession = vi.fn();
vi.mock('@/lib/auth-session', () => ({
  requireSession: (req: Request) => requireSession(req),
  authError: (result: { status: number; error: string }) =>
    new Response(JSON.stringify({ error: result.error }), { status: result.status }),
}));

let emailConfigured: boolean;
let mailError: Error | null;
const notifyRegistrationApproved = vi.fn(async (_args: { email: string; token: string; groupName?: string | null }) => {
  if (mailError) throw mailError;
});
vi.mock('@/lib/email', () => ({
  isEmailConfigured: () => emailConfigured,
  notifyRegistrationApproved,
}));

/** Every chained call a route makes, per `from()`, so writes are assertable. */
type Op = { table: string; calls: Array<[string, unknown[]]> };
let ops: Op[] = [];
let tableRows: Record<string, unknown[]> = {};

// Same Proxy stand-in as clubAggregateAuth.test.ts: any operator records itself and
// returns the chain, awaiting resolves to the rows registered for that table. The
// filters are not applied — these routes narrow in JS, which is the part under test.
function chainFor(record: Op) {
  const chain: Record<string | symbol, unknown> = new Proxy(
    {},
    {
      get(_target, prop) {
        if (typeof prop === 'symbol') return undefined;
        if (prop === 'then') {
          return (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
            Promise.resolve({ data: tableRows[record.table] ?? [], error: null }).then(resolve, reject);
        }
        if (prop === 'maybeSingle' || prop === 'single') {
          const rows = tableRows[record.table] ?? [];
          return () => Promise.resolve({ data: rows[0] ?? null, error: null });
        }
        return (...args: unknown[]) => {
          record.calls.push([prop as string, args]);
          return chain;
        };
      },
    },
  );
  return chain;
}

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({
    from(table: string) {
      const record: Op = { table, calls: [] };
      ops.push(record);
      return chainFor(record);
    },
  }),
}));

const { GET: list } = await import('@/app/api/admin/registrations/route');
const { POST: resend } = await import('@/app/api/admin/registrations/resend/route');

const APPROVER = 'grosfeldofer@gmail.com';

const session = (email = APPROVER) => ({
  ok: true as const,
  user: {
    email,
    athleteId: 'athlete-approver',
    name: 'Approver',
    role: 'admin',
    groupId: null,
    athleteStatus: 'active',
    isStaff: true,
  },
});

type Row = { id: string; email: string; status: string; stage: string; hasStrava: boolean; hasGarmin: boolean; athleteName: string | null; inviteToken: string | null };

async function stages(): Promise<Record<string, Row>> {
  const res = await list(new Request('https://example.test/api/admin/registrations?status=all'));
  const body = await res.json();
  const out: Record<string, Row> = {};
  for (const r of body.requests as Row[]) out[r.id] = r;
  return out;
}

beforeEach(() => {
  ops = [];
  tableRows = {};
  emailConfigured = true;
  mailError = null;
  notifyRegistrationApproved.mockClear();
  requireSession.mockResolvedValue(session());
});

describe('GET /api/admin/registrations — where did they get to', () => {
  beforeEach(() => {
    tableRows.signup_requests = [
      // Approved, and no athlete row matches at all: the link went out and nothing
      // has happened. Indistinguishable from a mail that never arrived, which is
      // exactly why this bucket is the one to chase.
      { id: 'r-ghost', email: 'ghost@gmail.com', status: 'approved', created_at: '2026-09-01T06:00:00Z', athlete_id: null, invite_token: 'a'.repeat(32) },
      // Approved, row exists, untouched.
      { id: 'r-fresh', email: 'fresh@gmail.com', status: 'approved', created_at: '2026-09-01T07:00:00Z', athlete_id: 'a-fresh', invite_token: 'b'.repeat(32) },
      // Started: gave a name and a Garmin credential, still not active.
      { id: 'r-part', email: 'part@gmail.com', status: 'approved', created_at: '2026-09-01T08:00:00Z', athlete_id: 'a-part', invite_token: 'c'.repeat(32) },
      // In.
      { id: 'r-in', email: 'in@gmail.com', status: 'approved', created_at: '2026-09-01T09:00:00Z', athlete_id: 'a-in', invite_token: 'd'.repeat(32) },
      { id: 'r-wait', email: 'wait@gmail.com', status: 'pending', created_at: '2026-09-01T10:00:00Z', athlete_id: null, invite_token: null },
      { id: 'r-no', email: 'no@gmail.com', status: 'rejected', created_at: '2026-09-01T11:00:00Z', athlete_id: null, invite_token: null },
      { id: 'r-already', email: 'already@gmail.com', status: 'member', created_at: '2026-09-01T12:00:00Z', athlete_id: 'a-in', invite_token: null },
    ];
    tableRows.athletes = [
      { id: 'a-fresh', email: 'fresh@gmail.com', name: 'fresh', status: 'invited', strava_athlete_id: null, strava_auth: null, garmin_auth: null, onboarding_status: null, last_seen_at: null },
      { id: 'a-part', email: 'part@gmail.com', name: 'דנה כהן', status: 'invited', strava_athlete_id: null, strava_auth: null, garmin_auth: 'encrypted-blob', onboarding_status: 'garmin_authed', last_seen_at: null },
      { id: 'a-in', email: 'in@gmail.com', name: 'יואב לוי', status: 'active', strava_athlete_id: 12345, strava_auth: 'encrypted-blob', garmin_auth: null, onboarding_status: 'garmin_authed', last_seen_at: '2026-09-02T05:00:00Z' },
    ];
  });

  it('calls an approved row with no athlete row "emailed"', async () => {
    expect((await stages())['r-ghost'].stage).toBe('emailed');
  });

  it('calls an approved row that never opened the link "emailed"', async () => {
    expect((await stages())['r-fresh'].stage).toBe('emailed');
  });

  it('calls a part-way row "connected" — the one that is stuck', async () => {
    const row = (await stages())['r-part'];
    // Not active, no Strava: they did the work and still cannot sign in. This is the
    // stage nobody was being told about.
    expect(row.stage).toBe('connected');
    expect(row.hasStrava).toBe(false);
    expect(row.hasGarmin).toBe(true);
  });

  it('calls an active row with Strava "done"', async () => {
    const row = (await stages())['r-in'];
    expect(row.stage).toBe('done');
    expect(row.hasStrava).toBe(true);
  });

  it('leaves the request statuses that are not "approved" as themselves', async () => {
    const all = await stages();
    expect(all['r-wait'].stage).toBe('pending');
    expect(all['r-no'].stage).toBe('rejected');
    expect(all['r-already'].stage).toBe('member');
  });

  it('carries the name they typed at /join', async () => {
    const all = await stages();
    expect(all['r-part'].athleteName).toBe('דנה כהן');
    expect(all['r-in'].athleteName).toBe('יואב לוי');
  });

  it('never serialises the watch credentials themselves', async () => {
    // strava_auth / garmin_auth are encrypted at rest. The screen can only use a
    // boolean, and a blob that reaches the client is a blob that can leak.
    const res = await list(new Request('https://example.test/api/admin/registrations?status=all'));
    const text = await res.text();
    expect(text).not.toContain('encrypted-blob');
    expect(text).not.toContain('strava_auth');
    expect(text).not.toContain('garmin_auth');
  });

  it('stays shut to a member who is not an approver', async () => {
    // This is a list of strangers' addresses plus, now, their invite tokens — which
    // are credentials. canApprove, not merely a session.
    requireSession.mockResolvedValue(session('runner@gmail.com'));
    const res = await list(new Request('https://example.test/api/admin/registrations?status=all'));
    expect(res.status).toBe(403);
  });
});

describe('POST /api/admin/registrations/resend', () => {
  const approved = (over: Record<string, unknown> = {}) => {
    tableRows.signup_requests = [
      { id: 'r-1', email: 'dana@gmail.com', status: 'approved', group_id: 'g1', invite_token: 'e'.repeat(32), athlete_id: 'a-1', ...over },
    ];
    tableRows.groups = [{ id: 'g1', name: 'דבוקה 2' }];
  };

  const post = (id?: string) =>
    resend(new Request('https://example.test/api/admin/registrations/resend', {
      method: 'POST',
      body: JSON.stringify(id === undefined ? {} : { id }),
    }));

  it('sends the same link to the same address', async () => {
    approved();
    const res = await post('r-1');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, emailed: true });
    expect(body.joinUrl).toMatch(/\/join\/e{32}$/);
    expect(notifyRegistrationApproved).toHaveBeenCalledTimes(1);
  });

  it('hands back the link even when the send is refused', async () => {
    // ⚠️ The 2026-09-06 failure. With no RESEND_FROM_EMAIL the sender is Resend's
    // shared onboarding@resend.dev, which only delivers to the account owner — so
    // every applicant is refused. The reason has to travel, and the link has to
    // survive: copying it out is the only thing left that works.
    approved();
    mailError = new Error('validation_error: You can only send testing emails to your own email address');
    const body = await (await post('r-1')).json();
    expect(body.ok).toBe(true);
    expect(body.emailed).toBe(false);
    expect(body.emailReason).toMatch(/own email address/);
    expect(body.joinUrl).toMatch(/\/join\/e{32}$/);
  });

  it('says so, without trying, when mail is not configured at all', async () => {
    approved();
    emailConfigured = false;
    const body = await (await post('r-1')).json();
    expect(body).toMatchObject({ ok: true, emailed: false, emailReason: 'email-not-configured' });
    expect(notifyRegistrationApproved).not.toHaveBeenCalled();
  });

  it('mints a token onto the ATHLETE row when the request has none', async () => {
    // /join/{token} looks the token up on athletes.invite_token — a token written
    // only to the request would 404 on the join page.
    approved({ invite_token: null });
    const body = await (await post('r-1')).json();
    const token = body.joinUrl.split('/join/')[1];
    expect(token).toMatch(/^[0-9a-f]{32}$/);
    const wrote = ops.filter(o => o.table === 'athletes' && o.calls.some(([m]) => m === 'update'));
    expect(wrote).toHaveLength(1);
    expect(wrote[0].calls.find(([m]) => m === 'update')![1][0]).toEqual({ invite_token: token });
  });

  it('cannot be used to approve anything', async () => {
    // Not a shortcut around the approve route's group check: a pending request is a
    // 400 here, and nothing is written.
    approved({ status: 'pending' });
    const res = await post('r-1');
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('not-approved');
    expect(notifyRegistrationApproved).not.toHaveBeenCalled();
  });

  it('404s an id it does not know', async () => {
    tableRows.signup_requests = [];
    expect((await post('nope')).status).toBe(404);
  });

  it('400s without an id', async () => {
    approved();
    expect((await post(undefined)).status).toBe(400);
  });

  it('is shut to anyone who cannot approve', async () => {
    // It emails a credential and can re-mint one. Same gate as approve.
    approved();
    requireSession.mockResolvedValue(session('runner@gmail.com'));
    expect((await post('r-1')).status).toBe(403);
    expect(notifyRegistrationApproved).not.toHaveBeenCalled();
  });
});
