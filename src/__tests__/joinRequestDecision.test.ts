import { beforeEach, describe, expect, it, vi } from 'vitest';
import { suggestGroup, cleanReason } from '@/lib/join/suggest-group';
import { COACH_ID } from '@/lib/constants';

const GROUPS = [
  { id: 'g3', name: 'Group C - SUB 3:15', marathonGoal: '' },
  { id: 'g1', name: 'Group A', marathonGoal: 'SUB 2:30' },
  { id: 'g2', name: 'Group B - SUB 2:45', marathonGoal: null },
];

describe('suggestGroup', () => {
  it('marathon time → the fastest pack whose goal it is within', () => {
    expect(suggestGroup({ bestDistance: 'marathon', bestSeconds: 2 * 3600 + 28 * 60 }, GROUPS)).toMatchObject({ kind: 'group', groupId: 'g1' });
    expect(suggestGroup({ bestDistance: 'marathon', bestSeconds: 2 * 3600 + 40 * 60 }, GROUPS)).toMatchObject({ kind: 'group', groupId: 'g2' });
    expect(suggestGroup({ bestDistance: 'marathon', bestSeconds: 2 * 3600 + 45 * 60 }, GROUPS)).toMatchObject({ kind: 'group', groupId: 'g2' });
  });
  it('a half time goes through the Riegel equivalent', () => {
    // 1:15:00 half → ~2:36:30 marathon → pack B
    const s = suggestGroup({ bestDistance: 'half', bestSeconds: 75 * 60 }, GROUPS);
    expect(s).toMatchObject({ kind: 'group', groupId: 'g2' });
    if (s.kind === 'group') expect(s.marathonEquivalentSec).toBeGreaterThan(2.5 * 3600);
  });
  it('slower than every pack → academy', () => {
    expect(suggestGroup({ bestDistance: 'marathon', bestSeconds: 4 * 3600 }, GROUPS)).toMatchObject({ kind: 'academy' });
  });
  it('no time or no readable goals → none', () => {
    expect(suggestGroup(null, GROUPS)).toEqual({ kind: 'none', why: 'no-time' });
    expect(suggestGroup({ noRace: true }, GROUPS)).toEqual({ kind: 'none', why: 'no-time' });
    expect(suggestGroup({ bestDistance: 'marathon', bestSeconds: 9000 }, [{ id: 'x', name: 'Fast pack' }])).toEqual({ kind: 'none', why: 'no-goals' });
  });
  it('cleanReason trims, collapses and caps', () => {
    expect(cleanReason('  not  in club ')).toBe('not in club');
    expect(cleanReason('   ')).toBeNull();
    expect(cleanReason(5)).toBeNull();
    expect(cleanReason('x'.repeat(400))!.length).toBe(280);
  });
});

// ── routes ───────────────────────────────────────────────────────────────────
let session: Record<string, unknown> | null;
let rows: Record<string, Array<Record<string, unknown>>>;
let inserted: Array<{ table: string; row: Record<string, unknown> }>;
let insertError: { code: string; message: string } | null;
let dbCalls: number;
const forwardedBodies: Array<Record<string, unknown>> = [];
let approveReply: { status: number; body: Record<string, unknown> };

vi.mock('@/lib/auth-session', () => ({
  requireSession: async () => (session ? { ok: true as const, user: session } : { ok: false as const, status: 401, error: 'unauthenticated' }),
  authError: (r: { status: number; error: string }) => new Response(JSON.stringify({ error: r.error }), { status: r.status }),
}));

vi.mock('@/app/api/admin/registrations/approve/route', () => ({
  POST: async (req: Request) => {
    forwardedBodies.push(await req.json());
    return new Response(JSON.stringify(approveReply.body), { status: approveReply.status });
  },
}));

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({
    from(table: string) {
      dbCalls += 1;
      const filters: Array<[string, unknown]> = [];
      const list = () => (rows[table] || []).filter((r) => filters.every(([c, v]) => r[c] === v));
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: (c: string, v: unknown) => { filters.push([c, v]); return chain; },
        order: () => chain,
        limit: () => Promise.resolve({ data: list(), error: null }),
        maybeSingle: () => Promise.resolve({ data: list()[0] ?? null, error: null }),
        insert: (row: Record<string, unknown>) => { inserted.push({ table, row }); return Promise.resolve({ error: insertError }); },
        then: (res: (v: unknown) => unknown) => Promise.resolve({ data: list(), error: null }).then(res),
      };
      return chain;
    },
  }),
}));

const { GET } = await import('@/app/api/admin/join-requests/route');
const { POST } = await import('@/app/api/admin/join-requests/[id]/decision/route');

const APPROVER = { email: 'coach@example.test', athleteId: 'a-coach', canApprove: true };
const decide = (body: unknown, id = 'r1') =>
  POST(new Request(`https://x.test/api/admin/join-requests/${id}/decision`, { method: 'POST', body: JSON.stringify(body) }), { params: Promise.resolve({ id }) });

beforeEach(() => {
  session = APPROVER;
  inserted = [];
  insertError = null;
  dbCalls = 0;
  forwardedBodies.length = 0;
  approveReply = { status: 200, body: { ok: true, status: 'approved' } };
  rows = {
    groups: GROUPS.map((g) => ({ id: g.id, name: g.name, coach_id: COACH_ID, pace_profile: { marathonGoal: g.marathonGoal } })),
    signup_requests: [
      { id: 'r1', email: 'new@example.test', full_name: 'New Runner', status: 'pending', group_id: null, created_at: '2026-11-01T00:00:00Z', intake: { bestDistance: 'marathon', bestSeconds: 2 * 3600 + 40 * 60 } },
    ],
  };
});

describe('GET /api/admin/join-requests', () => {
  it('403 without canApprove, before any DB read', async () => {
    session = { ...APPROVER, canApprove: false };
    const res = await GET(new Request('https://x.test/api/admin/join-requests'));
    expect(res.status).toBe(403);
    expect(dbCalls).toBe(0);
  });
  it('lists pending requests with the pace suggestion', async () => {
    const res = await GET(new Request('https://x.test/api/admin/join-requests'));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.requests[0]).toMatchObject({ id: 'r1', fullName: 'New Runner', suggestion: { kind: 'group', groupId: 'g2' } });
  });
});

describe('POST /api/admin/join-requests/{id}/decision', () => {
  it('403 for a non-approver, nothing read or forwarded', async () => {
    session = { ...APPROVER, canApprove: false };
    const res = await decide({ action: 'reject', reason: 'spam' });
    expect(res.status).toBe(403);
    expect(dbCalls).toBe(0);
    expect(forwardedBodies).toEqual([]);
  });
  it('reject needs a reason', async () => {
    const res = await decide({ action: 'reject', reason: '  ' });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('reason-required');
    expect(forwardedBodies).toEqual([]);
  });
  it('400 on an unknown action', async () => {
    expect((await decide({ action: 'maybe' })).status).toBe(400);
  });
  it('404 for an unknown request', async () => {
    expect((await decide({ action: 'reject', reason: 'dup' }, 'nope')).status).toBe(404);
  });
  it('reject goes through approve and writes the audit row with the reason', async () => {
    approveReply = { status: 200, body: { ok: true, status: 'rejected' } };
    const res = await decide({ action: 'reject', reason: 'not in the club area' });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(forwardedBodies).toEqual([{ id: 'r1', action: 'reject' }]);
    expect(body).toMatchObject({ status: 'rejected', auditStored: true, reason: 'not in the club area' });
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({ table: 'join_request_audit', row: { request_id: 'r1', action: 'reject', reason: 'not in the club area', group_id: null, actor_email: APPROVER.email, actor_athlete_id: 'a-coach', suggested_group_id: 'g2' } });
  });
  it('acceptSuggestion approves into the suggested pack', async () => {
    const res = await decide({ action: 'approve', acceptSuggestion: true });
    expect(res.status).toBe(200);
    expect(forwardedBodies).toEqual([{ id: 'r1', action: 'approve', groupId: 'g2' }]);
    expect(inserted[0].row).toMatchObject({ action: 'approve', group_id: 'g2', group_source: 'suggestion', reason: null });
  });
  it('the approver\'s group wins over the suggestion', async () => {
    await decide({ action: 'approve', groupId: 'g1', acceptSuggestion: true, reason: 'ran 2:29 last month' });
    expect(forwardedBodies[0]).toEqual({ id: 'r1', action: 'approve', groupId: 'g1' });
    expect(inserted[0].row).toMatchObject({ group_id: 'g1', group_source: 'approver', suggested_group_id: 'g2', reason: 'ran 2:29 last month' });
  });
  it('without groupId or acceptSuggestion the suggestion is NOT applied', async () => {
    approveReply = { status: 400, body: { error: 'group-required' } };
    const res = await decide({ action: 'approve' });
    expect(res.status).toBe(400);
    expect(forwardedBodies[0]).toEqual({ id: 'r1', action: 'approve' });
    expect(inserted).toEqual([]);
  });
  it('acceptSuggestion with no suggestion → 400 no-suggestion', async () => {
    rows.signup_requests[0].intake = null;
    const res = await decide({ action: 'approve', acceptSuggestion: true });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('no-suggestion');
    expect(forwardedBodies).toEqual([]);
  });
  it('already handled → no audit row', async () => {
    approveReply = { status: 200, body: { ok: true, alreadyHandled: 'approved' } };
    await decide({ action: 'approve', groupId: 'g1' });
    expect(inserted).toEqual([]);
  });
  it('before migration 350 the decision stands, auditStored false', async () => {
    insertError = { code: '42P01', message: 'relation "join_request_audit" does not exist' };
    const res = await decide({ action: 'reject', reason: 'duplicate' });
    expect(res.status).toBe(200);
    expect((await res.json()).auditStored).toBe(false);
  });
});
