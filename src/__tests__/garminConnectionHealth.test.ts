import { beforeEach, describe, expect, it, vi } from 'vitest';
import { classifyGarminHealth, garminReconnectPrompt, GARMIN_RECONNECT_URL, type GarminHealthRow } from '@/lib/garmin/connection-health';

const NOW = Date.parse('2026-11-28T10:00:00Z');
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString();
const row = (id: string, p: Partial<GarminHealthRow> = {}): GarminHealthRow => ({
  id, name: id.toUpperCase(), hasAuth: true, garmin_last_sync_at: null, garmin_auth_failed_at: null, ...p,
});

describe('classifyGarminHealth', () => {
  it('sorts every connected athlete into exactly one state', () => {
    const r = classifyGarminHealth([
      row('ok', { garmin_last_sync_at: daysAgo(0.01) }),
      row('stale', { garmin_last_sync_at: daysAgo(20) }),
      row('refused', { garmin_last_sync_at: daysAgo(3), garmin_auth_failed_at: daysAgo(2) }),
      row('fresh'),
      row('nocred', { hasAuth: false, garmin_auth_failed_at: daysAgo(1) }),
    ], NOW);
    expect(r.counts).toEqual({ ok: 1, stale: 1, failed: 1, unknown: 1 });
    expect(r.failed.map((f) => f.athleteId)).toEqual(['refused']);
    expect(r.failed[0].failedAt).toBe(daysAgo(2));
    expect(r.stale.map((f) => f.athleteId)).toEqual(['stale']);
    expect(r.stale[0].failedAt).toBeNull();
  });

  it('a refusal followed by a good sync (reconnected) is healthy, not failed', () => {
    const r = classifyGarminHealth([row('back', { garmin_auth_failed_at: daysAgo(2), garmin_last_sync_at: daysAgo(1) })], NOW);
    expect(r.counts.failed).toBe(0);
    expect(r.counts.ok).toBe(1);
  });

  it('a refusal with no sync ever is failed', () => {
    expect(classifyGarminHealth([row('x', { garmin_auth_failed_at: daysAgo(1) })], NOW).failed).toHaveLength(1);
  });

  it('longest-broken first', () => {
    const r = classifyGarminHealth([
      row('b', { garmin_auth_failed_at: daysAgo(1) }),
      row('a', { garmin_auth_failed_at: daysAgo(9) }),
      row('c', { garmin_last_sync_at: daysAgo(15) }),
      row('d', { garmin_last_sync_at: daysAgo(40) }),
    ], NOW);
    expect(r.failed.map((f) => f.athleteId)).toEqual(['a', 'b']);
    expect(r.stale.map((f) => f.athleteId)).toEqual(['d', 'c']);
  });
});

describe('garminReconnectPrompt', () => {
  it('points at the data-source tab in both languages', () => {
    for (const loc of ['he', 'en'] as const) {
      const p = garminReconnectPrompt(loc);
      expect(p).toMatchObject({ kind: 'garmin_reconnect', url: GARMIN_RECONNECT_URL });
      expect(p.title.length).toBeGreaterThan(0);
      expect(p.body.length).toBeGreaterThan(0);
    }
    expect(garminReconnectPrompt('he').body).toMatch(/[֐-׿]/);
    expect(garminReconnectPrompt('en').body).not.toMatch(/[֐-׿]/);
  });
});

// ── the route ────────────────────────────────────────────────────────────────
const h = vi.hoisted(() => ({
  denied: null as Response | null,
  rows: [] as Array<Record<string, unknown>>,
  error: null as { code: string; message: string } | null,
  filters: [] as string[],
  sends: 0,
}));

vi.mock('@/lib/auth/self-or-staff', () => ({ requireStaff: async () => h.denied }));
vi.mock('@/lib/push', () => ({
  localesForAthletes: async (ids: string[]) => new Map(ids.map((id) => [id, id === 'en-runner' ? 'en' : 'he'])),
  sendPush: () => { h.sends += 1; },
  notifyAthlete: () => { h.sends += 1; },
}));
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({
    from: () => {
      const q: Record<string, unknown> = {};
      q.select = (cols: string) => { h.filters.push(`select:${cols}`); return q; };
      q.eq = (c: string, v: string) => { h.filters.push(`eq:${c}=${v}`); return q; };
      q.not = (c: string, op: string, v: unknown) => { h.filters.push(`not:${c} ${op} ${v}`); return q; };
      q.order = () => q;
      q.range = async (from: number, to: number) => ({ data: h.error ? null : h.rows.slice(from, to + 1), error: h.error });
      return q;
    },
  }),
}));

import { GET } from '@/app/api/admin/garmin-health/route';

describe('GET /api/admin/garmin-health', () => {
  beforeEach(() => { h.denied = null; h.rows = []; h.error = null; h.filters = []; h.sends = 0; });
  const req = () => new Request('http://x/api/admin/garmin-health');

  it('is staff-only', async () => {
    h.denied = new Response('{}', { status: 403 });
    expect((await GET(req())).status).toBe(403);
  });

  it('lists refused credentials with a localized prompt, never the credential, never sends', async () => {
    const refused = new Date(Date.now() - 86_400_000).toISOString();
    h.rows = [
      { id: 'he-runner', name: 'א', garmin_auth: 'ENCRYPTED-BLOB-1', garmin_last_sync_at: null, garmin_auth_failed_at: refused },
      { id: 'en-runner', name: 'B', garmin_auth: 'ENCRYPTED-BLOB-2', garmin_last_sync_at: null, garmin_auth_failed_at: refused },
      { id: 'ok-runner', name: 'C', garmin_auth: 'ENCRYPTED-BLOB-3', garmin_last_sync_at: new Date().toISOString(), garmin_auth_failed_at: null },
    ];
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    const text = await res.text();
    expect(text).not.toMatch(/ENCRYPTED-BLOB/);
    const body = JSON.parse(text);
    expect(body.ready).toBe(true);
    expect(body.counts).toEqual({ ok: 1, stale: 0, failed: 2, unknown: 0 });
    const byId = Object.fromEntries(body.failed.map((f: { athleteId: string }) => [f.athleteId, f]));
    expect(byId['he-runner'].prompt.body).toMatch(/[֐-׿]/);
    expect(byId['en-runner'].prompt.body).toMatch(/Reconnecting/);
    expect(byId['en-runner'].prompt.url).toBe('/dashboard/profile?tab=datasource');
    expect(h.sends).toBe(0);
    expect(h.filters).toContain('eq:status=active');
    expect(h.filters).toContain('not:garmin_auth is null');
  });

  it('pages past 1000 connected athletes', async () => {
    h.rows = Array.from({ length: 1205 }, (_, i) => ({
      id: `a${String(i).padStart(5, '0')}`, name: null, garmin_auth: 'x', garmin_last_sync_at: null, garmin_auth_failed_at: null,
    }));
    const body = await (await GET(req())).json();
    expect(body.counts.unknown).toBe(1205);
  });

  it('ready:false before migration 101, 500 without error text on other failures', async () => {
    h.error = { code: '42703', message: 'column athletes.garmin_last_sync_at does not exist' };
    expect(await (await GET(req())).json()).toEqual({ ready: false });
    h.error = { code: '57014', message: 'canceling statement due to statement timeout' };
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await GET(req());
    expect(res.status).toBe(500);
    expect(await res.text()).not.toMatch(/statement timeout/);
    err.mockRestore();
  });
});
