import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { isSyntheticAuthEmail } from '@/lib/auth/athlete-identity';
import { mergeAthleteRows } from '@/lib/auth/merge-athletes';

export const dynamic = 'force-dynamic';

/**
 * POST /api/auth/claim-member/confirm  { token }
 *
 * The other end of the claim link (migration 098): the member clicked it in their
 * own inbox, so the address on their roster row has just been proven to be theirs,
 * and the Strava sign-in that asked can be folded into it.
 *
 * NO SESSION IS REQUIRED, and that is the design rather than an omission. The claim
 * is opened on whatever device the mail was read on — usually not the phone the PWA
 * is installed on — and demanding the shell's session there would defeat the one
 * flow that exists for people the app cannot recognise. The token is the
 * authorisation: single-use, half an hour, and it names both rows itself, so
 * nothing here depends on who is holding it beyond the fact that it arrived in the
 * right mailbox.
 *
 * POST, not GET on the link. A mail client that pre-fetches links — several do, for
 * previews and for malware scanning — would otherwise merge two accounts before the
 * member had read the sentence explaining what the button does. /claim/[token] is a
 * page with a button, and this is the button.
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as { token?: string };
    const token = (body.token || '').trim();
    if (!/^[0-9a-f]{64}$/.test(token)) {
      return NextResponse.json({ error: 'bad-token' }, { status: 400 });
    }

    // Service role throughout: athlete_claims has RLS on with no policies (nothing
    // reachable from a browser may read a live claim token), and the merge function
    // is revoked from anon and authenticated.
    const admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    // Claim and read in ONE statement, the same way /api/auth/claim-login consumes
    // a login handoff: `claimed_at IS NULL` in the WHERE clause is what makes the
    // token single-use under a race. A read-then-write lets a double-tap — or a mail
    // client racing the reader — run the merge twice, and the second run has a
    // deleted row for a duplicate.
    const { data: claim, error } = await admin
      .from('athlete_claims')
      .update({ claimed_at: new Date().toISOString() })
      .eq('token', token)
      .is('claimed_at', null)
      .gt('expires_at', new Date().toISOString())
      .select('shell_athlete_id, target_athlete_id, sent_to')
      .maybeSingle();

    if (error) {
      // Includes 42P01 until migration 098 is applied by hand.
      console.error('claim-confirm: lookup failed', error);
      return NextResponse.json({ error: 'unavailable' }, { status: 503 });
    }
    // Expired, already used, or never existed — one answer for all three, because
    // the distinction is only useful to somebody guessing tokens. The page tells
    // the member what to do about it.
    if (!claim) return NextResponse.json({ error: 'expired' }, { status: 410 });

    // Re-read both rows at the moment of the merge rather than trusting what was
    // written half an hour ago: the shell may already have been merged by the
    // approver from the queue, or by the member's own next Strava login.
    const { data: rows } = await admin
      .from('athletes')
      .select('id, name, email')
      .in('id', [claim.shell_athlete_id, claim.target_athlete_id]);
    const shell = (rows || []).find(r => r.id === claim.shell_athlete_id);
    const target = (rows || []).find(r => r.id === claim.target_athlete_id);

    if (!target) return NextResponse.json({ error: 'gone' }, { status: 410 });
    if (!shell) {
      // Somebody already tidied this up. Nothing to do, and it is not a failure —
      // the member's account is intact, which is what they came here for.
      return NextResponse.json({ ok: true, alreadyMerged: true, athleteName: target.name });
    }
    // The direction is fixed and checked here as well as in SQL: the row that goes
    // is the one the app invented. If the shell somehow holds a real address, this
    // is not the claim flow's business.
    if (!isSyntheticAuthEmail(shell.email)) {
      console.error('claim-confirm: refusing to merge away a real address', { shell: shell.id });
      return NextResponse.json({ error: 'refused' }, { status: 409 });
    }

    const merged = await mergeAthleteRows(admin, {
      duplicateId: shell.id,
      realId: target.id,
      reason: `self-claim:${claim.sent_to}`,
    });
    if (!merged.merged) {
      return NextResponse.json({ error: merged.error || 'merge-failed' }, { status: 500 });
    }

    return NextResponse.json({ ok: true, athleteName: target.name });
  } catch (err) {
    console.error('claim-confirm failed:', err);
    return NextResponse.json({ error: 'failed' }, { status: 500 });
  }
}
