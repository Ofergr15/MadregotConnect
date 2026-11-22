import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryDb, uid } from './helpers/memory-db';

/** GET /api/attendance/real: the coach's presence marks (migration 197) and the roster to mark from. */

const COACH = uid();
const A = uid();
const B = uid();
const C = uid(); // active, approved, never ran or RSVP'd — must be markable
const PENDING = uid();
const GONE = uid();
const ACAD = uid();
const G1 = uid();
const G2 = uid();

let staff = true;
vi.mock('@/lib/auth/self-or-staff', () => ({
  resolveVerifiedCaller: async () => ({ denied: null, caller: { isSuperUser: false, isStaff: staff, athleteId: COACH } }),
  requireStaffCaller: async () => ({ denied: null, caller: { isSuperUser: false, isStaff: true, athleteId: COACH } }),
}));
vi.mock('@/lib/attendance/real-server', async (orig) => ({
  ...(await orig<typeof import('@/lib/attendance/real-server')>()),
  sessionsBetween: async () => [
    { date: '2026-11-24', held: true, groups: [[A]], came: [A], said: [] },
    { date: '2026-11-27', held: false, groups: [], came: [], said: [] },
  ],
}));

let db: ReturnType<typeof createMemoryDb>;
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => db.client }));

const { GET } = await import('@/app/api/attendance/real/route');
const get = () => GET(new Request('http://x/api/attendance/real?from=2026-11-22&to=2026-11-28'));
const COLS = ['id', 'athlete_id', 'week_start', 'day', 'group_label', 'present', 'marked_by', 'marked_at'];
const ATH = ['id', 'name', 'email', 'avatar_url', 'group_id', 'is_academy', 'status', 'approved'];

function seed(withPresence: boolean) {
  db = createMemoryDb({ schema: { athletes: ATH, groups: ['id', 'name'], ...(withPresence ? { practice_presence: COLS } : {}) } });
  db.tables.groups.push({ id: G1, name: 'Group 1' }, { id: G2, name: 'Group 2' });
  const a = (id: string, name: string, group_id: string | null, extra: Record<string, unknown> = {}) =>
    ({ id, name, email: `${name}@x.test`, avatar_url: null, group_id, is_academy: false, status: 'active', approved: true, ...extra });
  db.tables.athletes.push(
    a(A, 'A', G1), a(B, 'B', G2), a(C, 'C', G1), a(COACH, 'Coach', null),
    a(PENDING, 'Pending', G1, { approved: false }),
    a(GONE, 'Gone', G1, { status: 'inactive' }),
    a(ACAD, 'Acad', G2, { is_academy: true }),
  );
  if (withPresence) db.tables.practice_presence.push(
    { id: uid(), athlete_id: A, week_start: '2026-11-22', day: 2, group_label: '1', present: true, marked_by: COACH, marked_at: '2026-11-24T06:00:00Z' },
    { id: uid(), athlete_id: B, week_start: '2026-11-22', day: 2, group_label: '2', present: false, marked_by: COACH, marked_at: '2026-11-24T06:01:00Z' },
    // Previous week: not in range.
    { id: uid(), athlete_id: A, week_start: '2026-11-15', day: 2, group_label: '1', present: true, marked_by: COACH, marked_at: '2026-11-17T06:00:00Z' },
  );
}

beforeEach(() => { staff = true; seed(true); });

describe('GET /api/attendance/real — presence and roster', () => {
  it('each session carries presence {athleteId: boolean} and who marked it', async () => {
    const r = await get();
    expect(r.status).toBe(200);
    const { days, people } = await r.json();
    expect(days[0].presence).toEqual({ [A]: true, [B]: false });
    expect(days[0].presenceMarks).toEqual({
      [A]: { markedBy: COACH, markedAt: '2026-11-24T06:00:00Z', groupLabel: '1' },
      [B]: { markedBy: COACH, markedAt: '2026-11-24T06:01:00Z', groupLabel: '2' },
    });
    expect(days[1].presence).toEqual({});
    expect(Object.keys(people)).toEqual(expect.arrayContaining([A, B]));
  });

  it('each session carries the active, approved roster by pack: id + name only', async () => {
    const { days } = await (await get()).json();
    for (const d of days) {
      expect(d.roster).toEqual({
        1: [{ id: A, name: 'A' }, { id: C, name: 'C' }],
        2: [{ id: B, name: 'B' }],
        3: [],
        academy: [{ id: ACAD, name: 'Acad' }],
      });
    }
    const json = JSON.stringify(days);
    expect(json).not.toContain('@x.test');
    expect(json).not.toContain(PENDING);
    expect(json).not.toContain(GONE);
  });

  it('table missing: presence is null, roster still there, not a 500', async () => {
    seed(false);
    const r = await get();
    expect(r.status).toBe(200);
    const { days } = await r.json();
    expect(days[0].presence).toBeNull();
    expect(days[0].presenceMarks).toBeNull();
    expect(days[0].roster[1]).toHaveLength(2);
  });

  it('an unmarked athlete drops out of presence and presenceMarks', async () => {
    const { PUT } = await import('@/app/api/attendance/presence/route');
    const r = await PUT(new Request('http://x/api/attendance/presence', { method: 'PUT', body: JSON.stringify({ athleteId: B, weekStart: '2026-11-22', day: 2, present: null }) }));
    expect(r.status).toBe(200);
    const s = (await (await get()).json()).days[0];
    expect(s.presence).toEqual({ [A]: true });
    expect(Object.keys(s.presenceMarks)).toEqual([A]);
  });

  it('non-staff still gets 403', async () => {
    staff = false;
    expect((await get()).status).toBe(403);
  });
});
