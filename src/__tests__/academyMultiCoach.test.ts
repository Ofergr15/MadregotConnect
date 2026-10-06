import { describe, it, expect, vi, beforeEach } from 'vitest';

// Several coaches per trainee (migration 135): the helper module, the scope gates,
// the shared conversation, and the coach route — against an in-memory PostgREST
// that can also pretend 135 hasn't been pasted yet.

type Row = Record<string, unknown>;
const db: Record<string, Row[]> = {};
const writes: Array<{ table: string; op: string; row?: Row }> = [];
const failing: Record<string, { code: string; message: string }> = {};

class Query {
  private filters: Array<(r: Row) => boolean> = [];
  private op: 'select' | 'update' | 'insert' | 'delete' | 'upsert' = 'select';
  private payload: Row | null = null;
  private many: Row[] = [];
  constructor(private table: string) {}
  select() { return this; }
  update(row: Row) { this.op = 'update'; this.payload = row; return this; }
  insert(row: Row) { this.op = 'insert'; this.payload = row; return this; }
  upsert(rows: Row[]) { this.op = 'upsert'; this.many = rows; return this; }
  delete() { this.op = 'delete'; return this; }
  eq(col: string, v: unknown) { this.filters.push((r) => (col === 'coach_id' && this.table === 'athletes') || r[col] === v); return this; }
  in(col: string, vs: unknown[]) { this.filters.push((r) => vs.includes(r[col])); return this; }
  is(col: string, v: unknown) { this.filters.push((r) => (r[col] ?? null) === v); return this; }
  limit() { return this; }
  order() { return this; }
  private run() {
    if (failing[this.table]) return { data: null, error: failing[this.table] };
    const rows = (db[this.table] || []).filter((r) => this.filters.every((f) => f(r)));
    if (this.op === 'update') { writes.push({ table: this.table, op: 'update', row: this.payload! }); for (const r of rows) Object.assign(r, this.payload); return { data: rows, error: null }; }
    if (this.op === 'insert') { writes.push({ table: this.table, op: 'insert', row: this.payload! }); (db[this.table] ||= []).push({ ...this.payload }); return { data: null, error: null }; }
    if (this.op === 'upsert') {
      const t = (db[this.table] ||= []);
      for (const row of this.many) {
        writes.push({ table: this.table, op: 'upsert', row });
        if (!t.some((r) => r.athlete_id === row.athlete_id && r.coach_id === row.coach_id)) t.push({ ...row });
      }
      return { data: null, error: null };
    }
    if (this.op === 'delete') { writes.push({ table: this.table, op: 'delete' }); db[this.table] = (db[this.table] || []).filter((r) => !rows.includes(r)); return { data: null, error: null }; }
    return { data: rows.map((r) => ({ ...r })), error: null };
  }
  maybeSingle() { const r = this.run(); return Promise.resolve({ ...r, data: Array.isArray(r.data) ? r.data[0] ?? null : r.data }); }
  then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) { return Promise.resolve(this.run()).then(res, rej); }
}

const supabase = { from: (t: string) => new Query(t) };
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => supabase }));
vi.mock('@/lib/constants', async (orig) => ({ ...(await orig<object>()), COACH_ID: 'club' }));

const pushes: Array<{ athleteId: string; kind: string }> = [];
vi.mock('@/lib/push', () => ({
  notifyAthlete: vi.fn(async (o: { athleteId: string; kind: string }) => { pushes.push({ athleteId: o.athleteId, kind: o.kind }); }),
}));

// A Stream that records what the thread did.
const stream = {
  sent: [] as Row[],
  added: [] as string[][],
  removed: [] as string[][],
  channel: () => ({
    create: async () => {},
    addMembers: async (ids: string[]) => { stream.added.push(ids); },
    removeMembers: async (ids: string[]) => { stream.removed.push(ids); },
    sendMessage: async (m: Row) => { stream.sent.push(m); return { message: { id: 'm1' } }; },
  }),
  upsertUsers: async () => {},
};
vi.mock('@/lib/stream/server', async (orig) => ({
  ...(await orig<object>()),
  getStreamServerClient: () => stream,
  upsertStreamUsersFromAthletes: async () => {},
}));

const caller = vi.fn();
vi.mock('@/lib/auth/self-or-staff', async (orig) => ({
  ...(await orig<object>()),
  resolveVerifiedCaller: async () => ({ denied: null, caller: caller() }),
}));

const tc = await import('@/lib/academy/trainee-coaches');
const pairing = await import('@/lib/academy/pairing-server');
const { academyThreadMembers, syncAcademyThreadCoaches } = await import('@/lib/academy/thread-server');
const { seatFor, toThreadMessages } = await import('@/lib/academy/thread');
const { isMine } = await import('@/components/academy/ThreadTranscript');
const messagesRoute = await import('@/app/api/academy/threads/messages/route');
const threadsRoute = await import('@/app/api/academy/threads/route');
const coachRoute = await import('@/app/api/academy/coach/route');
const { buildCoachCards, unpairedTrainees } = await import('@/lib/academy/coach-board');
const { buildSuggestions } = await import('@/lib/academy/suggestions');

const coachCaller = (id: string) => ({ athleteId: id, role: 'academy_coach', roles: ['academy_coach'], isStaff: true, isSuperUser: false, email: id });
const trainee = (id: string) => ({ athleteId: id, role: 'runner', roles: ['runner'], isStaff: false, isSuperUser: false, email: id });
const manager = { athleteId: 'boss', role: 'admin', roles: ['admin'], isStaff: true, isSuperUser: false, email: 'b' };

const a = (o: Row): Row => ({ coach_id: 'club', role: 'runner', extra_roles: null, is_academy: false, academy_coach_id: null, academy_band_id: null, academy_pace_offset_sec: null, ...o });

beforeEach(() => {
  for (const k of Object.keys(db)) delete db[k];
  for (const k of Object.keys(failing)) delete failing[k];
  writes.length = 0;
  pushes.length = 0;
  stream.sent.length = 0; stream.added.length = 0; stream.removed.length = 0;
  db.athletes = [
    a({ id: 'boss', name: 'Boss', role: 'admin' }),
    a({ id: 'dana', name: 'Dana Levi', role: 'academy_coach' }),
    a({ id: 'guy', name: 'Guy Ziv', role: 'academy_coach' }),
    a({ id: 'avi', name: 'Avi Peretz', role: 'academy_coach' }),
    // Yoav: Dana (legacy) and Guy (the table). Michal: Guy only. Raz: nobody.
    a({ id: 'yoav', name: 'Yoav Cohen', is_academy: true, academy_coach_id: 'dana' }),
    a({ id: 'michal', name: 'Michal Raz', is_academy: true, academy_coach_id: 'guy' }),
    a({ id: 'raz', name: 'Raz Kedem', is_academy: true }),
  ];
  db.academy_trainee_coaches = [
    { athlete_id: 'yoav', coach_id: 'guy', since: '2026-10-02' },
    { athlete_id: 'yoav', coach_id: 'dana', since: '2026-10-01' },
    { athlete_id: 'michal', coach_id: 'guy', since: '2026-09-01' },
  ];
  db.academy_coach_history = [{ athlete_id: 'yoav', coach_id: 'dana', started_on: '2026-08-12', ended_on: null }];
  process.env.STREAM_API_KEY = 'k';
  process.env.STREAM_API_SECRET = 's';
});

const pre135 = () => { failing.academy_trainee_coaches = { code: '42P01', message: 'relation "academy_trainee_coaches" does not exist' }; };

describe('trainee-coaches: reads', () => {
  it('unions the table with the legacy column, legacy first', async () => {
    const map = await tc.coachIdsByTrainee(supabase as never);
    expect(map.get('yoav')).toEqual(['dana', 'guy']);
    expect(map.get('michal')).toEqual(['guy']);
    expect(map.get('raz')).toEqual([]);
    expect(await tc.coachIdsOf(supabase as never, 'yoav')).toEqual(['dana', 'guy']);
    expect((await tc.traineeIdsOfCoach(supabase as never, 'guy')).sort()).toEqual(['michal', 'yoav']);
    expect(await tc.traineeIdsOfCoach(supabase as never, 'dana')).toEqual(['yoav']);
  });

  it('takes rows the caller already read, and scopes to them', async () => {
    const map = await tc.coachIdsByTrainee(supabase as never, undefined, [{ id: 'yoav', academy_coach_id: 'dana' }]);
    expect([...map.keys()]).toEqual(['yoav']);
    expect(map.get('yoav')).toEqual(['dana', 'guy']);
  });

  it('before 135: the legacy column alone, one coach as today', async () => {
    pre135();
    const map = await tc.coachIdsByTrainee(supabase as never);
    expect(map.get('yoav')).toEqual(['dana']);
    expect(await tc.traineeIdsOfCoach(supabase as never, 'guy')).toEqual(['michal']);
    expect(await tc.hasTraineeCoachesTable(supabase as never)).toBe(false);
  });

  it('orders, dedupes and diffs sets', () => {
    expect(tc.orderCoachIds('b', ['a', 'b', '', 'c'])).toEqual(['b', 'a', 'c']);
    expect(tc.diffCoachSets(['a', 'b'], ['b', 'c'])).toEqual({ added: ['c'], removed: ['a'] });
  });
});

describe('trainee-coaches: setTraineeCoaches', () => {
  it('replaces the set, writes the legacy column = first, and history follows the first coach only', async () => {
    const r = await tc.setTraineeCoaches(supabase as never, 'michal', ['guy', 'avi'], { reason: 'x' });
    expect(r).toMatchObject({ ok: true, before: ['guy'], after: ['guy', 'avi'], added: ['avi'], removed: [] });
    expect(db.athletes.find((x) => x.id === 'michal')!.academy_coach_id).toBe('guy');
    expect(writes.some((w) => w.table === 'academy_coach_history')).toBe(false);

    const swap = await tc.setTraineeCoaches(supabase as never, 'yoav', ['guy'], {});
    expect(swap).toMatchObject({ ok: true, added: [], removed: ['dana'] });
    expect(db.athletes.find((x) => x.id === 'yoav')!.academy_coach_id).toBe('guy');
    // One open history row, now Guy's.
    const open = db.academy_coach_history.filter((h) => h.athlete_id === 'yoav' && h.ended_on == null);
    expect(open.map((h) => h.coach_id)).toEqual(['guy']);
    expect(db.academy_trainee_coaches.filter((x) => x.athlete_id === 'yoav').map((x) => x.coach_id)).toEqual(['guy']);
  });

  it('is a no-op for the same set', async () => {
    const r = await tc.setTraineeCoaches(supabase as never, 'yoav', ['dana', 'guy']);
    expect(r).toMatchObject({ ok: true, unchanged: true });
    expect(writes).toHaveLength(0);
  });

  it('clears the set: column null, rows gone, history closed', async () => {
    const r = await tc.setTraineeCoaches(supabase as never, 'yoav', []);
    expect(r).toMatchObject({ ok: true, removed: ['dana', 'guy'] });
    expect(db.athletes.find((x) => x.id === 'yoav')!.academy_coach_id).toBeNull();
    expect(db.academy_trainee_coaches.some((x) => x.athlete_id === 'yoav')).toBe(false);
    expect(db.academy_coach_history.every((h) => h.ended_on != null)).toBe(true);
  });

  it('before 135: refuses a set of two and writes nothing; one coach still works', async () => {
    pre135();
    expect(await tc.setTraineeCoaches(supabase as never, 'michal', ['guy', 'avi'])).toEqual({ ok: false, reason: 'no_schema' });
    expect(writes).toHaveLength(0);
    expect(await tc.setTraineeCoaches(supabase as never, 'michal', ['avi'])).toMatchObject({ ok: true, after: ['avi'] });
    expect(db.athletes.find((x) => x.id === 'michal')!.academy_coach_id).toBe('avi');
  });
});

describe('scope: every coach of a shared trainee is equal', () => {
  it('visibleTraineeIds and mayCoach include the co-coach', async () => {
    expect([...(await pairing.visibleTraineeIds(coachCaller('guy')))!].sort()).toEqual(['michal', 'yoav']);
    expect(await pairing.mayCoach(coachCaller('guy'), 'yoav')).toBe(true);
    expect(await pairing.mayCoach(coachCaller('dana'), 'yoav')).toBe(true);
    expect(await pairing.mayCoach(coachCaller('avi'), 'yoav')).toBe(false);
    const lookup = await pairing.loadPair('yoav');
    expect(lookup.ok && lookup.pair).toMatchObject({ academyCoachId: 'dana', academyCoachIds: ['dana', 'guy'] });
  });

  it('requireTraineeAccess lets any of the coaches in, nobody else', async () => {
    caller.mockReturnValue(coachCaller('guy'));
    expect((await pairing.requireTraineeAccess(new Request('http://x'), 'yoav')).denied).toBeNull();
    caller.mockReturnValue(coachCaller('avi'));
    expect((await pairing.requireTraineeAccess(new Request('http://x'), 'yoav')).denied?.status).toBe(403);
  });
});

describe('the shared conversation', () => {
  it('has the trainee, every coach, and the admins', async () => {
    expect((await academyThreadMembers(supabase as never, 'yoav')).sort()).toEqual(['boss', 'dana', 'guy', 'yoav']);
  });

  it('a removed coach leaves the channel; an admin who was a coach stays', async () => {
    db.athletes.find((x) => x.id === 'yoav')!.academy_coach_id = 'guy';
    db.academy_trainee_coaches = db.academy_trainee_coaches.filter((x) => !(x.athlete_id === 'yoav' && x.coach_id === 'dana'));
    const r = await syncAcademyThreadCoaches(stream as never, supabase as never, 'yoav', ['dana', 'boss']);
    expect(r.removed).toEqual(['dana']);
    expect(stream.removed).toEqual([['dana']]);
  });

  it('setPairCoaches syncs Stream membership when coaches change', async () => {
    const r = await pairing.setPairCoaches('yoav', ['guy', 'avi'], null);
    expect(r).toMatchObject({ ok: true, added: ['avi'], removed: ['dana'] });
    expect(stream.added.at(-1)!.sort()).toEqual(['avi', 'boss', 'guy', 'yoav']);
    expect(stream.removed).toEqual([['dana']]);
  });

  const send = (body: Row) => messagesRoute.POST(new Request('http://x/api/academy/threads/messages', { method: 'POST', body: JSON.stringify(body) }));

  it('a trainee message notifies ALL their coaches', async () => {
    caller.mockReturnValue(trainee('yoav'));
    expect((await send({ text: 'hi' })).status).toBe(200);
    expect(pushes.map((p) => p.athleteId).sort()).toEqual(['dana', 'guy']);
  });

  it('a co-coach may write, and it notifies the trainee only', async () => {
    caller.mockReturnValue(coachCaller('guy'));
    expect((await send({ athleteId: 'yoav', text: 'agree' })).status).toBe(200);
    expect(pushes.map((p) => p.athleteId)).toEqual(['yoav']);
    caller.mockReturnValue(coachCaller('avi'));
    expect((await send({ athleteId: 'yoav', text: 'x' })).status).toBe(403);
  });

  it('a trainee with no coach still reaches the admins', async () => {
    caller.mockReturnValue(trainee('raz'));
    await send({ text: 'anyone?' });
    expect(pushes.map((p) => p.athleteId)).toEqual(['boss']);
  });

  it('opening the thread seats every coach as "coach" and returns them all', async () => {
    caller.mockReturnValue(coachCaller('guy'));
    const body = await (await threadsRoute.POST(new Request('http://x/api/academy/threads', { method: 'POST', body: JSON.stringify({ athleteId: 'yoav' }) }))).json();
    expect(body).toMatchObject({ mentorId: 'dana', mentorIds: ['dana', 'guy'], seat: 'coach', viewerId: 'guy' });
  });

  it('seats and "mine" by author when several coaches share the seat', () => {
    expect(seatFor('guy', 'yoav', ['dana', 'guy'])).toBe('coach');
    expect(seatFor('boss', 'yoav', ['dana', 'guy'])).toBe('manager');
    expect(seatFor('dana', 'yoav', 'dana')).toBe('coach');
    const msgs = toThreadMessages([
      { id: '1', text: 'Dana here', created_at: '2026-10-05T10:00:00Z', user: { id: 'dana', name: 'Dana Levi · מאמן' } },
      { id: '2', text: 'Guy here', created_at: '2026-10-05T10:01:00Z', user: { id: 'guy', name: 'Guy Ziv' } },
    ], { athleteId: 'yoav', mentorId: ['dana', 'guy'] });
    expect(msgs.map((m) => [m.authorId, m.seat, m.authorName])).toEqual([['dana', 'coach', 'Dana Levi'], ['guy', 'coach', 'Guy Ziv']]);
    // Guy reads Dana's message as someone else's, named — not as his own.
    expect(msgs.map((m) => isMine(m, 'coach', 'guy'))).toEqual([false, true]);
    // Without a viewer id, the old seat rule.
    expect(isMine(msgs[0], 'coach')).toBe(true);
  });
});

describe('PUT /api/academy/coach', () => {
  const put = (body: Row) => coachRoute.PUT(new Request('http://x/api/academy/coach', { method: 'PUT', body: JSON.stringify(body) }));

  it('takes a whole set (coachIds) and still the legacy coachId', async () => {
    caller.mockReturnValue(manager);
    const set = await (await put({ athleteId: 'michal', coachIds: ['guy', 'avi'] })).json();
    expect(set).toMatchObject({ coachId: 'guy', coachIds: ['guy', 'avi'], coachNames: ['Guy Ziv', 'Avi Peretz'], added: ['avi'], unchanged: false });
    const again = await (await put({ athleteId: 'michal', coachIds: ['guy', 'avi'] })).json();
    expect(again.unchanged).toBe(true);
    const legacy = await (await put({ athleteId: 'michal', coachId: 'dana' })).json();
    expect(legacy).toMatchObject({ coachIds: ['dana'], removed: ['guy', 'avi'] });
    expect((await put({ athleteId: 'michal', coachId: null })).status).toBe(200);
    expect(db.athletes.find((x) => x.id === 'michal')!.academy_coach_id).toBeNull();
  });

  it('refuses a non-coach in the set, the trainee themselves, and a coach caller', async () => {
    caller.mockReturnValue(manager);
    expect((await put({ athleteId: 'michal', coachIds: ['guy', 'raz'] })).status).toBe(400);
    expect((await put({ athleteId: 'michal', coachIds: ['michal'] })).status).toBe(400);
    expect((await put({ athleteId: 'michal' })).status).toBe(400);
    caller.mockReturnValue(coachCaller('guy'));
    expect((await put({ athleteId: 'michal', coachIds: ['guy'] })).status).toBe(403);
  });

  it('before 135: two coaches is a 409 no_schema', async () => {
    pre135();
    caller.mockReturnValue(manager);
    const res = await put({ athleteId: 'michal', coachIds: ['guy', 'avi'] });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('no_schema');
  });
});

describe('capacity and suggestions', () => {
  const m = (id: string, ids: string[]) => ({
    athleteId: id, name: id, approved: true, status: 'active', academyCoachId: ids[0] ?? null, academyCoachName: null,
    academyCoachIds: ids, academyCoachNames: ids.map((x) => x.toUpperCase()), attention: [], plannedCount: 0, completedCount: 0,
    academyJoinedOn: '2026-10-01', daysSinceActivity: 1,
  });

  it('a shared trainee takes a place on each coach card; "without a coach" is zero coaches', () => {
    const members = [m('yoav', ['dana', 'guy']), m('michal', ['guy']), m('raz', [])] as never[];
    const cards = buildCoachCards([{ id: 'dana', name: 'Dana', avatarUrl: null, trainees: 0 }, { id: 'guy', name: 'Guy', avatarUrl: null, trainees: 0 }], members, 8);
    expect(cards.map((c) => [c.id, c.trainees.length, c.free])).toEqual([['dana', 1, 7], ['guy', 2, 6]]);
    expect(unpairedTrainees(members).map((x: { athleteId: string }) => x.athleteId)).toEqual(['raz']);
  });

  it('suggests pairing only the trainees with no coach at all', () => {
    const s = buildSuggestions({
      members: [m('yoav', ['dana', 'guy']), m('raz', [])] as never[],
      coaches: [{ coachId: 'avi', coachName: 'Avi', trainees: 0 }],
      capacity: 8, isManager: true, today: '2026-10-06',
    });
    expect(s[0]).toMatchObject({ kind: 'pair', people: [{ id: 'raz', name: 'raz' }] });
  });
});
