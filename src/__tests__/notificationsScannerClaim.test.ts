import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * /api/cron/notifications claims a due row before sending it: the update matches only
 * while the row still has the next_run_at it was read with, so a second, overlapping run
 * (the every-minute cron and a slow one before it) matches nothing and sends nothing.
 */

const due = [
  { id: 'a', status: 'scheduled', schedule_type: 'once_at', next_run_at: '2026-10-18T05:00:00.000Z', audience_type: 'all', audience_id: null, title_he: 'א', body_he: 'ב', sent_count: 0 },
  { id: 'b', status: 'scheduled', schedule_type: 'recurring', recur_interval: 1, recur_unit: 'week', next_run_at: '2026-10-13T05:00:00.000Z', audience_type: 'all', audience_id: null, title_he: 'א', body_he: 'ב', sent_count: 0 },
];
const claimedBy = new Map<string, unknown>();
const lostClaims = new Set<string>();
const send = vi.fn(async () => ({ sent: 3 }));

function table() {
  let filters: Record<string, unknown> = {};
  let patch: Record<string, unknown> | null = null;
  const q = {
    select: () => q,
    not: () => q,
    lte: () => Promise.resolve({ data: due, error: null }),
    update: (p: Record<string, unknown>) => { patch = p; filters = {}; return q; },
    eq: (k: string, v: unknown) => {
      filters[k] = v;
      // The claim is the update that filters on next_run_at, finished by .select('id').
      return q;
    },
    then: (r: (v: unknown) => void) => r({ data: null, error: null }),
  } as Record<string, unknown>;
  (q as { select: unknown }).select = (cols?: string) => {
    if (patch && cols === 'id') {
      const id = filters.id as string;
      if (lostClaims.has(id)) return Promise.resolve({ data: [], error: null });
      claimedBy.set(id, patch);
      return Promise.resolve({ data: [{ id }], error: null });
    }
    return q;
  };
  (q as { eq: unknown }).eq = (k: string, v: unknown) => { filters[k] = v; return q; };
  return q;
}

vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => ({ from: () => table() }) }));
vi.mock('@/lib/push', () => ({ resolveAudience: async () => [{}], sendPushLocalized: (...a: unknown[]) => send(...(a as [])) }));
vi.mock('@/lib/feed/announce', () => ({ publishAnnouncement: async () => {} }));
vi.mock('@/lib/cron-pause', () => ({ cronPaused: async () => false }));

const { GET } = await import('@/app/api/cron/notifications/route');
const run = () => GET(new Request('http://x/api/cron/notifications'));

beforeEach(() => { claimedBy.clear(); lostClaims.clear(); send.mockClear(); delete process.env.CRON_SECRET; });

describe('notification scanner claim', () => {
  it('sends what it claimed, and moves a recurring row past the runs it missed', async () => {
    const body = await (await run()).json();
    expect(body.processed).toBe(2);
    expect(send).toHaveBeenCalledTimes(2);
    expect(claimedBy.get('a')).toMatchObject({ status: 'sent' });
    const next = (claimedBy.get('b') as { next_run_at: string }).next_run_at;
    expect(Date.parse(next)).toBeGreaterThan(Date.now());
  });
  it('sends nothing for a row another run already claimed', async () => {
    lostClaims.add('a');
    const body = await (await run()).json();
    expect(body.processed).toBe(1);
    expect(send).toHaveBeenCalledTimes(1);
  });
});
