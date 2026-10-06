import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';

/**
 * POST /api/academy/dispatch/resend — "לשלוח שוב" for one trainee and one week.
 *
 * What only the route can get wrong: WHO may press it (the manager or the trainee's own
 * coach — `requireTraineeAccess`), WHAT is pushed (the trainee's own saved plan, never a
 * body the caller wrote), and pace alarms (never granted by a resend that cannot price them).
 */

type Row = Record<string, unknown>;
const db: Record<string, Row[]> = { athletes: [], weekly_plans: [] };

class Query implements PromiseLike<{ data: unknown; error: unknown }> {
  private filters: Array<(r: Row) => boolean> = [];
  private single = false;
  private desc: string | null = null;
  constructor(private table: string) {}
  select() { return this; }
  eq(c: string, v: unknown) { this.filters.push(r => r[c] === v); return this; }
  in(c: string, v: unknown[]) { this.filters.push(r => v.includes(r[c])); return this; }
  order(c: string, o?: { ascending?: boolean }) { if (o?.ascending === false) this.desc = c; return this; }
  limit() { return this; }
  maybeSingle() { this.single = true; return this; }
  then<R1 = { data: unknown; error: unknown }, R2 = never>(
    ok?: ((v: { data: unknown; error: unknown }) => R1 | PromiseLike<R1>) | null,
    bad?: ((e: unknown) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    let rows = (db[this.table] || []).filter(r => this.filters.every(f => f(r)));
    if (this.desc) rows = [...rows].sort((a, b) => String(b[this.desc!]).localeCompare(String(a[this.desc!])));
    return Promise.resolve({ data: this.single ? rows[0] ?? null : rows, error: null }).then(ok, bad);
  }
}
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => ({ from: (t: string) => new Query(t) }) }));
vi.mock('@/lib/constants', () => ({ COACH_ID: 'club' }));

const access = vi.fn();
vi.mock('@/lib/academy/pairing-server', () => ({
  requireTraineeAccess: (req: Request, id: string) => access(req, id),
}));
vi.mock('@/lib/academy/settings-server', () => ({ loadAcademySettings: async () => ({ paceAlerts: true }) }));
const push = vi.fn();
vi.mock('@/lib/garmin/push-week', () => ({ pushWeekToAthlete: (args: unknown) => push(args) }));
const notify = vi.fn();
vi.mock('@/lib/push', () => ({ notifyAthlete: (a: unknown) => notify(a) }));
vi.mock('@/lib/notifications/copy', () => ({ watchDisconnectedCopy: () => ({}) }));

const { POST } = await import('@/app/api/academy/dispatch/resend/route');

const pair = (o: Row = {}) => ({
  athleteId: 't1', name: 'Tom', isAcademy: true, academyCoachId: 'coach-1', academyBandId: 'b3', academyPaceOffsetSec: null, ...o,
});
const allow = (p = pair()) => access.mockResolvedValue({ denied: null, caller: { isSuperUser: false, athleteId: 'coach-1' }, pair: p });
const post = (body: unknown) => POST(new Request('http://x/api/academy/dispatch/resend', { method: 'POST', body: JSON.stringify(body) }));
const WEEK = '2026-10-04';

beforeEach(() => {
  access.mockReset(); push.mockReset(); notify.mockReset();
  db.athletes = [{ id: 't1', name: 'Tom', coach_id: 'club', status: 'active', garmin_auth: 'enc', is_academy: true }];
  db.weekly_plans = [
    { id: 'old', coach_id: 'club', athlete_id: 't1', week_start_date: WEEK, created_at: '2026-10-01', parsed_workouts: { workouts: [{ dayOfWeek: 0, name: 'old' }] } },
    { id: 'new', coach_id: 'club', athlete_id: 't1', week_start_date: WEEK, created_at: '2026-10-02', parsed_workouts: { workouts: [{ dayOfWeek: 1, name: 'A' }, { dayOfWeek: 3, name: 'B' }] } },
    // Somebody else's plan the same week — must never be the one pushed.
    { id: 'other', coach_id: 'club', athlete_id: 't9', week_start_date: WEEK, created_at: '2026-10-03', parsed_workouts: { workouts: [{ dayOfWeek: 2 }] } },
  ];
  push.mockResolvedValue({ athleteId: 't1', athleteName: 'Tom', status: 'success' });
  allow();
});

describe('who may resend', () => {
  it('rejects a bad body before any lookup', async () => {
    expect((await post({ athleteId: 't1', weekStart: 'next week' })).status).toBe(400);
    expect((await post({ weekStart: WEEK })).status).toBe(400);
    expect(access).not.toHaveBeenCalled();
  });

  it('returns the gate\'s own refusal — another coach\'s trainee, or a runner', async () => {
    access.mockResolvedValue({ denied: NextResponse.json({ error: 'Not your trainee' }, { status: 403 }), caller: {}, pair: null });
    const res = await post({ athleteId: 't1', weekStart: WEEK });
    expect(res.status).toBe(403);
    expect(push).not.toHaveBeenCalled();
  });

  it('refuses somebody who is not in the academy', async () => {
    allow(pair({ isAcademy: false }));
    expect((await post({ athleteId: 't1', weekStart: WEEK })).status).toBe(409);
    expect(push).not.toHaveBeenCalled();
  });
});

describe('what is pushed', () => {
  it('the trainee\'s own newest plan for that week, and nothing from the body', async () => {
    const res = await post({ athleteId: 't1', weekStart: WEEK, workouts: [{ name: 'forged' }] });
    expect(res.status).toBe(200);
    expect(push).toHaveBeenCalledTimes(1);
    const args = push.mock.calls[0][0];
    expect(args.planId).toBe('new');
    expect(args.weekStartDate).toBe(WEEK);
    expect(args.athlete.id).toBe('t1');
    expect(args.plannedWorkouts.map((w: { name: string }) => w.name)).toEqual(['A', 'B']);
  });

  it('409 when Garmin is not linked, or there is no plan', async () => {
    db.athletes[0].garmin_auth = null;
    expect(await (await post({ athleteId: 't1', weekStart: WEEK })).json()).toEqual({ error: 'garmin-not-connected' });
    db.athletes[0].garmin_auth = 'enc';
    const res = await post({ athleteId: 't1', weekStart: '2026-10-11' });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('no-plan');
    expect(push).not.toHaveBeenCalled();
  });
});

describe('pace alarms', () => {
  it('on for an academy trainee with a band', async () => {
    await post({ athleteId: 't1', weekStart: WEEK });
    expect(push.mock.calls[0][0].paceTarget).toBe(true);
  });

  it('off when neither a band nor an offset prices the paces', async () => {
    allow(pair({ academyBandId: null, academyPaceOffsetSec: null }));
    await post({ athleteId: 't1', weekStart: WEEK });
    expect(push.mock.calls[0][0].paceTarget).toBe(false);
  });
});

describe('a failed push', () => {
  it('is a 502 with whose problem it is, and tells the athlete only when it is theirs', async () => {
    push.mockResolvedValue({ athleteId: 't1', athleteName: 'Tom', status: 'failed', error: 'No Garmin auth token' });
    const res = await post({ athleteId: 't1', weekStart: WEEK });
    expect(res.status).toBe(502);
    expect((await res.json()).blame).toBe('reconnect');
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0][0].tag).toBe(`watch-disconnected-t1-${WEEK}`);
  });
});
