// Task 185: staff moderation API — list (keyset), dismiss / resolve / hide on the target, audited.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { cursorOf, isHideable, parseAction, parseCursor } from '@/lib/moderation/actions';

const resolveVerifiedCaller = vi.fn();
// requireStaffCaller wraps resolveVerifiedCaller inside its own module, so it is rebuilt here over the mock.
vi.mock('@/lib/auth/self-or-staff', async (o) => ({
  ...(await o<object>()),
  requireStaffCaller: async (r: Request) => {
    const { denied, caller } = await resolveVerifiedCaller(r);
    if (denied) return { denied, caller };
    if (!caller.isStaff && !caller.isSuperUser) return { denied: new Response(null, { status: 403 }), caller };
    return { denied: null, caller };
  },
}));
const deleteMessage = vi.fn(async () => ({}));
vi.mock('@/lib/stream/server', () => ({ getStreamServerClient: () => ({ deleteMessage: (...a: unknown[]) => deleteMessage(...(a as [])) }) }));

// A tiny in-memory PostgREST: enough of select/update/insert/eq/in/is/or/order/limit for these routes.
type Row = Record<string, unknown>;
let tables: Record<string, Row[]>;
let missing = new Set<string>();
const calls: Array<{ table: string; op: string; filters: string[] }> = [];
function q(table: string) {
  let op = 'select'; let patch: Row | null = null; let lim = Infinity;
  const preds: Array<(r: Row) => boolean> = []; const filters: string[] = [];
  const run = () => {
    calls.push({ table, op, filters });
    if (missing.has(table)) return { data: null, error: { code: '42P01', message: `relation "${table}" does not exist` } };
    const rows = (tables[table] ??= []);
    const hit = rows.filter((r) => preds.every((p) => p(r)));
    if (op === 'update') { hit.forEach((r) => Object.assign(r, patch)); return { data: hit.map((r) => ({ id: r.id })), error: null }; }
    const sorted = [...hit].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)) || String(b.id).localeCompare(String(a.id)));
    return { data: sorted.slice(0, lim), error: null };
  };
  const b: Record<string, unknown> = {
    select: () => b,
    update: (p: Row) => { op = 'update'; patch = p; return b; },
    insert: async (row: Row) => {
      calls.push({ table, op: 'insert', filters: [] });
      if (missing.has(table)) return { error: { code: '42P01', message: 'missing' } };
      (tables[table] ??= []).push(row); return { error: null };
    },
    eq: (c: string, v: unknown) => { filters.push(`${c}=${v}`); preds.push((r) => r[c] === v); return b; },
    is: (c: string, v: unknown) => { preds.push((r) => (r[c] ?? null) === v); return b; },
    in: (c: string, vs: unknown[]) => { preds.push((r) => vs.includes(r[c])); return b; },
    or: (s: string) => {
      filters.push(`or:${s}`);
      const m = /created_at\.lt\.([^,]+),and\(created_at\.eq\.[^,]+,id\.lt\.([^)]+)\)/.exec(s)!;
      preds.push((r) => String(r.created_at) < m[1] || (r.created_at === m[1] && String(r.id) < m[2]));
      return b;
    },
    order: () => b,
    limit: (n: number) => { lim = n; return Promise.resolve(run()); },
    maybeSingle: async () => { const r = run(); return { data: r.data?.[0] ?? null, error: r.error }; },
    then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(run()).then(res, rej),
  };
  return b;
}
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => ({ from: (t: string) => q(t) }) }));

const reports = await import('@/app/api/moderation/reports/route');
const actions = await import('@/app/api/moderation/actions/route');
const as = (c: object) => resolveVerifiedCaller.mockResolvedValue({ denied: null, caller: { athleteId: 'coach-1', isStaff: true, isSuperUser: false, ...c } });
const list = (qs = '') => reports.GET(new Request(`http://x/api/moderation/reports?${qs}`));
const act = (body: unknown) => reports.POST(new Request('http://x/api/moderation/reports', { method: 'POST', body: JSON.stringify(body) }));

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const T = (m: number) => `2026-11-28T10:${String(m).padStart(2, '0')}:00.000Z`;
const rep = (n: number, target: string, type = 'feed_item', status = 'open') =>
  ({ id: U(n), reporter_athlete_id: U(100 + n), target_type: type, target_id: target, reason: 'spam', status, created_at: T(n) });

beforeEach(() => {
  tables = {
    content_reports: [rep(1, 'post-a'), rep(2, 'post-a'), rep(3, 'c-1', 'comment'), rep(4, 'msg-9', 'group_chat_message'), rep(5, 'drive-x', 'photo'), rep(6, 'post-a', 'feed_item', 'dismissed')],
    feed_items: [{ id: 'post-a', deleted_at: null }],
    feed_comments: [{ id: 'c-1', deleted_at: null }],
    moderation_actions: [],
  };
  missing = new Set();
  calls.length = 0;
  deleteMessage.mockReset().mockResolvedValue({});
  as({});
});

describe('rules', () => {
  it('parseAction', () => {
    expect(parseAction({ reportId: U(1), action: 'hide', note: '  spam bot ' })).toEqual({ ok: true, value: { reportId: U(1), action: 'hide', note: 'spam bot' } });
    expect(parseAction({ reportId: 'x', action: 'hide' }).ok).toBe(false);
    expect(parseAction({ reportId: U(1), action: 'ban' }).ok).toBe(false);
    expect(parseAction({ reportId: U(1), action: 'dismiss', note: 'x'.repeat(501) }).ok).toBe(false);
  });
  it('cursor round-trips; junk is null', () => {
    const c = cursorOf({ created_at: T(3), id: U(3) });
    expect(parseCursor(c)).toEqual({ at: T(3), id: U(3) });
    expect(parseCursor('2026-11-28|nope')).toBeNull();
    expect(parseCursor("x'),id.gt.0")).toBeNull();
  });
  it('hideable targets', () => {
    expect(['feed_item', 'comment', 'run_chat_message', 'academy_message', 'group_chat_message'].every(isHideable)).toBe(true);
    expect(isHideable('photo')).toBe(false);
  });
});

describe('GET /api/moderation/reports', () => {
  it('staff only', async () => {
    as({ isStaff: false });
    expect((await list()).status).toBe(403);
  });
  it('open reports newest first, keyset-paged, with reports-per-target and hideable', async () => {
    const a = await (await list('limit=2')).json();
    expect(a.reports.map((r: { id: string }) => r.id)).toEqual([U(5), U(4)]);
    expect(a.reports[0]).toMatchObject({ hideable: false, reportsOnTarget: 1 });
    const b = await (await list(`limit=2&cursor=${encodeURIComponent(a.nextCursor)}`)).json();
    expect(b.reports.map((r: { id: string }) => r.id)).toEqual([U(3), U(2)]);
    expect(b.reports[1].reportsOnTarget).toBe(3);
    const c = await (await list(`limit=2&cursor=${encodeURIComponent(b.nextCursor)}`)).json();
    expect(c).toMatchObject({ reports: [{ id: U(1) }], nextCursor: null });
  });
  it('bad status / cursor → 400; 203 unapplied → 503', async () => {
    expect((await list('status=all')).status).toBe(400);
    expect((await list('cursor=zzz')).status).toBe(400);
    missing.add('content_reports');
    expect((await list()).status).toBe(503);
  });
});

describe('POST /api/moderation/reports', () => {
  it('hide a post: soft-deleted, every open report on it closed as actioned, one audit row', async () => {
    const res = await act({ reportId: U(1), action: 'hide', note: 'spam' });
    expect(await res.json()).toEqual({ ok: true, action: 'hide', outcome: 'hidden', reportsClosed: 2 });
    expect(tables.feed_items[0].deleted_at).toBeTruthy();
    expect(tables.content_reports.filter((r) => r.target_id === 'post-a').map((r) => r.status)).toEqual(['actioned', 'actioned', 'dismissed']);
    expect(tables.content_reports[0]).toMatchObject({ handled_by: 'coach-1' });
    expect(tables.moderation_actions).toEqual([{
      report_id: U(1), target_type: 'feed_item', target_id: 'post-a', action: 'hide', outcome: 'hidden',
      actor_athlete_id: 'coach-1', note: 'spam', reports_closed: 2,
    }]);
  });
  it('hiding twice keeps the first deleted_at and closes nothing more', async () => {
    await act({ reportId: U(1), action: 'hide' });
    const first = tables.feed_items[0].deleted_at;
    const again = await (await act({ reportId: U(2), action: 'hide' })).json();
    expect(again).toMatchObject({ outcome: 'hidden', reportsClosed: 0 });
    expect(tables.feed_items[0].deleted_at).toBe(first);
  });
  it('hide a comment, and a chat message through Stream', async () => {
    await act({ reportId: U(3), action: 'hide' });
    expect(tables.feed_comments[0].deleted_at).toBeTruthy();
    expect(await (await act({ reportId: U(4), action: 'hide' })).json()).toMatchObject({ outcome: 'hidden', reportsClosed: 1 });
    expect(deleteMessage).toHaveBeenCalledWith('msg-9');
  });
  it('a vanished target still closes its reports (outcome missing); a photo is 422 and changes nothing', async () => {
    tables.feed_items = [];
    expect(await (await act({ reportId: U(1), action: 'hide' })).json()).toMatchObject({ outcome: 'missing', reportsClosed: 2 });
    const res = await act({ reportId: U(5), action: 'hide' });
    expect(res.status).toBe(422);
    expect(tables.content_reports.find((r) => r.id === U(5))!.status).toBe('open');
  });
  it('dismiss and resolve close the target without hiding it', async () => {
    expect(await (await act({ reportId: U(2), action: 'dismiss' })).json()).toMatchObject({ outcome: 'dismissed', reportsClosed: 2 });
    expect(tables.feed_items[0].deleted_at).toBeNull();
    expect(await (await act({ reportId: U(3), action: 'resolve' })).json()).toMatchObject({ outcome: 'actioned', reportsClosed: 1 });
    expect(tables.feed_comments[0].deleted_at).toBeNull();
    expect(tables.moderation_actions.map((a) => a.action)).toEqual(['dismiss', 'resolve']);
  });
  it('members 403, view-as 403, bad body 400, unknown report 404', async () => {
    as({ isStaff: false });
    expect((await act({ reportId: U(1), action: 'hide' })).status).toBe(403);
    as({ viewingAsBy: 'admin' });
    expect((await act({ reportId: U(1), action: 'hide' })).status).toBe(403);
    as({});
    expect((await act({ action: 'hide' })).status).toBe(400);
    expect((await act({ reportId: U(77), action: 'hide' })).status).toBe(404);
    expect(tables.feed_items[0].deleted_at).toBeNull();
  });
  it('348 unapplied: the decision stands, audit skipped', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    missing.add('moderation_actions');
    expect((await act({ reportId: U(2), action: 'dismiss' })).status).toBe(200);
  });
});

describe('GET /api/moderation/actions', () => {
  it('the audit trail, per target, staff only; unmigrated → empty', async () => {
    await act({ reportId: U(1), action: 'hide' });
    tables.moderation_actions[0] = { ...tables.moderation_actions[0], id: U(900), created_at: T(30) };
    const body = await (await actions.GET(new Request('http://x/api/moderation/actions?targetType=feed_item&targetId=post-a'))).json();
    expect(body.actions).toHaveLength(1);
    expect((await actions.GET(new Request('http://x/api/moderation/actions?targetType=feed_item'))).status).toBe(400);
    as({ isStaff: false });
    expect((await actions.GET(new Request('http://x/api/moderation/actions'))).status).toBe(403);
    as({});
    missing.add('moderation_actions');
    expect(await (await actions.GET(new Request('http://x/api/moderation/actions'))).json()).toMatchObject({ actions: [], migrated: false });
  });
});

describe('migration 348', () => {
  it('idempotent, service-role only', () => {
    const sql = readFileSync('supabase/migrations/348_moderation_actions.sql', 'utf8');
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS moderation_actions/);
    expect(sql).toMatch(/REVOKE ALL ON TABLE moderation_actions FROM anon, authenticated/);
    expect(sql).not.toMatch(/CREATE INDEX (?!IF NOT EXISTS)/);
  });
});
