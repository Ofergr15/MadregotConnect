import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * "לקבל התראה עם שם הבן אדם שמנסה להתחבר" — the admin, 2026-09-11, two hours after
 * the club's newest member signed in through Strava.
 *
 * What he had been sent, straight out of `scheduled_notifications` in production:
 *
 *     👋 בקשת הרשמה חדשה
 *     Strava Athlete · 26 בקשות ממתינות לאישור
 *
 * The alert already interpolated a name. The problem was upstream of the wording:
 * the Strava callback hands this queue `stravaDisplayName || "Strava <id>"`, so a
 * stand-in for a name arrives indistinguishable from a name, and Strava itself
 * answers firstname "Strava" / lastname "Athlete" for a profile it will not
 * disclose. And when that fell through, the fallback was `input.email` — which for
 * a Strava sign-in is the synthetic strava_<id>@strava.madregot.local, an address
 * the app invented for its own JWTs and that no human has ever seen.
 *
 * So these hold the two ends of the fix at once: the identity comes from the ROW
 * (which a merge inside the same login may have improved) with the provider name
 * behind it and the real address's local part behind that, and NOTHING that is not
 * a name is allowed onto a coach's lock screen.
 */

/** athletes rows the fake DB answers with, keyed by id. */
let athletes: Record<string, { name: string | null; email: string | null }>;
let pendingCount: number;
let insertError: { code: string } | null;
/** The push copy notifyStaff was handed, rendered in both languages. */
let pushed: { he: { title: string; body: string }; en: { title: string; body: string } } | null;
/** The arguments the approver email was called with. */
let mailArgs: { email: string; name?: string | null; groupName?: string | null } | null;

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({
    from(table: string) {
      if (table === 'signup_requests') {
        return {
          insert: () => Promise.resolve({ error: insertError }),
          // .select('id', { count: 'exact', head: true }).eq('status', 'pending')
          select: () => ({
            eq: () => Promise.resolve({ count: pendingCount, error: null }),
          }),
        };
      }
      // athletes: .select('name, email').eq('id', …).maybeSingle()
      let wanted: string | null = null;
      const chain = {
        select: () => chain,
        eq: (_col: string, val: string) => { wanted = val; return chain; },
        maybeSingle: () => Promise.resolve({ data: (wanted && athletes[wanted]) || null, error: null }),
      };
      return chain;
    },
  }),
}));

vi.mock('@/lib/notifications/staff', () => ({
  notifyStaff: async (opts: { copy: (locale: 'he' | 'en') => { title: string; body: string } }) => {
    pushed = { he: opts.copy('he'), en: opts.copy('en') };
    return { recipients: 1, sent: 1 };
  },
}));

vi.mock('@/lib/email', () => ({
  notifyAdminNewSignupRequest: async (req: { email: string; name?: string | null; groupName?: string | null }) => {
    mailArgs = req;
    return { sent: true };
  },
}));

const { queuePendingStravaSignup } = await import('@/lib/signup-queue');

const STRAVA_ID = 659081577;
const SYNTHETIC = `strava_${STRAVA_ID}@strava.madregot.local`;
const ATHLETE_ID = 'athlete-new';

beforeEach(() => {
  insertError = null;
  pendingCount = 26;
  pushed = null;
  mailArgs = null;
  // The row the Strava callback has just inserted for a stranger: it carries the
  // callback's own "Strava <id>" stand-in, because athletes.name is NOT NULL.
  athletes = { [ATHLETE_ID]: { name: `Strava ${STRAVA_ID}`, email: SYNTHETIC } };
});

const queue = (stravaName: string | null) =>
  queuePendingStravaSignup({ athleteId: ATHLETE_ID, email: SYNTHETIC, stravaName });

describe('the staff sign-up alert names the person trying to get in', () => {
  it('uses the name Strava gave, which is the common case', async () => {
    athletes[ATHLETE_ID] = { name: 'Yosi Sabag', email: SYNTHETIC };
    await queue('Yosi Sabag');
    expect(pushed!.he.body).toBe('Yosi Sabag · 26 בקשות ממתינות לאישור');
    expect(pushed!.en.body).toBe('Yosi Sabag · 26 requests waiting for approval');
  });

  it('prefers the roster name a merge folded in over the provider name', async () => {
    // duplicatesToFold/mergeAthleteRows can resolve this login to the row the club
    // already had, and the Hebrew name on it is the one the coach knows.
    athletes[ATHLETE_ID] = { name: 'רועי רות', email: 'roy.m.roth@gmail.com' };
    await queue('Roy Roth');
    expect(pushed!.he.body).toBe('רועי רות · 26 בקשות ממתינות לאישור');
  });

  it('never announces the synthetic address as if it were a name', async () => {
    // The exact regression: no provider name, so the old code fell back to
    // input.email and sent "strava_659081577@strava.madregot.local מחכה לאישור".
    pendingCount = 1;
    await queue(null);
    expect(pushed!.he.body).not.toContain('strava.madregot.local');
    expect(pushed!.he.body).not.toContain('@');
    expect(pushed!.he.body).toBe('מישהו מחכה לאישור');
    expect(pushed!.en.body).toBe('Someone is waiting for approval');
  });

  it('never announces Strava’s own "Strava Athlete" placeholder as a name', async () => {
    // The alert the admin actually complained about. A name that identifies nobody
    // is worse than an admitted blank: it reads as a person called Strava Athlete.
    athletes[ATHLETE_ID] = { name: 'Strava Athlete', email: SYNTHETIC };
    await queue('Strava Athlete');
    expect(pushed!.he.body).toBe('מישהו · 26 בקשות ממתינות לאישור');
  });

  it('falls back to a real address’s local part before it gives up', async () => {
    // A stranger whose row already holds a real email (they were matched by name,
    // or an admin typed one) but no usable name yet.
    athletes[ATHLETE_ID] = { name: `Strava ${STRAVA_ID}`, email: 'dana.levi92@gmail.com' };
    await queue(null);
    expect(pushed!.he.body).toBe('Dana Levi · 26 בקשות ממתינות לאישור');
  });

  it('still names them when the athletes row cannot be read at all', async () => {
    // The read is an improvement, not a dependency: this whole function is
    // best-effort hung off a sign-in that has already succeeded.
    athletes = {};
    await queue('Shay Noam');
    expect(pushed!.he.body).toBe('Shay Noam · 26 בקשות ממתינות לאישור');
  });

  it('sends the approvers the same resolved name it pushed', async () => {
    // Two channels, one identity — the mail used to get the raw `input.name`, so
    // the subject line and the push could disagree about who was at the door.
    athletes[ATHLETE_ID] = { name: 'Strava Athlete', email: SYNTHETIC };
    await queue('Strava Athlete');
    expect(mailArgs!.name).toBeNull();
    // The synthetic address is still the row's identity and still goes to the mail
    // — notifyAdminNewSignupRequest is what decides never to print it.
    expect(mailArgs!.email).toBe(SYNTHETIC);
  });

  it('announces nothing when the person is already in the queue', async () => {
    // 23505 on the partial unique index over pending emails: pressing "sign in with
    // Strava" again while waiting is one fact, not two.
    insertError = { code: '23505' };
    await queue('Yosi Sabag');
    expect(pushed).toBeNull();
    expect(mailArgs).toBeNull();
  });
});
