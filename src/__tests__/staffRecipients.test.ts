import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * Who receives a management notification.
 *
 * This used to be a union of four sources — APPROVER_EMAILS, any STAFF_ROLES
 * role, `is_super_user` and `is_approver` — which on the real club resolved to
 * NINE people, because `role='admin'` had been handed to five ordinary members
 * and one of the nine was the `Test Coach` fixture row. Every bug report, store
 * order and pain alert went to all of them.
 *
 * Narrowed on 2026-09-08 to `role='admin'` OR `is_super_user`. These tests exist
 * because the narrowing is invisible from the outside: nothing in the app says
 * who a notification went to, so widening this function back — or "fixing" it by
 * re-adding a source that looks obviously missing — would go unnoticed until
 * somebody counted push receipts. The point of the assertions below is that a
 * COACH IS NOT A RECIPIENT, and that this is on purpose.
 *
 * The known cost is recorded in staff.ts: a plain coach no longer hears that one
 * of their athletes reported pain. If that gets fixed, it must be fixed by giving
 * workout-feedback its own recipient list, not by widening this one.
 */

type Call = { table: string; column: string; value: unknown };

const calls: Call[] = [];
let answer: (call: Call) => { data?: Array<{ id: string }>; error?: { code: string } | null };

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({
    from: (table: string) => ({
      select: () => {
        // Both `.eq()` and `.in()` are recorded, so a source re-added in either
        // shape shows up — the old email source was an `.in()`.
        const record = (column: string, value: unknown) => {
          const call = { table, column, value };
          calls.push(call);
          return Promise.resolve(answer(call));
        };
        return { eq: record, in: record };
      },
    }),
  }),
}));

// staff.ts pulls the whole push stack in for notifyStaff; staffRecipientIds
// touches none of it, and importing the real module would drag in web-push +
// VAPID env just to resolve a list of ids.
vi.mock('@/lib/push', () => ({
  localesForAthletes: vi.fn(),
  persistNotifications: vi.fn(),
  sendPushLocalized: vi.fn(),
  subscriptionsForAthletes: vi.fn(),
}));

const { staffRecipientIds } = await import('@/lib/notifications/staff');

beforeEach(() => {
  calls.length = 0;
  answer = () => ({ data: [], error: null });
});

describe('staffRecipientIds', () => {
  it('asks exactly two questions: role=admin, and is_super_user', async () => {
    await staffRecipientIds();
    expect(calls).toEqual([
      { table: 'athletes', column: 'role', value: 'admin' },
      { table: 'athletes', column: 'is_super_user', value: true },
    ]);
  });

  it('never resolves a recipient by email address', async () => {
    // APPROVER_EMAILS was one of the four old sources. It is also the source that
    // looks most obviously like a bug when it is missing, so it is the one most
    // likely to be re-added by someone reading notifyStaff in isolation.
    await staffRecipientIds();
    expect(calls.some((c) => c.column === 'email')).toBe(false);
  });

  it('does not make a coach a recipient — the whole point of the narrowing', async () => {
    await staffRecipientIds();
    const roleQueries = calls.filter((c) => c.column === 'role');
    expect(roleQueries).toHaveLength(1);
    // A single literal 'admin', not a list that a role could be appended to.
    expect(roleQueries[0].value).toBe('admin');
    expect(calls.some((c) => c.column === 'is_approver')).toBe(false);
  });

  it('counts an account that is both admin and super-user once', async () => {
    // The club's own admin row is both, and a duplicated id would mean a
    // duplicated push and two inbox rows for the same event.
    answer = () => ({ data: [{ id: 'club-admin' }], error: null });
    await expect(staffRecipientIds()).resolves.toEqual(['club-admin']);
  });

  it('still returns the admins when is_super_user does not exist', async () => {
    // Migration 084 is hand-applied, so a database without the column must fall
    // back to the role answer rather than losing every recipient to a 42703.
    answer = (call) =>
      call.column === 'is_super_user'
        ? { error: { code: '42703' } }
        : { data: [{ id: 'club-admin' }], error: null };
    await expect(staffRecipientIds()).resolves.toEqual(['club-admin']);
  });

  it('returns an empty list rather than throwing when everything fails', async () => {
    // Every caller is a side-effect on somebody else's successful request: a
    // notification failure must not fail the bug report that triggered it.
    answer = () => { throw new Error('connection refused'); };
    await expect(staffRecipientIds()).resolves.toEqual([]);
  });
});
