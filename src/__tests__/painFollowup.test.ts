import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parseFollowupInput } from '@/lib/feedback/pain-followup';

/**
 * Task 187: staff follow-up on pain reports. Only the routed recipients (and admins) work
 * it; the runner never sees the notes.
 */

describe('parseFollowupInput', () => {
  it('needs a status or a note', () => {
    expect(parseFollowupInput({})).toEqual({ ok: false, error: 'status or note required' });
    expect(parseFollowupInput({ note: '   ' })).toEqual({ ok: false, error: 'status or note required' });
    expect(parseFollowupInput(null).ok).toBe(false);
  });
  it('rejects an unknown status and a non-string note', () => {
    expect(parseFollowupInput({ status: 'resolved' }).ok).toBe(false);
    expect(parseFollowupInput({ note: 5 }).ok).toBe(false);
  });
  it('trims and caps the note', () => {
    const r = parseFollowupInput({ status: 'contacted', note: `  ${'x'.repeat(1200)} ` });
    expect(r.ok && r.value.status).toBe('contacted');
    expect(r.ok && r.value.note!.length).toBe(1000);
  });
});

// ── routes ───────────────────────────────────────────────────────────────────
type Caller = { email: string; isSuperUser: boolean; canApprove: boolean; isStaff: boolean; athleteId: string | null; role: string; roles: string[]; isCoreRunner: boolean; viewingAsBy?: string };
const base: Caller = { email: 'x@x', isSuperUser: false, canApprove: false, isStaff: false, athleteId: null, role: 'runner', roles: ['runner'], isCoreRunner: false };
const runner: Caller = { ...base, athleteId: 'a1' };
const routedCoach: Caller = { ...base, athleteId: 'c1', role: 'coach', roles: ['coach'], isStaff: true };
const unroutedCoach: Caller = { ...base, athleteId: 'c2', role: 'coach', roles: ['coach'], isStaff: true };
const admin: Caller = { ...base, athleteId: 'ad', role: 'admin', roles: ['admin'], isStaff: true };

let caller: Caller;
let report: Record<string, unknown>;
let followups: Array<Record<string, unknown>>;
let writes: Array<{ table: string; op: string; row: Record<string, unknown> }>;
let missing: boolean;
let recipientCalls: number;

vi.mock('@/lib/auth/self-or-staff', () => ({
  resolveVerifiedCaller: async () => ({ denied: null, caller }),
}));
vi.mock('@/lib/feedback/pain-server', async (orig) => ({
  ...(await orig<typeof import('@/lib/feedback/pain-server')>()),
  // staff by scope: every coach/admin; the owner is 'owner'
  callerMaySeePain: async (_db: unknown, c: Caller, runnerId: string) => (c.athleteId === runnerId ? 'owner' : c.isStaff || c.isSuperUser ? 'staff' : null),
  // the pain_report routing resolves to c1 only
  painRecipientIds: async () => { recipientCalls += 1; return { ids: ['c1'], isAcademy: false }; },
}));

const missingCol = { code: '42703', message: 'column "followup_status" does not exist' };
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({
    from(table: string) {
      const q: Record<string, unknown> = {};
      let cols = '';
      const gone = () => missing && (/followup/.test(cols.replace('last_followup_on', '')) || table === 'pain_report_followups');
      Object.assign(q, {
        select: (c: string) => { cols = c || ''; return q; }, eq: () => q, neq: () => q, in: () => q, order: () => q, limit: () => q,
        maybeSingle: async () => {
          if (table === 'pain_reports') return gone() ? { data: null, error: missingCol } : { data: report, error: null };
          return { data: null, error: null };
        },
        insert: async (row: Record<string, unknown>) => { writes.push({ table, op: 'insert', row }); return { error: null }; },
        update: (row: Record<string, unknown>) => { writes.push({ table, op: 'update', row }); return q; },
        then: (ok: (v: unknown) => unknown) => {
          if (table === 'pain_report_followups') return Promise.resolve(gone() ? { data: null, error: { code: '42P01', message: 'relation does not exist' } } : { data: followups, error: null }).then(ok);
          if (table === 'pain_reports') return Promise.resolve(gone() ? { data: null, error: missingCol } : { data: [report], error: null }).then(ok);
          if (table === 'athletes') return Promise.resolve({ data: [{ id: 'c1', name: 'Coach One' }], error: null }).then(ok);
          return Promise.resolve({ data: null, error: null }).then(ok);
        },
      });
      return q;
    },
  }),
}));

const one = await import('@/app/api/pain-reports/[id]/followup/route');
const list = await import('@/app/api/pain-reports/followups/route');
const { shapePain, PAIN_SELECT } = await import('@/lib/feedback/pain-server');

const req = (url: string, body?: unknown) => new Request(`http://x${url}`, { method: body ? 'POST' : 'GET', body: body ? JSON.stringify(body) : undefined });
const p = { params: Promise.resolve({ id: 'p1' }) };

beforeEach(() => {
  caller = routedCoach;
  report = { id: 'p1', athlete_id: 'a1', area: 'knee', severity: 5, effect: 'altered', status: 'open', followup_status: 'open', followup_updated_at: null };
  followups = [{ id: 'f1', author_id: 'c1', status_from: 'open', status_to: 'contacted', note: 'called, resting 3 days', created_at: '2026-11-27T10:00:00Z' }];
  writes = [];
  missing = false;
  recipientCalls = 0;
});

describe('who may work the follow-up', () => {
  it('the runner gets 403 on GET and POST', async () => {
    caller = runner;
    expect((await one.GET(req('/api/pain-reports/p1/followup'), p)).status).toBe(403);
    expect((await one.POST(req('/api/pain-reports/p1/followup', { note: 'x' }), p)).status).toBe(403);
    expect(writes).toEqual([]);
  });
  it('a coach in scope but not routed gets 403', async () => {
    caller = unroutedCoach;
    expect((await one.GET(req('/api/pain-reports/p1/followup'), p)).status).toBe(403);
    expect((await one.POST(req('/api/pain-reports/p1/followup', { status: 'closed' }), p)).status).toBe(403);
    expect(writes).toEqual([]);
  });
  it('an admin may, without the routing lookup', async () => {
    caller = admin;
    expect((await one.GET(req('/api/pain-reports/p1/followup'), p)).status).toBe(200);
    expect(recipientCalls).toBe(0);
  });
  it('viewing-as is read-only', async () => {
    caller = { ...routedCoach, viewingAsBy: 'owner@x' };
    expect((await one.POST(req('/api/pain-reports/p1/followup', { note: 'x' }), p)).status).toBe(403);
  });
  it('a member gets 403 on the queue before any read', async () => {
    caller = runner;
    expect((await list.GET(req('/api/pain-reports/followups'))).status).toBe(403);
  });
});

describe('GET / POST follow-up', () => {
  it('GET returns status and notes with author names', async () => {
    const body = await (await one.GET(req('/api/pain-reports/p1/followup'), p)).json();
    expect(body.status).toBe('open');
    expect(body.notes).toEqual([expect.objectContaining({ id: 'f1', authorName: 'Coach One', statusTo: 'contacted', note: 'called, resting 3 days' })]);
  });
  it('POST status + note writes one row and moves the status', async () => {
    const res = await one.POST(req('/api/pain-reports/p1/followup', { status: 'contacted', note: 'phoned' }), p);
    expect(await res.json()).toEqual({ ok: true, status: 'contacted', changed: true });
    expect(writes[0]).toEqual({ table: 'pain_report_followups', op: 'insert', row: { report_id: 'p1', author_id: 'c1', status_from: 'open', status_to: 'contacted', note: 'phoned' } });
    expect(writes[1]).toMatchObject({ table: 'pain_reports', op: 'update', row: { followup_status: 'contacted', followup_updated_by: 'c1' } });
  });
  it('a note alone does not touch the status', async () => {
    await one.POST(req('/api/pain-reports/p1/followup', { note: 'no answer' }), p);
    expect(writes).toHaveLength(1);
    expect(writes[0].row).toMatchObject({ status_from: null, status_to: null, note: 'no answer' });
  });
  it('same status, no note → no write', async () => {
    const res = await one.POST(req('/api/pain-reports/p1/followup', { status: 'open' }), p);
    expect((await res.json()).changed).toBe(false);
    expect(writes).toEqual([]);
  });
  it('400 on a bad body', async () => {
    expect((await one.POST(req('/api/pain-reports/p1/followup', { status: 'nope' }), p)).status).toBe(400);
  });
  it('before migration 351: GET migrationPending, POST 503', async () => {
    missing = true;
    expect((await (await one.GET(req('/api/pain-reports/p1/followup'), p)).json()).migrationPending).toBe(true);
    expect((await one.POST(req('/api/pain-reports/p1/followup', { note: 'x' }), p)).status).toBe(503);
  });
  it('the queue lists routed reports only', async () => {
    const body = await (await list.GET(req('/api/pain-reports/followups'))).json();
    expect(body.items.map((i: { id: string }) => i.id)).toEqual(['p1']);
    caller = unroutedCoach;
    expect((await (await list.GET(req('/api/pain-reports/followups'))).json()).items).toEqual([]);
  });
});

describe('notes never reach a member response', () => {
  it('the member-facing select and shape carry no follow-up field', () => {
    expect(PAIN_SELECT).not.toMatch(/followup_status|followup_updated|pain_report_followups/);
    const shaped = shapePain({ ...report, followup_status: 'contacted', note: null } as never);
    expect(Object.keys(shaped).some((k) => /followup|notes/i.test(k))).toBe(false);
  });
});
