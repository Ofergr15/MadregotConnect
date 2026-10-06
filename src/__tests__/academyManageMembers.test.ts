import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  applicationDeletable, daysBetween, deriveLeft, groupByCoach, monthsBetween, otherCoachNames, parseBulk, rowLine, waPhone, waShareUrl,
  type ApplicantRow,
} from '@/lib/academy/manage';
import type { AcademyMember } from '@/lib/academy/members';

// ── An in-memory PostgREST, enough for the people tab's routes ───────────────

type Row = Record<string, unknown>;
const db: Record<string, Row[]> = {};
const writes: Array<{ table: string; op: 'update' | 'insert' | 'delete' | 'upsert'; row?: Row; filters: Array<[string, unknown]> }> = [];
/** Tables whose reads fail, and how. */
const failing: Record<string, { code: string; message: string }> = {};

class Query {
  private filters: Array<[string, (r: Row) => boolean, string, unknown]> = [];
  private op: 'select' | 'update' | 'insert' | 'delete' | 'upsert' = 'select';
  private payload: Row | null = null;
  private many: Row[] = [];
  private head = false;
  constructor(private table: string) {}
  select(_cols?: string, opts?: { count?: string; head?: boolean }) { if (this.op === 'select') this.head = !!opts?.head; return this; }
  update(row: Row) { this.op = 'update'; this.payload = row; return this; }
  insert(row: Row) { this.op = 'insert'; this.payload = row; return this; }
  delete() { this.op = 'delete'; return this; }
  // The link table's upsert (migration 135): insert what isn't there by (athlete_id, coach_id).
  upsert(rows: Row[]) { this.op = 'upsert'; this.many = rows; return this; }
  eq(col: string, v: unknown) { this.filters.push([col, (r) => col === 'coach_id' && this.table === 'athletes' ? true : r[col] === v, 'eq', v]); return this; }
  in(col: string, vs: unknown[]) { this.filters.push([col, (r) => vs.includes(r[col]), 'in', vs]); return this; }
  is(col: string, v: unknown) { this.filters.push([col, (r) => (r[col] ?? null) === v, 'is', v]); return this; }
  order() { return this; }
  limit() { return this; }
  private matches() { return (db[this.table] || []).filter((r) => this.filters.every(([, f]) => f(r))); }
  private run() {
    if (failing[this.table] && this.op === 'select') return { data: null, error: failing[this.table], count: null };
    const rows = this.matches();
    const filters = this.filters.map(([c, , , v]) => [c, v] as [string, unknown]);
    if (this.op === 'update') {
      writes.push({ table: this.table, op: 'update', row: this.payload!, filters });
      for (const r of rows) Object.assign(r, this.payload);
      return { data: rows, error: null };
    }
    if (this.op === 'insert') {
      writes.push({ table: this.table, op: 'insert', row: this.payload!, filters });
      const row = { id: `new-${writes.length}`, ...this.payload };
      (db[this.table] ||= []).push(row);
      return { data: row, error: null };
    }
    if (this.op === 'upsert') {
      const t = (db[this.table] ||= []);
      for (const row of this.many) {
        writes.push({ table: this.table, op: 'upsert', row, filters });
        if (!t.some((r) => r.athlete_id === row.athlete_id && r.coach_id === row.coach_id)) t.push({ ...row });
      }
      return { data: null, error: null };
    }
    if (this.op === 'delete') {
      writes.push({ table: this.table, op: 'delete', filters });
      db[this.table] = (db[this.table] || []).filter((r) => !rows.includes(r));
      return { data: null, error: null };
    }
    return { data: this.head ? null : rows.map((r) => ({ ...r })), error: null, count: rows.length };
  }
  maybeSingle() { const r = this.run(); return Promise.resolve({ ...r, data: Array.isArray(r.data) ? r.data[0] ?? null : r.data }); }
  single() { return this.maybeSingle(); }
  then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) { return Promise.resolve(this.run()).then(res, rej); }
}

vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => ({ from: (t: string) => new Query(t) }) }));
vi.mock('@/lib/constants', async (orig) => ({ ...(await orig<object>()), COACH_ID: 'club' }));
const pushes: Array<{ athleteId: string; kind: string; title: string }> = [];
vi.mock('@/lib/push', () => ({
  notifyAthlete: vi.fn(async (o: { athleteId: string; kind: string; copy: (l: 'he') => { title: string } }) => {
    pushes.push({ athleteId: o.athleteId, kind: o.kind, title: o.copy('he').title });
  }),
}));
const caller = vi.fn();
vi.mock('@/lib/auth/self-or-staff', async (orig) => ({
  ...(await orig<object>()),
  resolveVerifiedCaller: async () => ({ denied: null, caller: caller() }),
}));

const people = await import('@/app/api/academy/members/people/route');
const bulk = await import('@/app/api/academy/members/bulk/route');
const application = await import('@/app/api/academy/members/application/route');
const { APPLICANT_DATA_TABLES } = await import('@/lib/academy/manage-server');

const manager = { athleteId: 'mgr', role: 'runner', roles: ['runner', 'academy_manager'], isStaff: true, isSuperUser: false, email: 'm' };
const coach = { athleteId: 'dana', role: 'academy_coach', roles: ['academy_coach'], isStaff: true, isSuperUser: false, email: 'd' };

const post = (body: unknown) => bulk.POST(new Request('http://x/api/academy/members/bulk', { method: 'POST', body: JSON.stringify(body) }));
const del = (body: unknown) => application.DELETE(new Request('http://x/api/academy/members/application', { method: 'DELETE', body: JSON.stringify(body) }));

const athlete = (o: Row): Row => ({
  role: 'runner', extra_roles: null, status: 'active', approved: true, approved_at: '2025-01-01', is_academy: false,
  onboarding_status: 'complete', academy_coach_id: null, academy_joined_on: null, academy_band_id: null,
  garmin_auth: null, strava_auth: null, created_at: '2025-01-01T00:00:00Z', coach_id: 'club', ...o,
});

beforeEach(() => {
  for (const k of Object.keys(db)) delete db[k];
  for (const k of Object.keys(failing)) delete failing[k];
  writes.length = 0;
  pushes.length = 0;
  db.athletes = [
    athlete({ id: 'mgr', name: 'Manager', extra_roles: ['academy_manager'] }),
    athlete({ id: 'dana', name: 'Dana Levi', role: 'academy_coach' }),
    athlete({ id: 'guy', name: 'Guy Ziv', role: 'runner', extra_roles: ['academy_coach'] }),
    athlete({ id: 'plain', name: 'Plain Runner' }),
    athlete({ id: 't1', name: 'Yoav Cohen', is_academy: true, academy_coach_id: 'dana', academy_joined_on: '2026-08-12', academy_band_id: 'b3' }),
    athlete({ id: 't2', name: 'Noa Barak', is_academy: true, academy_coach_id: 'dana', academy_joined_on: '2026-06-01' }),
    // Left in September, coached by Guy.
    athlete({ id: 'gone', name: 'Tal Ben', academy_joined_on: '2026-05-01' }),
    // The form's own account: never approved, nothing attached.
    athlete({ id: 'app', name: 'Lior Katz', approved: false, approved_at: null, status: 'invited', role: 'academy_user', is_academy: true, onboarding_status: 'academy_pending', created_at: '2026-10-04T08:00:00Z' }),
  ];
  db.academy_coach_history = [
    { athlete_id: 'gone', coach_id: 'guy', started_on: '2026-05-01', ended_on: '2026-09-09' },
    { athlete_id: 't1', coach_id: 'dana', started_on: '2026-08-12', ended_on: null },
  ];
  db.academy_bands = [{ id: 'b3', name: 'דבוקה 3', active: true }, { id: 'b4', name: 'דבוקה 4', active: true }];
  db.academy_candidates = [
    { id: 'c-app', name: 'Lior Katz', athlete_id: 'app', created_at: '2026-10-04', archived_at: null, accepted_at: null },
    { id: 'c-member', name: 'Plain Runner', athlete_id: 'plain', created_at: '2026-10-03', archived_at: null, accepted_at: null },
  ];
  db.academy_candidate_events = [
    { candidate_id: 'c-app', stage: 'form', occurred_at: '2026-10-04T08:00:00Z' },
    { candidate_id: 'c-member', stage: 'form', occurred_at: '2026-10-03T08:00:00Z' },
  ];
  db.athlete_activities = [{ athlete_id: 'plain', id: 'a1' }];
});

// ── Pure ────────────────────────────────────────────────────────────────────

const member = (o: Partial<AcademyMember>): AcademyMember => ({
  athleteId: 'x', name: 'X', email: '', avatarUrl: null, groupId: null, groupName: null,
  academyCoachId: 'dana', academyCoachName: 'Dana', band: null, paceOffsetSec: null, status: 'active', role: 'runner',
  approved: true, hasWatch: true, hasGarmin: true, hasStrava: false, joinedAt: null, academyJoinedOn: '2026-07-01',
  weekKm: 10, weekRuns: 2, weekDurationMin: 60, totalKm: 100, totalRuns: 10, lastActivityAt: null, daysSinceActivity: 1,
  plannedCount: 4, completedCount: 3, completionRate: 0.75, attention: [], ...o,
  academyCoachIds: o.academyCoachIds ?? ((o.academyCoachId === undefined ? 'dana' : o.academyCoachId) ? [o.academyCoachId === undefined ? 'dana' : o.academyCoachId!] : []),
  academyCoachNames: o.academyCoachNames ?? ((o.academyCoachId === undefined ? 'dana' : o.academyCoachId) ? [o.academyCoachName === undefined ? 'Dana' : o.academyCoachName || ''] : []),
});

describe('grouping the roster by coach', () => {
  it('puts the busiest coach first, sorts names, and the unpaired last', () => {
    const s = groupByCoach([
      member({ athleteId: '1', name: 'Zed', academyCoachId: 'guy', academyCoachName: 'Guy' }),
      member({ athleteId: '2', name: 'Bea', academyCoachId: 'dana', academyCoachName: 'Dana' }),
      member({ athleteId: '3', name: 'Ann', academyCoachId: 'dana', academyCoachName: 'Dana' }),
      member({ athleteId: '4', name: 'Raz', academyCoachId: null, academyCoachName: null }),
    ]);
    expect(s.map((x) => [x.coachId, x.members.map((m) => m.name)])).toEqual([
      ['dana', ['Ann', 'Bea']], ['guy', ['Zed']], [null, ['Raz']],
    ]);
  });
});

describe('the row line', () => {
  const today = '2026-10-06';
  it('says what needs attention before the routine numbers', () => {
    expect(rowLine(member({ hasWatch: false }), today)).toEqual({ kind: 'no_watch' });
    expect(rowLine(member({ daysSinceActivity: 6 }), today)).toEqual({ kind: 'inactive', days: 6 });
    expect(rowLine(member({ academyJoinedOn: '2026-10-02', academyCoachId: null }), today)).toEqual({ kind: 'new', days: 4 });
    expect(rowLine(member({ daysSinceActivity: null, totalRuns: 0 }), today)).toEqual({ kind: 'never_ran' });
  });
  it('otherwise since-when and this week', () => {
    expect(rowLine(member({}), today)).toEqual({ kind: 'week', since: '2026-07-01', done: 3, planned: 4 });
    expect(rowLine(member({ plannedCount: 0 }), today)).toEqual({ kind: 'since', since: '2026-07-01' });
  });
  it('counts days and months', () => {
    expect(daysBetween('2026-10-01', '2026-10-06')).toBe(5);
    expect(daysBetween('2026-10-06', '2026-10-01')).toBe(0);
    expect(monthsBetween('2026-05-01', '2026-09-09')).toBe(4);
  });
});

describe('who left', () => {
  it('reads the join stamp and the coach history; skips members, removed and unapproved accounts', () => {
    const left = deriveLeft(
      [
        { id: 'a', name: 'A', is_academy: false, academy_joined_on: '2026-05-01' },
        { id: 'b', name: 'B', is_academy: false, academy_joined_on: null },
        { id: 'c', name: 'C', is_academy: true, academy_joined_on: '2026-05-01' },
        { id: 'd', name: 'D', is_academy: false, academy_joined_on: '2026-01-01', status: 'removed' },
        { id: 'e', name: 'E', is_academy: false, academy_joined_on: null },
      ],
      [
        { athlete_id: 'a', coach_id: 'dana', started_on: '2026-05-01', ended_on: '2026-07-01' },
        { athlete_id: 'a', coach_id: 'guy', started_on: '2026-07-01', ended_on: '2026-09-09' },
        // Accepted from the funnel (no join stamp), then removed.
        { athlete_id: 'b', coach_id: 'dana', started_on: '2026-06-01', ended_on: '2026-08-02' },
      ],
      new Map([['dana', 'Dana Levi'], ['guy', 'Guy Ziv']]),
      '2026-10-06',
    );
    expect(left.map((l) => [l.athleteId, l.leftOn, l.previousCoachId, l.previousCoachName, l.monthsIn])).toEqual([
      ['a', '2026-09-09', 'guy', 'Guy Ziv', 4],
      ['b', '2026-08-02', 'dana', 'Dana Levi', 2],
    ]);
  });
});

describe('which applications may be deleted', () => {
  const form: ApplicantRow = { id: 'x', approved: false, approved_at: null, status: 'invited', role: 'academy_user', onboarding_status: 'academy_pending' };
  const facts = { dataRows: 0, coachesSomeone: false };
  it('only the form’s own, untouched account', () => {
    expect(applicationDeletable(form, facts)).toEqual({ ok: true });
  });
  it.each([
    ['approved', { approved: true }],
    ['approved', { approved: null }],
    ['approved', { approved: undefined }],
    ['approved', { approved_at: '2026-01-01' }],
    ['not_form_account', { onboarding_status: 'complete' }],
    ['not_form_account', { status: 'active' }],
    ['staff', { role: 'coach' }],
    ['staff', { extra_roles: ['academy_coach'] }],
    ['connected', { strava_auth: { token: 1 } }],
    ['paired', { academy_coach_id: 'dana' }],
    ['paired', { academy_joined_on: '2026-01-01' }],
  ])('refuses: %s', (reason, patch) => {
    expect(applicationDeletable({ ...form, ...patch } as ApplicantRow, facts)).toEqual({ ok: false, reason });
  });
  it('refuses when the account has data or coaches someone', () => {
    expect(applicationDeletable(form, { dataRows: 1, coachesSomeone: false })).toEqual({ ok: false, reason: 'has_data' });
    expect(applicationDeletable(form, { dataRows: 0, coachesSomeone: true })).toEqual({ ok: false, reason: 'coaches_someone' });
  });
});

describe('the bulk body', () => {
  it('validates the action, the ids and the fields each action needs', () => {
    expect(parseBulk({ action: 'nope', athleteIds: ['a'] })).toBe('Unknown action');
    expect(parseBulk({ action: 'remove', athleteIds: [] })).toBe('athleteIds is required');
    expect(parseBulk({ action: 'coach', athleteIds: ['a'] })).toMatch(/coachId or coachIds is required/);
    expect(parseBulk({ action: 'addCoach', athleteIds: ['a'] })).toMatch(/coachId or coachIds is required/);
    expect(parseBulk({ action: 'removeCoach', athleteIds: ['a'], coachId: null })).toMatch(/coachId is required/);
    expect(parseBulk({ action: 'coach', athleteIds: ['a'], coachIds: 'dana' })).toMatch(/must be an array/);
    expect(parseBulk({ action: 'coach', athleteIds: ['a'], coachIds: ['dana', 'a'] })).toMatch(/own coach/);
    expect(parseBulk({ action: 'coach', athleteIds: ['a'], coachIds: ['dana', ' guy ', 'dana', ''] })).toMatchObject({ coachIds: ['dana', 'guy'] });
    expect(parseBulk({ action: 'band', athleteIds: ['a'], bandId: null, coachIds: ['dana'] })).toMatchObject({ coachIds: null });
    expect(parseBulk({ action: 'band', athleteIds: ['a'] })).toMatch(/bandId is required/);
    expect(parseBulk({ action: 'coach', athleteIds: ['a'], coachId: 'a' })).toMatch(/own coach/);
    expect(parseBulk({ action: 'remove', athleteIds: Array.from({ length: 101 }, (_, i) => `i${i}`) })).toMatch(/At most/);
    expect(parseBulk({ action: 'coach', athleteIds: ['a', 'a', ' b '], coachId: null, notify: true })).toMatchObject({
      athleteIds: ['a', 'b'], coachId: null, notify: true, hasCoach: true,
    });
  });
});

describe('WhatsApp links', () => {
  it('turns an Israeli number into wa.me form, and drops what is not a phone', () => {
    expect(waPhone('054-123 4567')).toBe('972541234567');
    expect(waPhone('+972 54 123 4567')).toBe('972541234567');
    expect(waPhone('12')).toBeNull();
    expect(waShareUrl(null, 'a b')).toBe('https://wa.me/?text=a%20b');
  });
});

// ── Routes ──────────────────────────────────────────────────────────────────

describe('GET /api/academy/members/people', () => {
  it('is the manager’s', async () => {
    caller.mockReturnValue(coach);
    expect((await people.GET(new Request('http://x/api/academy/members/people'))).status).toBe(403);
  });

  it('lists who left with their last coach, who is waiting, and who could be added', async () => {
    caller.mockReturnValue(manager);
    const body = await (await people.GET(new Request('http://x/api/academy/members/people'))).json();
    expect(body.left).toEqual([expect.objectContaining({ athleteId: 'gone', leftOn: '2026-09-09', previousCoachId: 'guy', previousCoachName: 'Guy Ziv' })]);
    expect(body.pending).toEqual([
      expect.objectContaining({ athleteId: 'app', candidateId: 'c-app', clubMember: false, deletable: true }),
      expect.objectContaining({ athleteId: 'plain', candidateId: 'c-member', clubMember: true, deletable: false }),
    ]);
    const addable = body.addable.map((a: { athleteId: string }) => a.athleteId);
    expect(addable).toContain('plain');
    expect(addable).not.toContain('t1');
    expect(addable).not.toContain('app');
  });
});

describe('POST /api/academy/members/bulk', () => {
  it('refuses a coach and writes nothing', async () => {
    caller.mockReturnValue(coach);
    expect((await post({ action: 'remove', athleteIds: ['t1'] })).status).toBe(403);
    expect(writes).toHaveLength(0);
  });

  it('400s a bad body', async () => {
    caller.mockReturnValue(manager);
    expect((await post({ action: 'coach', athleteIds: ['t1'] })).status).toBe(400);
  });

  it('moves trainees to a coach with history, and tells each trainee and the coach once', async () => {
    caller.mockReturnValue(manager);
    const body = await (await post({ action: 'coach', athleteIds: ['t1', 't2', 'plain'], coachId: 'guy', notify: true })).json();
    expect(body.results).toEqual([
      { athleteId: 't1', ok: true, coachId: 'guy', coachIds: ['guy'] },
      { athleteId: 't2', ok: true, coachId: 'guy', coachIds: ['guy'] },
      { athleteId: 'plain', ok: false, error: 'not_member' },
    ]);
    expect(db.athletes.find((a) => a.id === 't1')!.academy_coach_id).toBe('guy');
    expect(db.academy_coach_history.find((h) => h.athlete_id === 't1' && h.coach_id === 'dana')!.ended_on).not.toBeNull();
    expect(writes.filter((w) => w.table === 'academy_coach_history' && w.op === 'insert').map((w) => w.row!.athlete_id)).toEqual(['t1', 't2']);
    expect(pushes.map((p) => [p.athleteId, p.kind])).toEqual([
      ['t1', 'academy_coach_assigned'], ['t2', 'academy_coach_assigned'],
      // The coach they left is told too (the sheet's "להודיע … שנוספו או הוסרו").
      ['dana', 'academy_trainee_removed'], ['guy', 'academy_trainee_assigned'],
    ]);
    expect(pushes[3].title).toContain('2');
    expect(pushes[2].title).toContain('2');
  });

  it('is idempotent on the coach a trainee already has, and silent without notify', async () => {
    caller.mockReturnValue(manager);
    const body = await (await post({ action: 'coach', athleteIds: ['t1'], coachId: 'dana' })).json();
    expect(body.results[0]).toMatchObject({ ok: true, unchanged: true });
    expect(writes).toHaveLength(0);
    expect(pushes).toHaveLength(0);
  });

  it('refuses a coach who is not an academy coach', async () => {
    caller.mockReturnValue(manager);
    expect((await post({ action: 'coach', athleteIds: ['t1'], coachId: 'plain' })).status).toBe(400);
    expect(writes).toHaveLength(0);
  });

  it('sets the band, and 404s an unknown one', async () => {
    caller.mockReturnValue(manager);
    expect((await post({ action: 'band', athleteIds: ['t2'], bandId: 'nope' })).status).toBe(404);
    const body = await (await post({ action: 'band', athleteIds: ['t1', 't2'], bandId: 'b4' })).json();
    expect(body.ok).toBe(2);
    expect(db.athletes.find((a) => a.id === 't2')!.academy_band_id).toBe('b4');
  });

  it('removes from the academy and ends the pair, keeping the band', async () => {
    caller.mockReturnValue(manager);
    const body = await (await post({ action: 'remove', athleteIds: ['t1'] })).json();
    expect(body.ok).toBe(1);
    const t1 = db.athletes.find((a) => a.id === 't1')!;
    expect(t1).toMatchObject({ is_academy: false, academy_coach_id: null, academy_band_id: 'b3' });
    expect(db.academy_coach_history.find((h) => h.athlete_id === 't1')!.ended_on).not.toBeNull();
  });

  it('adds an approved club member with a coach and band; refuses members and applicants', async () => {
    caller.mockReturnValue(manager);
    const body = await (await post({ action: 'add', athleteIds: ['plain', 't1', 'app'], coachId: 'guy', bandId: 'b3', notify: true })).json();
    expect(body.results.map((r: { error?: string; ok: boolean }) => r.error ?? r.ok)).toEqual([true, 'already_member', 'already_member']);
    expect(db.athletes.find((a) => a.id === 'plain')).toMatchObject({ is_academy: true, academy_coach_id: 'guy', academy_band_id: 'b3' });
    expect(db.athletes.find((a) => a.id === 'plain')!.academy_joined_on).toBeTruthy();
    expect(pushes.map((p) => p.athleteId)).toEqual(['plain', 'guy']);
  });

  it('brings someone back with the coach they had', async () => {
    caller.mockReturnValue(manager);
    const body = await (await post({ action: 'restore', athleteIds: ['gone'] })).json();
    expect(body.results[0]).toMatchObject({ ok: true, coachId: 'guy' });
    expect(db.athletes.find((a) => a.id === 'gone')).toMatchObject({ is_academy: true, academy_coach_id: 'guy' });
  });
});

describe('several coaches per trainee (migration 135)', () => {
  it('replaces the set with coachIds, keeps the first as the legacy coach, and history follows the first', async () => {
    caller.mockReturnValue(manager);
    const body = await (await post({ action: 'coach', athleteIds: ['t1'], coachIds: ['dana', 'guy'], notify: true })).json();
    expect(body.results[0]).toMatchObject({ ok: true, coachId: 'dana', coachIds: ['dana', 'guy'] });
    expect(db.athletes.find((a) => a.id === 't1')!.academy_coach_id).toBe('dana');
    expect(db.academy_trainee_coaches.map((r) => `${r.athlete_id}:${r.coach_id}`).sort()).toEqual(['t1:dana', 't1:guy']);
    // The first coach didn't change, so the one-open-row history is untouched.
    expect(writes.filter((w) => w.table === 'academy_coach_history')).toHaveLength(0);
    expect(pushes.map((p) => [p.athleteId, p.kind])).toEqual([['t1', 'academy_coach_added'], ['guy', 'academy_trainee_assigned']]);
    expect(pushes[0].title).toContain('Guy');
  });

  it('addCoach adds one coach across many and keeps who they had; removeCoach drops just that one', async () => {
    caller.mockReturnValue(manager);
    const add = await (await post({ action: 'addCoach', athleteIds: ['t1', 't2'], coachId: 'guy' })).json();
    expect(add.results.map((r: { coachIds: string[] }) => r.coachIds)).toEqual([['dana', 'guy'], ['dana', 'guy']]);
    const again = await (await post({ action: 'addCoach', athleteIds: ['t1'], coachId: 'guy' })).json();
    expect(again.results[0]).toMatchObject({ ok: true, unchanged: true });

    const rm = await (await post({ action: 'removeCoach', athleteIds: ['t1'], coachId: 'dana' })).json();
    expect(rm.results[0]).toMatchObject({ ok: true, coachId: 'guy', coachIds: ['guy'] });
    // The legacy column moves to the remaining coach, and the history with it.
    expect(db.athletes.find((a) => a.id === 't1')!.academy_coach_id).toBe('guy');
    expect(db.academy_coach_history.find((h) => h.athlete_id === 't1' && h.coach_id === 'dana')!.ended_on).not.toBeNull();
    expect(db.academy_coach_history.find((h) => h.athlete_id === 't1' && h.coach_id === 'guy' && h.ended_on == null)).toBeTruthy();
    expect(db.academy_trainee_coaches.filter((r) => r.athlete_id === 't1').map((r) => r.coach_id)).toEqual(['guy']);
  });

  it('before 135 is pasted: one coach works as today, a set of two is refused and nothing is written', async () => {
    caller.mockReturnValue(manager);
    failing.academy_trainee_coaches = { code: '42P01', message: 'relation "academy_trainee_coaches" does not exist' };
    const two = await (await post({ action: 'coach', athleteIds: ['t1'], coachIds: ['dana', 'guy'] })).json();
    expect(two.results[0]).toMatchObject({ ok: false, error: 'no_schema' });
    expect(writes).toHaveLength(0);
    const one = await (await post({ action: 'coach', athleteIds: ['t1'], coachIds: ['guy'] })).json();
    expect(one.results[0]).toMatchObject({ ok: true, coachIds: ['guy'] });
    expect(db.athletes.find((a) => a.id === 't1')!.academy_coach_id).toBe('guy');
  });

  it('a shared trainee sits under each coach, tagged with the others', () => {
    const shared = member({ athleteId: 's', name: 'Yoav', academyCoachId: 'dana', academyCoachName: 'Dana', academyCoachIds: ['dana', 'guy'], academyCoachNames: ['Dana', 'Guy'] });
    const s = groupByCoach([shared, member({ athleteId: 'm', name: 'Michal' })]);
    expect(s.map((x) => [x.coachId, x.members.map((m) => m.athleteId)])).toEqual([['dana', ['m', 's']], ['guy', ['s']]]);
    expect(otherCoachNames(shared, 'dana')).toEqual(['Guy']);
    expect(otherCoachNames(shared, 'guy')).toEqual(['Dana']);
    expect(otherCoachNames(member({}), 'dana')).toEqual([]);
  });

  it('a co-coach of a shared trainee is "coaching someone" for the delete gate', async () => {
    caller.mockReturnValue(manager);
    db.academy_trainee_coaches = [{ athlete_id: 't1', coach_id: 'app' }];
    const res = await del({ athleteId: 'app', confirm: 'delete' });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('coaches_someone');
  });
});

describe('DELETE /api/academy/members/application', () => {
  it('is the manager’s, and needs the confirmation', async () => {
    caller.mockReturnValue(coach);
    expect((await del({ athleteId: 'app', confirm: 'delete' })).status).toBe(403);
    caller.mockReturnValue(manager);
    expect((await del({ athleteId: 'app' })).status).toBe(400);
    expect(writes).toHaveLength(0);
  });

  it('deletes the card and the form’s account', async () => {
    caller.mockReturnValue(manager);
    const res = await del({ athleteId: 'app', confirm: 'delete' });
    expect(res.status).toBe(200);
    expect(db.athletes.some((a) => a.id === 'app')).toBe(false);
    expect(db.academy_candidates.some((c) => c.id === 'c-app')).toBe(false);
  });

  it('never deletes an approved club member, by athlete or by card', async () => {
    caller.mockReturnValue(manager);
    for (const body of [{ athleteId: 'plain' }, { candidateId: 'c-member' }, { athleteId: 't1' }]) {
      const res = await del({ ...body, confirm: 'delete' });
      expect(res.status).toBe(409);
    }
    expect(writes.filter((w) => w.op === 'delete')).toHaveLength(0);
    expect(db.athletes.some((a) => a.id === 'plain')).toBe(true);
  });

  it('refuses an applicant account that already has data in any of the data tables', async () => {
    caller.mockReturnValue(manager);
    for (const table of APPLICANT_DATA_TABLES) {
      db[table] = [{ athlete_id: 'app' }];
      const res = await del({ athleteId: 'app', confirm: 'delete' });
      expect(res.status, table).toBe(409);
      expect((await res.json()).code).toBe('has_data');
      db[table] = [];
    }
    expect(writes.filter((w) => w.op === 'delete')).toHaveLength(0);
  });

  it('treats an unreadable data table as data, and a missing one as empty', async () => {
    caller.mockReturnValue(manager);
    failing.shoes = { code: '57014', message: 'timeout' };
    expect((await del({ athleteId: 'app', confirm: 'delete' })).status).toBe(409);
    failing.shoes = { code: '42P01', message: 'relation "shoes" does not exist' };
    expect((await del({ athleteId: 'app', confirm: 'delete' })).status).toBe(200);
  });

  it('refuses a card that points at somebody else', async () => {
    caller.mockReturnValue(manager);
    expect((await del({ athleteId: 'app', candidateId: 'c-member', confirm: 'delete' })).status).toBe(409);
  });
});
