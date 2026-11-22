import { beforeEach, describe, expect, it, vi } from 'vitest';
import { recentSubmits, serializeByKey, u21DedupeKey, U21_MAX_PER_EMAIL_PER_HOUR } from '@/lib/u21/register-guard';

/**
 * POST /api/u21/register under concurrent identical submits, and the per-email hourly cap.
 * The fake DB reads a snapshot when the statement starts and answers a tick later, so two
 * concurrent requests both read before either inserts — the read-then-insert race.
 * `unique` models migration 202's partial unique index on dedupe_key; `noColumn` models 183
 * not yet pasted (PostgREST rejects the unknown column). Synthetic data only.
 */

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
const fakeJwt = (p: Record<string, unknown>) => `${b64({ alg: 'HS256' })}.${b64(p)}.sig`;
const REF = 'rtcgklespcwvxashhamh';
vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', `https://${REF}.supabase.co`);
vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', fakeJwt({ role: 'service_role', ref: REF }));
vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', fakeJwt({ role: 'anon', ref: REF }));

type Row = Record<string, any>;
let rows: Row[] = [];
let unique = false;
let noColumn = false;
let failWith: Row | null = null;
const tick = () => new Promise((r) => setTimeout(r, 2));

function fakeDb() {
  return {
    from: (_t: string) => {
      const eqs: Record<string, unknown> = {};
      let gte: string | null = null;
      const chain: any = {
        select: () => chain,
        eq: (c: string, v: unknown) => { eqs[c] = v; return chain; },
        gte: (_c: string, v: string) => { gte = v; return chain; },
        limit: () => chain,
        then: (res: any, rej: any) => {
          const snap = rows.filter((r) => Object.entries(eqs).every(([k, v]) => r[k] === v) && (!gte || r.created_at >= gte))
            .map((r) => ({ track: r.track, created_at: r.created_at }));
          return tick().then(() => ({ data: snap, error: null })).then(res, rej);
        },
        insert: async (row: Row) => {
          await tick();
          if (failWith) return { error: failWith };
          if (noColumn && 'dedupe_key' in row) return { error: { code: 'PGRST204', message: "Could not find the 'dedupe_key' column of 'u21_registrations' in the schema cache" } };
          if (unique && row.dedupe_key && rows.some((r) => r.dedupe_key === row.dedupe_key)) {
            return { error: { code: '23505', message: 'duplicate key value violates unique constraint "u21_registrations_dedupe_key_uidx"' } };
          }
          rows.push({ ...row, created_at: new Date().toISOString() });
          return { error: null };
        },
      };
      return chain;
    },
  };
}
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => fakeDb() }));

import { POST } from '@/app/api/u21/register/route';

const yearsAgo = (y: number) => { const d = new Date(); d.setFullYear(d.getFullYear() - y); d.setDate(d.getDate() - 1); return d.toISOString().slice(0, 10); };
const answers = {
  firstName: 'נועה', lastName: 'כהן', email: 'race@example.com', phone: '0501234567', birthDate: yearsAgo(19),
  framework: 'מכינה קדם־צבאית', goal: 'גיבוש', experience: 'אין ניסיון', runsPerWeek: '0', strengthExperience: 'אין',
  availableDays: ['שני'], sleepHours: '6–7', chestPain: 'no', fainting: 'no', bonePain: 'no', acuteInjury: 'no',
};
let ipN = 0;
const req = (body: unknown) => new Request('http://x/api/u21/register', {
  method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.9.${ipN++ % 250}.${ipN % 250}` }, body: JSON.stringify(body),
});
const RECEIVED = JSON.stringify({ ok: true, status: 'pending_review' });

beforeEach(() => { rows = []; unique = false; noColumn = false; failWith = null; });

describe('the race this fixes', () => {
  it('the bare read-then-insert dedupe lets two concurrent identical submits both through', async () => {
    const db = fakeDb();
    // Both read before either writes: neither sees a recent submit.
    const [a, b] = await Promise.all([recentSubmits(db, 'race@example.com', 'basic'), recentSubmits(db, 'race@example.com', 'basic')]);
    expect(a).toEqual({ sameTrackRecent: false, lastHour: 0 });
    expect(b).toEqual({ sameTrackRecent: false, lastHour: 0 });
    await Promise.all([db.from('u21_registrations').insert({ email: 'race@example.com', track: 'basic' }), db.from('u21_registrations').insert({ email: 'race@example.com', track: 'basic' })]);
    expect(rows).toHaveLength(2);
  });
});

describe('POST /api/u21/register — concurrent identical submits', () => {
  it('same instance: serialized by email+track, so only one row lands and both answer the same 200', async () => {
    const res = await Promise.all([1, 2, 3].map(() => POST(req({ track: 'basic', answers }))));
    for (const r of res) expect([r.status, await r.text()]).toEqual([200, RECEIVED]);
    expect(rows).toHaveLength(1);
    expect(rows[0].dedupe_key).toBe(u21DedupeKey('race@example.com', 'basic'));
  });

  it('cross instance (no shared in-flight map): the unique index rejects the second, answered as the same 200', async () => {
    unique = true;
    // Simulate two instances: two separately imported route modules, each with its own map.
    vi.resetModules();
    const { POST: other } = await import('@/app/api/u21/register/route');
    const [a, b] = await Promise.all([POST(req({ track: 'basic', answers })), other(req({ track: 'basic', answers }))]);
    expect([a.status, await a.text()]).toEqual([200, RECEIVED]);
    expect([b.status, await b.text()]).toEqual([200, RECEIVED]);
    expect(rows).toHaveLength(1);
  });

  it('before migration 202: the missing dedupe_key column falls back to a plain insert', async () => {
    noColumn = true;
    const r = await POST(req({ track: 'pro', answers }));
    expect([r.status, await r.text()]).toEqual([200, RECEIVED]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).not.toHaveProperty('dedupe_key');
  });

  it('a 23505 on another constraint (not dedupe_key) is a real failure: redacted 500', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    failWith = { code: '23505', message: 'duplicate key value violates unique constraint "u21_registrations_pkey"' };
    const r = await POST(req({ track: 'advanced', answers }));
    expect([r.status, await r.text()]).toEqual([500, JSON.stringify({ error: 'Could not save' })]);
    spy.mockRestore();
  });

  it('any other insert error is still a redacted 500, not swallowed as a duplicate', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    failWith = { code: '23514', message: 'violates check constraint "u21_guardian_for_minors"' };
    const r = await POST(req({ track: 'advanced', answers }));
    expect([r.status, await r.text()]).toEqual([500, JSON.stringify({ error: 'Could not save' })]);
    spy.mockRestore();
  });
});

describe('per-email hourly cap (cross-instance, from u21_registrations)', () => {
  it(`stores at most ${U21_MAX_PER_EMAIL_PER_HOUR} per email per hour across tracks and IPs; the rest get the same 200`, async () => {
    const tracks = ['basic', 'advanced', 'pro', 'basic', 'advanced'];
    const out: string[] = [];
    for (const [i, track] of tracks.entries()) {
      const r = await POST(req({ track, answers: { ...answers, phone: `05012345${10 + i}` } }));
      out.push(`${r.status} ${await r.text()}`);
    }
    expect(new Set(out)).toEqual(new Set([`200 ${RECEIVED}`]));
    expect(rows).toHaveLength(U21_MAX_PER_EMAIL_PER_HOUR);
  });

  it('does not count another address', async () => {
    for (let i = 0; i < 3; i++) await POST(req({ track: ['basic', 'advanced', 'pro'][i], answers }));
    await POST(req({ track: 'basic', answers: { ...answers, email: 'other@example.com' } }));
    expect(rows.filter((r) => r.email === 'other@example.com')).toHaveLength(1);
  });
});

describe('serializeByKey', () => {
  it('runs same-key work one at a time, different keys in parallel, and survives a throw', async () => {
    const log: string[] = [];
    const job = (k: string, n: string, fail = false) => serializeByKey(k, async () => {
      log.push(`start ${n}`); await tick(); log.push(`end ${n}`); if (fail) throw new Error('x');
    });
    await Promise.allSettled([job('a', '1', true), job('a', '2'), job('b', '3')]);
    expect(log.indexOf('end 1')).toBeLessThan(log.indexOf('start 2'));
    expect(log.indexOf('start 3')).toBeLessThan(log.indexOf('end 1'));
  });
});
