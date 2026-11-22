import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Native sign-in & onboarding (design/onboarding-prototype BUILD-BRIEF, migration 189).
 * Gaps 1–7 server-side. Synthetic data only.
 */

// ── a tiny fake Supabase: enough of the builder for these routes ─────────────
type Row = Record<string, unknown>;
let tables: Record<string, Row[]>;
let writes: Array<{ table: string; op: string; patch?: Row; row?: Row }>;

function query(table: string) {
  const filters: Array<(r: Row) => boolean> = [];
  let op: 'select' | 'update' = 'select';
  let patch: Row = {};
  const matched = () => (tables[table] || []).filter((r) => filters.every((f) => f(r)));
  const run = () => {
    if (op === 'update') {
      const hit = matched();
      hit.forEach((r) => Object.assign(r, patch));
      writes.push({ table, op: 'update', patch });
      return { data: hit.map((r) => ({ ...r })), error: null };
    }
    return { data: matched(), error: null };
  };
  const chain: Record<string, unknown> = {
    select: () => chain,
    update: (p: Row) => { op = 'update'; patch = p; return chain; },
    insert: (row: Row) => { (tables[table] ||= []).push({ id: `new-${Math.random()}`, ...row }); writes.push({ table, op: 'insert', row }); return Promise.resolve({ error: null }); },
    eq: (c: string, v: unknown) => { filters.push((r) => r[c] === v); return chain; },
    in: (c: string, v: unknown[]) => { filters.push((r) => v.includes(r[c])); return chain; },
    is: (c: string, v: unknown) => { filters.push((r) => (r[c] ?? null) === v); return chain; },
    order: () => chain,
    limit: () => chain,
    maybeSingle: () => Promise.resolve({ data: run().data[0] ?? null, error: null }),
    single: () => Promise.resolve({ data: run().data[0] ?? null, error: null }),
    then: (res: (v: unknown) => unknown) => Promise.resolve(run()).then(res),
  };
  return chain;
}

vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => ({ from: query }) }));
const routed = vi.fn<(kind: string) => Promise<string[] | null>>();
vi.mock('@/lib/notifications/routing', () => ({ recipientsForKind: (k: string) => routed(k) }));
const mint = vi.fn();
vi.mock('@/lib/auth/member-session', () => ({ mintMemberSession: (...a: unknown[]) => mint(...a) }));

const { POST: status } = await import('@/app/api/public/signup/status/route');
const lib = await import('@/lib/onboarding/signup-status');
const { deriveSetup, applySetupWrite } = await import('@/lib/onboarding/native-setup');
const { devFixedCodeFor } = await import('@/lib/auth/dev-login');
const { transportName } = await import('@/lib/email/transport');
const { APPROVER_EMAILS } = await import('@/lib/constants');

const ID = '11111111-2222-3333-4444-555555555555';
const SECRET = lib.newStatusSecret();
const ask = (body: Row) => status(new Request('https://x.test/api/public/signup/status', { method: 'POST', body: JSON.stringify(body), headers: { 'x-forwarded-for': `10.0.0.${Math.floor(Math.random() * 250)}` } }));

beforeEach(() => {
  lib.__resetRateLimit();
  writes = [];
  routed.mockReset();
  mint.mockReset();
  tables = {
    signup_requests: [{ id: ID, status: 'pending', created_at: '2026-11-21T07:41:00Z', status_secret_hash: lib.hashStatusSecret(SECRET), status_grant_used_at: null, notify_opt_in_at: null, athlete_id: null, approved_by: null }],
    athletes: [
      { id: 'c1', name: 'Yoav Cohen', email: 'coach1@example.test', role: 'coach' },
      { id: 'c2', name: 'Ron Levi', email: 'coach2@example.test', role: 'admin' },
    ],
    groups: [{ id: 'g2', name: 'Group 2 - SUB 2:35' }],
  };
});

describe('gap 2 — POST /api/public/signup/status is keyed by the secret alone', () => {
  it('a wrong secret, a missing secret and an unknown id all answer the same 404', async () => {
    routed.mockResolvedValue(['c1']);
    for (const body of [{ id: ID, secret: lib.newStatusSecret() }, { id: ID }, { id: '99999999-2222-3333-4444-555555555555', secret: SECRET }, { id: 'nope', secret: SECRET }]) {
      const res = await ask(body);
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: 'not-found' });
    }
  });

  it('pending: status, time and approver FIRST NAMES only — no emails, no ids', async () => {
    routed.mockResolvedValue(['c1', 'c2']);
    const res = await ask({ id: ID, secret: SECRET });
    const body = await res.json();
    expect(body).toEqual({ status: 'pending', createdAt: '2026-11-21T07:41:00Z', notify: null, approvers: ['Yoav', 'Ron'] });
    expect(JSON.stringify(body)).not.toMatch(/@|c1|c2/);
    expect(routed).toHaveBeenCalledWith('signup_request');
  });

  it('gap 7: routing null → the mail’s own fallback (APPROVER_EMAILS); [] → []', async () => {
    tables.athletes.push({ id: 'o', name: 'Owner Person', email: APPROVER_EMAILS[0], role: 'coach' });
    routed.mockResolvedValue(null);
    expect((await (await ask({ id: ID, secret: SECRET })).json()).approvers).toEqual(['Owner']);
    routed.mockResolvedValue([]);
    expect((await (await ask({ id: ID, secret: SECRET })).json()).approvers).toEqual([]);
  });

  it('gap 3: "notify me" records the opt-in once and answers what exists — email', async () => {
    routed.mockResolvedValue([]);
    const body = await (await ask({ id: ID, secret: SECRET, notify: true })).json();
    expect(body.notify).toBe('email');
    expect(tables.signup_requests[0].notify_opt_in_at).toBeTruthy();
  });

  it('approved: the session is handed out ONCE, then status only', async () => {
    Object.assign(tables.signup_requests[0], { status: 'approved', athlete_id: 'a1', approved_by: 'coach1@example.test' });
    tables.athletes.push({ id: 'a1', email: 'runner@example.test', name: 'Noa Barak', group_id: 'g2', status: 'invited', approved: true });
    mint.mockResolvedValue({ ok: true, body: { ok: true, athleteId: 'a1', session: { access_token: 't' } } });
    const first = await (await ask({ id: ID, secret: SECRET })).json();
    expect(first.status).toBe('approved');
    expect(first.session.athleteId).toBe('a1');
    expect(first.approvedBy).toBe('Yoav');
    expect(first.group.id).toBe('g2');
    const second = await (await ask({ id: ID, secret: SECRET })).json();
    expect(second.session).toBeUndefined();
    expect(mint).toHaveBeenCalledTimes(1);
  });

  it('a removed member never gets the grant', async () => {
    Object.assign(tables.signup_requests[0], { status: 'approved', athlete_id: 'a1' });
    tables.athletes.push({ id: 'a1', email: 'r@example.test', name: 'X', status: 'removed', approved: true });
    const body = await (await ask({ id: ID, secret: SECRET })).json();
    expect(body.session).toBeUndefined();
    expect(mint).not.toHaveBeenCalled();
  });

  it('declined reads as declined', async () => {
    tables.signup_requests[0].status = 'rejected';
    expect((await (await ask({ id: ID, secret: SECRET })).json()).status).toBe('declined');
  });

  it('is rate limited per request id', async () => {
    routed.mockResolvedValue([]);
    let last = 200;
    for (let i = 0; i < 32; i++) last = (await ask({ id: ID, secret: SECRET })).status;
    expect(last).toBe(429);
  });
});

describe('the secret and the phrasing', () => {
  it('only a hash is stored, and it is compared in constant time', () => {
    const s = lib.newStatusSecret();
    expect(s.length).toBeGreaterThanOrEqual(43);
    expect(lib.statusSecretMatches(s, lib.hashStatusSecret(s))).toBe(true);
    expect(lib.statusSecretMatches(s + 'x', lib.hashStatusSecret(s))).toBe(false);
    expect(lib.statusSecretMatches(s, null)).toBe(false);
  });
  it('approver phrase: 1–2 names, more, none', () => {
    expect(lib.approverPhrase(['יואב', 'רון'])).toBe('יואב או רון מהצוות');
    expect(lib.approverPhrase(['יואב', 'רון', 'דנה'])).toBe('יואב, רון ועוד');
    expect(lib.approverPhrase([])).toBe('צוות המועדון');
  });
  it('signup hands the secret out only to the submission that CREATED the row', () => {
    const r = readFileSync(join(__dirname, '..', 'app/api/public/signup/route.ts'), 'utf8');
    expect(r).toMatch(/\.is\('status_secret_hash', null\)/);
    expect(r).toMatch(/if \(pending\) \{[\s\S]*?return NextResponse\.json\(\{ ok: true, state: 'pending' \}\);/);
  });
});

describe('gap 5 — setup progress', () => {
  it('derives watch/photo, stores only what the person said, names the next step', () => {
    const s = deriveSetup({ garminConnected: true, stravaConnected: false, avatarUrl: null, progress: { notifications: 'skipped' } });
    expect(s.steps.watch).toEqual({ done: true, state: 'garmin' });
    expect(s.steps.notifications.done).toBe(false);
    expect(s.next).toBe('notifications');
    expect(s.doneCount).toBe(1);
    const all = deriveSetup({ garminConnected: false, stravaConnected: false, avatarUrl: 'u', progress: { watch: 'apple', notifications: 'denied', group: 'requested' } });
    expect(all.complete).toBe(true);
    expect(all.next).toBeNull();
  });
  it('rejects a write outside the allowed values', () => {
    expect(applySetupWrite({}, { step: 'group', value: 'confirmed' })).toEqual({ group: 'confirmed' });
    expect(applySetupWrite({}, { step: 'group', value: 'g3' })).toBeNull();
    expect(applySetupWrite({}, { step: 'role', value: 'admin' })).toBeNull();
    expect(applySetupWrite({}, { dismiss: true })?.dismissedAt).toBeTruthy();
  });
});

describe('gap 1 — dev-only fixed code and dev-log transport never reach production', () => {
  const dev = { VERCEL: '1', VERCEL_ENV: 'preview', NEXT_PUBLIC_SUPABASE_URL: 'https://rtcgklespcwvxashhamh.supabase.co', DEV_FIXED_LOGIN_CODE: '123456', DEV_FIXED_LOGIN_EMAILS: 'tester@example.test' };
  it('fixed code: dev project + listed address only', () => {
    expect(devFixedCodeFor('Tester@example.test', dev)).toBe('123456');
    expect(devFixedCodeFor('other@example.test', dev)).toBeNull();
    expect(devFixedCodeFor('tester@example.test', { ...dev, VERCEL_ENV: 'production' })).toBeNull();
    expect(devFixedCodeFor('tester@example.test', { ...dev, NEXT_PUBLIC_SUPABASE_URL: 'https://prodref.supabase.co' })).toBeNull();
    expect(devFixedCodeFor('tester@example.test', { ...dev, DEV_FIXED_LOGIN_CODE: '12' })).toBeNull();
  });
  it('dev-log transport falls back to resend anywhere but dev', () => {
    expect(transportName({ ...dev, EMAIL_TRANSPORT: 'dev-log' })).toBe('dev-log');
    expect(transportName({ ...dev, EMAIL_TRANSPORT: 'dev-log', VERCEL_ENV: 'production' })).toBe('resend');
    expect(transportName({ ...dev, EMAIL_TRANSPORT: 'dev-log', NEXT_PUBLIC_SUPABASE_URL: 'https://prodref.supabase.co' })).toBe('resend');
    expect(transportName({ VERCEL: '1', VERCEL_ENV: 'preview' })).toBe('resend');
  });
});

describe('gap 6 — a removed member is told by mail, the screen stays generic', () => {
  it('the route mails the closed-account notice and answers the same { ok }', () => {
    const r = readFileSync(join(__dirname, '..', 'app/api/auth/email-code/route.ts'), 'utf8');
    expect(r).toMatch(/const closed = await closedMemberFor\(supabase, email\);/);
    expect(r).toMatch(/notifyAccountClosed\(/);
    expect(r).toMatch(/data\.status === 'removed' \|\| data\.status === 'disconnected' \? data : null/);
  });
});

describe('gap 4 — pack change is a request, never a switch', () => {
  it('the athlete route never writes group_id; only the staff decision does', () => {
    const self = readFileSync(join(__dirname, '..', 'app/api/onboarding/group-change/route.ts'), 'utf8');
    expect(self).not.toMatch(/from\('athletes'\)\.update/);
    expect(self).toMatch(/kind: 'group_change_request'/);
    const staff = readFileSync(join(__dirname, '..', 'app/api/admin/group-change-requests/route.ts'), 'utf8');
    expect(staff).toMatch(/requireStaffCaller/);
    expect(staff).toMatch(/\.eq\('status', 'pending'\)/);
  });
});
