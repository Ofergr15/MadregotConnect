import { describe, expect, it, vi, beforeEach } from 'vitest';

// /api/auth/resolve-role runs on the critical path of every sign-in, and it used
// to ask the athletes table for the same email up to four times in sequence
// (coach/admin, then active, then invited, then any status) plus a re-read of a
// row it had already found. It now reads the table ONCE and branches in memory,
// so what needs pinning is that the branching still produces the same answers —
// and that the single read never leaks the OAuth blobs it now has to select.

interface Op { table: string; op: string; filters: Array<{ fn: string; args: unknown[] }> }

let ops: Op[];
let coachRow: Record<string, unknown> | null;
let athleteRows: Array<Record<string, unknown>>;

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({
    from(table: string) {
      const record: Op = { table, op: 'select', filters: [] };
      ops.push(record);
      const rowsFor = () => (table === 'coaches' ? (coachRow ? [coachRow] : []) : athleteRows);
      const track = (fn: string) => (...args: unknown[]) => { record.filters.push({ fn, args }); return chain; };
      const chain: Record<string, unknown> = {
        select: track('select'),
        eq: track('eq'),
        is: track('is'),
        in: track('in'),
        order: track('order'),
        limit: track('limit'),
        update: (...args: unknown[]) => { record.op = 'update'; record.filters.push({ fn: 'update', args }); return chain; },
        upsert: (...args: unknown[]) => {
          record.op = 'upsert';
          record.filters.push({ fn: 'upsert', args });
          return Promise.resolve({ data: null, error: null });
        },
        maybeSingle: () => Promise.resolve({ data: rowsFor()[0] ?? null, error: null }),
        then: (resolve: (v: unknown) => unknown) =>
          Promise.resolve({ data: rowsFor(), error: null }).then(resolve),
      };
      return chain;
    },
  }),
}));

const { POST } = await import('@/app/api/auth/resolve-role/route');

function athlete(over: Record<string, unknown> = {}) {
  return {
    id: 'a1',
    name: 'Runner',
    email: 'runner@example.com',
    group_id: 'g1',
    status: 'active',
    garmin_auth: null,
    strava_auth: null,
    approved: true,
    role: null,
    created_at: '2026-01-01T00:00:00Z',
    ...over,
  };
}

async function resolve(body: Record<string, unknown> = { email: 'Runner@Example.com ' }) {
  const req = { json: async () => body } as unknown as Parameters<typeof POST>[0];
  const res = await POST(req);
  return { status: res.status, body: await res.json() };
}

const athleteSelects = () => ops.filter(o => o.table === 'athletes' && o.op === 'select');

beforeEach(() => {
  ops = [];
  coachRow = null;
  athleteRows = [athlete()];
});

describe('resolve-role — one read, in-memory branching', () => {
  it('reads athletes exactly once for a returning athlete, lowercased and trimmed', async () => {
    const { body } = await resolve();
    expect(athleteSelects()).toHaveLength(1);
    const eq = athleteSelects()[0].filters.find(f => f.fn === 'eq');
    expect(eq?.args).toEqual(['email', 'runner@example.com']);
    expect(body.role).toBe('runner');
  });

  it('never returns the OAuth credential blobs it has to select', async () => {
    athleteRows = [athlete({ garmin_auth: { token: 'secret' }, strava_auth: { token: 'secret' } })];
    const { body } = await resolve();
    expect(body.athlete).not.toHaveProperty('garmin_auth');
    expect(body.athlete).not.toHaveProperty('strava_auth');
    expect(body.athlete).not.toHaveProperty('approved');
    expect(body.athlete).not.toHaveProperty('role');
    // ...but still reports the connections, which the client branches on.
    expect(body.hasGarmin).toBe(true);
    expect(body.hasStrava).toBe(true);
  });

  it('honours an elevated role on the athlete row', async () => {
    athleteRows = [athlete({ role: 'academy_coach' })];
    expect((await resolve()).body.role).toBe('academy_coach');
  });

  it('prefers a Strava-connected duplicate over a Garmin one, and Garmin over neither', async () => {
    athleteRows = [
      athlete({ id: 'plain' }),
      athleteRows[0] = athlete({ id: 'garmin', garmin_auth: { t: 1 } }),
      athlete({ id: 'strava', strava_auth: { t: 1 } }),
    ];
    expect((await resolve()).body.athlete.id).toBe('strava');

    ops = [];
    athleteRows = [athlete({ id: 'plain' }), athlete({ id: 'garmin', garmin_auth: { t: 1 } })];
    expect((await resolve()).body.athlete.id).toBe('garmin');
  });

  it('holds an unapproved athlete at pending, but still names them for push opt-in', async () => {
    athleteRows = [athlete({ approved: false })];
    const { body } = await resolve();
    expect(body.pendingApproval).toBe(true);
    expect(body.athlete.id).toBe('a1');
    expect(body.role).toBeUndefined();
  });

  it('treats a coach with a coach/admin athlete row as staff', async () => {
    coachRow = { id: 'c1', email: 'runner@example.com', name: 'Coach' };
    athleteRows = [athlete({ id: 'staff', role: 'admin' })];
    const { body } = await resolve();
    expect(body.role).toBe('admin');
    expect(body.coach.id).toBe('c1');
    expect(body.athlete).toEqual({ id: 'staff', name: 'Runner', email: 'runner@example.com', group_id: 'g1' });
    // The old code re-read the row it had just found by id; there is nothing left
    // to re-read now.
    expect(athleteSelects()).toHaveLength(1);
  });

  it('falls back to the athlete branch for a coach with no coach/admin athlete row', async () => {
    coachRow = { id: 'c1', email: 'runner@example.com', name: 'Coach' };
    const { body } = await resolve();
    expect(body.coach).toBeUndefined();
    expect(body.role).toBe('runner');
  });

  it('sends an approved invited athlete to the dashboard, not back through onboarding', async () => {
    athleteRows = [athlete({ status: 'invited', garmin_auth: { t: 1 } })];
    const { body } = await resolve();
    expect(body.needsOnboarding).toBeUndefined();
    expect(body.role).toBe('runner');
    expect(body.hasGarmin).toBe(true);
  });

  it('reactivates an athlete with some other status instead of re-registering them', async () => {
    athleteRows = [athlete({ status: 'inactive' })];
    const { body } = await resolve();
    expect(body.needsOnboarding).toBeUndefined();
    expect(body.role).toBe('runner');
    const update = ops.find(o => o.table === 'athletes' && o.op === 'update');
    expect(update?.filters.find(f => f.fn === 'update')?.args).toEqual([{ status: 'active' }]);
  });

  it('duplicate rows do not read as "no athlete" and force re-registration', async () => {
    // The old per-branch maybeSingle() errored on more than one row, so a stray
    // duplicate fell all the way through to the new-user branch.
    athleteRows = [athlete({ id: 'dup1', status: 'inactive' }), athlete({ id: 'dup2', status: 'inactive' })];
    const { body } = await resolve();
    expect(body.needsOnboarding).toBeUndefined();
    expect(body.athlete.id).toBe('dup1');
  });

  it('creates a brand-new user and reports onboarding', async () => {
    athleteRows = [];
    const { body } = await resolve({ email: 'new@example.com', name: 'New Person' });
    expect(body.needsOnboarding).toBe(true);
    expect(body.pendingApproval).toBe(true);
    const upsert = ops.find(o => o.op === 'upsert');
    const [row, opts] = upsert!.filters.find(f => f.fn === 'upsert')!.args as [Record<string, unknown>, unknown];
    expect(row.email).toBe('new@example.com');
    expect(row.status).toBe('invited');
    expect(row.approved).toBe(false);
    expect(row.onboarding_status).toBe('google_authed');
    expect(opts).toEqual({ onConflict: 'email', ignoreDuplicates: true });
  });

  it('backfills the Google avatar without a round trip in front of the reads', async () => {
    await resolve({ email: 'runner@example.com', avatarUrl: 'https://x/y.png' });
    const update = ops.find(o => o.table === 'athletes' && o.op === 'update');
    expect(update?.filters.find(f => f.fn === 'update')?.args).toEqual([{ avatar_url: 'https://x/y.png' }]);
    // Only sets it where it isn't already set — a manual upload wins.
    expect(update?.filters.some(f => f.fn === 'is')).toBe(true);
    expect(athleteSelects()).toHaveLength(1);
  });

  it('rejects a request with no email', async () => {
    const { status } = await resolve({});
    expect(status).toBe(400);
    expect(ops).toHaveLength(0);
  });
});
