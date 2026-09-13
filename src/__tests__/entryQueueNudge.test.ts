import { describe, expect, it, vi, beforeEach } from 'vitest';
import { snapshotRowCopy } from '@/lib/notifications/copy';

/**
 * POST /api/admin/entry-queue/nudge — the reminder for somebody nothing is
 * holding out who simply never came in.
 *
 * Two things here are easy to get wrong and neither shows up in a screenshot:
 *
 *  1. **"Sent" must not mean "arrived somewhere".** Push when there is a
 *     subscription, EMAIL when there isn't, and a silent no-op only for the row
 *     with neither — a Strava-only sign-in, whose `.local` address is not an
 *     address. The route reports `reachable` and `emailed` separately so the
 *     button can name the channel instead of ticking.
 *  2. **The copy has to match what is actually missing, by NAME.** Somebody who
 *     never landed inside the app is told about that and nothing else — a photo
 *     they cannot upload is noise. Everybody else gets their open setup tasks
 *     listed, decided by credentials — garmin_auth/strava_auth — not by
 *     `data_source`, which all 28 members have set and only 17 have anything
 *     behind.
 *  3. **The gaps come from the ROW, never from the request.** The message names
 *     things about a member, so a client must not be able to dictate what it
 *     says about them.
 */

let athlete: Record<string, unknown> | null;
let pushCount: number;
let canApprove: boolean;
let isStaff: boolean;
/** What notifyAthlete was handed, so the copy branch is inspectable. */
let notified: Record<string, unknown> | null;

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({
    from: (table: string) => {
      if (table === 'push_subscriptions') {
        return { select: () => ({ eq: async () => ({ count: pushCount, error: null }) }) };
      }
      return {
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: athlete, error: null }) }) }),
      };
    },
  }),
}));

vi.mock('@/lib/auth/self-or-staff', () => ({
  requireStaffCaller: async () => (isStaff
    ? { denied: null, caller: { email: 'strava_1@strava.madregot.local', athleteId: 'admin-1', canApprove, isStaff: true } }
    : { denied: new Response('forbidden', { status: 403 }), caller: null }),
}));

vi.mock('@/lib/push', () => ({
  notifyAthlete: async (args: Record<string, unknown>) => {
    notified = args;
  },
}));

/** What notifyEntryNudge was handed, or null when no mail was attempted. */
let mailed: Record<string, unknown> | null;
let mailOk: boolean;

vi.mock('@/lib/email', () => ({
  notifyEntryNudge: async (args: Record<string, unknown>) => {
    mailed = args;
    return mailOk ? { ok: true, status: 'sent' } : { ok: false, status: 'failed' };
  },
}));

const { POST } = await import('@/app/api/admin/entry-queue/nudge/route');

const nudge = (athleteId?: string) =>
  POST(new Request('https://madregot.app/api/admin/entry-queue/nudge', {
    method: 'POST',
    body: JSON.stringify(athleteId ? { athleteId } : {}),
  }) as never);

beforeEach(() => {
  athlete = { id: 'dana-1', name: 'דנה', garmin_auth: null, strava_auth: null };
  pushCount = 2;
  canApprove = true;
  isStaff = true;
  notified = null;
  mailed = null;
  mailOk = true;
});

describe('POST /api/admin/entry-queue/nudge', () => {
  it('tells somebody who never landed inside about that, and only that', async () => {
    // No last_seen_at: they cannot act on a missing photo, so the message must not
    // mention one — the ONE thing they can do has to be the whole sentence.
    const res = await nudge('dana-1');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, reachable: true, gaps: ['login'] });
    const copy = (notified!.copy as (l: string) => { title: string; body: string })('he');
    expect(copy.body).not.toMatch(/שעון|תמונ/);
  });

  it('names the open setup tasks for a member who is already in', async () => {
    athlete = {
      id: 'yossi-1',
      name: 'יוסי',
      last_seen_at: '2026-09-01T00:00:00Z',
      garmin_auth: '<encrypted>',
      strava_auth: null,
      avatar_url: null,
      phone: null,
    };
    const res = await nudge('yossi-1');
    // 'watch' is done (credentials on file); the rest are named, and
    // 'notifications' is never listed BY a notification.
    expect(await res.json()).toMatchObject({ gaps: ['photo', 'personalInfo', 'sizes'] });
    const copy = (notified!.copy as (l: string) => { title: string; body: string })('he');
    expect(copy.body).toContain('תמונת פרופיל');
    expect(copy.body).not.toMatch(/התראות/);
  });

  it('ignores gaps sent by the caller — the row decides what the message says', async () => {
    const res = await POST(new Request('https://madregot.app/api/admin/entry-queue/nudge', {
      method: 'POST',
      body: JSON.stringify({ athleteId: 'dana-1', gaps: ['sizes'] }),
    }) as never);
    expect(await res.json()).toMatchObject({ gaps: ['login'] });
  });

  it('reports unreachable when there is neither a phone nor an address', async () => {
    // The whole point: the admin must not see a tick for a send that landed nowhere.
    // A Strava-only member is the only row that can still reach this state — the
    // synthetic `.local` address is not somewhere anybody can be written to.
    pushCount = 0;
    athlete = { ...athlete!, email: 'strava_884@strava.madregot.local' };
    const res = await nudge('dana-1');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, reachable: false, emailed: false });
    expect(mailed).toBeNull();
  });

  it('emails a member with no push subscription but a real address', async () => {
    // The regression this file now exists to hold: push-only meant the ONE reminder
    // the app has for somebody who never arrived was undeliverable to exactly the
    // members it was written for. Measured 2026-09-13 — 9 of 23 had no push, and
    // every one of the 9 had a real inbox.
    pushCount = 0;
    athlete = { ...athlete!, email: 'eli@example.com' };
    const res = await nudge('dana-1');
    expect(await res.json()).toMatchObject({ ok: true, reachable: false, emailed: true });
    // Same gaps as the push, resolved from the row — not a second opinion.
    expect(mailed).toMatchObject({ email: 'eli@example.com', gaps: ['login'], athleteId: 'dana-1' });
  });

  it('hands the mail the whole scored checklist, not just the gap names', async () => {
    // "חסר: חיבור שעון, מידות." in running text is the same information and reads as
    // an aside. The mail draws the marked list instead — which needs the FULL state,
    // done rows included, and a score.
    pushCount = 0;
    athlete = {
      id: 'yossi-1',
      name: 'יוסי',
      email: 'yossi@example.com',
      last_seen_at: '2026-09-01T00:00:00Z',
      garmin_auth: '<encrypted>',
      strava_auth: null,
      avatar_url: null,
      phone: null,
    };
    await nudge('yossi-1');
    const setup = mailed!.setup as { doneCount: number; total: number; rows: Array<{ name: string; hint: string; done: boolean }> };
    expect(setup.total).toBe(5);
    expect(setup.rows).toHaveLength(5);
    expect(setup.rows.filter((r) => r.done)).toHaveLength(setup.doneCount);
    // Every row carries its own explanation, and the done ones are listed too.
    expect(setup.rows.every((r) => r.name.length > 0 && r.hint.length > 0)).toBe(true);
    // 'notifications' is dropped from `gaps` (a push cannot ask for push) but belongs
    // in an inbox list — this member has no subscription, which is why they got mail.
    expect(setup.rows.map((r) => r.name)).toContain(snapshotRowCopy('he', { key: 'notifications', done: false }).name);
  });

  it('does not also email somebody whose phone was pushed', async () => {
    // A fallback, not a second copy. Two channels for one prod reads as spam.
    athlete = { ...athlete!, email: 'eli@example.com' };
    const res = await nudge('dana-1');
    expect(await res.json()).toMatchObject({ reachable: true, emailed: false });
    expect(mailed).toBeNull();
  });

  it('says emailed: false when Resend refuses, without failing the nudge', async () => {
    // The push is already away and the approval-mail bug (2026-09-06) was exactly
    // this: a refusal read as success. `ok` must never be inferred from "nothing threw".
    pushCount = 0;
    mailOk = false;
    athlete = { ...athlete!, email: 'eli@example.com' };
    const res = await nudge('dana-1');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, reachable: false, emailed: false });
  });

  it('refuses a staff member who is not an approver', async () => {
    // Unsolicited notification to a named person: the same people who may let
    // somebody in are the people who may prod them.
    canApprove = false;
    const res = await nudge('dana-1');
    expect(res.status).toBe(403);
    expect(notified).toBeNull();
  });

  it('refuses a non-staff caller before reading anything', async () => {
    isStaff = false;
    const res = await nudge('dana-1');
    expect(res.status).toBe(403);
    expect(notified).toBeNull();
  });

  it('404s an unknown athlete, and 400s a request with no id', async () => {
    athlete = null;
    expect((await nudge('ghost')).status).toBe(404);
    expect((await nudge()).status).toBe(400);
    expect(notified).toBeNull();
  });
});
