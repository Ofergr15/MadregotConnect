import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryDb, uid } from './helpers/memory-db';

/** PUT /api/attendance/presence — coach marks present/absent (migration 197). */

const COACH = uid();
const RUNNER = uid();
const A = uid();
const B = uid();

let caller: { isSuperUser: boolean; isStaff: boolean; athleteId: string | null } = { isSuperUser: false, isStaff: true, athleteId: COACH };
vi.mock('@/lib/auth/self-or-staff', async () => {
  const { NextResponse } = await import('next/server');
  return {
    requireStaffCaller: async () =>
      caller.isStaff || caller.isSuperUser
        ? { denied: null, caller }
        : { denied: NextResponse.json({ error: 'Staff access required' }, { status: 403 }), caller },
  };
});

let db: ReturnType<typeof createMemoryDb>;
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => db.client }));

const { PUT } = await import('@/app/api/attendance/presence/route');
const put = (body: unknown) => PUT(new Request('http://x/api/attendance/presence', { method: 'PUT', body: JSON.stringify(body) }));

const COLS = ['id', 'athlete_id', 'week_start', 'day', 'group_label', 'present', 'marked_by', 'marked_at'];
const SUNDAY = '2026-11-22';

beforeEach(() => {
  caller = { isSuperUser: false, isStaff: true, athleteId: COACH };
  db = createMemoryDb({ schema: { practice_presence: COLS } });
});

describe('PUT /api/attendance/presence', () => {
  it('non-staff gets 403 and nothing is written', async () => {
    caller = { isSuperUser: false, isStaff: false, athleteId: RUNNER };
    const r = await put({ athleteId: A, weekStart: SUNDAY, day: 2, present: true });
    expect(r.status).toBe(403);
    expect(db.tables.practice_presence).toHaveLength(0);
  });

  it('marked_by comes from the token, not the body', async () => {
    const r = await put({ athleteId: A, weekStart: SUNDAY, day: 2, present: true, markedBy: RUNNER, marked_by: RUNNER, groupLabel: '1' });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, saved: 1, cleared: 0 });
    expect(db.tables.practice_presence).toHaveLength(1);
    expect(db.tables.practice_presence[0]).toMatchObject({ athlete_id: A, week_start: SUNDAY, day: 2, present: true, marked_by: COACH, group_label: '1' });
  });

  it.each([
    [{ athleteId: A, weekStart: '2026-11-23', day: 2, present: true }], // Monday
    [{ athleteId: A, weekStart: '2026-11-2', day: 2, present: true }],
    [{ athleteId: A, weekStart: SUNDAY, day: 7, present: true }],
    [{ athleteId: A, weekStart: SUNDAY, day: -1, present: true }],
    [{ athleteId: A, weekStart: SUNDAY, day: 1.5, present: true }],
    [{ athleteId: A, weekStart: SUNDAY, day: 2, present: 'yes' }],
    [{ athleteId: 'not-a-uuid', weekStart: SUNDAY, day: 2, present: true }],
    [{ weekStart: SUNDAY, day: 2, marks: [] }],
    [{ weekStart: SUNDAY, day: 2, marks: [{ athleteId: A, present: 1 }] }],
    [{ weekStart: SUNDAY, day: 2, marks: [{ athleteId: A }] }], // missing present is not an unmark
    [{ athleteId: 'not-a-uuid', weekStart: SUNDAY, day: 2, present: null }],
    [{ athleteId: A, weekStart: '2026-11-23', day: 2, present: null }],
    [{ weekStart: SUNDAY, day: 2, marks: Array.from({ length: 201 }, () => ({ athleteId: uid(), present: true })) }],
  ])('bad input returns 400: %j', async (body) => {
    const r = await put(body);
    expect(r.status).toBe(400);
    expect(db.tables.practice_presence).toHaveLength(0);
  });

  it('bulk "mark all" upserts every mark', async () => {
    const r = await put({ weekStart: SUNDAY, day: 5, groupLabel: '2', marks: [{ athleteId: A, present: true, groupLabel: '1' }, { athleteId: B, present: false }], markedBy: RUNNER });
    expect(await r.json()).toEqual({ ok: true, saved: 2, cleared: 0 });
    const rows = db.tables.practice_presence;
    expect(rows).toHaveLength(2);
    expect(rows.every((x) => x.marked_by === COACH && x.day === 5)).toBe(true);
    // Per-mark groupLabel wins; the top-level one is the default.
    expect(rows.find((x) => x.athlete_id === A)!.group_label).toBe('1');
    expect(rows.find((x) => x.athlete_id === B)!.group_label).toBe('2');
    expect(rows.find((x) => x.athlete_id === B)!.present).toBe(false);
  });

  it('re-marking updates the row instead of duplicating', async () => {
    await put({ athleteId: A, weekStart: SUNDAY, day: 2, present: true });
    await put({ weekStart: SUNDAY, day: 2, marks: [{ athleteId: A, present: false }] });
    expect(db.tables.practice_presence).toHaveLength(1);
    expect(db.tables.practice_presence[0].present).toBe(false);
  });

  it('missing table returns 503', async () => {
    db = createMemoryDb({ schema: {} });
    const r = await put({ athleteId: A, weekStart: SUNDAY, day: 2, present: true });
    expect(r.status).toBe(503);
    expect(await r.json()).toEqual({ error: 'presence table missing — migration 197 not applied' });
  });
  describe('unmark (present: null)', () => {
    const row = (athlete_id: string, day = 2, week_start = SUNDAY) =>
      ({ id: uid(), athlete_id, week_start, day, group_label: '1', present: true, marked_by: COACH, marked_at: '2026-11-24T06:00:00Z' });

    it('deletes only that (athlete, week, day) row', async () => {
      db.tables.practice_presence.push(row(A), row(A, 3), row(B), row(A, 2, '2026-11-15'));
      const r = await put({ athleteId: A, weekStart: SUNDAY, day: 2, present: null });
      expect(r.status).toBe(200);
      expect(await r.json()).toEqual({ ok: true, saved: 0, cleared: 1 });
      const left = db.tables.practice_presence.map((x) => `${x.athlete_id === A ? 'A' : 'B'}:${x.week_start}:${x.day}`).sort();
      expect(left).toEqual([`A:2026-11-15:2`, `A:${SUNDAY}:3`, `B:${SUNDAY}:2`]);
    });

    it('non-staff gets 403 and nothing is deleted', async () => {
      db.tables.practice_presence.push(row(A));
      caller = { isSuperUser: false, isStaff: false, athleteId: RUNNER };
      const r = await put({ athleteId: A, weekStart: SUNDAY, day: 2, present: null });
      expect(r.status).toBe(403);
      expect(db.tables.practice_presence).toHaveLength(1);
    });

    it('bulk mixes mark and unmark', async () => {
      db.tables.practice_presence.push(row(B));
      const r = await put({ weekStart: SUNDAY, day: 2, marks: [{ athleteId: A, present: false }, { athleteId: B, present: null }] });
      expect(await r.json()).toEqual({ ok: true, saved: 1, cleared: 1 });
      expect(db.tables.practice_presence).toHaveLength(1);
      expect(db.tables.practice_presence[0]).toMatchObject({ athlete_id: A, present: false, marked_by: COACH });
    });

    it('is idempotent on a missing row', async () => {
      const r1 = await put({ athleteId: A, weekStart: SUNDAY, day: 2, present: null });
      const r2 = await put({ athleteId: A, weekStart: SUNDAY, day: 2, present: null });
      expect(r1.status).toBe(200);
      expect(await r2.json()).toEqual({ ok: true, saved: 0, cleared: 1 });
      expect(db.tables.practice_presence).toHaveLength(0);
    });

    it('missing table returns 503', async () => {
      db = createMemoryDb({ schema: {} });
      const r = await put({ athleteId: A, weekStart: SUNDAY, day: 2, present: null });
      expect(r.status).toBe(503);
    });
  });
});
