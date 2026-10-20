import { describe, expect, it, vi } from 'vitest';
import { FLOWS, TEST_EMAILS, editDistance, isTestEmail, orderStates } from '@/lib/testing/flows';
import { fixTestEmail, cleanupTestAccounts } from '@/lib/testing/actions';

describe('the tests screen — flows', () => {
  it('every flow has its own +…20 test address, and only those count as test accounts', () => {
    expect(new Set(Object.values(TEST_EMAILS)).size).toBe(4);
    for (const f of FLOWS) expect(isTestEmail(f.email)).toBe(true);
    expect(isTestEmail('grosfeldofer@gmail.com')).toBe(false);
    expect(isTestEmail('grosfeldofer+test2@gmail.com')).toBe(false);
    expect(isTestEmail(' GROSFELDOFER+club20@gmail.com ')).toBe(true);
  });
  it('the first not-done step is next, the rest wait; a stuck step takes the "next" slot', () => {
    const st = orderStates([{ key: 'a', done: true }, { key: 'b', done: false }, { key: 'c', done: false }]);
    expect(st.map((s) => s.state)).toEqual(['done', 'next', 'waiting']);
    const stuck = orderStates([{ key: 'a', done: false, stuck: 'typo' }, { key: 'b', done: false }]);
    expect(stuck.map((s) => s.state)).toEqual(['stuck', 'waiting']);
  });
  it('catches the real typo from the first run (grosfeldofr+club20@)', () => {
    expect(editDistance('grosfeldofr+club20@gmail.com', TEST_EMAILS.club)).toBe(1);
  });
  it('the club flow tells the tester to sign in with a code, not Strava', () => {
    const club = FLOWS.find((f) => f.id === 'club')!;
    expect(club.steps.find((s) => s.key === 'signed_in')!.do.join(' ')).toContain('כניסה עם קוד במייל');
    expect(club.steps.find((s) => s.key === 'signup')!.values!.find((v) => v.label === 'זמן מרתון')!.value).toBe('23400');
  });
});

/** A tiny fake client recording every write. */
function fakeDb(tables: Record<string, Array<Record<string, any>>>) {
  const writes: Array<{ op: string; table: string; col?: string; vals?: unknown }> = [];
  const q = (table: string) => {
    let rows = [...(tables[table] || [])];
    let op: string | null = null; let patch: any = null;
    const api: any = {
      select: () => api,
      eq: (c: string, v: unknown) => { rows = rows.filter((r) => r[c] === v); if (op) writes.push({ op, table, col: c, vals: v }); return api; },
      in: (c: string, v: unknown[]) => { rows = rows.filter((r) => v.includes(r[c])); if (op) writes.push({ op, table, col: c, vals: v }); return api; },
      limit: () => api,
      maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
      update: (p: any) => { op = 'update'; patch = p; return api; },
      delete: () => { op = 'delete'; return api; },
      then: (res: any) => res({ data: rows, error: null }),
    };
    void patch;
    return api;
  };
  const db: any = { from: q, auth: { admin: { listUsers: vi.fn(async () => ({ data: { users: [{ id: 'u1', email: TEST_EMAILS.club }, { id: 'u2', email: 'real@member.com' }] } })), deleteUser: vi.fn(async () => ({})) } } };
  return { db, writes };
}

describe('the tests screen — writes stay inside the test accounts', () => {
  it('fixes a near-miss address only to a test address', async () => {
    const { db, writes } = fakeDb({ signup_requests: [{ id: 'r1', email: 'grosfeldofr+club20@gmail.com' }, { id: 'r2', email: 'dana@gmail.com' }] });
    expect(await fixTestEmail(db, 'r1', TEST_EMAILS.club)).toBe(true);
    expect(await fixTestEmail(db, 'r2', TEST_EMAILS.club)).toBe(false); // not a near miss
    expect(await fixTestEmail(db, 'r1', 'dana@gmail.com')).toBe(false); // not a test address
    expect(writes.filter((w) => w.op === 'update')).toHaveLength(1);
  });
  it('cleanup deletes by the test addresses and their ids, never a real member', async () => {
    const { db, writes } = fakeDb({
      athletes: [{ id: 'a-test', email: TEST_EMAILS.club }, { id: 'a-real', email: 'real@member.com' }],
      academy_candidates: [{ id: 'c-test', email: TEST_EMAILS.import }, { id: 'c-real', email: 'real@member.com' }],
    });
    await cleanupTestAccounts(db);
    const touched = JSON.stringify(writes);
    expect(touched).not.toContain('a-real');
    expect(touched).not.toContain('c-real');
    expect(touched).not.toContain('real@member.com');
    expect(touched).toContain('a-test');
    expect(db.auth.admin.deleteUser).toHaveBeenCalledWith('u1');
    expect(db.auth.admin.deleteUser).not.toHaveBeenCalledWith('u2');
  });
});
