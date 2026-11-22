import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * /api/athletes/update-group (2026-11-22). Synthetic only: in-memory athletes, mocked verified
 * caller. Before: anyone could regroup a pending applicant and ACTIVATE an approved-null row by
 * naming an email, and the 404 told unknown addresses from existing ones. Now a verified session
 * that owns the address / is linked to the row / is staff; anonymous → 401 for every address.
 */
type Row = Record<string, any>;
let rows: Row[] = [];
let syncs = 0;
const resolveVerifiedCaller = vi.fn();
vi.mock('@/lib/auth/self-or-staff', async () => {
  const real = await vi.importActual<typeof import('@/lib/auth/self-or-staff')>('@/lib/auth/self-or-staff');
  return { mayActFor: real.mayActFor, resolveVerifiedCaller: (r: Request) => resolveVerifiedCaller(r) };
});
vi.mock('@/lib/follows/club-sync', () => ({ syncClubFollows: async () => { syncs++; } }));
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({
    from() {
      const f: Record<string, unknown> = {}; let patch: Row | null = null;
      const pick = () => rows.find((r) => Object.entries(f).every(([k, v]) => r[k] === v)) ?? null;
      const chain: any = {
        select: () => chain,
        eq: (k: string, v: unknown) => { f[k] = v; return chain; },
        update: (p: Row) => { patch = p; return chain; },
        maybeSingle: async () => ({ data: pick(), error: null }),
        single: async () => { const r = pick(); if (r && patch) Object.assign(r, patch); return { data: r, error: r ? null : { message: 'none' } }; },
      };
      return chain;
    },
  }),
}));
const who = (email: string, athleteId: string | null = null, staff = false) => ({
  denied: null,
  caller: { email, athleteId, isSuperUser: false, canApprove: false, isStaff: staff, role: staff ? 'coach' : 'runner', isCoreRunner: false },
});
const req = (body: unknown, bearer = true) => new Request('http://x/api/athletes/update-group', {
  method: 'POST',
  headers: { 'content-type': 'application/json', ...(bearer ? { authorization: 'Bearer jwt' } : {}) },
  body: JSON.stringify(body),
});
async function call(r: Request) {
  const { POST } = await import('@/app/api/athletes/update-group/route');
  const res = await POST(r as any);
  return { status: res.status, text: await res.text() };
}
const snap = () => JSON.stringify(rows);

beforeEach(() => {
  rows = [
    { id: 'p-false', email: 'a@x', status: 'invited', approved: false, group_id: 'g1' },
    { id: 'p-null', email: 'n@x', status: 'invited', approved: null, group_id: 'g1' },
    { id: 'p-true', email: 't@x', status: 'invited', approved: true, group_id: 'g1' },
  ];
  syncs = 0;
  resolveVerifiedCaller.mockReset();
  resolveVerifiedCaller.mockImplementation(async () => ({ denied: new Response('{"error":"Sign in"}', { status: 401 }), caller: {} }));
});

describe('update-group: a pending row needs its owner', () => {
  it('anonymous: 401 for pending AND unknown addresses, same body, nothing written', async () => {
    const before = snap();
    const p = await call(req({ email: 'n@x', groupId: 'g9' }, false));
    const u = await call(req({ email: 'nobody@x', groupId: 'g9' }, false));
    expect([p.status, u.status]).toEqual([401, 401]);
    expect(p.text).toBe(u.text);
    expect(snap()).toBe(before);
    expect(syncs).toBe(0);
  });

  it.each(['a@x', 'n@x', 't@x'])('caller B cannot regroup or activate pending %s', async (email) => {
    resolveVerifiedCaller.mockResolvedValue(who('b@x'));
    const before = snap();
    const r = await call(req({ email, groupId: 'g9' }));
    expect(r.status).toBe(403);
    expect(snap()).toBe(before);
    expect(syncs).toBe(0);
  });

  it('B naming an unknown address gets the same 403 (no enumeration)', async () => {
    resolveVerifiedCaller.mockResolvedValue(who('b@x'));
    const a = await call(req({ email: 'n@x', groupId: 'g9' }));
    const u = await call(req({ email: 'nobody@x', groupId: 'g9' }));
    expect([a.status, a.text]).toEqual([u.status, u.text]);
  });

  it('the owner (group-only signup path) sets their own group; approved-null legacy activation kept for them', async () => {
    resolveVerifiedCaller.mockResolvedValue(who('n@x'));
    const r = await call(req({ email: 'n@x', groupId: 'g2', weekStartDay: 1 }));
    expect(r.status).toBe(200);
    expect(rows.find((x) => x.id === 'p-null')).toMatchObject({ group_id: 'g2', status: 'active', week_start_day: 1 });
  });

  it('an approved-false owner stays pending', async () => {
    resolveVerifiedCaller.mockResolvedValue(who('a@x'));
    expect((await call(req({ email: 'a@x', groupId: 'g2' }))).status).toBe(200);
    expect(rows.find((x) => x.id === 'p-false')).toMatchObject({ group_id: 'g2', status: 'invited' });
  });

  it('the owner of an unknown address hears 404', async () => {
    resolveVerifiedCaller.mockResolvedValue(who('fresh@x'));
    expect((await call(req({ email: 'fresh@x', groupId: 'g2' }))).status).toBe(404);
  });

  it('a session linked to the row (synthetic Strava address) may set it', async () => {
    resolveVerifiedCaller.mockResolvedValue(who('strava-1@synthetic', 'p-true'));
    expect((await call(req({ email: 't@x', groupId: 'g2' }))).status).toBe(200);
  });

  it('staff may set a pending applicant’s group', async () => {
    resolveVerifiedCaller.mockResolvedValue(who('coach@x', 'coach-row', true));
    expect((await call(req({ email: 'a@x', groupId: 'g3' }))).status).toBe(200);
  });
});

describe('callers send the bearer', () => {
  it('/join/onboard group-only save carries apiHeaders', () => {
    const src = readFileSync(join(__dirname, '..', 'app/join/onboard/page.tsx'), 'utf8');
    const i = src.indexOf("fetch('/api/athletes/update-group', {");
    expect(i).toBeGreaterThan(0);
    expect(src.slice(i, i + 140)).toMatch(/headers: await apiHeaders\(true\)/);
  });
});
