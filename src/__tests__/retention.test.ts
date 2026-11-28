import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'fs';
import { RETENTION_RULES, cutoffFor, filtersFor, DAY_MS } from '@/lib/retention/policy';
import { runRetention, retentionModeFromEnv, type RetentionDb } from '@/lib/retention/run';

/** Records every builder call; answers per table. */
type Call = { table: string; kind: 'select' | 'delete'; ops: unknown[][] };
function fakeDb(answer: (c: Call) => { count: number | null; error: { message: string; code?: string } | null } | Error) {
  const calls: Call[] = [];
  const db: RetentionDb = {
    from(table: string) {
      const mk = (kind: Call['kind']) => {
        const c: Call = { table, kind, ops: [] };
        calls.push(c);
        const q: Record<string, unknown> = {};
        for (const m of ['lt', 'in', 'neq', 'not', 'or']) q[m] = (...a: unknown[]) => { c.ops.push([m, ...a]); return q; };
        q.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => {
          const a = answer(c);
          return (a instanceof Error ? Promise.reject(a) : Promise.resolve(a)).then(res, rej);
        };
        return q as never;
      };
      return { select: () => mk('select'), delete: () => mk('delete') };
    },
  };
  return { db, calls };
}

const NOW = Date.UTC(2026, 11, 6, 2, 50); // Valencia morning
const rule = (id: string) => RETENTION_RULES.find((r) => r.id === id)!;

describe('policy', () => {
  it('cutoff = now − days', () => {
    expect(cutoffFor(rule('race_positions'), NOW)).toBe(new Date(NOW - 2 * DAY_MS).toISOString());
    expect(cutoffFor(rule('notifications'), NOW)).toBe(new Date(NOW - 400 * DAY_MS).toISOString());
  });
  it('rule ids and tables are unique; every window is positive', () => {
    expect(new Set(RETENTION_RULES.map((r) => r.id)).size).toBe(RETENTION_RULES.length);
    expect(new Set(RETENTION_RULES.map((r) => r.table)).size).toBe(RETENTION_RULES.length);
    for (const r of RETENTION_RULES) expect(r.days).toBeGreaterThan(0);
  });
  it('notifications: only sent/cancelled, never recurring, never an idempotency ledger row', () => {
    const f = filtersFor(rule('notifications'), NOW);
    expect(f).toContainEqual({ op: 'in', column: 'status', values: ['sent', 'cancelled'] });
    expect(f).toContainEqual({ op: 'neq', column: 'schedule_type', value: 'recurring' });
    expect(f).toContainEqual({ op: 'or', expr: 'url.is.null,url.not.like."#ledger:*"' });
  });
  it('email_log keeps bounces and complaints', () => {
    expect(filtersFor(rule('email_log'), NOW)).toContainEqual({ op: 'notIn', column: 'status', values: ['bounced', 'complained'] });
  });
  it('the doc lists every rule with its window', () => {
    const doc = readFileSync(new URL('../../docs/data-retention.md', import.meta.url), 'utf8');
    for (const r of RETENTION_RULES) expect(doc).toMatch(new RegExp(`\\|\\s*\`${r.table}\`\\s*\\|\\s*\`${r.column}\`\\s*\\|\\s*${r.days} days`));
  });
});

describe('runRetention', () => {
  let n = 0;
  beforeEach(() => { n = 0; });

  it('dry-run by default: counts with head:true selects, deletes nothing', async () => {
    const { db, calls } = fakeDb(() => ({ count: ++n, error: null }));
    const report = await runRetention(db, { nowMs: NOW });
    expect(report.mode).toBe('dry-run');
    expect(calls.every((c) => c.kind === 'select')).toBe(true);
    expect(calls).toHaveLength(RETENTION_RULES.length);
    expect(report.total).toBe((RETENTION_RULES.length * (RETENTION_RULES.length + 1)) / 2);
  });

  it('applies the age filter first, then the extras, to the right table', async () => {
    const { db, calls } = fakeDb(() => ({ count: 0, error: null }));
    await runRetention(db, { nowMs: NOW, mode: 'purge' });
    const notif = calls.find((c) => c.table === 'scheduled_notifications')!;
    expect(notif.kind).toBe('delete');
    expect(notif.ops).toEqual([
      ['lt', 'updated_at', new Date(NOW - 400 * DAY_MS).toISOString()],
      ['in', 'status', ['sent', 'cancelled']],
      ['neq', 'schedule_type', 'recurring'],
      ['or', 'url.is.null,url.not.like."#ledger:*"'],
    ]);
    const email = calls.find((c) => c.table === 'email_log')!;
    expect(email.ops).toContainEqual(['not', 'status', 'in', '(bounced,complained)']);
    const pos = calls.find((c) => c.table === 'race_positions')!;
    expect(pos.ops).toEqual([['lt', 'at', new Date(NOW - 2 * DAY_MS).toISOString()]]);
  });

  it('one failing rule (missing table, thrown error) does not stop the others', async () => {
    const { db } = fakeDb((c) => {
      if (c.table === 'login_handoffs') return { count: null, error: { message: 'relation does not exist', code: '42P01' } };
      if (c.table === 'client_events') return new Error('timeout');
      return { count: 3, error: null };
    });
    const report = await runRetention(db, { nowMs: NOW });
    expect(report.rules.find((r) => r.id === 'login_handoffs')).toMatchObject({ rows: null, error: 'table missing' });
    expect(report.rules.find((r) => r.id === 'client_events')).toMatchObject({ rows: null, error: 'timeout' });
    expect(report.total).toBe(3 * (RETENTION_RULES.length - 2));
  });
});

describe('mode from env', () => {
  it('purges only for RETENTION_PURGE=on exactly', () => {
    expect(retentionModeFromEnv({ RETENTION_PURGE: 'on' })).toBe('purge');
    for (const v of [undefined, '', 'true', '1', 'ON', 'on ']) expect(retentionModeFromEnv({ RETENTION_PURGE: v })).toBe('dry-run');
  });
});

describe('GET /api/cron/retention', () => {
  beforeEach(() => { vi.resetModules(); });

  async function load(env: Record<string, string | undefined>, answer = () => ({ count: 5, error: null })) {
    const { db, calls } = fakeDb(answer);
    vi.doMock('@/lib/supabase/server', () => ({ createServerClient: () => db }));
    vi.doMock('@/lib/cron-pause', () => ({ cronPaused: async () => false }));
    for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v as string);
    const { GET } = await import('@/app/api/cron/retention/route');
    return { GET, calls };
  }
  const req = (auth?: string) => new Request('http://x/api/cron/retention', { headers: auth ? { authorization: auth } : {} }) as never;

  it('401 without CRON_SECRET configured, even with no header (fail closed)', async () => {
    const { GET, calls } = await load({ CRON_SECRET: '' });
    expect((await GET(req())).status).toBe(401);
    expect(calls).toHaveLength(0);
  });
  it('401 on a wrong bearer', async () => {
    const { GET } = await load({ CRON_SECRET: 's3' });
    expect((await GET(req('Bearer nope'))).status).toBe(401);
  });
  it('dry run with the right bearer and no RETENTION_PURGE', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { GET, calls } = await load({ CRON_SECRET: 's3', RETENTION_PURGE: '' });
    const res = await GET(req('Bearer s3'));
    const body = await res.json();
    expect(body.mode).toBe('dry-run');
    expect(calls.every((c) => c.kind === 'select')).toBe(true);
    expect(log.mock.calls[0][0]).toMatch(/^\[retention\] dry-run: notifications=5 /);
    log.mockRestore();
  });
  it('purges with RETENTION_PURGE=on', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { GET, calls } = await load({ CRON_SECRET: 's3', RETENTION_PURGE: 'on' });
    expect((await (await GET(req('Bearer s3'))).json()).mode).toBe('purge');
    expect(calls.every((c) => c.kind === 'delete')).toBe(true);
    log.mockRestore();
  });
});
