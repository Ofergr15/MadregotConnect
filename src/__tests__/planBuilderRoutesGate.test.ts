import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

/** Every plan-builder route is JWT-verified staff (BUILD-BRIEF item 8). Real gates; only the session is faked. */
let user: any;
vi.mock('@/lib/auth-session', () => ({
  requireSession: async () => (user ? { ok: true, user } : { ok: false, status: 401 }),
  authError: () => new Response(null, { status: 401 }),
}));
vi.mock('@/lib/maintenance', () => ({ readMaintenance: async () => null, maintenanceBlocks: () => false }));
const parsed = vi.fn();
vi.mock('@/lib/ai/parser', async (orig) => ({ ...(await orig<any>()), parseWorkoutPlan: (...a: unknown[]) => parsed(...a) }));
vi.mock('@/lib/push', () => ({ notifyAthlete: async () => ({ subscriptions: 0, delivered: 0 }) }));
vi.mock('next/server', async (orig) => ({ ...(await orig<any>()), after: (fn: () => unknown) => { void fn(); } }));
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({
    from: () => {
      const q: any = {
        select: () => q, eq: () => q, in: () => q, is: () => q, lte: () => q, neq: () => q, order: () => q, limit: () => q,
        update: () => q, insert: () => q, delete: () => q, upsert: async () => ({ error: null }),
        single: async () => ({ data: { id: 'job1', status: 'running' }, error: null }),
        maybeSingle: async () => ({ data: null, error: null }),
        then: (ok: any) => Promise.resolve({ data: [], error: null }).then(ok),
      };
      return q;
    },
  }),
}));

const runner = { email: 'r@x', isSuperUser: false, canApprove: false, isStaff: false, athleteId: 'a1', role: 'runner', isCoreRunner: false };
const coach = { ...runner, athleteId: 'c1', role: 'coach', isStaff: true };
const req = (url: string, body?: unknown, method = body ? 'POST' : 'GET') =>
  new Request(`http://x${url}`, { method, body: body ? JSON.stringify(body) : undefined, headers: { authorization: 'Bearer t' } });
const wk = { params: Promise.resolve({ week: '2026-11-22' }) };

const jobs = await import('@/app/api/plan-builder/parse-jobs/route');
const week = await import('@/app/api/plan-builder/weeks/[week]/route');
const publish = await import('@/app/api/plan-builder/weeks/[week]/publish/route');
const unpublish = await import('@/app/api/plan-builder/weeks/[week]/unpublish/route');
const config = await import('@/app/api/plan-builder/config/route');

beforeEach(() => { parsed.mockReset(); parsed.mockResolvedValue({ workouts: [] }); });

describe('plan-builder routes', () => {
  it('refuse anonymous and runner callers on every mutation, unpublish included', async () => {
    for (const u of [null, runner]) {
      user = u;
      const want = u ? 403 : 401;
      expect((await jobs.POST(req('/p', { week: '2026-11-22', text: 'x' }) as any)).status).toBe(want);
      expect((await week.PUT(req('/w', { body: { workouts: [] } }, 'PUT') as any, wk)).status).toBe(want);
      expect((await publish.POST(req('/p', {}) as any, wk)).status).toBe(want);
      expect((await unpublish.POST(req('/u', {}) as any, wk)).status).toBe(want);
      expect((await config.GET(req('/c') as any)).status).toBe(want);
    }
    expect(parsed).not.toHaveBeenCalled();
  });

  it('a coach gets a job id at once; the parse runs after the reply', async () => {
    user = coach;
    const r = await jobs.POST(req('/p', { week: '2026-11-22', text: 'ראשון 10 ק"מ' }) as any);
    expect(r.status).toBe(202);
    expect(await r.json()).toEqual({ jobId: 'job1' });
    expect(parsed).toHaveBeenCalledOnce();
  });

  it('rejects a week that is not a plan-week Sunday', async () => {
    user = coach;
    expect((await jobs.POST(req('/p', { week: '2026-11-23', text: 'x' }) as any)).status).toBe(400);
  });

  it('every route file under api/plan-builder goes through the staff gate (or gate(): staff, or trainee access with ?athleteId)', () => {
    const walk = (d: string): string[] => readdirSync(d).flatMap((f) => statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]);
    const files = walk('src/app/api/plan-builder').filter((f) => f.endsWith('route.ts'));
    expect(files.length).toBeGreaterThanOrEqual(10);
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      const handlers = (src.match(/export async function (GET|POST|PUT|DELETE)/g) || []).length;
      expect((src.match(/await (staff|gate)\(req\)/g) || []).length, f).toBe(handlers);
    }
  });
});
