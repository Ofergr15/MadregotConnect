// QA 25.11 #2 — POST /api/admin/finance/remind: any read error is a 503 and sends nothing; one reminder
// per athlete per calendar month; the link opens the web inbox (/dashboard/notifications), not /inbox.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const resolveVerifiedCaller = vi.fn();
vi.mock('@/lib/auth/self-or-staff', () => ({ resolveVerifiedCaller: (r: Request) => resolveVerifiedCaller(r) }));
const notifyAthlete = vi.fn(async (_o: { url: string }) => ({ subscriptions: 1, delivered: 1 }));
vi.mock('@/lib/push', () => ({ notifyAthlete: (o: { url: string }) => notifyAthlete(o) }));

type R = { data: unknown; error: unknown };
let tables: Record<string, R> = {};
class Q implements PromiseLike<R> {
  constructor(private t: string) {}
  select() { return this; } eq() { return this; } in() { return this; } gte() { return this; } lt() { return this; }
  order() { return this; } limit() { return this; } maybeSingle() { return this; }
  then<A = R, B = never>(ok?: ((v: R) => A | PromiseLike<A>) | null, bad?: ((e: unknown) => B | PromiseLike<B>) | null): PromiseLike<A | B> {
    return Promise.resolve(tables[this.t] ?? { data: [], error: null }).then(ok, bad);
  }
}
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => ({ from: (t: string) => new Q(t) }) }));

const admin = { denied: null, caller: { athleteId: 'm1', role: 'admin', isSuperUser: false, isStaff: true } };
const post = () => new Request('http://x', { method: 'POST', body: JSON.stringify({ athleteId: 'a1' }) });
const boom = { code: '57014', message: 'canceling statement due to statement timeout' };

beforeEach(() => {
  resolveVerifiedCaller.mockReset(); resolveVerifiedCaller.mockResolvedValue(admin); notifyAthlete.mockClear();
  tables = { athletes: { data: [{ id: 'a1', name: 'A', academy_coach_id: null, academy_band_id: null, academy_joined_on: '2026-01-01' }], error: null } };
});

describe('finance remind guards', () => {
  it('sends once, to /dashboard/notifications', async () => {
    const { POST } = await import('@/app/api/admin/finance/remind/route');
    const res = await POST(post());
    expect(res.status).toBe(200);
    expect(notifyAthlete).toHaveBeenCalledTimes(1);
    expect(notifyAthlete.mock.calls[0][0].url).toBe('/dashboard/notifications');
  });

  it('a payments read error is 503 and nothing is sent', async () => {
    tables.academy_payments = { data: null, error: boom };
    const { POST } = await import('@/app/api/admin/finance/remind/route');
    expect((await POST(post())).status).toBe(503);
    expect(notifyAthlete).not.toHaveBeenCalled();
  });

  it('a billing error that is not "missing table" is 503, not awaiting_link', async () => {
    tables.academy_billing = { data: null, error: boom };
    const { POST } = await import('@/app/api/admin/finance/remind/route');
    expect((await POST(post())).status).toBe(503);
    expect(notifyAthlete).not.toHaveBeenCalled();
  });

  it('already reminded this month → 409, nothing sent; dedupe read error → 503', async () => {
    const { POST } = await import('@/app/api/admin/finance/remind/route');
    tables.scheduled_notifications = { data: [{ id: 'n1', last_sent_at: new Date().toISOString() }], error: null };
    expect((await POST(post())).status).toBe(409);
    tables.scheduled_notifications = { data: null, error: boom };
    expect((await POST(post())).status).toBe(503);
    expect(notifyAthlete).not.toHaveBeenCalled();
  });
});
