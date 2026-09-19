import { describe, expect, it, vi, beforeEach } from 'vitest';
import { COACH_ID } from '@/lib/constants';

/**
 * `GET /api/academy/test-invitation/board` — the coach's list of open invitations.
 *
 * The scoping IS the feature under test. This is the one academy payload that carries several
 * trainees' names in a single response, so the two things that can go wrong are a coach seeing
 * somebody else's trainee and a trainee seeing the board at all.
 */

const resolveVerifiedCaller = vi.fn();
vi.mock('@/lib/auth/self-or-staff', () => ({
  resolveVerifiedCaller: (req: Request) => resolveVerifiedCaller(req),
}));

type Row = Record<string, unknown>;

const db: { academy_test_invitations: Row[]; athletes: Row[]; academy_tests: Row[] } = {
  academy_test_invitations: [],
  athletes: [],
  // Read for one label and one omission: a trainee who has submitted a result must not appear
  // on this board wearing `אין תוצאה`, which is the only flatly untrue thing it could say.
  academy_tests: [],
};

/** Set to make the invitations table read as absent, the way it is before migration 112. */
let tableMissing = false;

class Query implements PromiseLike<{ data: Row[] | null; error: unknown }> {
  private filters: Array<(r: Row) => boolean> = [];
  private orderBy: { column: string; ascending: boolean } | null = null;

  constructor(private table: keyof typeof db) {}

  select() { return this; }

  eq(column: string, value: unknown) {
    this.filters.push(r => r[column] === value);
    return this;
  }

  in(column: string, values: unknown[]) {
    this.filters.push(r => values.includes(r[column]));
    return this;
  }

  order(column: string, opts?: { ascending?: boolean }) {
    this.orderBy = { column, ascending: opts?.ascending !== false };
    return this;
  }

  private settle() {
    if (this.table === 'academy_test_invitations' && tableMissing) {
      return { data: null, error: { code: 'PGRST205', message: 'Could not find the table' } };
    }
    let rows = db[this.table].filter(r => this.filters.every(f => f(r)));
    if (this.orderBy) {
      const { column, ascending } = this.orderBy;
      rows = [...rows].sort((a, b) =>
        String(a[column]).localeCompare(String(b[column])) * (ascending ? 1 : -1));
    }
    return { data: rows, error: null };
  }

  then<R1 = { data: Row[] | null; error: unknown }, R2 = never>(
    onfulfilled?: ((v: { data: Row[] | null; error: unknown }) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    return Promise.resolve(this.settle()).then(onfulfilled, onrejected);
  }
}

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({ from: (table: keyof typeof db) => new Query(table) }),
}));

const { GET } = await import('@/app/api/academy/test-invitation/board/route');

const SOON = '2099-09-17T04:00:00.000Z';

function invitation(over: Row = {}): Row {
  const row: Row = {
    id: 'inv-1',
    athlete_id: 'a1',
    protocol: '30min',
    proposed_slots: [SOON],
    confirmed_slot: null,
    status: 'proposed',
    requested_note: null,
    test_id: null,
    created_at: '2026-09-15T00:00:00.000Z',
    updated_at: '2026-09-15T00:00:00.000Z',
    ...over,
  };
  db.academy_test_invitations.push(row);
  return row;
}

function asCoach(athleteId = 'coach-1') {
  resolveVerifiedCaller.mockResolvedValue({
    denied: null,
    caller: { email: 'yossi@madregot.app', athleteId, role: 'academy_coach', isStaff: true, isSuperUser: false },
  });
}
function asManager() {
  resolveVerifiedCaller.mockResolvedValue({
    denied: null,
    caller: { email: 'ofer@madregot.app', athleteId: 'boss', role: 'admin', isStaff: true, isSuperUser: true },
  });
}
function asTrainee() {
  resolveVerifiedCaller.mockResolvedValue({
    denied: null,
    caller: { email: 'dor@x.com', athleteId: 'a1', role: 'runner', isStaff: false, isSuperUser: false },
  });
}

const get = () => GET(new Request('http://x/api/academy/test-invitation/board'));

/** A submission of `athleteId`'s that nobody has approved yet. */
function submission(over: Row = {}): Row {
  const row: Row = {
    id: 'test-1',
    athlete_id: 'a1',
    protocol: '30min',
    test_date: '2026-09-16',
    submitted_at: '2026-09-16T17:00:00.000Z',
    status: 'pending',
    ...over,
  };
  db.academy_tests.push(row);
  return row;
}

beforeEach(() => {
  db.academy_tests = [];
  db.academy_test_invitations = [];
  db.athletes = [
    // `coach_id` is the club's single head coach, the same filter every academy route uses.
    { id: 'a1', name: 'Dor Alon', is_academy: true, academy_coach_id: 'coach-1', coach_id: COACH_ID },
    { id: 'a2', name: 'Noa Shemesh', is_academy: true, academy_coach_id: 'coach-2', coach_id: COACH_ID },
    { id: 'a3', name: 'Omri Levi', is_academy: false, academy_coach_id: 'coach-1', coach_id: COACH_ID },
  ];
  tableMissing = false;
  asCoach();
});

describe('who can read the board', () => {
  it('is closed to a trainee, even about their own invitation', async () => {
    // A trainee reads `GET /api/academy/test-invitation`, which returns one row and no names.
    invitation();
    asTrainee();
    const res = await get();
    expect(res.status).toBe(403);
  });

  it('gives a coach only their own trainees', async () => {
    invitation({ id: 'mine', athlete_id: 'a1' });
    invitation({ id: 'theirs', athlete_id: 'a2' });
    const { rows } = await (await get()).json();
    expect(rows.map((r: any) => r.invite.id)).toEqual(['mine']);
  });

  it('gives the manager everybody', async () => {
    invitation({ id: 'mine', athlete_id: 'a1' });
    invitation({ id: 'theirs', athlete_id: 'a2', created_at: '2026-09-16T00:00:00.000Z' });
    asManager();
    const { rows } = await (await get()).json();
    expect(rows.map((r: any) => r.invite.id)).toEqual(['mine', 'theirs']);
  });

  it('ignores an invitation for somebody who is not in the academy', async () => {
    // `is_academy` false with an academy coach set is a half-removed member; their invitation
    // is not part of the academy's queue.
    invitation({ athlete_id: 'a3' });
    const { rows } = await (await get()).json();
    expect(rows).toEqual([]);
  });

  it('is an empty list, not an error, for a coach with no trainees', async () => {
    invitation();
    asCoach('coach-9');
    const res = await get();
    expect(res.status).toBe(200);
    expect((await res.json()).rows).toEqual([]);
  });
});

describe('what the board carries', () => {
  it('returns only open invitations', async () => {
    invitation({ id: 'open', status: 'proposed' });
    invitation({ id: 'answered', status: 'confirmed', confirmed_slot: SOON });
    invitation({ id: 'asked', status: 'other' });
    invitation({ id: 'ran', status: 'done', test_id: 't1' });
    invitation({ id: 'dropped', status: 'cancelled' });
    const { rows } = await (await get()).json();
    expect(rows.map((r: any) => r.invite.id).sort()).toEqual(['answered', 'asked', 'open']);
  });

  it('carries the name, and the two timestamps the silence counters need', async () => {
    invitation({ created_at: '2026-09-10T00:00:00.000Z', updated_at: '2026-09-14T00:00:00.000Z' });
    const { rows } = await (await get()).json();
    expect(rows[0]).toMatchObject({
      name: 'Dor Alon',
      createdAt: '2026-09-10T00:00:00.000Z',
      updatedAt: '2026-09-14T00:00:00.000Z',
    });
  });

  it('dates an untouched row from when it was sent, never from now', async () => {
    // Falling back to the clock would reset every silence counter on the board on refresh, so
    // nobody would ever look ignored.
    invitation({ created_at: '2026-09-10T00:00:00.000Z', updated_at: null });
    const { rows } = await (await get()).json();
    expect(rows[0].updatedAt).toBe('2026-09-10T00:00:00.000Z');
  });

  it('does not decide the state here', async () => {
    // Derived on the client from the clock. A state computed at fetch time would keep saying
    // `today` tomorrow morning in a tab nobody reloaded.
    invitation();
    const { rows } = await (await get()).json();
    expect(rows[0].state).toBeUndefined();
  });

  it('names who could be invited: in scope, and nothing open', async () => {
    // The header button's list. Without it the only way to create an invitation is a hand-run
    // POST, which is how this slice started: a write path with no author.
    invitation({ athlete_id: 'a1' });
    asManager();
    const { rows, invitable } = await (await get()).json();
    expect(rows).toHaveLength(1);
    // `a1` has one open, `a3` is not in the academy, so only `a2` is left.
    expect(invitable).toEqual([{ athleteId: 'a2', name: 'Noa Shemesh' }]);
  });

  it('scopes the invitable list to the coach’s own trainees', async () => {
    const { invitable } = await (await get()).json();
    expect(invitable).toEqual([{ athleteId: 'a1', name: 'Dor Alon' }]);
  });

  it('counts a closed invitation as invitable again', async () => {
    // "We invited him three times and he never ran it" has to stay expressible.
    invitation({ athlete_id: 'a1', status: 'cancelled' });
    const { invitable } = await (await get()).json();
    expect(invitable).toEqual([{ athleteId: 'a1', name: 'Dor Alon' }]);
  });

  it('is empty for a coach with no trainees, alongside the empty board', async () => {
    asCoach('coach-9');
    expect(await (await get()).json()).toEqual({ rows: [], invitable: [] });
  });

  it('says the table is missing rather than showing an empty board', async () => {
    // Before migration 112 an empty board would read as "nobody has a test scheduled", which
    // is the wrong thing to tell a coach who scheduled three.
    tableMissing = true;
    const res = await get();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ rows: [], tableMissing: true });
  });
});

// ── A result that is waiting for the coach's eye, not for the coach's calendar ──

describe('a submitted result the coach has not approved', () => {
  it('is marked on the row, so the board can drop it instead of saying there is no result', async () => {
    invitation({ confirmed_slot: '2026-09-16T04:00:00.000Z', status: 'confirmed' });
    submission();
    const { rows } = await (await get()).json();
    expect(rows[0].submittedAt).toBe('2026-09-16T17:00:00.000Z');
  });

  it('still blocks a second invitation, because the first one is open', async () => {
    invitation();
    submission();
    const { invitable } = await (await get()).json();
    expect(invitable).toEqual([]);
  });

  it('ignores a submission for a different protocol', async () => {
    // A 2000m does not answer an invitation to a 30-minute test, so that invitation really is
    // still waiting for a result.
    invitation();
    submission({ protocol: '2000m' });
    const { rows } = await (await get()).json();
    expect(rows[0].submittedAt).toBeNull();
  });

  it('ignores a submission from before the invitation was sent', async () => {
    invitation({ created_at: '2026-09-15T00:00:00.000Z' });
    submission({ test_date: '2026-05-02' });
    const { rows } = await (await get()).json();
    expect(rows[0].submittedAt).toBeNull();
  });

  it('ignores an approved test, which the settle has already closed', async () => {
    invitation();
    submission({ status: 'approved' });
    const { rows } = await (await get()).json();
    expect(rows[0].submittedAt).toBeNull();
  });
});
