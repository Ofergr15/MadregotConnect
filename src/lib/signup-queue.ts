import { createServerClient } from '@/lib/supabase/server';
import { notifyStaff } from '@/lib/notifications/staff';
import { signupRequestCopy } from '@/lib/notifications/copy';
import { notifyAdminNewSignupRequest } from '@/lib/email';

/**
 * Put a person in the approval queue, and tell the coaches they are standing there.
 *
 * The queue at /dashboard/settings?tab=registrations reads `signup_requests`. An
 * `athletes` row that is merely un-approved appears on NO screen — which is how a
 * Strava sign-in could leave somebody pending and unreachable at the same time:
 * blocked by the shell, invisible to the only control that could unblock them, with
 * no link and no email in play. The row here is what makes "waiting for approval" a
 * state somebody can actually get out of.
 *
 * Every step is best-effort and nothing throws. Each caller is a side effect on a
 * request that has already succeeded — the account exists whether or not the coach's
 * phone buzzes — so the worst outcome allowed here is a queue entry with no ping,
 * never a sign-in that fails.
 */
export async function queuePendingStravaSignup(input: {
  athleteId: string;
  /** May be the synthetic strava_*@strava.madregot.local address; it is the row's identity either way. */
  email: string;
  /** Their Strava display name — the only human-readable thing the coach has to go on. */
  name: string | null;
  groupName?: string | null;
}): Promise<{ queued: boolean }> {
  try {
    const supabase = createServerClient();

    const { error: insertError } = await supabase.from('signup_requests').insert({
      email: input.email,
      status: 'pending',
      athlete_id: input.athleteId,
      // Free-text provenance (migration 083). Worth distinguishing from
      // 'public-form': this person never typed an address, so the one on the row is
      // synthetic and must not be mailed or shown as theirs.
      source: 'strava-login',
    });

    // 23505 = the partial unique index over pending emails. They already have a
    // request open — pressing "sign in with Strava" again while waiting is the
    // normal thing to do, and it is one fact, not two. Nothing to insert and
    // nothing to announce a second time.
    if (insertError) {
      if (insertError.code === '23505') return { queued: true };
      console.error('Failed to queue a pending Strava signup:', insertError);
      return { queued: false };
    }

    // The pending total rides along so a burst of sign-ups reads as one growing
    // queue rather than N interchangeable pings — same as the public form's.
    const { count } = await supabase
      .from('signup_requests')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending');

    // Push FIRST, and treat it as the channel that matters. Email here is on its
    // way out: the club's sender is not verified yet, so mail to the approvers is
    // the thing that silently failed for two weeks. A push reaches the phone the
    // coach is already holding.
    await notifyStaff({
      kind: 'signup_request',
      url: '/dashboard/settings?tab=registrations',
      // Per-person tag: two people waiting are two facts, one person signing in
      // twice must not stack.
      tag: `signup-request-${input.email}`,
      category: 'management',
      copy: (locale) => signupRequestCopy(locale, { name: input.name || input.email, pending: count ?? 1 }),
    });

    try {
      await notifyAdminNewSignupRequest({
        email: input.email,
        name: input.name,
        groupName: input.groupName ?? null,
      });
    } catch (mailErr) {
      console.error('Failed to email the approvers about a pending Strava signup:', mailErr);
    }

    return { queued: true };
  } catch (err) {
    // Includes 42P01 if migration 083 was never applied in this environment.
    console.error('Failed to queue a pending Strava signup:', err);
    return { queued: false };
  }
}
