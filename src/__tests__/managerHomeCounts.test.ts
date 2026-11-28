// Task 150: the manager home's "מחכה לך עכשיו" and "השבוע לפי קבוצה" blocks, on fixtures.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { waitingCounts, weekByGroup } from '@/lib/admin/manager-week';
import { addDaysToDateStr, getActivityWeekStart, israelDateAnchor } from '@/lib/utils';

const NOW = '2026-11-28T10:00:00.000Z';
const hoursAgo = (h: number) => new Date(Date.parse(NOW) - h * 3_600_000).toISOString();

describe('waitingCounts', () => {
  const fb = (id: string, athleteId: string, h: number, o: Record<string, unknown> = {}) => ({
    id, athleteId, createdAt: hoursAgo(h), pain: true, wantsFeedback: false, comment: null, coachReplyAt: null, messages: [], ...o,
  });

  it('counts runners with waiting pain once, skips answered pain, oldest in days', () => {
    const c = waitingCounts(
      [fb('f1', 'a', 50), fb('f2', 'a', 2), fb('f3', 'b', 1), fb('f4', 'c', 80, { coachReplyAt: hoursAgo(70) })],
      [],
      [],
      NOW,
    );
    expect(c.pain).toBe(2);
    expect(c.oldestDays.pain).toBe(2);
  });

  it('a request whose person is already approved is not waiting', () => {
    const c = waitingCounts([], [
      { id: 'r1', createdAt: hoursAgo(30), athleteId: 'x', fullName: 'X', approved: true },
      { id: 'r2', createdAt: hoursAgo(73), athleteId: null, fullName: 'Y', approved: false },
    ], [{ id: 'o1', createdAt: hoursAgo(24 * 5) }], NOW);
    expect(c).toMatchObject({ join: 1, unpaid: 1, total: 2, oldestDays: { join: 3, unpaid: 5 } });
  });

  it('all zero when nothing waits', () => {
    expect(waitingCounts([], [], [], NOW)).toEqual({ join: 0, pain: 0, unpaid: 0, total: 0, oldestDays: { join: 0, pain: 0, unpaid: 0 } });
  });
});

describe('weekByGroup', () => {
  const groups = [{ id: 'g3', name: 'SUB 2:45' }, { id: 'g1', name: 'SUB 2:30' }, { id: 'g2', name: 'SUB 2:35' }, { id: 'gx', name: 'Trail' }];

  it('ran / not yet per pack, in lane order, no pack last, empty packs kept', () => {
    const w = weekByGroup('2026-11-23', [
      { id: 'a', groupId: 'g1' }, { id: 'b', groupId: 'g1' }, { id: 'c', groupId: 'g3' }, { id: 'd', groupId: null }, { id: 'e', groupId: 'gone' },
    ], groups, ['a', 'c', 'c', 'staff-1']);
    expect(w.groups.map((g) => [g.groupId, g.lane, g.members, g.ran, g.notYet])).toEqual([
      ['g1', 1, 2, 1, 1],
      ['g2', 2, 0, 0, 0],
      ['g3', 3, 1, 1, 0],
      ['gx', null, 0, 0, 0],
      [null, null, 2, 0, 2],          // no pack and an unknown pack id
    ]);
    expect(w.totals).toEqual({ members: 5, ran: 2, notYet: 3 });
  });

  it('no "no pack" row when everyone has one', () => {
    const w = weekByGroup('2026-11-23', [{ id: 'a', groupId: 'g1' }], groups, []);
    expect(w.groups.some((g) => g.groupId === null)).toBe(false);
  });
});

// ── The route, on fixture tables ──────────────────────────────────────────────
type R = { data: unknown; error: unknown };
let tables: Record<string, R> = {};
const filters: Record<string, string[]> = {};
class Q implements PromiseLike<R> {
  constructor(private t: string) { filters[t] = []; }
  private f(s: string) { filters[this.t].push(s); return this; }
  select() { return this; } eq(c: string, v: unknown) { return this.f(`eq ${c} ${v}`); } in() { return this; }
  gte(c: string, v: unknown) { return this.f(`gte ${c} ${v}`); } lt(c: string, v: unknown) { return this.f(`lt ${c} ${v}`); }
  neq() { return this; } or(s: string) { return this.f(`or ${s}`); } range() { return this; } order() { return this; }
  then<A = R, B = never>(ok?: ((v: R) => A | PromiseLike<A>) | null, bad?: ((e: unknown) => B | PromiseLike<B>) | null): PromiseLike<A | B> {
    return Promise.resolve(tables[this.t] ?? { data: [], error: null }).then(ok, bad);
  }
}
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => ({ from: (t: string) => new Q(t) }) }));
const resolveVerifiedCaller = vi.fn();
vi.mock('@/lib/auth/self-or-staff', () => ({ resolveVerifiedCaller: (r: Request) => resolveVerifiedCaller(r) }));
vi.mock('@/lib/academy/staff-scope', () => ({ staffAthleteScope: async () => null, inScope: <T,>(rows: T[]) => rows }));

const admin = { denied: null, caller: { athleteId: 'm1', role: 'admin', roles: ['admin'], isSuperUser: false, isStaff: true } };
const academyManager = { denied: null, caller: { athleteId: 'm2', role: 'academy_manager', roles: ['academy_manager'], isSuperUser: false, isStaff: true } };
const call = async () => {
  const { GET } = await import('@/app/api/admin/manager-home/route');
  return GET(new Request('http://x/api/admin/manager-home'));
};

beforeEach(() => {
  tables = {
    workout_feedback: { data: [{ id: 'f1', athlete_id: 'a', created_at: new Date(Date.now() - 6 * 3_600_000).toISOString(), pain: true, wants_feedback: false, comment: null, coach_reply_at: null }], error: null },
    signup_requests: { data: [{ id: 'r1', created_at: new Date().toISOString(), athlete_id: null, full_name: 'New Person' }], error: null },
    athletes: { data: [{ id: 'a', group_id: 'g1', name: 'A', approved: true }, { id: 'b', group_id: 'g1', name: 'B', approved: true }], error: null },
    groups: { data: [{ id: 'g1', name: 'SUB 2:30' }], error: null },
    store_orders: { data: [{ id: 'o1', created_at: new Date().toISOString() }], error: null },
    athlete_activities: { data: [{ athlete_id: 'b' }], error: null },
  };
  for (const k of Object.keys(filters)) delete filters[k];
  resolveVerifiedCaller.mockReset();
});

describe('GET /api/admin/manager-home — waiting + week', () => {
  it('returns both blocks with counts for an admin', async () => {
    resolveVerifiedCaller.mockResolvedValue(admin);
    const res = await call();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.waiting).toMatchObject({ join: 1, pain: 1, unpaid: 1, total: 3 });
    expect(body.week.groups[0]).toMatchObject({ groupId: 'g1', members: 2, ran: 1, notYet: 1 });
    expect(body.urgent).toHaveLength(1);              // pain ≥ 4 h is also urgent; the 0-hour request is not
  });

  it('reads this activity week (Monday) and runs only', async () => {
    resolveVerifiedCaller.mockResolvedValue(admin);
    await call();
    const monday = getActivityWeekStart(israelDateAnchor());
    expect(filters.athlete_activities).toEqual(expect.arrayContaining([
      `gte start_time ${monday}T00:00:00Z`, `lt start_time ${addDaysToDateStr(monday, 7)}T00:00:00Z`,
      expect.stringMatching(/^or activity_type\.is\.null/),
    ]));
  });

  it('an academy manager gets no money: unpaid is null and store_orders is not read', async () => {
    resolveVerifiedCaller.mockResolvedValue(academyManager);
    const body = await (await call()).json();
    expect(body.waiting).toMatchObject({ join: 1, pain: 1, unpaid: null, total: 2 });
    expect(filters.store_orders).toBeUndefined();
  });

  it('a coach is refused', async () => {
    resolveVerifiedCaller.mockResolvedValue({ denied: null, caller: { athleteId: 'c', role: 'coach', roles: ['coach'], isSuperUser: false, isStaff: true } });
    expect((await call()).status).toBe(403);
  });

  it.each(['athletes', 'groups', 'store_orders', 'athlete_activities'])('500 when %s fails — never an empty "nobody"', async (t) => {
    resolveVerifiedCaller.mockResolvedValue(admin);
    tables[t] = { data: null, error: { code: '57014', message: 'timeout' } };
    expect((await call()).status).toBe(500);
  });
});
