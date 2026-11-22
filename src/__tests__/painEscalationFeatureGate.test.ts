import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * runPainFollowups' escalation (pain_no_checkin to coaches) honours the feedback_pain flag
 * (2026-11-22). Synthetic: in-memory pain_reports, mocked flag / recipients / push.
 */
const h = vi.hoisted(() => ({
  enabled: true,
  notified: [] as Array<{ athleteId: string; kind: string }>,
  recipientsAsked: 0,
  updates: [] as Array<Record<string, unknown>>,
}));
vi.mock('@/lib/features/server', () => ({ isFeatureEnabled: vi.fn(async () => h.enabled) }));
vi.mock('@/lib/push', () => ({ notifyAthlete: vi.fn(async (a: { athleteId: string; kind: string }) => { h.notified.push(a); }) }));
vi.mock('@/lib/feedback/pain-server', () => ({ painRecipientIds: vi.fn(async () => { h.recipientsAsked++; return { ids: ['coach-1', 'coach-2'] }; }) }));
vi.mock('@/lib/feedback/pain', async (orig) => ({
  ...(await orig<typeof import('@/lib/feedback/pain')>()),
  followupDue: () => 'escalate',
}));

const OLD = { id: 'rep-old', athlete_id: 'runner-1', area: 'knee', status: 'open', created_at: '2026-10-01T06:00:00Z', last_followup_on: null, escalated_at: null };
const db: any = {
  from: (table: string) => {
    const b: any = {
      select: () => b, eq: () => b, in: () => b, order: () => b, limit: () => b,
      maybeSingle: async () => ({ data: { name: 'Runner' }, error: null }),
      update: (u: Record<string, unknown>) => { h.updates.push({ table, ...u }); return { eq: async () => ({ error: null }), in: async () => ({ error: null }) }; },
      then: (ok: any) => Promise.resolve(table === 'pain_reports' ? { data: [OLD], error: null } : { data: [], error: null }).then(ok),
    };
    return b;
  },
};

beforeEach(() => { h.enabled = true; h.notified = []; h.recipientsAsked = 0; h.updates = []; });

describe('pain escalation and the feedback_pain flag', () => {
  it('feature OFF + an old eligible report: no recipient lookup, no notification, no escalated_at write', async () => {
    h.enabled = false;
    const { runPainFollowups } = await import('@/lib/feedback/followups-server');
    const r = await runPainFollowups(db, new Date('2026-11-22T07:00:00Z'));
    expect(r.escalated).toBe(0);
    expect(h.recipientsAsked).toBe(0);
    expect(h.notified).toEqual([]);
    expect(h.updates.filter((u) => 'escalated_at' in u)).toEqual([]);
  });
  it('feature ON: the coaches are told once and the report is marked escalated', async () => {
    const { runPainFollowups } = await import('@/lib/feedback/followups-server');
    const r = await runPainFollowups(db, new Date('2026-11-22T07:00:00Z'));
    expect(r.escalated).toBe(1);
    expect(h.notified.map((n) => n.athleteId).sort()).toEqual(['coach-1', 'coach-2']);
    expect(h.notified.every((n) => n.kind === 'pain_no_checkin')).toBe(true);
    expect(h.updates.filter((u) => 'escalated_at' in u)).toHaveLength(1);
  });
});
