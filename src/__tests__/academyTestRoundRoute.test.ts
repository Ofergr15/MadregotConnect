import { describe, expect, it, vi, beforeEach } from 'vitest';
import { COACH_ID } from '@/lib/constants';

/**
 * `POST /api/academy/test-round` — N invitations from one tap.
 *
 * `academyTestRound.test.ts` proves WHO belongs in a round. This file is about the two things a
 * bulk write can get wrong that a single write cannot:
 *
 *  - **Scope.** One request now touches many rows, so a coach reaching another coach's trainee
 *    must write nothing at all — not "everybody except that one".
 *  - **Partial failure.** One athlete who was invited by hand a minute ago trips the unique index,
 *    and must not cost the other seventeen their invitations.
 */

const resolveVerifiedCaller = vi.fn();
vi.mock('@/lib/auth/self-or-staff', () => ({
  resolveVerifiedCaller: (req: Request) => resolveVerifiedCaller(req),
}));

type Row = Record<string, unknown>;

const db: { academy_test_invitations: Row[]; athletes: Row[] } = {
  academy_test_invitations: [],
  athletes: [],
};

/** Set to make the invitations table read as absent, the way it is before migration 112. */
let tableMissing = false;

/** The partial unique index from migration 112: one OPEN invitation per athlete. */
const OPEN = ['proposed', 'confirmed', 'other'];

class Query implements PromiseLike<{ data: Row[] | null; error: unknown }> {
  private filters: Array<(r: Row) => boolean> = [];
  private error: unknown = null;
  private inserted: Row | null = null;

  constructor(private table: keyof typeof db) {}

  select() { return this; }

  eq(column: string, value: unknown) {
    this.filters.push(r => r[column] === value);
    return this;
  }

  insert(row: Row) {
    if (this.table === 'academy_test_invitations' && tableMissing) {
      this.error = { code: 'PGRST205', message: 'Could not find the table' };
      return this;
    }
    const clash = db[this.table].some(
      r => r.athlete_id === row.athlete_id && OPEN.includes(String(r.status)),
    );
    if (clash) {
      this.error = { code: '23505', message: 'duplicate key value violates unique constraint' };
      return this;
    }
    this.inserted = { id: `inv-${db[this.table].length + 1}`, ...row };
    db[this.table].push(this.inserted);
    return this;
  }

  private settle() {
    if (this.error) return { data: null, error: this.error };
    if (this.inserted) return { data: [this.inserted], error: null };
    return { data: db[this.table].filter(r => this.filters.every(f => f(r))), error: null };
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

const { POST } = await import('@/app/api/academy/test-round/route');

// Far enough ahead that these stay future for the life of the repo.
const SOON = '2099-09-17T04:00:00.000Z';
const ALT = '2099-09-18T04:00:00.000Z';

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

const post = (body: unknown) =>
  POST(new Request('http://x/api/academy/test-round', { method: 'POST', body: JSON.stringify(body) }));

beforeEach(() => {
  db.academy_test_invitations = [];
  db.athletes = [
    { id: 'a1', name: 'Dor Alon', is_academy: true, academy_coach_id: 'coach-1', coach_id: COACH_ID },
    { id: 'a2', name: 'Noa Shemesh', is_academy: true, academy_coach_id: 'coach-1', coach_id: COACH_ID },
    { id: 'b1', name: 'Avi Barak', is_academy: true, academy_coach_id: 'coach-2', coach_id: COACH_ID },
    { id: 'x1', name: 'Omri Levi', is_academy: false, academy_coach_id: 'coach-1', coach_id: COACH_ID },
  ];
  tableMissing = false;
  asCoach();
});

describe('creating a round', () => {
  it('invites everybody on the list with the same offered times', async () => {
    // One Tuesday morning for the whole round is the point of a round.
    const res = await post({ athleteIds: ['a1', 'a2'], slots: [SOON, ALT] });
    expect(res.status).toBe(200);
    expect((await res.json())).toEqual({ invited: ['a1', 'a2'], failed: [] });
    expect(db.academy_test_invitations).toHaveLength(2);
    expect(db.academy_test_invitations[0]).toMatchObject({
      athlete_id: 'a1', protocol: '30min', status: 'proposed', proposed_slots: [SOON, ALT],
      created_by: 'coach-1',
    });
  });

  it('drops a slot that has gone by rather than refusing the round', async () => {
    const res = await post({ athleteIds: ['a1'], slots: ['2020-01-01T00:00:00Z', SOON] });
    expect(res.status).toBe(200);
    expect(db.academy_test_invitations[0].proposed_slots).toEqual([SOON]);
  });

  it('refuses a round with no future time in it at all', async () => {
    const res = await post({ athleteIds: ['a1'], slots: ['2020-01-01T00:00:00Z'] });
    expect(res.status).toBe(400);
    expect(db.academy_test_invitations).toEqual([]);
  });

  it('refuses an empty list rather than reporting a round of nobody', async () => {
    expect((await post({ athleteIds: [], slots: [SOON] })).status).toBe(400);
  });

  it('counts the same athlete once', async () => {
    // The second copy would be one invitation and one 409 about a duplicate the caller made.
    const res = await post({ athleteIds: ['a1', 'a1'], slots: [SOON] });
    expect((await res.json()).invited).toEqual(['a1']);
    expect(db.academy_test_invitations).toHaveLength(1);
  });

  it('refuses a roster-sized body, which is a broken client and not a round', async () => {
    const ids = Array.from({ length: 61 }, (_, i) => `id-${i}`);
    const res = await post({ athleteIds: ids, slots: [SOON] });
    expect(res.status).toBe(400);
    expect(db.academy_test_invitations).toEqual([]);
  });

  it('carries a non-default protocol through to every row', async () => {
    await post({ athleteIds: ['a1', 'a2'], protocol: '2000m', slots: [SOON] });
    expect(db.academy_test_invitations.map(r => r.protocol)).toEqual(['2000m', '2000m']);
  });
});

describe('who may round whom', () => {
  it('is closed to a trainee', async () => {
    asTrainee();
    const res = await post({ athleteIds: ['a1'], slots: [SOON] });
    expect(res.status).toBe(403);
    expect(db.academy_test_invitations).toEqual([]);
  });

  it('writes NOTHING when one id belongs to another coach', async () => {
    // Not "everybody except that one": a coach's client cannot reach somebody else's trainee by
    // accident, so the request is wrong and the answer is that nothing happened.
    const res = await post({ athleteIds: ['a1', 'b1'], slots: [SOON] });
    expect(res.status).toBe(403);
    expect(db.academy_test_invitations).toEqual([]);
  });

  it('refuses somebody who is not in the academy at all', async () => {
    const res = await post({ athleteIds: ['x1'], slots: [SOON] });
    expect(res.status).toBe(403);
    expect(db.academy_test_invitations).toEqual([]);
  });

  it('lets a manager round across coaches', async () => {
    asManager();
    const res = await post({ athleteIds: ['a1', 'b1'], slots: [SOON] });
    expect((await res.json()).invited).toEqual(['a1', 'b1']);
  });

  it('refuses an id that is not on the roster at all', async () => {
    const res = await post({ athleteIds: ['ghost'], slots: [SOON] });
    expect(res.status).toBe(403);
  });
});

describe('when part of the round cannot be written', () => {
  it('reports the clash and still invites everybody else', async () => {
    // Somebody was invited by hand between the preview and the tap. One insert per athlete exists
    // precisely so this costs one invitation and not the round.
    db.academy_test_invitations.push({ id: 'inv-old', athlete_id: 'a1', status: 'proposed' });
    const res = await post({ athleteIds: ['a1', 'a2'], slots: [SOON] });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      invited: ['a2'],
      failed: [{ athleteId: 'a1', reason: 'already_invited' }],
    });
  });

  it('does not count a closed invitation as a clash', async () => {
    // "We invited him twice and he never ran it" has to stay expressible in a round too.
    db.academy_test_invitations.push({ id: 'inv-old', athlete_id: 'a1', status: 'cancelled' });
    const res = await post({ athleteIds: ['a1'], slots: [SOON] });
    expect((await res.json()).invited).toEqual(['a1']);
  });

  it('stops with a 503 when the table is not there, instead of failing once per athlete', async () => {
    tableMissing = true;
    const res = await post({ athleteIds: ['a1', 'a2'], slots: [SOON] });
    expect(res.status).toBe(503);
  });
});
