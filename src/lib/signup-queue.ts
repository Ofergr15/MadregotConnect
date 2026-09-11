import { createServerClient } from '@/lib/supabase/server';
import { notifyStaff } from '@/lib/notifications/staff';
import { signupRequestCopy } from '@/lib/notifications/copy';
import { notifyAdminNewSignupRequest } from '@/lib/email';
import { signupAlertName } from '@/lib/signup';

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
  /**
   * What STRAVA calls them, or null when it disclosed nothing usable.
   *
   * ⚠️ Must be `stravaDisplayNameOf()`'s answer and NOT the callback's own `name`,
   * which falls back to "Strava <id>" so a fresh `athletes` row is never nameless.
   * Handed that fallback, this function cannot tell "Strava knows nothing" from
   * "this person is called X" and announces the placeholder as a name.
   */
  stravaName: string | null;
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

    // WHO IS AT THE DOOR — read from the row, not taken from the caller.
    //
    // The alert used to say `input.name || input.email`, and both halves of that
    // identify nobody in the case this function exists for: a stranger arriving
    // through Strava has no address (so the fallback is the synthetic
    // strava_<id>@strava.madregot.local) and, when Strava withholds their profile
    // name, no provider name either (so the first half is "Strava Athlete"). The
    // admin got exactly that on 2026-09-11 and asked to be told who is trying to
    // get in.
    //
    // The `athletes` row is worth the extra read because it is the one source that
    // can IMPROVE between the insert above and now: this same login may have folded
    // a duplicate into a roster row that already carries a Hebrew name and a real
    // address (duplicatesToFold / mergeAthleteRows), and that name is the one the
    // club knows this person by. A read failure is not an error here — signupAlertName
    // simply has one fewer source and falls back.
    const { data: athlete } = await supabase
      .from('athletes')
      .select('name, email')
      .eq('id', input.athleteId)
      .maybeSingle();

    const who = signupAlertName({
      athleteName: athlete?.name,
      providerName: input.stravaName,
      email: athlete?.email || input.email,
    });

    // Push FIRST, and treat it as the channel that matters. Email here is on its
    // way out: the club's sender is not verified yet, so mail to the approvers is
    // the thing that silently failed for two weeks. A push reaches the phone the
    // coach is already holding.
    await notifyStaff({
      kind: 'signup_request',
      url: '/dashboard/settings?tab=registrations',
      // Per-person tag: two people waiting are two facts, one person signing in
      // twice must not stack. The synthetic address is fine HERE — a tag is an
      // identity key the browser collapses on, never a string anybody reads.
      tag: `signup-request-${input.email}`,
      category: 'management',
      copy: (locale) => signupRequestCopy(locale, { name: who, pending: count ?? 1 }),
    });

    try {
      await notifyAdminNewSignupRequest({
        email: input.email,
        name: who,
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
