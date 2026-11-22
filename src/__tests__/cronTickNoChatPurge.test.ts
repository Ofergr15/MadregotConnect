import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// No retention policy for run-together chats was ever approved, so no scheduled job may
// hard-delete them. purgeExpiredChats stays in lib/runs/together-cron.ts for a manual path;
// the tick must not call it, and must not issue a delete on run_meetup_messages at all.

const calls = vi.hoisted(() => ({ deletes: [] as string[], purge: 0, soon: 0, link: 0 }));

function fakeDb() {
  const chain = (table: string): any => {
    const result = { data: [], error: null, count: 0 };
    const p: any = new Proxy(function () {}, {
      get(_t, prop) {
        if (prop === 'then') return (res: any, rej: any) => Promise.resolve(result).then(res, rej);
        if (prop === 'delete') return () => { calls.deletes.push(table); return p; };
        if (prop === 'maybeSingle' || prop === 'single') return () => Promise.resolve({ data: null, error: null });
        return () => p;
      },
      apply() { return p; },
    });
    return p;
  };
  return new Proxy({}, {
    get(_t, prop) {
      if (prop === 'from') return (table: string) => chain(table);
      if (prop === 'rpc') return () => Promise.resolve({ data: null, error: null });
      if (prop === 'storage') return { from: () => chain('storage') };
      return () => chain(String(prop));
    },
  });
}

vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => fakeDb() }));
vi.mock('@/lib/cron-pause', () => ({ cronPaused: async () => false }));
vi.mock('@/lib/runs/together-cron', () => ({
  sendSoonReminders: async () => { calls.soon++; return 0; },
  purgeExpiredChats: async () => { calls.purge++; return 0; },
  linkGroupRuns: async () => { calls.link++; return 0; },
}));
vi.mock('next/server', async (orig) => ({ ...(await orig<any>()), after: () => {} }));

describe('cron/tick never purges run-together chats', () => {
  beforeEach(() => {
    calls.deletes = []; calls.purge = 0; calls.soon = 0; calls.link = 0;
    delete process.env.CRON_SECRET;
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it('a minute<5 tick (when the purge used to run) calls neither purgeExpiredChats nor a chat delete', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-22T10:02:00Z')); // 12:02 Israel, minute < 5
    const { GET } = await import('@/app/api/cron/tick/route');
    await GET(new Request('http://localhost/api/cron/tick'));
    expect(calls.soon).toBe(1); // proves the run-together block was reached
    expect(calls.link).toBe(1); // group-run linking (non-destructive) still runs
    expect(calls.purge).toBe(0);
    expect(calls.deletes).not.toContain('run_meetup_messages');
  }, 30_000);
});
