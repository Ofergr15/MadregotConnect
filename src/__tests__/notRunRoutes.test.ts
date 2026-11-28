// Task 151: "who hasn't run" + the bulk-message dry run (staff-only, rate-limited, audited).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { lastRunDays, notRunThisWeek, planBulkMessage, readGroupFilter, BULK_DRY_RUNS_PER_HOUR } from '@/lib/admin/not-run';
import { addDaysToDateStr, getActivityWeekStart, israelDateAnchor } from '@/lib/utils';

const G1 = '11111111-1111-4111-8111-111111111111';
const G2 = '22222222-2222-4222-8222-222222222222';
const groups = [{ id: G2, name: 'SUB 2:35' }, { id: G1, name: 'SUB 2:30' }];

describe('readGroupFilter', () => {
  it.each([[null, 'all'], ['', 'all'], ['all', 'all'], ['none', 'none'], [G1, 'group']])('%s → %s', (raw, kind) => {
    expect(readGroupFilter(raw)?.kind).toBe(kind);
  });
  it('anything else is refused', () => {
    expect(readGroupFilter('drop table')).toBeNull();
    expect(readGroupFilter(5)).toBeNull();
  });
});

describe('notRunThisWeek', () => {
  const members = [
    { id: 'a', name: 'Avi', groupId: G1 }, { id: 'b', name: 'Bat', groupId: G1 }, { id: 'c', name: 'Chen', groupId: G2 },
    { id: 'd', name: 'Dor', groupId: null }, { id: 'e', name: '', groupId: 'ghost' },
  ];
  it('lists only who has not run, per pack in lane order, no pack last', () => {
    const r = notRunThisWeek('2026-11-23', members, groups, ['a', 'c'], new Map([['b', '2026-11-20']]), { kind: 'all' });
    expect(r.groups.map((g) => [g.groupId, g.members, g.notRun, g.people.map((p) => p.id).sort()])).toEqual([
      [G1, 2, 1, ['b']],
      [G2, 1, 0, []],
      [null, 2, 2, ['d', 'e']],         // an unknown pack id counts as no pack
    ]);
    expect(r.groups[0].people[0]).toEqual({ id: 'b', name: 'Bat', groupId: G1, lastRunDate: '2026-11-20' });
    expect(r.total).toEqual({ members: 5, notRun: 3 });
  });
  it('a group filter keeps one pack; "none" keeps members with no pack', () => {
    expect(notRunThisWeek('w', members, groups, [], new Map(), { kind: 'group', id: G2 }).groups.map((g) => g.groupId)).toEqual([G2]);
    expect(notRunThisWeek('w', members, groups, [], new Map(), { kind: 'none' }).total.notRun).toBe(2);
  });
});

describe('lastRunDays / planBulkMessage', () => {
  it('latest wall-clock day per runner', () => {
    expect(lastRunDays([
      { athlete_id: 'a', start_time: '2026-11-01T06:00:00+00:00' }, { athlete_id: 'a', start_time: '2026-11-10T23:30:00+00:00' },
    ]).get('a')).toBe('2026-11-10');
  });
  it('muted wins over a device; no device is inbox only', () => {
    expect(planBulkMessage(['a', 'b', 'c'], new Set(['a', 'b']), new Set(['b']))).toEqual({ recipients: 3, push: ['a'], inboxOnly: ['c'], muted: ['b'] });
  });
});

// ── Routes on fixture tables ──────────────────────────────────────────────────
type R = { data: unknown; error: unknown; count?: number };
let tables: Record<string, R> = {};
const log: Array<{ t: string; op: string; arg?: unknown }> = [];
class Q implements PromiseLike<R> {
  private op = 'select';
  constructor(private t: string) {}
  select() { return this; } eq() { return this; } in() { return this; } gte(c: string, v: unknown) { log.push({ t: this.t, op: 'gte', arg: `${c} ${v}` }); return this; }
  lt() { return this; } or() { return this; } range() { return this; } maybeSingle() { return this; }
  insert(row: unknown) { this.op = 'insert'; log.push({ t: this.t, op: 'insert', arg: row }); return this; }
  then<A = R, B = never>(ok?: ((v: R) => A | PromiseLike<A>) | null, bad?: ((e: unknown) => B | PromiseLike<B>) | null): PromiseLike<A | B> {
    const key = this.op === 'insert' ? `${this.t}:insert` : this.t;
    return Promise.resolve(tables[key] ?? { data: [], error: null }).then(ok, bad);
  }
}
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => ({ from: (t: string) => new Q(t) }) }));
const requireStaffCaller = vi.fn();
vi.mock('@/lib/auth/self-or-staff', () => ({ requireStaffCaller: (r: Request) => requireStaffCaller(r) }));

const coach = { denied: null, caller: { athleteId: 'coach-1', email: 'c@x', role: 'coach', isStaff: true, isSuperUser: false } };
const monday = getActivityWeekStart(israelDateAnchor());

beforeEach(() => {
  log.length = 0;
  requireStaffCaller.mockReset().mockResolvedValue(coach);
  tables = {
    athletes: { data: [{ id: 'a', name: 'Avi', group_id: G1, role: 'runner', notification_prefs: null }, { id: 'b', name: 'Bat', group_id: G1, role: 'runner', notification_prefs: { coach: false } }, { id: 'c', name: 'Chen', group_id: G2, role: 'runner', notification_prefs: null }], error: null },
    groups: { data: groups, error: null },
    athlete_activities: { data: [{ athlete_id: 'c', start_time: `${monday}T06:00:00+00:00` }, { athlete_id: 'a', start_time: `${addDaysToDateStr(monday, -3)}T06:00:00+00:00` }], error: null },
    push_subscriptions: { data: [{ athlete_id: 'a' }, { athlete_id: 'b' }], error: null },
    athlete_devices: { data: [], error: null },
    staff_bulk_message_log: { data: null, error: null, count: 0 },
  };
});

const get = async (q = '') => (await import('@/app/api/admin/not-run/route')).GET(new Request(`http://x/api/admin/not-run${q}`));
const post = async (body: unknown) => (await import('@/app/api/admin/not-run/message/route')).POST(
  new Request('http://x/api/admin/not-run/message', { method: 'POST', body: JSON.stringify(body) }),
);

describe('GET /api/admin/not-run', () => {
  it('this week, with last run day, from 60 days back', async () => {
    const body = await (await get()).json();
    expect(body.weekStart).toBe(monday);
    expect(body.groups[0].people).toEqual([
      { id: 'a', name: 'Avi', groupId: G1, lastRunDate: addDaysToDateStr(monday, -3) },
      { id: 'b', name: 'Bat', groupId: G1, lastRunDate: null },
    ]);
    expect(log).toContainEqual({ t: 'athlete_activities', op: 'gte', arg: `start_time ${addDaysToDateStr(monday, -60)}T00:00:00Z` });
  });
  it('400 on a bad group, staff gate passes through', async () => {
    expect((await get('?group=x')).status).toBe(400);
    requireStaffCaller.mockResolvedValue({ denied: new Response('no', { status: 403 }), caller: {} });
    expect((await get()).status).toBe(403);
  });
  it('500 when a read fails, never "everyone ran"', async () => {
    tables.athlete_activities = { data: null, error: { message: 'timeout' } };
    expect((await get()).status).toBe(500);
  });
});

describe('POST /api/admin/not-run/message (dry run)', () => {
  it('names who would get a push and who muted it, sends nothing, writes one audit row', async () => {
    const res = await post({ text: 'יאללה לרוץ', group: G1 });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ dryRun: true, sent: 0, recipients: 2, push: [{ id: 'a', name: 'Avi' }], muted: [{ id: 'b', name: 'Bat' }], inboxOnly: [] });
    expect(body.preview.he.body).toBe('יאללה לרוץ');
    const audits = log.filter((l) => l.op === 'insert');
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ t: 'staff_bulk_message_log', arg: { action: 'not_run_dry_run', dry_run: true, group_id: G1, recipient_count: 2, push_count: 1, muted_count: 1 } });
  });
  it('refuses a real send, an empty or long text', async () => {
    expect((await post({ text: 'x', dryRun: false })).status).toBe(400);
    expect((await post({ text: '  ' })).status).toBe(400);
    expect((await post({ text: 'x'.repeat(1001) })).status).toBe(400);
  });
  it('429 at the hourly limit, before any read or audit row', async () => {
    tables.staff_bulk_message_log = { data: null, error: null, count: BULK_DRY_RUNS_PER_HOUR };
    const res = await post({ text: 'x' });
    expect(res.status).toBe(429);
    expect(log.some((l) => l.op === 'insert')).toBe(false);
  });
  it('409 without migration 325 — never an unaudited run', async () => {
    tables.staff_bulk_message_log = { data: null, error: { code: '42P01', message: 'relation "staff_bulk_message_log" does not exist' } };
    expect((await post({ text: 'x' })).status).toBe(409);
  });
  it('500 when the audit write fails', async () => {
    tables['staff_bulk_message_log:insert'] = { data: null, error: { code: '23502', message: 'null value' } };
    expect((await post({ text: 'x' })).status).toBe(500);
  });
  it('read-only while viewing as', async () => {
    requireStaffCaller.mockResolvedValue({ denied: null, caller: { ...coach.caller, viewingAsBy: 'boss' } });
    expect((await post({ text: 'x' })).status).toBe(403);
  });
});
