// Task 94: per-athlete backoff after repeated Garmin auth failures + the member's reconnect state.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { backoffTier, garminReconnect, isAuthFailing, nextGarminAttemptAt, shouldAttemptGarmin, TICK_MS } from '@/lib/garmin/auth-backoff';

const T0 = Date.parse('2026-11-28T00:00:00Z');
const H = 3_600_000;
const failingSince = (msAgo: number, id = 'ath-1') => ({ id, garmin_auth: 'x', garmin_auth_failed_at: new Date(T0 - msAgo).toISOString(), garmin_last_sync_at: new Date(T0 - msAgo - H).toISOString() });
const attemptsOver = (a: ReturnType<typeof failingSince>, from: number, ms: number) => {
  let n = 0;
  for (let t = from; t < from + ms; t += TICK_MS) if (shouldAttemptGarmin(a, t)) n++;
  return n;
};

describe('isAuthFailing', () => {
  it('a failure after the last good sync is failing; a sync after it heals', () => {
    expect(isAuthFailing('2026-11-28T10:00:00Z', '2026-11-28T09:00:00Z')).toBe(true);
    expect(isAuthFailing('2026-11-28T10:00:00Z', '2026-11-28T11:00:00Z')).toBe(false);
    expect(isAuthFailing('2026-11-28T10:00:00Z', null)).toBe(true);
    expect(isAuthFailing(null, null)).toBe(false);
  });
});

describe('backoff', () => {
  it('tiers by streak age', () => {
    expect([backoffTier(10 * 60_000), backoffTier(2 * H), backoffTier(30 * H)]).toEqual(['every_tick', 'hourly', 'six_hourly']);
  });
  it('a healthy athlete is always attempted', () => {
    expect(shouldAttemptGarmin({ id: 'a', garmin_auth_failed_at: null, garmin_last_sync_at: null }, T0)).toBe(true);
  });
  it('first hour: every tick (a blip heals fast)', () => {
    expect(attemptsOver(failingSince(5 * 60_000), T0, 30 * 60_000)).toBe(6);
  });
  it('1–24 h: exactly once an hour', () => {
    const a = failingSince(3 * H);
    expect(attemptsOver(a, T0, H)).toBe(1);
    expect(attemptsOver(a, T0, 5 * H)).toBe(5);
  });
  it('after a day: once every 6 hours (288/day → 4/day)', () => {
    const a = failingSince(48 * H);
    expect(attemptsOver(a, T0, 24 * H)).toBe(4);
  });
  it('different athletes retry on different ticks', () => {
    const ticks = new Set(['a1', 'b2', 'c3', 'd4', 'e5', 'f6'].map((id) => {
      const a = failingSince(3 * H, id);
      for (let t = T0; t < T0 + H; t += TICK_MS) if (shouldAttemptGarmin(a, t)) return t;
      return -1;
    }));
    expect(ticks.size).toBeGreaterThan(1);
  });
  it('nextGarminAttemptAt lands on an attempt tick; null when healthy', () => {
    const a = failingSince(3 * H);
    const next = nextGarminAttemptAt(a, T0)!;
    expect(shouldAttemptGarmin(a, Date.parse(next))).toBe(true);
    expect(Date.parse(next) - T0).toBeLessThanOrEqual(H);
    expect(nextGarminAttemptAt({ id: 'a', garmin_auth_failed_at: null }, T0)).toBeNull();
  });
});

describe('member reconnect state', () => {
  it('needed with since + next retry while failing', () => {
    const a = failingSince(30 * H);
    expect(garminReconnect(a, T0)).toMatchObject({ needed: true, since: a.garmin_auth_failed_at });
    expect(garminReconnect(a, T0).nextRetryAt).toBeTruthy();
  });
  it('not needed without a credential or once a sync succeeded', () => {
    expect(garminReconnect({ ...failingSince(30 * H), garmin_auth: null }, T0).needed).toBe(false);
    expect(garminReconnect({ id: 'a', garmin_auth: 'x', garmin_auth_failed_at: '2026-11-27T00:00:00Z', garmin_last_sync_at: '2026-11-27T01:00:00Z' }, T0).needed).toBe(false);
  });
});

// ── the sync route uses it ──────────────────────────────────────────────────────────────

const r = vi.hoisted(() => ({ athletes: [] as any[], listCalls: [] as string[], marked: [] as string[], selects: [] as string[], missingHealthCols: false }));
vi.mock('@/lib/garmin/client', () => ({
  GarminClient: class {
    constructor(private auth: { id: string }) {}
    async getActivities() { r.listCalls.push(this.auth.id); throw Object.assign(new Error('401 Unauthorized'), { status: 401 }); }
  },
}));
vi.mock('@/lib/providers/health', async (o) => ({
  ...(await o<object>()),
  markProviderAuthFailed: async (_s: unknown, id: string) => { r.marked.push(id); },
  markProviderSynced: async () => {},
}));
vi.mock('@/lib/auth/self-or-staff', () => ({ requireCallerForAthlete: async () => ({ denied: null }), resolveVerifiedCaller: async () => ({ user: null }) }));
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({
    from: () => {
      let cols = '';
      const q: any = {};
      for (const m of ['eq', 'not', 'neq', 'order']) q[m] = () => q;
      q.select = (c: string) => { cols = c; r.selects.push(c); return q; };
      q.returns = async () => (r.missingHealthCols && cols.includes('garmin_auth_failed_at')
        ? { data: null, error: { code: '42703' } } : { data: r.athletes, error: null });
      return q;
    },
  }),
}));

const runSync = async (body: object) => {
  const { runSyncRequest } = await import('@/app/api/garmin/sync-activities/route');
  return (await runSyncRequest(new Request('http://x', { method: 'POST', body: JSON.stringify(body) }))).json();
};
const athleteRow = (id: string, failingForMs: number | null) => {
  const now = Date.now();
  return failingForMs == null
    ? { id, name: id, garmin_auth: { id }, garmin_auth_failed_at: null, garmin_last_sync_at: new Date(now - H).toISOString() }
    : { id, name: id, garmin_auth: { id }, garmin_auth_failed_at: new Date(now - failingForMs).toISOString(), garmin_last_sync_at: new Date(now - failingForMs - H).toISOString() };
};

describe('garmin sync-activities with the backoff', () => {
  beforeEach(() => { r.listCalls = []; r.marked = []; r.selects = []; r.missingHealthCols = false; });

  it('the broadcast pass skips a credential refused for days unless it is that athlete\'s slot; healthy ones are tried', async () => {
    // Pick an id whose 6-hour slot is NOT the current tick, so the skip is deterministic.
    const tick = Math.floor(Date.now() / TICK_MS);
    const id = ['x1', 'x2', 'x3', 'x4'].find((c) => !shouldAttemptGarmin(athleteRow(c, 48 * H), tick * TICK_MS))!;
    r.athletes = [athleteRow('ok', null), athleteRow(id, 48 * H)];
    const body = await runSync({});
    expect(r.listCalls).toEqual(['ok']);
    expect(body.backedOff).toBe(1);
  });

  it("a member's own sync always tries, and a repeat refusal keeps the streak's first failure time", async () => {
    r.athletes = [athleteRow('me', 48 * H)];
    await runSync({ athleteId: 'me' });
    expect(r.listCalls).toEqual(['me']);
    expect(r.marked).toEqual([]);
  });

  it('a first refusal is marked', async () => {
    r.athletes = [athleteRow('new', null)];
    await runSync({ athleteId: 'new' });
    expect(r.marked).toEqual(['new']);
  });

  it('without the 101 health columns it still selects active_shoe_id and tries everyone', async () => {
    r.missingHealthCols = true;
    r.athletes = [athleteRow('ok', null)];
    await runSync({});
    expect(r.selects[1]).toContain('active_shoe_id');
    expect(r.listCalls).toEqual(['ok']);
  });
});
