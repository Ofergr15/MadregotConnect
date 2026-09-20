import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ACADEMY_REMINDER_KINDS,
  REMINDER_AFTER_KIND,
  REMINDER_BEFORE_KIND,
  plannedReminders,
  reminderRow,
  reminderStillOwed,
} from '@/lib/academy/testReminders';

/**
 * The reminder dispatch — the last capability the flow map listed as unbuilt.
 *
 * Two halves, and the interesting one is the second:
 *
 *  1. **What gets written.** Two `scheduled_notifications` rows, and a reminder whose time has
 *     already gone by is dropped rather than written.
 *  2. **What gets WITHHELD.** The follow-up says "we have no result for your test". Sending that
 *     to somebody who ran it proves the app is not reading what they actually did, and no later
 *     apology recovers it. The row is supposed to be cancelled when the result arrives — but that
 *     cancel is a best-effort write in a path that only logs its failures, so the dispatcher
 *     re-reads the invitation before sending and cancels the row instead if the test happened.
 *     These tests are that second guard.
 */

const sendPushLocalized = vi.fn();
const resolveAudience = vi.fn();
vi.mock('@/lib/push', () => ({
  sendPushLocalized: (...args: unknown[]) => sendPushLocalized(...args),
  resolveAudience: (...args: unknown[]) => resolveAudience(...args),
}));

const { dispatchDueTestReminders } = await import('@/lib/academy/testReminders-server');

type Row = Record<string, unknown>;

const db: { scheduled_notifications: Row[]; academy_test_invitations: Row[] } = {
  scheduled_notifications: [], academy_test_invitations: [],
};

/** Just enough of the query builder for this module's four shapes. */
class Query implements PromiseLike<{ data: Row[] | null; error: unknown }> {
  private filters: Array<(r: Row) => boolean> = [];
  private patch: Row | null = null;
  constructor(private table: keyof typeof db) {}

  select() { return this; }
  eq(column: string, value: unknown) { this.filters.push(r => r[column] === value); return this; }
  in(column: string, values: unknown[]) { this.filters.push(r => values.includes(r[column])); return this; }
  lte(column: string, value: string) { this.filters.push(r => String(r[column]) <= value); return this; }
  update(row: Row) { this.patch = row; return this; }

  private rows(): Row[] {
    const matched = db[this.table].filter(r => this.filters.every(f => f(r)));
    if (this.patch) for (const row of matched) Object.assign(row, this.patch);
    return matched;
  }

  maybeSingle() { return Promise.resolve({ data: this.rows()[0] ?? null, error: null }); }

  then<R1 = { data: Row[] | null; error: unknown }, R2 = never>(
    onfulfilled?: ((v: { data: Row[] | null; error: unknown }) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    return Promise.resolve({ data: this.rows(), error: null }).then(onfulfilled, onrejected);
  }
}

const supabase = { from: (table: keyof typeof db) => new Query(table) } as never;

const NOW = '2026-09-20T06:00:00.000Z';
/** Thursday 07:00 Israel. */
const SLOT = '2026-09-24T04:00:00.000Z';

/** A due reminder row, and the invitation it belongs to. */
function seed(kind: string, invite: Row = {}) {
  const id = `notif-${kind}`;
  db.scheduled_notifications.push({
    id, kind, status: 'scheduled', next_run_at: '2026-09-20T05:00:00.000Z',
    title_he: 'כותרת', body_he: 'גוף', title_en: null, body_en: null,
    url: '/dashboard/academy', audience_type: 'athlete', audience_id: 'a1', sent_count: 0,
  });
  db.academy_test_invitations.push({
    id: 'inv-1', athlete_id: 'a1', protocol: '30min', status: 'confirmed',
    confirmed_slot: SLOT, test_id: null,
    reminder_before_id: kind === REMINDER_BEFORE_KIND ? id : null,
    reminder_after_id: kind === REMINDER_AFTER_KIND ? id : null,
    ...invite,
  });
  return db.scheduled_notifications.at(-1) as Row;
}

beforeEach(() => {
  db.scheduled_notifications = [];
  db.academy_test_invitations = [];
  sendPushLocalized.mockReset().mockResolvedValue({ sent: 1, byAthlete: { a1: 1 } });
  resolveAudience.mockReset().mockResolvedValue([{ athlete_id: 'a1', endpoint: 'e' }]);
});

describe('what a confirmed invitation plans', () => {
  const invite = { protocol: '30min', confirmedSlot: SLOT };

  it('plans both reminders, 12 hours before and 2 days after', () => {
    const planned = plannedReminders(invite, NOW);
    expect(planned.map(p => p.which)).toEqual(['before', 'after']);
    expect(planned[0].runAt).toBe('2026-09-23T16:00:00.000Z');
    expect(planned[1].runAt).toBe('2026-09-26T04:00:00.000Z');
    expect(planned.map(p => p.kind)).toEqual([...ACADEMY_REMINDER_KINDS]);
  });

  it('drops the before-reminder once its time has gone', () => {
    // Confirming a slot three hours out: the person is holding the phone that confirmed it, and
    // a row due in the past would be delivered on the very next tick.
    const planned = plannedReminders(invite, '2026-09-24T01:00:00.000Z');
    expect(planned.map(p => p.which)).toEqual(['after']);
  });

  it('plans nothing at all for an invitation with no confirmed time', () => {
    expect(plannedReminders({ protocol: '30min', confirmedSlot: null }, NOW)).toEqual([]);
    expect(plannedReminders({ protocol: '30min', confirmedSlot: 'not a date' }, NOW)).toEqual([]);
  });

  it('says the day in the copy, in both languages', () => {
    const [before, after] = plannedReminders(invite, NOW);
    // Thursday 07:00 Israel — the label the trainee's own card shows for the same slot.
    expect(before.titleHe).toContain('יום ה׳ · 07:00');
    expect(before.titleEn).toContain('07:00');
    expect(after.titleHe).not.toContain('לא ביצעת');
    expect(after.bodyHe).toContain('יום ה׳');
    expect(after.bodyEn.length).toBeGreaterThan(0);
  });

  it('writes a row the scanner can actually find', () => {
    const row = reminderRow(plannedReminders(invite, NOW)[0], 'a1');
    // next_run_at is the column the scan filters on; scheduled_at alone would be a row that is
    // documented as due and never becomes due.
    expect(row.next_run_at).toBe('2026-09-23T16:00:00.000Z');
    expect(row).toMatchObject({
      audience_type: 'athlete', audience_id: 'a1', schedule_type: 'once_at', status: 'scheduled',
      url: '/dashboard/academy',
    });
  });
});

describe('whether a due reminder is still owed', () => {
  it('sends both while the invitation is confirmed and empty-handed', () => {
    const invite = { status: 'confirmed', testId: null };
    expect(reminderStillOwed(REMINDER_BEFORE_KIND, invite)).toBe(true);
    expect(reminderStillOwed(REMINDER_AFTER_KIND, invite)).toBe(true);
  });

  it('withholds the follow-up once a result is linked', () => {
    const invite = { status: 'confirmed', testId: 'test-9' };
    expect(reminderStillOwed(REMINDER_AFTER_KIND, invite)).toBe(false);
    // The before-reminder is unaffected: a result linked to a future test is a correction being
    // filed, not a reason to stop reminding somebody about the test itself.
    expect(reminderStillOwed(REMINDER_BEFORE_KIND, invite)).toBe(true);
  });

  it('withholds everything for a closed or missing invitation', () => {
    for (const status of ['done', 'cancelled', 'other', 'proposed']) {
      expect(reminderStillOwed(REMINDER_BEFORE_KIND, { status, testId: null })).toBe(false);
    }
    expect(reminderStillOwed(REMINDER_AFTER_KIND, null)).toBe(false);
  });
});

describe('dispatching the due reminders', () => {
  it('sends a due reminder and marks the row sent', async () => {
    const row = seed(REMINDER_BEFORE_KIND);
    const result = await dispatchDueTestReminders(supabase, NOW);

    expect(result).toEqual({ sent: 1, withheld: 0 });
    expect(sendPushLocalized).toHaveBeenCalledTimes(1);
    expect(row.status).toBe('sent');
    expect(row.sent_count).toBe(1);
    expect(row.last_sent_at).toBe(NOW);

    // The push the athlete gets: their own screen, and the category the badge counter agrees
    // with (KIND_CATEGORY maps both kinds to 'workouts').
    const payload = sendPushLocalized.mock.calls[0][1]('he');
    expect(payload).toMatchObject({ url: '/dashboard/academy', category: 'workouts' });
  });

  it('withholds the follow-up when the test has been recorded, and cancels the row', async () => {
    const row = seed(REMINDER_AFTER_KIND, { test_id: 'test-9' });
    const result = await dispatchDueTestReminders(supabase, NOW);

    expect(result).toEqual({ sent: 0, withheld: 1 });
    expect(sendPushLocalized).not.toHaveBeenCalled();
    // Cancelled and not left scheduled: otherwise every tick for the rest of time re-examines
    // the same row and re-decides the same thing.
    expect(row.status).toBe('cancelled');
  });

  it('withholds a reminder whose invitation is no longer confirmed', async () => {
    const row = seed(REMINDER_BEFORE_KIND, { status: 'other', confirmed_slot: null });
    expect(await dispatchDueTestReminders(supabase, NOW)).toEqual({ sent: 0, withheld: 1 });
    expect(row.status).toBe('cancelled');
  });

  it('withholds an orphan row whose invitation cannot be found', async () => {
    const row = seed(REMINDER_AFTER_KIND);
    db.academy_test_invitations = [];
    expect(await dispatchDueTestReminders(supabase, NOW)).toEqual({ sent: 0, withheld: 1 });
    expect(row.status).toBe('cancelled');
  });

  it('leaves a reminder that is not due yet alone', async () => {
    const row = seed(REMINDER_BEFORE_KIND);
    row.next_run_at = '2026-09-23T16:00:00.000Z';
    expect(await dispatchDueTestReminders(supabase, NOW)).toEqual({ sent: 0, withheld: 0 });
    expect(row.status).toBe('scheduled');
  });

  it('marks the row sent even when nobody has a push subscription', async () => {
    // A trainee with no subscription still has an inbox, and treating 0 as a failure would mean
    // re-examining the row every five minutes forever.
    resolveAudience.mockResolvedValue([]);
    sendPushLocalized.mockResolvedValue({ sent: 0, byAthlete: {} });
    const row = seed(REMINDER_BEFORE_KIND);
    expect(await dispatchDueTestReminders(supabase, NOW)).toEqual({ sent: 1, withheld: 0 });
    expect(row.status).toBe('sent');
    expect(row.sent_count).toBe(0);
  });

  it('does not let one bad reminder stop the others', async () => {
    seed(REMINDER_BEFORE_KIND);
    db.scheduled_notifications.push({
      ...db.scheduled_notifications[0], id: 'notif-other', kind: REMINDER_AFTER_KIND, status: 'scheduled',
    });
    db.academy_test_invitations[0].reminder_after_id = 'notif-other';
    sendPushLocalized.mockRejectedValueOnce(new Error('web-push exploded'));

    const result = await dispatchDueTestReminders(supabase, NOW);
    expect(result.sent).toBe(1);
    // The one that threw stays scheduled, so the next tick tries it again.
    expect(db.scheduled_notifications[0].status).toBe('scheduled');
  });
});
