import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'fs';
import { NextResponse } from 'next/server';

// ── shared mocks ─────────────────────────────────────────────────────────────────────
const gate = vi.hoisted(() => ({ denied: null as Response | null, caller: { athleteId: 'coach', isStaff: true, isSuperUser: false } as any }));
vi.mock('@/lib/auth/self-or-staff', () => ({
  requireStaff: async () => gate.denied,
  requireStaffCaller: async () => ({ denied: gate.denied, caller: gate.caller }),
}));

const tables = vi.hoisted(() => ({ rows: {} as Record<string, any> }));
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({
    from: (t: string) => {
      const q: any = {};
      for (const m of ['select', 'eq', 'gte', 'lt', 'lte', 'limit', 'in', 'order', 'range']) q[m] = () => q;
      q.maybeSingle = async () => ({ data: tables.rows[t] ?? null, error: null });
      q.then = (res: any) => res({ data: tables.rows[t] ?? [], error: null });
      return q;
    },
  }),
}));

const ds = vi.hoisted(() => ({
  readDaySession: vi.fn(), setLate: vi.fn(), lateRecipients: vi.fn(), sendLatePush: vi.fn(),
}));
vi.mock('@/lib/day-session/server', () => ds);

const forbid = () => NextResponse.json({ error: 'Staff access required' }, { status: 403 });

beforeEach(() => {
  gate.denied = null;
  gate.caller = { athleteId: 'coach', isStaff: true, isSuperUser: false };
  tables.rows = {};
  for (const f of Object.values(ds)) f.mockReset();
});

// ── GET /api/admin/data-check ────────────────────────────────────────────────────────
describe('GET /api/admin/data-check', () => {
  const ID = '11111111-1111-4111-8111-111111111111';
  const req = (q: string) => new Request(`http://x/api/admin/data-check${q}`);

  it('is staff-only', async () => {
    const { GET } = await import('@/app/api/admin/data-check/route');
    gate.denied = forbid();
    expect((await GET(req(`?athleteId=${ID}`))).status).toBe(403);
  });

  it('400 without an athleteId, 404 for an unknown one', async () => {
    const { GET } = await import('@/app/api/admin/data-check/route');
    expect((await GET(req(''))).status).toBe(400);
    expect((await GET(req(`?athleteId=${ID}`))).status).toBe(404);
  });

  it('answers days14/checks/headline and never serialises a credential', async () => {
    const { GET } = await import('@/app/api/admin/data-check/route');
    tables.rows.athletes = {
      id: ID, garmin_auth: { oauth2: 'SECRET-GARMIN' }, strava_auth: { refresh_token: 'SECRET-STRAVA' }, strava_athlete_id: 7,
      garmin_last_sync_at: new Date().toISOString(), garmin_auth_failed_at: null, strava_last_sync_at: null, strava_auth_failed_at: null,
    };
    tables.rows.athlete_activities = [];
    const res = await GET(req(`?athleteId=${ID}`));
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toMatch(/SECRET|garmin_auth"|strava_auth"|oauth|refresh_token/);
    const body = JSON.parse(text);
    expect(body.days14).toHaveLength(14);
    expect(body.connections.garmin.connected).toBe(true);
    expect(typeof body.headline).toBe('string');
    expect(Array.isArray(body.checks)).toBe(true);
  });
});

// ── POST / DELETE /api/day-session/late ──────────────────────────────────────────────
describe('/api/day-session/late', () => {
  const session = { id: 's', date: '2099-01-01', startTime: '06:00', late: null };
  const post = (body: unknown) => new Request('http://x/api/day-session/late', { method: 'POST', body: JSON.stringify(body) });

  it('is staff-only, both verbs', async () => {
    const { POST, DELETE } = await import('@/app/api/day-session/late/route');
    gate.denied = forbid();
    expect((await POST(post({ date: '2099-01-01', minutes: 10 }))).status).toBe(403);
    expect((await DELETE(new Request('http://x/api/day-session/late?date=2099-01-01', { method: 'DELETE' }))).status).toBe(403);
    expect(ds.setLate).not.toHaveBeenCalled();
  });

  it('rejects minutes outside 5–30 and view-as sessions', async () => {
    const { POST } = await import('@/app/api/day-session/late/route');
    expect((await POST(post({ date: '2099-01-01', minutes: 45 }))).status).toBe(400);
    gate.caller = { ...gate.caller, viewingAsBy: 'admin@x' };
    expect((await POST(post({ date: '2099-01-01', minutes: 10 }))).status).toBe(403);
  });

  it('stores, then pushes to the RSVPs only', async () => {
    const { POST } = await import('@/app/api/day-session/late/route');
    ds.readDaySession.mockResolvedValue({ setup: true, session });
    ds.setLate.mockImplementation(async (_d: string, late: any) => ({ ...session, late }));
    ds.lateRecipients.mockResolvedValue(['r1', 'r2']);
    ds.sendLatePush.mockResolvedValue(3);
    const res = await POST(post({ date: '2099-01-01', minutes: 10, note: 'parking' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.late).toMatchObject({ minutes: 10, note: 'parking' });
    expect(body.recipients).toBe(2);
    expect(ds.lateRecipients).toHaveBeenCalledWith('2099-01-01');
    expect(ds.sendLatePush.mock.calls[0][2]).toEqual(['r1', 'r2']);
  });

  it('a second POST replaces (setLate overwrites, never appends)', async () => {
    const { POST } = await import('@/app/api/day-session/late/route');
    ds.readDaySession.mockResolvedValue({ setup: true, session });
    ds.setLate.mockImplementation(async (_d: string, late: any) => ({ ...session, late }));
    ds.lateRecipients.mockResolvedValue([]);
    ds.sendLatePush.mockResolvedValue(0);
    await POST(post({ date: '2099-01-01', minutes: 10 }));
    const res = await POST(post({ date: '2099-01-01', minutes: 20 }));
    expect((await res.json()).late.minutes).toBe(20);
    expect(ds.setLate).toHaveBeenCalledTimes(2);
  });

  it('404 with no session that day; 503 before the migration', async () => {
    const { POST } = await import('@/app/api/day-session/late/route');
    ds.readDaySession.mockResolvedValue({ setup: true, session: null });
    expect((await POST(post({ date: '2099-01-01', minutes: 10 }))).status).toBe(404);
    ds.readDaySession.mockResolvedValue({ setup: true, session });
    ds.setLate.mockResolvedValue('not_set_up');
    expect((await POST(post({ date: '2099-01-01', minutes: 10 }))).status).toBe(503);
  });

  it('DELETE clears without a push', async () => {
    const { DELETE } = await import('@/app/api/day-session/late/route');
    ds.setLate.mockResolvedValue({ ...session, late: null });
    const res = await DELETE(new Request('http://x/api/day-session/late?date=2099-01-01', { method: 'DELETE' }));
    expect(res.status).toBe(200);
    expect(ds.setLate).toHaveBeenCalledWith('2099-01-01', null);
    expect(ds.sendLatePush).not.toHaveBeenCalled();
  });
});

// ── source pins ──────────────────────────────────────────────────────────────────────
describe('b23 source pins', () => {
  const src = (p: string) => readFileSync(p, 'utf8');

  it('late recipients are attending RSVPs keyed by the Sunday plan week', () => {
    const s = src('src/lib/day-session/server.ts');
    expect(s).toMatch(/from\('workout_attendance'\)[\s\S]{0,200}\.eq\('attending', true\)/);
    expect(s).toMatch(/planWeekStartOf\(date\)/);
    expect(s).toMatch(/kind: 'day_session_late'/);
    expect(src('src/lib/notifications/prefs.ts')).toMatch(/day_session_late:/);
  });

  it('records/weekly: day bars from the activity week, caller from the session, weekOffset', () => {
    const s = src('src/app/api/records/weekly/route.ts');
    expect(s).toMatch(/getActivityWeekStart\(israelDateAnchor\(\)\), 7 \* weekOffset/);
    expect(s).toMatch(/dayKmOf\(await dayRowsP, weekStart, caller\.athleteId\)/);
    expect(s).not.toMatch(/err\.message/);
  });

  it('stats: planKm from the Sunday plan week, activity week alongside', () => {
    const s = src('src/app/api/athletes/[id]/stats/route.ts');
    expect(s).toMatch(/planWeekStartOf\(\)/);
    expect(s).toMatch(/activityWeekOfPlanWeek\(planWeekStart\)/);
    expect(s).toMatch(/planKm: planTarget \? planTarget\.min : null/);
  });

  it('new routes are force-dynamic and leak no error.message', () => {
    for (const p of ['src/app/api/admin/data-check/route.ts', 'src/app/api/day-session/late/route.ts']) {
      const s = src(p);
      expect(s).toMatch(/export const dynamic = 'force-dynamic'/);
      expect(s).not.toMatch(/\.message/);
    }
  });
});
