import { describe, it, expect, vi, beforeEach } from 'vitest';

// "שיבוץ מאמנים" end to end on the server: every door that chooses a trainee's
// coaches writes the SET (migration 135) — letting a club member in straight away
// with several coaches, adding coaches across many trainees, the coaches board's
// add (never a replace), and the funnel's accept — plus the pure picker logic.
// Against an in-memory PostgREST that can also pretend 135 isn't pasted yet.

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
vi.mock('@/lib/maintenance-release', () => ({ releaseFromMaintenance: async () => ({ released: false }) }));
const mails: Array<{ coachName: string | null }> = [];
vi.mock('@/lib/email', async (orig) => ({
  ...(await orig<object>()),
  notifyAcademyAccepted: async (o: { coachName: string | null }) => { mails.push({ coachName: o.coachName }); return { ok: true }; },
  notifyAcademyInvite: async () => ({ ok: true }),
}));

const caller = vi.fn();
vi.mock('@/lib/auth/self-or-staff', async (orig) => ({
  ...(await orig<object>()),
  resolveVerifiedCaller: async () => ({ denied: null, caller: caller() }),
}));

const bulk = await import('@/app/api/academy/members/bulk/route');
const { acceptAction, acceptCoachIds } = await import('@/lib/academy/admit-server');
const picker = await import('@/lib/academy/coach-picker');
const { traineesToAdd, addToCoachBody } = await import('@/lib/academy/coach-board');
const { parseBulk } = await import('@/lib/academy/manage');

const manager = { athleteId: 'boss', role: 'admin', roles: ['admin'], isStaff: true, isSuperUser: false, email: 'b' };
const coachCaller = (id: string) => ({ athleteId: id, role: 'academy_coach', roles: ['academy_coach'], isStaff: true, isSuperUser: false, email: id });
const a = (o: Row): Row => ({ coach_id: 'club', role: 'runner', extra_roles: null, is_academy: false, approved: true, status: 'active', academy_coach_id: null, academy_band_id: null, academy_pace_offset_sec: null, ...o });
const post = (body: unknown) => bulk.POST(new Request('http://x/api/academy/members/bulk', { method: 'POST', body: JSON.stringify(body) }));
const setOf = (id: string) => (db.academy_trainee_coaches || []).filter((r) => r.athlete_id === id).map((r) => r.coach_id).sort();
const athlete = (id: string) => db.athletes.find((r) => r.id === id)!;
const pre135 = () => { failing.academy_trainee_coaches = { code: '42P01', message: 'relation "academy_trainee_coaches" does not exist' }; };

beforeEach(() => {
  for (const k of Object.keys(db)) delete db[k];
  for (const k of Object.keys(failing)) delete failing[k];
  writes.length = 0;
  pushes.length = 0;
  mails.length = 0;
  delete process.env.STREAM_API_KEY;
  delete process.env.STREAM_API_SECRET;
  db.athletes = [
    a({ id: 'boss', name: 'Boss', role: 'admin' }),
    a({ id: 'dana', name: 'Dana Levi', role: 'academy_coach' }),
    a({ id: 'guy', name: 'Guy Ziv', role: 'academy_coach' }),
    // An academy coach by an extra role only (127).
    a({ id: 'avi', name: 'Avi Peretz', role: 'runner', extra_roles: ['academy_coach'] }),
    a({ id: 'yoav', name: 'Yoav Cohen', is_academy: true, academy_coach_id: 'dana' }),
    a({ id: 'raz', name: 'Raz Kedem', is_academy: true }),
    a({ id: 'noa', name: 'Noa Club' }),
    a({ id: 'tal', name: 'Tal Form', approved: false, status: 'invited', email: 'tal@x' }),
  ];
  db.academy_trainee_coaches = [
    { athlete_id: 'yoav', coach_id: 'dana', since: '2026-10-01' },
    { athlete_id: 'yoav', coach_id: 'guy', since: '2026-10-02' },
  ];
  db.academy_coach_history = [{ athlete_id: 'yoav', coach_id: 'dana', started_on: '2026-08-12', ended_on: null }];
  db.academy_candidates = [{ id: 'card1', name: 'Tal Form', email: 'tal@x', athlete_id: 'tal', invite_token: null, invited_at: null }];
});

describe('the picker (lib/academy/coach-picker)', () => {
  it('ticks several, or one before 135', () => {
    expect(picker.toggleCoach(['dana'], 'guy', true)).toEqual(['dana', 'guy']);
    expect(picker.toggleCoach(['dana', 'guy'], 'dana', true)).toEqual(['guy']);
    expect(picker.toggleCoach(['dana'], 'guy', false)).toEqual(['guy']);
    expect(picker.toggleCoach(['dana'], 'dana', false)).toEqual([]);
  });

  it('replace vs add, and the load each coach ends with', () => {
    expect(picker.coachesAfter(['dana'], ['guy'], 'replace')).toEqual(['guy']);
    expect(picker.coachesAfter(['dana'], ['guy', 'dana'], 'add')).toEqual(['dana', 'guy']);
    // Two trainees: one with Dana, one with nobody. "Add Guy": Guy +2, Dana unchanged.
    const sets = [['dana'], []];
    expect(picker.loadAfter('guy', 3, sets, ['guy'], 'add')).toBe(5);
    expect(picker.loadAfter('dana', 4, sets, ['guy'], 'add')).toBe(4);
    // "Move to Guy": Dana loses hers.
    expect(picker.loadAfter('dana', 4, sets, ['guy'], 'replace')).toBe(3);
  });

  it('builds the one bulk body and the CTA in each mode', () => {
    expect(picker.assignBody(['t'], ['dana', 'guy'], 'replace', true)).toEqual({ athleteIds: ['t'], action: 'coach', coachIds: ['dana', 'guy'], notify: true });
    expect(picker.assignBody(['t', 'u'], ['avi'], 'add', false).action).toBe('addCoach');
    expect(picker.bulkCta('add', 2, ['Avi Peretz'], false)).toBe('להוסיף את Avi ל־2 מתאמנים');
    expect(picker.bulkCta('replace', 2, ['Dana Levi', 'Guy Ziv'], false)).toBe('להעביר 2 מתאמנים ל־Dana ו־Guy');
    expect(picker.bulkCta('replace', 3, [], true)).toBe('3 מתאמנים בלי מאמן');
    expect(picker.bulkCta('replace', 2, ['Guy Ziv'], false, true)).toBe('לשבץ 2 מתאמנים אצל Guy');
    expect(picker.bidiNames(['Dana', 'Guy'])).toBe('\u200F\u2068Dana\u2069 ו־\u2068Guy\u2069');
    expect(picker.saveCoachesLabel(2)).toBe('לשמור · 2 מאמנים');
    expect(picker.sameCoachSet(['dana', 'guy'], ['guy', 'dana'])).toBe(false);
  });

  it('parses coachIds for add and addCoach too', () => {
    expect(parseBulk({ action: 'add', athleteIds: ['noa'], coachIds: ['dana', 'guy'] })).toMatchObject({ coachIds: ['dana', 'guy'] });
    expect(parseBulk({ action: 'addCoach', athleteIds: ['raz'], coachIds: ['avi'] })).toMatchObject({ coachIds: ['avi'], coachId: null });
    expect(parseBulk({ action: 'band', athleteIds: ['raz'], bandId: null, coachIds: ['avi'] })).toMatchObject({ coachIds: null });
  });
});

describe('the coaches board: "להוסיף מתאמן" adds, never replaces', () => {
  const m = (id: string, coachIds: string[], extra: Partial<Row> = {}) =>
    ({ athleteId: id, name: id, approved: true, status: 'active', academyCoachId: coachIds[0] ?? null, academyCoachIds: coachIds, ...extra }) as never;

  it('offers every trainee the coach does not hold yet, the unpaired first', () => {
    const list = traineesToAdd('avi', [m('yoav', ['dana']), m('raz', []), m('kim', ['avi']), m('pend', [], { approved: false })]);
    expect(list.map((x: { athleteId: string }) => x.athleteId)).toEqual(['raz', 'yoav']);
  });

  it('posts addCoach, so Yoav keeps Dana and Guy and gains Avi', async () => {
    caller.mockReturnValue(manager);
    const body = addToCoachBody('avi', ['yoav', 'raz']);
    expect(body.action).toBe('addCoach');
    const res = await (await post(body)).json();
    expect(res.failed).toBe(0);
    expect(setOf('yoav')).toEqual(['avi', 'dana', 'guy']);
    expect(athlete('yoav').academy_coach_id).toBe('dana');
    expect(setOf('raz')).toEqual(['avi']);
    expect(athlete('raz').academy_coach_id).toBe('avi');
  });
});

describe('bulk: several coaches at once', () => {
  it('addCoach with coachIds adds both to every trainee', async () => {
    caller.mockReturnValue(manager);
    const res = await (await post({ action: 'addCoach', athleteIds: ['raz', 'yoav'], coachIds: ['avi', 'guy'], notify: true })).json();
    expect(res.failed).toBe(0);
    expect(setOf('raz')).toEqual(['avi', 'guy']);
    expect(setOf('yoav')).toEqual(['avi', 'dana', 'guy']);
    // Avi is told once, about both.
    expect(pushes.filter((p) => p.athleteId === 'avi')).toHaveLength(1);
  });

  it('"add" lets a club member in straight away with two coaches', async () => {
    caller.mockReturnValue(manager);
    const res = await (await post({ action: 'add', athleteIds: ['noa'], coachIds: ['dana', 'avi'], notify: true })).json();
    expect(res.results[0]).toMatchObject({ ok: true, coachId: 'dana', coachIds: ['dana', 'avi'] });
    expect(athlete('noa').is_academy).toBe(true);
    expect(athlete('noa').academy_coach_id).toBe('dana');
    expect(setOf('noa')).toEqual(['avi', 'dana']);
    expect(pushes.map((p) => p.athleteId).sort()).toEqual(['avi', 'dana', 'noa']);
  });

  it('"add" with two coaches before 135: a clear 409 and nobody half let in', async () => {
    caller.mockReturnValue(manager);
    pre135();
    const r = await post({ action: 'add', athleteIds: ['noa'], coachIds: ['dana', 'avi'] });
    expect(r.status).toBe(409);
    expect((await r.json()).code).toBe('no_schema');
    expect(athlete('noa').is_academy).toBe(false);
    expect(writes.filter((w) => w.table === 'athletes')).toHaveLength(0);
  });

  it('"add" with one coach before 135 still works, as it did', async () => {
    caller.mockReturnValue(manager);
    pre135();
    const res = await (await post({ action: 'add', athleteIds: ['noa'], coachIds: ['guy'] })).json();
    expect(res.results[0]).toMatchObject({ ok: true, coachId: 'guy' });
    expect(athlete('noa').academy_coach_id).toBe('guy');
  });
});

describe('the funnel accept writes the whole set', () => {
  it('reads coachIds, falls back to coachId, and keeps a coach to themselves', () => {
    expect(acceptCoachIds({ coachIds: ['dana', 'guy', 'dana'] }, manager as never, true)).toEqual(['dana', 'guy']);
    expect(acceptCoachIds({ coachId: 'guy' }, manager as never, true)).toEqual(['guy']);
    expect(acceptCoachIds({}, manager as never, true)).toEqual(['boss']);
    expect(acceptCoachIds({ coachIds: ['guy'] }, coachCaller('dana') as never, false)).toMatchObject({ status: 403 });
    expect(acceptCoachIds({}, coachCaller('dana') as never, false)).toEqual(['dana']);
  });

  it('accepts with two coaches: approved, in the academy, both in the table, legacy = first', async () => {
    const res = await acceptAction('card1', manager as never, { coachIds: ['guy', 'avi'] });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, coachId: 'guy', coachIds: ['guy', 'avi'], coachName: 'Guy Ziv ו־Avi Peretz', paired: true });
    expect(athlete('tal')).toMatchObject({ approved: true, is_academy: true, academy_coach_id: 'guy' });
    expect(setOf('tal')).toEqual(['avi', 'guy']);
    expect(mails[0].coachName).toBe('Guy Ziv ו־Avi Peretz');
    const { academyAcceptedEmail } = await import('@/lib/email');
    expect(academyAcceptedEmail({ name: 'Tal', token: null, coachName: 'Guy ו־Avi', coachCount: 2 }).html).toContain('המאמנים שלך: Guy ו־Avi');
    expect(academyAcceptedEmail({ name: 'Tal', token: null, coachName: 'Guy' }).html).toContain('המאמן/ת שלך: Guy');
    // History follows the first coach only (077's one open row).
    expect((db.academy_coach_history || []).filter((h) => h.athlete_id === 'tal')).toEqual([
      expect.objectContaining({ coach_id: 'guy', reason: 'accepted from the funnel' }),
    ]);
  });

  it('refuses a non-coach in the set, before writing anything', async () => {
    const res = await acceptAction('card1', manager as never, { coachIds: ['guy', 'noa'] });
    expect(res.status).toBe(400);
    expect(athlete('tal').approved).toBe(false);
  });

  it('before 135: two coaches is a 409 no_schema and Tal is not let in', async () => {
    pre135();
    const res = await acceptAction('card1', manager as never, { coachIds: ['guy', 'avi'] });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('no_schema');
    expect(athlete('tal')).toMatchObject({ approved: false, is_academy: false });
  });

  it('one coach before 135 still accepts', async () => {
    pre135();
    const res = await acceptAction('card1', manager as never, { coachIds: ['dana'] });
    expect(res.status).toBe(200);
    expect(athlete('tal').academy_coach_id).toBe('dana');
  });
});
