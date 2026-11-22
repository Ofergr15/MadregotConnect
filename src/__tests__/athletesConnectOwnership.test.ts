import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * /api/athletes/connect, token-less path (2026-11-22). Synthetic only: an in-memory athletes
 * table, a mocked verified caller, no real accounts or mail. Before: anyone could name a
 * pending applicant's address and rename/regroup/re-mark them, ACTIVATE an approved-null row,
 * read back id/email, and fire the admin mail + follow sync. Now the session must own the
 * address (or already be linked to the row). Invite redemption is unchanged.
 */

type Row = Record<string, any>;
let rows: Row[] = [];
let mails = 0;
let syncs = 0;

const resolveVerifiedCaller = vi.fn();
vi.mock('@/lib/auth/self-or-staff', async () => {
  const real = await vi.importActual<typeof import('@/lib/auth/self-or-staff')>('@/lib/auth/self-or-staff');
  return { mayActFor: real.mayActFor, resolveVerifiedCaller: (r: Request) => resolveVerifiedCaller(r) };
});
vi.mock('@/lib/follows/club-sync', () => ({ syncClubFollows: async () => { syncs++; } }));
vi.mock('@/lib/email', () => ({ notifyAdminNewUser: async () => { mails++; } }));
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({
    from() {
      const f: Record<string, unknown> = {};
      let patch: Row | null = null; let insert: Row | null = null;
      const pick = () => rows.find((r) => Object.entries(f).every(([k, v]) => r[k] === v)) ?? null;
      const chain: any = {
        select: () => chain,
        eq: (k: string, v: unknown) => { f[k] = v; return chain; },
        update: (p: Row) => { patch = p; return chain; },
        insert: (p: Row) => { insert = p; return chain; },
        maybeSingle: async () => ({ data: pick(), error: null }),
        single: async () => {
          if (insert) { const r = { id: `new-${rows.length}`, ...insert }; rows.push(r); return { data: r, error: null }; }
          const r = pick();
          if (r && patch) Object.assign(r, patch);
          return { data: r, error: r ? null : { message: 'none' } };
        },
      };
      return chain;
    },
  }),
}));

const caller = (email: string, athleteId: string | null = null) => ({
  denied: null,
  caller: { email, athleteId, isSuperUser: false, canApprove: false, isStaff: false, role: 'runner', isCoreRunner: false },
});
function req(body: unknown, bearer = true) {
  return new Request('http://x/api/athletes/connect', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(bearer ? { authorization: 'Bearer jwt' } : {}) },
    body: JSON.stringify(body),
  });
}
async function call(r: Request) {
  const { POST } = await import('@/app/api/athletes/connect/route');
  const res = await POST(r as any);
  const text = await res.text();
  return { status: res.status, text };
}
const snapshot = () => JSON.stringify(rows);

beforeEach(() => {
  rows = [
    { id: 'a-false', email: 'a@x', name: 'A', status: 'invited', approved: false, group_id: 'g1', garmin_auth: null },
    { id: 'a-null', email: 'n@x', name: 'N', status: 'invited', approved: null, group_id: 'g1', garmin_auth: null },
    { id: 'a-true', email: 't@x', name: 'T', status: 'invited', approved: true, group_id: 'g1', garmin_auth: null },
    { id: 'inv', email: 'i@x', name: 'I', status: 'invited', approved: true, invite_token: 'tok-123', garmin_auth: null },
  ];
  mails = 0; syncs = 0;
  resolveVerifiedCaller.mockReset();
});

describe('token-less connect needs the session to own the address', () => {
  it('no bearer: refused for every pending row, nothing written, nothing sent', async () => {
    for (const email of ['a@x', 'n@x', 't@x', 'brand-new@x']) {
      const before = snapshot();
      const r = await call(req({ name: 'Evil', email, groupId: 'g9' }, false));
      expect(r.status).toBe(401);
      expect(snapshot()).toBe(before);
    }
    expect(mails + syncs).toBe(0);
  });

  it.each(['a@x', 'n@x', 't@x'])("caller B cannot touch pending %s (approved false/null/true)", async (email) => {
    resolveVerifiedCaller.mockResolvedValue(caller('b@x'));
    const before = snapshot();
    const r = await call(req({ name: 'Evil', email, groupId: 'g9', weekStartDay: 1 }));
    expect(r.status).toBe(403);
    expect(snapshot()).toBe(before);           // no rename, regroup, activation
    expect(r.text).not.toMatch(/a-false|a-null|a-true|@x/); // no id/email read back
    expect(mails + syncs).toBe(0);
  });

  it("B naming a pending address answers exactly like B naming an unknown one", async () => {
    resolveVerifiedCaller.mockResolvedValue(caller('b@x'));
    const pending = await call(req({ name: 'Evil', email: 'n@x' }));
    const unknown = await call(req({ name: 'Evil', email: 'nobody@x' }));
    expect([pending.status, pending.text]).toEqual([unknown.status, unknown.text]);
    expect(rows.length).toBe(4);               // no pre-registration of someone else's address
  });

  it('the owner of an approved-null row onboards: legacy activation kept for them', async () => {
    resolveVerifiedCaller.mockResolvedValue(caller('n@x'));
    const r = await call(req({ name: 'N2', email: 'n@x', groupId: 'g2' }));
    expect(r.status).toBe(200);
    expect(rows.find((x) => x.id === 'a-null')).toMatchObject({ name: 'N2', group_id: 'g2', status: 'active' });
  });

  it('the owner of an approved-false row onboards and stays pending (approval owns activation)', async () => {
    resolveVerifiedCaller.mockResolvedValue(caller('a@x'));
    const r = await call(req({ name: 'A2', email: 'a@x' }));
    expect(r.status).toBe(200);
    expect(rows.find((x) => x.id === 'a-false')).toMatchObject({ name: 'A2', status: 'invited' });
  });

  it('a session already linked to the row may write it (synthetic Strava address)', async () => {
    resolveVerifiedCaller.mockResolvedValue(caller('strava-1@synthetic', 'a-true'));
    const r = await call(req({ name: 'T2', email: 't@x' }));
    expect(r.status).toBe(200);
  });

  it('fresh sign-up for the caller OWN address: inserted pending + unapproved', async () => {
    resolveVerifiedCaller.mockResolvedValue(caller('fresh@x'));
    const r = await call(req({ name: 'F', email: 'fresh@x' }));
    expect(r.status).toBe(200);
    expect(rows.find((x) => x.email === 'fresh@x')).toMatchObject({ status: 'invited', approved: false });
  });

  it('a rejected bearer passes through and writes nothing', async () => {
    resolveVerifiedCaller.mockResolvedValue({ denied: new Response('{"error":"x"}', { status: 401 }), caller: {} });
    const before = snapshot();
    const r = await call(req({ name: 'E', email: 'n@x' }));
    expect(r.status).toBe(401);
    expect(snapshot()).toBe(before);
  });
});

describe('invite redemption is unchanged (the token is the credential)', () => {
  it('works with no bearer at all', async () => {
    const r = await call(req({ inviteToken: 'tok-123', name: 'I2' }, false));
    expect(r.status).toBe(200);
    expect(rows.find((x) => x.id === 'inv')).toMatchObject({ name: 'I2', status: 'active' });
  });
});

describe('the only token-less caller sends its bearer', () => {
  it('/join/onboard: every connect POST carries apiHeaders', () => {
    const src = readFileSync(join(__dirname, '..', 'app/join/onboard/page.tsx'), 'utf8');
    const calls = src.split("fetch('/api/athletes/connect', {").slice(1);
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) expect(c.slice(0, 120)).toMatch(/headers: await apiHeaders\(true\)/);
  });
});
