import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { autoMarks, buildRows, editableUntil, isEditable, parseMarks } from '@/lib/packs/attendance';
import { makeFakeDb, session, type Op } from './helpers/packsFakeDb';

/**
 * b23 pack attendance (migration 216). Pinned: the edit window closes at 12:00 Israel the next
 * day (DST-aware) and the POST refuses after it; the watch auto-marks a run within ±90 min of
 * the session start reading start_time as UTC-shaped local time; a leader's mark beats the watch.
 */

const requireSession = vi.fn();
vi.mock('@/lib/auth-session', () => ({
  requireSession: (req: Request) => requireSession(req),
  authError: (r: { status: number; error: string }) => new Response(JSON.stringify({ error: r.error }), { status: r.status }),
}));
vi.mock('@/lib/maintenance', () => ({ readMaintenance: async () => null, maintenanceBlocks: () => false }));
let tables: Record<string, (op: Op) => unknown[]> = {};
const writes: Op[] = [];
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => makeFakeDb(tables, writes) }));
const route = await import('@/app/api/packs/[id]/attendance/route');

describe('edit window', () => {
  it('is 12:00 Israel the next day — winter (UTC+2)', () => {
    expect(editableUntil('2026-11-24')).toBe('2026-11-25T10:00:00.000Z');
  });
  it('is 12:00 Israel the next day — summer (UTC+3)', () => {
    expect(editableUntil('2026-07-07')).toBe('2026-07-08T09:00:00.000Z');
  });
  it('closes exactly then', () => {
    expect(isEditable('2026-11-24', new Date('2026-11-25T09:59:59Z'))).toBe(true);
    expect(isEditable('2026-11-24', new Date('2026-11-25T10:00:01Z'))).toBe(false);
  });
});

describe('auto-marking from the watch', () => {
  const at = (t: string, id = 'a') => ({ athleteId: id, startTime: t, distanceM: 12_400 });
  it('marks a run within ±90 min of a 05:30 start, by the wall clock in start_time', () => {
    const m = autoMarks('2026-11-24', 330, [at('2026-11-24T05:42:00+00:00'), at('2026-11-24T07:01:00+00:00', 'b'), at('2026-11-24T07:00:00+00:00', 'c')]);
    expect(m.get('a')).toBe('05:42 · 12.4 ק״מ');
    expect(m.has('b')).toBe(false); // 91 min
    expect(m.has('c')).toBe(true); // exactly 90
  });
  it('ignores another day, even when it is near in real time', () => {
    expect(autoMarks('2026-11-24', 330, [at('2026-11-23T23:30:00+00:00')]).size).toBe(0);
  });
  it('without a start time uses the club morning (04:00–09:00)', () => {
    const m = autoMarks('2026-11-24', null, [at('2026-11-24T06:00:00Z'), at('2026-11-24T18:00:00Z', 'b')]);
    expect([...m.keys()]).toEqual(['a']);
  });
  it('a leader mark beats the watch', () => {
    const rows = buildRows(
      [{ athleteId: 'a', name: 'A', avatarUrl: null }, { athleteId: 'b', name: 'B', avatarUrl: null }, { athleteId: 'c', name: 'C', avatarUrl: null }],
      [{ athleteId: 'a', status: 'absent', source: 'leader', watchNote: null }],
      new Map([['a', '05:40'], ['b', '05:50']]),
    );
    expect(rows.map((r) => [r.status, r.source])).toEqual([['absent', 'leader'], ['present', 'watch'], [null, null]]);
  });
  it('rejects marks for non-members', () => {
    expect(parseMarks([{ athleteId: 'x', status: 'present' }], new Set(['a']))).toBeNull();
    expect(parseMarks([{ athleteId: 'a', status: 'present' }], new Set(['a']))).toHaveLength(1);
  });
});

describe('POST /api/packs/:id/attendance', () => {
  const post = (body: unknown) => route.POST(
    new Request('https://x.test/api/packs/p/attendance', { method: 'POST', body: JSON.stringify(body), headers: { authorization: 'Bearer t' } }),
    { params: Promise.resolve({ id: 'p' }) },
  );
  beforeEach(() => {
    writes.length = 0;
    requireSession.mockResolvedValue(session({ athleteId: 'leader-1' }));
    tables = {
      pack_leaders: () => [{ pack_id: 'p' }],
      groups: () => [{ id: 'p', name: 'Group 1' }],
      athletes: () => [{ id: 'm1', name: 'M', avatar_url: null, last_seen_at: null, status: 'active' }],
    };
  });
  afterEach(() => vi.useRealTimers());

  it('is refused after the window, writing nothing', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-25T10:05:00Z'));
    const res = await post({ date: '2026-11-24', marks: [{ athleteId: 'm1', status: 'present' }] });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('locked');
    expect(writes).toHaveLength(0);
  });
  it('is accepted inside the window as a leader mark', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-25T09:00:00Z'));
    const res = await post({ date: '2026-11-24', marks: [{ athleteId: 'm1', status: 'present' }] });
    expect(res.status).toBe(200);
    const up = writes.find((w) => w.table === 'pack_attendance')!;
    const rows = up.calls.find(([m]) => m === 'upsert')![1][0] as Array<Record<string, unknown>>;
    expect(rows[0]).toEqual(expect.objectContaining({ athlete_id: 'm1', status: 'present', source: 'leader' }));
  });
});
