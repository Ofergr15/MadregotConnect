// QA 25.11 minor: gated-rollout flags enforced on the server, and manager home errors instead of "quiet".
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const flagOn = vi.fn(async (_k: string, _id: string | null) => false);
vi.mock('@/lib/features/server', () => ({ isFeatureEnabled: (k: string, id: string | null) => flagOn(k, id) }));

type R = { data: unknown; error: unknown };
let tables: Record<string, R> = {};
const calls: string[] = [];
class Q implements PromiseLike<R> {
  constructor(private t: string) { calls.push(t); }
  select() { return this; } eq() { return this; } in() { return this; } gte() { return this; } lt() { return this; } lte() { return this; }
  is() { return this; } not() { return this; } neq() { return this; } order() { return this; } limit() { return this; }
  maybeSingle() { return this; } update() { return this; }
  then<A = R, B = never>(ok?: ((v: R) => A | PromiseLike<A>) | null, bad?: ((e: unknown) => B | PromiseLike<B>) | null): PromiseLike<A | B> {
    return Promise.resolve(tables[this.t] ?? { data: [], error: null }).then(ok, bad);
  }
}
const fakeDb = { from: (t: string) => new Q(t) };
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => fakeDb }));

const resolveVerifiedCaller = vi.fn();
vi.mock('@/lib/auth/self-or-staff', () => ({ resolveVerifiedCaller: (r: Request) => resolveVerifiedCaller(r) }));
vi.mock('@/lib/academy/staff-scope', () => ({ staffAthleteScope: async () => null, inScope: <T,>(rows: T[]) => rows }));

beforeEach(() => { flagOn.mockReset().mockResolvedValue(false); tables = {}; calls.length = 0; resolveVerifiedCaller.mockReset(); });

describe('academy_week_moments is enforced server-side', () => {
  it('the scheduled dispatch skips a moment whose author has the flag off', async () => {
    const { dispatchScheduledMoments } = await import('@/lib/academy/week-moments-server');
    tables.academy_week_moments = { data: [{ id: 'm1', author_id: 'coach-1' }], error: null };
    const r = await dispatchScheduledMoments(fakeDb as never, new Date().toISOString());
    expect(r.sent).toBe(0);
    expect(flagOn).toHaveBeenCalledWith('academy_week_moments', 'coach-1');
    expect(calls).toEqual(['academy_week_moments']);   // the select only — nothing claimed, nothing sent
  });

  it.each(['route.ts', 'send/route.ts'])('%s checks the flag on the write', (f) => {
    const s = readFileSync(join(process.cwd(), 'src/app/api/academy/week-moments', f), 'utf8');
    expect(s).toContain("isFeatureEnabled('academy_week_moments', caller.athleteId)");
  });
});

describe('manager home: a failed read is an error, not "quiet"', () => {
  const admin = { denied: null, caller: { athleteId: 'm1', role: 'admin', isSuperUser: true, isStaff: true } };
  it('500 when the pain read fails', async () => {
    resolveVerifiedCaller.mockResolvedValue(admin);
    tables.workout_feedback = { data: null, error: { code: '57014', message: 'timeout' } };
    const { GET } = await import('@/app/api/admin/manager-home/route');
    expect((await GET(new Request('http://x/api/admin/manager-home'))).status).toBe(500);
  });
  it('500 when the requests read fails', async () => {
    resolveVerifiedCaller.mockResolvedValue(admin);
    tables.signup_requests = { data: null, error: { code: '57014', message: 'timeout' } };
    const { GET } = await import('@/app/api/admin/manager-home/route');
    expect((await GET(new Request('http://x/api/admin/manager-home'))).status).toBe(500);
  });
  it('200 and reads thread messages only for the pain rows found', async () => {
    resolveVerifiedCaller.mockResolvedValue(admin);
    const { GET } = await import('@/app/api/admin/manager-home/route');
    expect((await GET(new Request('http://x/api/admin/manager-home'))).status).toBe(200);
    expect(calls).not.toContain('workout_feedback_messages');   // no pain rows → no club-wide message read
  });
});
