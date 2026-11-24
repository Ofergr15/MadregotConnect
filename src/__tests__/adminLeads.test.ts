import { beforeEach, describe, expect, it, vi } from 'vitest';
import { entryStage } from '@/lib/admin/entry-queue';
import { placeCandidate } from '@/lib/academy/funnel';
import { buildLeads, clubStage, type AthleteFacts } from '@/lib/admin/leads';
import { neverPersisted } from '@/lib/swr-persist';

/**
 * The leads screen's data API (GET /api/admin/leads, POST /api/admin/leads/touch).
 *
 *  - staff-only: anonymous 401, a member 403;
 *  - email and phone only for an approver;
 *  - one lead per person, across signup_requests, academy_candidates and u21_registrations;
 *  - the stage is the entry queue's (entryStage) and the intake board's (placeCandidate),
 *    never a third derivation;
 *  - the response never rests on the device.
 */

const NOW = '2026-11-24T10:00:00Z';
const A1 = '11111111-1111-1111-1111-111111111111';
const R1 = '22222222-2222-2222-2222-222222222222';
const C1 = '33333333-3333-3333-3333-333333333333';
const U1 = '44444444-4444-4444-4444-444444444444';
const R2 = '55555555-5555-5555-5555-555555555555';

type Row = Record<string, unknown>;
const db: Record<string, Row[]> = {};
const inserted: Row[] = [];

function reset() {
  for (const k of Object.keys(db)) delete db[k];
  inserted.length = 0;
  Object.assign(db, {
    signup_requests: [
      { id: R1, email: 'Dana@Example.com', status: 'approved', source: 'public-form', created_at: '2026-11-01T08:00:00Z', athlete_id: A1, full_name: 'Dana Levi', phone: '050-1111111' },
      { id: R2, email: 'noam@example.com', status: 'pending', source: 'public-form', created_at: '2026-11-20T08:00:00Z', athlete_id: null, full_name: 'Noam', phone: '050-2222222' },
      { id: '66666666-6666-6666-6666-666666666666', email: 'old@example.com', status: 'pending', source: 'club-backfill', created_at: '2026-09-06T08:00:00Z', athlete_id: null },
    ],
    athletes: [
      { id: A1, name: 'Dana Levi', email: 'dana@example.com', phone: '050-1111111', approved: true, last_seen_at: '2026-11-02T08:00:00Z', garmin_auth: 'x', strava_auth: null },
    ],
    push_subscriptions: [],
    academy_candidates: [
      { id: C1, name: 'Dana Levi', email: 'dana@example.com', phone: null, goal: null, source: 'form', athlete_id: null, archived_at: null, archived_reason: null, created_at: '2026-10-28T08:00:00Z', invited_at: null, accepted_at: null },
    ],
    academy_candidate_events: [{ candidate_id: C1, stage: 'form', occurred_at: '2026-10-28T08:00:00Z' }],
    u21_registrations: [
      { id: U1, track: 'basic', first_name: 'Dana', last_name: 'Levi', email: 'DANA@example.com', phone: '050-1111111', status: 'pending_review', red_flag: false, created_at: '2026-11-10T08:00:00Z' },
    ],
    email_log: [
      { template: 'registration_approved', subject: 'ברוכה הבאה', status: 'sent', recipients: ['dana@example.com'], athlete_id: null, signup_request_id: R1, candidate_id: null, created_at: '2026-11-01T09:00:00Z' },
      { template: 'registration_received', subject: 'קיבלנו', status: 'sent', recipients: ['noam@example.com'], athlete_id: null, signup_request_id: null, candidate_id: null, created_at: '2026-11-20T08:01:00Z' },
    ],
    onboarding_events: [{ athlete_id: A1, signup_request_id: null, step: 'first_open', created_at: '2026-11-02T08:00:00Z' }],
    lead_touches: [{ lead_ref: `u21:${U1}`, kind: 'call', by_id: 'staff-1', at: '2026-11-11T08:00:00Z', note: 'left a message' }],
  });
}

class Query implements PromiseLike<{ data: unknown; error: unknown }> {
  private row: Row | null = null;
  constructor(private table: string) {}
  select() { return this; }
  order() { return this; }
  range() { return this; }
  single() { return this; }
  insert(row: Row) { this.row = { id: 'touch-1', ...row }; inserted.push(this.row); return this; }
  then<T1, T2>(ok?: ((v: { data: unknown; error: unknown }) => T1 | PromiseLike<T1>) | null, bad?: ((e: unknown) => T2 | PromiseLike<T2>) | null) {
    const v = this.row ? { data: this.row, error: null } : { data: db[this.table] ?? null, error: db[this.table] ? null : { code: '42P01' } };
    return Promise.resolve(v).then(ok, bad);
  }
}

vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => ({ from: (t: string) => new Query(t) }) }));
vi.mock('@/lib/maintenance', () => ({ readMaintenance: async () => ({ on: false }) }));

const requireStaffCaller = vi.fn();
vi.mock('@/lib/auth/self-or-staff', () => ({ requireStaffCaller: (r: Request) => requireStaffCaller(r) }));

const staff = (canApprove: boolean) => ({
  denied: null,
  caller: { email: 's@x', isSuperUser: false, canApprove, isStaff: true, athleteId: 'staff-1', role: 'coach', isCoreRunner: false },
});
const deny = (status: number) => ({ denied: new Response(JSON.stringify({ error: 'no' }), { status }), caller: {} });

async function getLeads(qs = '') {
  const { GET } = await import('@/app/api/admin/leads/route');
  return GET(new Request(`http://x/api/admin/leads${qs}`));
}
async function postTouch(body: unknown) {
  const { POST } = await import('@/app/api/admin/leads/touch/route');
  return POST(new Request('http://x/api/admin/leads/touch', { method: 'POST', body: JSON.stringify(body) }));
}

beforeEach(() => { reset(); requireStaffCaller.mockReset(); });

describe('auth', () => {
  it('anonymous gets 401 and a member 403, on both routes', async () => {
    requireStaffCaller.mockResolvedValue(deny(401));
    expect((await getLeads()).status).toBe(401);
    expect((await postTouch({ leadRef: `u21:${U1}`, kind: 'call' })).status).toBe(401);
    requireStaffCaller.mockResolvedValue(deny(403));
    expect((await getLeads()).status).toBe(403);
    expect((await postTouch({ leadRef: `u21:${U1}`, kind: 'call' })).status).toBe(403);
    expect(inserted).toEqual([]);
  });
});

describe('PII', () => {
  it('email and phone reach an approver only, and never through the timeline', async () => {
    requireStaffCaller.mockResolvedValue(staff(false));
    const plain = await (await getLeads()).json();
    expect(plain.leads.length).toBeGreaterThan(0);
    for (const l of plain.leads) { expect(l.email).toBeNull(); expect(l.phone).toBeNull(); }
    expect(JSON.stringify(plain)).not.toMatch(/@example\.com|050-/);

    requireStaffCaller.mockResolvedValue(staff(true));
    const full = await (await getLeads()).json();
    const dana = full.leads.find((l: { name: string }) => l.name === 'Dana Levi');
    expect(dana.email).toBe('dana@example.com');
    expect(dana.phone).toBe('050-1111111');
    expect(JSON.stringify(dana.timeline)).not.toContain('@');
  });
});

describe('one lead per person', () => {
  it('merges the same person across the three sources and skips the backfill', async () => {
    requireStaffCaller.mockResolvedValue(staff(true));
    const { leads } = await (await getLeads()).json();
    expect(leads).toHaveLength(2);
    const dana = leads.find((l: { name: string }) => l.name === 'Dana Levi');
    expect(dana.refs.sort()).toEqual([`academy:${C1}`, `signup:${R1}`, `u21:${U1}`].sort());
    expect(dana.track).toBe('academy');
    expect(dana.since).toBe('2026-10-28T08:00:00Z');
    expect(dana.lastEmail).toBe('2026-11-01T09:00:00Z');
    expect(dana.timeline.map((t: { kind: string }) => t.kind).sort()).toEqual(['email', 'event', 'touch']);
  });

  it('filters by track, stage and date', async () => {
    requireStaffCaller.mockResolvedValue(staff(true));
    expect((await (await getLeads('?track=club')).json()).leads).toHaveLength(2);
    const pending = (await (await getLeads('?stage=pending')).json()).leads;
    expect(pending.map((l: { name: string }) => l.name)).toEqual(['Noam']);
    expect((await (await getLeads('?from=2026-11-15')).json()).leads).toHaveLength(1);
    expect((await getLeads('?track=nope')).status).toBe(400);
  });
});

describe('stage', () => {
  const ath: AthleteFacts = { id: A1, email: 'a@x', name: 'A', phone: null, approved: true, blocked: false, lastSeenAt: '2026-11-02T00:00:00Z', hasWatch: true, hasPush: false };

  it('a club lead carries the entry queue\'s own stage', () => {
    for (const facts of [ath, { ...ath, approved: false }, { ...ath, lastSeenAt: null }, { ...ath, hasPush: true }, { ...ath, blocked: true }]) {
      expect(clubStage({ status: 'approved' }, facts)).toBe(entryStage(facts));
    }
    expect(clubStage({ status: 'pending' }, null)).toBe('pending');
  });

  it('an academy lead carries the intake board\'s stage', () => {
    const c = { id: C1, name: 'X', email: null, phone: null, createdAt: '2026-11-01T00:00:00Z' };
    const events = [{ candidateId: C1, stage: 'form', occurredAt: '2026-11-01T00:00:00Z' }];
    const [lead] = buildLeads({ signups: [], athletes: [], candidates: [c], candidateEvents: events, u21: [], now: NOW });
    expect(lead.stage).toBe(placeCandidate(c, events, NOW).waitingFor);
  });
});

describe('touch', () => {
  it('records the verified caller as the author, ignoring any body field', async () => {
    requireStaffCaller.mockResolvedValue(staff(false));
    const res = await postTouch({ leadRef: `signup:${R2}`, kind: 'call', note: ' rang ', by_id: 'someone-else' });
    expect(res.status).toBe(200);
    expect(inserted[0]).toMatchObject({ lead_ref: `signup:${R2}`, kind: 'call', note: 'rang', by_id: 'staff-1' });
  });

  it('refuses a bad ref or kind', async () => {
    requireStaffCaller.mockResolvedValue(staff(false));
    expect((await postTouch({ leadRef: 'x', kind: 'call' })).status).toBe(400);
    expect((await postTouch({ leadRef: `u21:${U1}`, kind: 'visit' })).status).toBe(400);
    expect((await postTouch({ leadRef: `u21:${U1}`, kind: 'note' })).status).toBe(400);
  });
});

describe('swr-persist', () => {
  it('never persists the leads response', () => {
    expect(neverPersisted('/api/admin/leads?stage=pending')).toBe(true);
  });
});
