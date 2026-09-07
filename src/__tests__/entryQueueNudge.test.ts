import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * POST /api/admin/entry-queue/nudge — the reminder for somebody nothing is
 * holding out who simply never came in.
 *
 * Two things here are easy to get wrong and neither shows up in a screenshot:
 *
 *  1. **"Sent" must not mean "arrived somewhere".** This is push-only (half the
 *     club signed in through Strava and has no real inbox), so a member with no
 *     push subscription is a silent no-op. The route reports `reachable` so the
 *     button can say "no way to reach them" instead of ticking.
 *  2. **The copy has to match what is actually missing.** Telling somebody who
 *     never opened the app to "connect your watch" is the wrong sentence, and
 *     the branch is decided by credentials — garmin_auth/strava_auth — not by
 *     `data_source`, which all 28 members have set and only 17 have anything
 *     behind.
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
});

describe('POST /api/admin/entry-queue/nudge', () => {
  it('says "connect a watch" to somebody with no credentials on file', async () => {
    const res = await nudge('dana-1');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, reachable: true, missing: 'watch' });
    const copy = (notified!.copy as (l: string) => { title: string })('he');
    expect(copy.title).toMatch(/שעון/);
  });

  it('says "come and finish" once a watch is actually connected', async () => {
    athlete = { id: 'yossi-1', name: 'יוסי', garmin_auth: '<encrypted>', strava_auth: null };
    const res = await nudge('yossi-1');
    expect(await res.json()).toMatchObject({ missing: 'setup' });
    const copy = (notified!.copy as (l: string) => { title: string })('he');
    expect(copy.title).not.toMatch(/שעון/);
  });

  it('reports unreachable when there is no phone to push to', async () => {
    // The whole point: the admin must not see a tick for a send that landed nowhere.
    pushCount = 0;
    const res = await nudge('dana-1');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, reachable: false });
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
