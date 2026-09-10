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
 * Narrowed on 2026-09-08 to `role='admin'` OR `is_super_user`, and again on
 * 2026-09-09 to `role='admin'` alone, with `is_super_user` demoted to a fallback
 * for the case where no admin row exists. The second narrowing is the one the
 * club owner reported: `is_super_user` is a permission flag, he carries it on his
 * RUNNER account as well as the admin one, so every bug report notified him twice
 * — once per account, with the two copies indistinguishable.
 *
 * These tests exist because the rule is invisible from the outside: nothing in the
 * app says who a notification went to, so widening this function back — or
 * "fixing" it by re-adding a source that looks obviously missing — would go
 * unnoticed until somebody counted push receipts. The assertions below say that a
 * COACH IS NOT A RECIPIENT, that a super-user's other accounts are NOT
 * RECIPIENTS, and that both are on purpose.
 *
 * The known cost is recorded in staff.ts: a plain coach does not hear that one of
 * their athletes reported pain. If that gets fixed, it must be fixed by giving
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

/** The club's real shape: one admin account, plus the owner's runner account. */
const CLUB = { admin: 'club-admin', ownerRunner: 'ofer-runner' };

beforeEach(() => {
  calls.length = 0;
  answer = () => ({ data: [], error: null });
});

describe('staffRecipientIds', () => {
  it('asks one question — role=admin — and stops there', async () => {
    answer = () => ({ data: [{ id: CLUB.admin }], error: null });
    await staffRecipientIds();
    expect(calls).toEqual([{ table: 'athletes', column: 'role', value: 'admin' }]);
  });

  it('does not notify a super-user on their other accounts', async () => {
    // The reported bug, in one test. `is_super_user` grants admin ABILITIES; it is
    // not a statement about which of a person's accounts should be mailed. The
    // owner holds it on his runner account, so using it as the recipient list
    // wrote two inbox rows per bug report — one to Madregot Admin, one to Ofer
    // Grosfeld — and nothing on the row said which was which.
    answer = (call) =>
      call.column === 'is_super_user'
        ? { data: [{ id: CLUB.admin }, { id: CLUB.ownerRunner }], error: null }
        : { data: [{ id: CLUB.admin }], error: null };
    await expect(staffRecipientIds()).resolves.toEqual([CLUB.admin]);
    expect(calls.some((c) => c.column === 'is_super_user')).toBe(false);
  });

  it('never resolves a recipient by email address', async () => {
    // APPROVER_EMAILS was one of the four old sources. It is also the source that
    // looks most obviously like a bug when it is missing, so it is the one most
    // likely to be re-added by someone reading notifyStaff in isolation.
    await staffRecipientIds();
    expect(calls.some((c) => c.column === 'email')).toBe(false);
  });

  it('does not make a coach a recipient — the whole point of the narrowing', async () => {
    answer = () => ({ data: [{ id: CLUB.admin }], error: null });
    await staffRecipientIds();
    const roleQueries = calls.filter((c) => c.column === 'role');
    expect(roleQueries).toHaveLength(1);
    // A single literal 'admin', not a list that a role could be appended to.
    expect(roleQueries[0].value).toBe('admin');
    expect(calls.some((c) => c.column === 'is_approver')).toBe(false);
  });

  it('falls back to is_super_user when there is no admin row at all', async () => {
    // The fallback is not a second opinion — it is the guarantee that a bug report
    // can never resolve to nobody. A club whose admin row was renamed or deleted
    // must still reach whoever holds the keys.
    answer = (call) =>
      call.column === 'is_super_user'
        ? { data: [{ id: CLUB.ownerRunner }], error: null }
        : { data: [], error: null };
    await expect(staffRecipientIds()).resolves.toEqual([CLUB.ownerRunner]);
  });

  it('falls back when the role answer itself is unreadable', async () => {
    answer = (call) =>
      call.column === 'role'
        ? { error: { code: '42703' } }
        : { data: [{ id: CLUB.ownerRunner }, { id: CLUB.ownerRunner }], error: null };
    // And dedupes: a duplicated id means a duplicated push and two inbox rows for
    // the same event, which is the shape of the bug this whole change is about.
    await expect(staffRecipientIds()).resolves.toEqual([CLUB.ownerRunner]);
  });

  it('returns an empty list when neither source can answer', async () => {
    // Migration 084 (`is_super_user`) is hand-applied, so the fallback may hit a
    // 42703 on a database that never ran it. Empty, not a throw.
    answer = () => ({ error: { code: '42703' } });
    await expect(staffRecipientIds()).resolves.toEqual([]);
  });

  it('returns an empty list rather than throwing when everything fails', async () => {
    // Every caller is a side-effect on somebody else's successful request: a
    // notification failure must not fail the bug report that triggered it.
    answer = () => { throw new Error('connection refused'); };
    await expect(staffRecipientIds()).resolves.toEqual([]);
  });
});
