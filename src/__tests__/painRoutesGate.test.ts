import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';

/**
 * Pain reports are self-or-scoped-staff; a teammate gets 403. Filing needs the
 * feature on for the caller. Toggling derives every fact from the DB.
 */
let user: any;
vi.mock('@/lib/auth-session', () => ({
  requireSession: async () => ({ ok: true, user }),
  authError: () => new Response(null, { status: 401 }),
}));
vi.mock('@/lib/maintenance', () => ({ readMaintenance: async () => null, maintenanceBlocks: () => false }));
vi.mock('@/lib/push', () => ({ notifyAthlete: async () => ({ subscriptions: 0, delivered: 0 }) }));
vi.mock('@/lib/notifications/staff', () => ({ notifyStaff: async () => ({ recipients: 0, sent: 0 }) }));
vi.mock('@/lib/academy/trainee-coaches', () => ({ coachIdsOf: async () => [], coachIdsByTrainee: async () => new Map() }));
vi.mock('@/lib/academy/thread-server', () => ({ academyManagerAthleteIds: async () => [] }));
vi.mock('@/lib/notifications/routing', () => ({ rolesForKind: async () => null }));

let enablements: any[] = [];
const writes: any[] = [];
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({
    from: (table: string) => {
      const q: any = {
        select: () => q, eq: () => q, in: () => q, gte: () => q, order: () => q, limit: () => q, neq: () => q, is: () => q, contains: () => q,
        update: (u: any) => { writes.push({ table, u }); return q; },
        insert: (u: any) => { writes.push({ table, u }); return q; },
        upsert: async (u: any) => { writes.push({ table, u }); return { error: null }; },
        delete: () => q,
        single: async () => ({ data: { id: 'p1', athlete_id: 'a1', area: 'knee', severity: 4, effect: 'none', status: 'open' }, error: null }),
        maybeSingle: async () => {
          if (table === 'pain_reports') return { data: { id: 'p1', athlete_id: 'a1', area: 'knee', severity: 4, effect: 'none', status: 'open', seen_at: null }, error: null };
          if (table === 'athletes') return { data: { id: 'a1', group_id: 'g1', role: 'runner', extra_roles: [], is_academy: false, name: 'R' }, error: null };
          return { data: null, error: null };
        },
        then: (ok: any) => Promise.resolve({ data: table === 'feature_enablements' ? enablements : [], error: null }).then(ok),
      };
      return q;
    },
  }),
}));

const runner = { email: 'r@x', isSuperUser: false, canApprove: false, isStaff: false, athleteId: 'a1', role: 'runner', roles: ['runner'], isCoreRunner: false };
const teammate = { ...runner, athleteId: 'a2' };
const acCoach = { ...runner, athleteId: 'ac', role: 'academy_coach', roles: ['academy_coach'], isStaff: true };
const coach = { ...runner, athleteId: 'c1', role: 'coach', roles: ['coach'], isStaff: true };

const req = (url: string, body?: unknown, method = body ? 'POST' : 'GET') =>
  new Request(`http://x${url}`, { method, body: body ? JSON.stringify(body) : undefined, headers: { authorization: 'Bearer t' } });
const p = (o: Record<string, string>) => ({ params: Promise.resolve(o) as any });

const list = await import('@/app/api/pain-reports/route');
const one = await import('@/app/api/pain-reports/[id]/route');
const reply = await import('@/app/api/pain-reports/[id]/reply/route');
const enable = await import('@/app/api/features/[feature]/enablements/route');

const painBody = { area: 'knee', side: 'left', severity: 4, since: 'today', effect: 'none' };

beforeEach(() => { writes.length = 0; enablements = []; });

describe('pain reports are never member-visible', () => {
  it('a teammate gets 403 on history and on a report', async () => {
    user = teammate;
    expect((await list.GET(req('/api/pain-reports?athleteId=a1'))).status).toBe(403);
    expect((await one.GET(req('/api/pain-reports/p1'), p({ id: 'p1' }))).status).toBe(403);
    expect((await reply.POST(req('/api/pain-reports/p1/reply', { text: 'hi' }), p({ id: 'p1' }))).status).toBe(403);
  });
  it('an academy coach does not see a club runner\'s pain', async () => {
    user = acCoach;
    expect((await one.GET(req('/api/pain-reports/p1'), p({ id: 'p1' }))).status).toBe(403);
  });
  it('the owner cannot reply as staff; the club coach can read', async () => {
    user = runner;
    expect((await reply.POST(req('/api/pain-reports/p1/reply', { text: 'hi' }), p({ id: 'p1' }))).status).toBe(403);
    user = coach;
    expect((await one.GET(req('/api/pain-reports/p1'), p({ id: 'p1' }))).status).toBe(200);
  });
});

describe('gated rollout', () => {
  it('filing is refused while the feature is off (the default)', async () => {
    user = runner;
    const res = await list.POST(req('/api/pain-reports', painBody));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe('feature_disabled');
    expect(writes.filter((w) => w.table === 'pain_reports')).toHaveLength(0);
  });
  it('filing works once enabled for that athlete', async () => {
    user = runner;
    enablements = [{ feature: 'feedback_pain', scope_type: 'athlete', scope_id: 'a1', enabled: true }];
    expect((await list.POST(req('/api/pain-reports', painBody))).status).toBe(200);
  });
  it('a body athleteId naming someone else is refused', async () => {
    user = runner;
    expect((await list.POST(req('/api/pain-reports', { ...painBody, athleteId: 'a2' }))).status).toBe(403);
  });
  it('a runner cannot toggle; an academy coach cannot toggle a club runner; a club coach can, audited', async () => {
    const body = { scopeType: 'athlete', scopeId: 'a1', enabled: true };
    user = runner;
    expect((await enable.PUT(req('/api/features/feedback_pain/enablements', body, 'PUT'), p({ feature: 'feedback_pain' }))).status).toBe(403);
    user = acCoach;
    expect((await enable.PUT(req('/api/features/feedback_pain/enablements', body, 'PUT'), p({ feature: 'feedback_pain' }))).status).toBe(403);
    user = coach;
    expect((await enable.PUT(req('/api/features/feedback_pain/enablements', body, 'PUT'), p({ feature: 'feedback_pain' }))).status).toBe(200);
    expect(writes.some((w) => w.table === 'feature_enablement_audit' && w.u.set_by === 'c1')).toBe(true);
  });
  it('a coach cannot flip the whole club', async () => {
    user = coach;
    expect((await enable.PUT(req('/api/features/feedback_pain/enablements', { scopeType: 'club', scopeId: '*', enabled: true }, 'PUT'), p({ feature: 'feedback_pain' }))).status).toBe(403);
  });
});

describe('source guards', () => {
  const read = (f: string) => readFileSync(fileURLToPath(new URL(`../${f}`, import.meta.url)), 'utf8');
  it('pain never reaches the feed projection', () => {
    expect(read('lib/feed/project.ts')).not.toMatch(/pain_reports/);
  });
  it('swr-persist skips pain routes', async () => {
    const { neverPersisted } = await import('@/lib/swr-persist');
    expect(neverPersisted('/api/pain-reports?athleteId=a1')).toBe(true);
    expect(neverPersisted('/api/feed')).toBe(false);
  });
  it('the toggle route never reads identity or coach facts off the body', () => {
    const src = read('app/api/features/[feature]/enablements/route.ts');
    expect(src).not.toMatch(/body\??\.(setBy|set_by|isAcademy|coachedByCaller|role)/);
  });
});
