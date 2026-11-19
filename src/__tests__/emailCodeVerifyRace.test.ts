import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * POST /api/auth/email-code action 'verify' under parallel guesses.
 *
 * The old code read `attempts`, compared the code, then wrote attempts + 1. Ten
 * requests fired together all read the same count, all passed the `attempts <
 * MAX_ATTEMPTS` gate and all got a code comparison — ten guesses against a limit of
 * five. The fix claims the slot with a compare-and-set before comparing: the UPDATE
 * only matches while `attempts` still holds the value that request read.
 *
 * The fake DB below models exactly that: reads resolve on a later tick (so all ten
 * read before any write lands), and an UPDATE applies only when every eq()/lt()
 * filter matches the row's CURRENT stored values. Synthetic data only.
 */

const EMAIL = 'racer@example.com';
let row: { id: string; email: string; code_hash: string; expires_at: string; attempts: number; created_at: string };
let compared: number;

const tick = () => new Promise((r) => setTimeout(r, 0));

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({
    from(table: string) {
      const filters: Array<[string, string, unknown]> = [];
      let patch: Record<string, unknown> | null = null;
      let wantRows = false;
      const apply = async () => {
        await tick();
        if (table !== 'login_codes' || !patch) return { data: null, error: null };
        const r = row as unknown as Record<string, unknown>;
        const ok = filters.every(([op, c, v]) => (op === 'eq' ? r[c] === v : (r[c] as number) < (v as number)));
        if (ok) Object.assign(row, patch);
        return { data: wantRows ? (ok ? [{ id: row.id }] : []) : null, error: null };
      };
      const chain: any = {
        select: () => { if (patch) wantRows = true; return chain; },
        update: (p: Record<string, unknown>) => { patch = p; return chain; },
        delete: () => { patch = null; return chain; },
        eq: (c: string, v: unknown) => { filters.push(['eq', c, v]); return chain; },
        lt: (c: string, v: unknown) => { filters.push(['lt', c, v]); return chain; },
        order: () => chain,
        limit: () => chain,
        maybeSingle: async () => {
          await tick();
          if (table === 'login_codes') return { data: { ...row }, error: null };
          return { data: null, error: null };
        },
        then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => apply().then(res, rej),
      };
      return chain;
    },
  }),
}));

vi.mock('@/lib/auth/email-code', async (orig) => ({
  ...(await orig<typeof import('@/lib/auth/email-code')>()),
  // Every guess is wrong; count how many guesses actually got compared.
  codeMatches: () => { compared += 1; return false; },
}));
vi.mock('@/lib/email', () => ({ notifyLoginCode: vi.fn() }));
vi.mock('@/lib/onboarding/events', () => ({ recordOnbEvent: vi.fn(), deviceFromUa: () => 'test' }));
vi.mock('@/lib/auth/synthetic-session', () => ({ createSyntheticSession: vi.fn() }));

import { POST } from '@/app/api/auth/email-code/route';
import { MAX_ATTEMPTS } from '@/lib/auth/email-code';

const verify = (code: string) => POST(new Request('http://x/api/auth/email-code', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ action: 'verify', email: EMAIL, code }),
}));

beforeEach(() => {
  compared = 0;
  row = {
    id: 'lc1', email: EMAIL, code_hash: 'x', attempts: 0,
    expires_at: new Date(Date.now() + 600_000).toISOString(), created_at: new Date().toISOString(),
  };
});

describe("email-code 'verify' cannot be raced past MAX_ATTEMPTS", () => {
  it('10 parallel wrong guesses: at most MAX_ATTEMPTS codes are ever compared', async () => {
    const res = await Promise.all(Array.from({ length: 10 }, (_, i) => verify(String(100000 + i))));
    expect(compared).toBeLessThanOrEqual(MAX_ATTEMPTS);
    expect(row.attempts).toBeLessThanOrEqual(MAX_ATTEMPTS);
    // Each comparison corresponds to exactly one claimed slot.
    expect(compared).toBe(row.attempts);
    const statuses = res.map((r) => r.status);
    expect(statuses.filter((s) => s === 401).length).toBe(compared);
    expect(statuses.filter((s) => s === 429).length).toBe(10 - compared);
  });

  it('sequential guesses still count down and then stop', async () => {
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      const r = await verify('111111');
      expect(r.status).toBe(401);
      expect((await r.json()).left).toBe(MAX_ATTEMPTS - i - 1);
    }
    const after = await verify('111111');
    expect(after.status).toBe(401);
    expect((await after.json()).error).toBe('expired');
    expect(compared).toBe(MAX_ATTEMPTS);
  });
});
