import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@/lib/supabase/server';
import { canApprove } from '@/lib/constants';
import { authError, requireSession } from '@/lib/auth-session';
import { isSyntheticAuthEmail } from '@/lib/auth/athlete-identity';
import { mergeAthleteRows } from '@/lib/auth/merge-athletes';

export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/registrations/link
 * Body: { id: string (signup_request), athleteId: string (the roster row) }
 *
 * "This sign-in is somebody we already have." The other half of the approval
 * queue: approve creates a NEW member, this one says the applicant is an existing
 * one and folds the two rows together.
 *
 * It exists because the automatic path cannot cover everybody. A Strava login now
 * matches a roster row across scripts and merges what it recognises with certainty
 * — but "Roey Roth" against "רועי רוט" reduces to three consonants, and acting on
 * that little would eventually hand one member another member's account. Those
 * sign-ins reach the queue instead, where the screen shows the roster row it looks
 * like and a human decides. One press, and they are back on their own account with
 * their group, their history and their role.
 *
 * The merge itself is merge_athlete_rows (migration 097), the same function the
 * login handler calls, so an admin-confirmed merge and an automatic one behave
 * identically and both land in athlete_merge_log — with the `reason` telling them
 * apart afterwards.
 *
 * DELIBERATELY still guarded: `p_require_synthetic_dup` stays on, so this can only
 * fold away a row the app itself invented (a synthetic strava_<id>@… address). An
 * approver pressing this cannot delete a member's real account by mistyping — two
 * genuine rows for one person is a different job, and a queue button is not where
 * it should live.
 */
export async function POST(request: Request) {
  try {
    const auth = await requireSession(request);
    if (!auth.ok) return authError(auth);
    if (!canApprove(auth.user.email)) {
      return NextResponse.json({ error: 'You are not authorized to approve registrations.' }, { status: 403 });
    }

    const body = (await request.json().catch(() => ({}))) as { id?: string; athleteId?: string };
    const { id, athleteId } = body;
    if (!id || !athleteId) {
      return NextResponse.json({ error: 'id and athleteId are required' }, { status: 400 });
    }

    const supabase = createServerClient();

    const { data: reqRow, error: findError } = await supabase
      .from('signup_requests')
      .select('id, email, status, athlete_id')
      .eq('id', id)
      .maybeSingle();
    if (findError) throw findError;
    if (!reqRow) return NextResponse.json({ error: 'Request not found' }, { status: 404 });
    if (!reqRow.athlete_id) {
      // Nothing to merge: this request never had a row of its own (a public-form
      // application, say). Approving it is the right action, not linking.
      return NextResponse.json(
        { error: 'This request has no account of its own to link — approve it instead.' },
        { status: 400 },
      );
    }
    if (reqRow.athlete_id === athleteId) {
      return NextResponse.json({ error: 'That is the same account.' }, { status: 400 });
    }

    const { data: target } = await supabase
      .from('athletes')
      .select('id, name, email')
      .eq('id', athleteId)
      .maybeSingle();
    if (!target) return NextResponse.json({ error: 'That member no longer exists.' }, { status: 404 });
    if (isSyntheticAuthEmail(target.email)) {
      // Merging one shell into another loses the roster row instead of restoring
      // it — the direction matters, and this is the wrong one.
      return NextResponse.json(
        { error: 'Pick the member’s real account as the destination, not another Strava sign-in.' },
        { status: 400 },
      );
    }

    // Service role: merge_athlete_rows is revoked from anon and authenticated on
    // purpose (nothing reachable from a browser may merge accounts), so the RPC is
    // called with the key, after the canApprove gate above has decided who is asking.
    const admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    const merged = await mergeAthleteRows(admin, {
      duplicateId: reqRow.athlete_id,
      realId: athleteId,
      reason: `admin-link:${auth.user.email}`,
    });
    if (!merged.merged) {
      return NextResponse.json(
        { error: merged.error || 'The merge did not run. Check that migration 097 has been applied.' },
        { status: 500 },
      );
    }

    // The request itself is resolved, not approved: nobody new joined the club.
    // 'member' is exactly this case in the existing vocabulary (migration 089) — a
    // submission from somebody who already had an account. It shows up in the
    // screen's second tab as a record rather than sitting in the queue as a task.
    //
    // athlete_id is repointed first: step 2 of the merge already moved this row
    // onto the real athlete, and leaving it pointing at a deleted id would strand
    // it. (Belt and braces — the FK sweep covers it.)
    const { error: updateError } = await supabase
      .from('signup_requests')
      .update({ status: 'member', athlete_id: athleteId })
      .eq('id', id);
    if (updateError) {
      // The accounts ARE merged at this point, which is the part that matters.
      console.error('Linked the account but failed to close the request:', updateError);
    }

    return NextResponse.json({
      ok: true,
      athleteId,
      athleteName: target.name,
      requestClosed: !updateError,
    });
  } catch (err) {
    console.error('Failed to link a signup request to an existing member:', err);
    return NextResponse.json({ error: 'Failed to link the account' }, { status: 500 });
  }
}
