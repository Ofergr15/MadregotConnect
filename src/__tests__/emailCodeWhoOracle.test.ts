import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * POST /api/auth/email-code, action 'who'. Only a join link may ask whose it is:
 * answered for a bare address it told anybody "member, first name X" versus 404 —
 * the membership probe `send` was built never to be. Synthetic data only.
 */

const MEMBER = 'member@example.com';
const TOKEN = 'tok_abcdefgh1234';
let athletes: Array<Record<string, unknown>>;

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({
    from(table: string) {
      const filters: Array<[string, unknown]> = [];
      const chain: any = {
        select: () => chain,
        eq: (c: string, v: unknown) => { filters.push([c, v]); return chain; },
        not: () => chain,
        is: () => chain,
        limit: () => chain,
        maybeSingle: () => {
          const rows = table === 'athletes' ? athletes : [];
          const hit = rows.find(r => filters.every(([c, v]) => r[c] === v));
          return Promise.resolve({ data: hit ?? null, error: null });
        },
      };
      return chain;
    },
  }),
}));
vi.mock('@/lib/email', () => ({ notifyLoginCode: vi.fn() }));
vi.mock('@/lib/onboarding/events', () => ({ recordOnbEvent: vi.fn(), deviceFromUa: () => 'test' }));
vi.mock('@/lib/auth/synthetic-session', () => ({ createSyntheticSession: vi.fn() }));

import { POST } from '@/app/api/auth/email-code/route';

const post = (body: unknown) => POST(new Request('http://x/api/auth/email-code', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
}));

describe("POST /api/auth/email-code action 'who'", () => {
  beforeEach(() => {
    athletes = [{ id: 'a1', email: MEMBER, name: 'Synthetic Member', approved: true, status: 'active', invite_token: TOKEN }];
  });

  it('a bare member address gets exactly what an unknown address gets', async () => {
    const member = await post({ action: 'who', email: MEMBER });
    const stranger = await post({ action: 'who', email: 'nobody@example.com' });
    expect(member.status).toBe(404);
    expect(stranger.status).toBe(404);
    const [a, b] = [await member.text(), await stranger.text()];
    expect(a).toBe(b);
    expect(a).not.toContain('Synthetic');
    expect(a).not.toContain('firstName');
  });

  it('the join link still greets its owner', async () => {
    const res = await post({ action: 'who', token: TOKEN });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.firstName).toBe('Synthetic');
    expect(body.maskedEmail).toBe('m•••@example.com');
  });

  it('an email alongside no token cannot borrow the token path', async () => {
    const res = await post({ action: 'who', email: MEMBER, token: '' });
    expect(res.status).toBe(404);
  });
});
