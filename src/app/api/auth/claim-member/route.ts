import { NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { createServerClient } from '@/lib/supabase/server';
import { authError, requireSession } from '@/lib/auth-session';
import { isSyntheticAuthEmail } from '@/lib/auth/athlete-identity';
import { notifyAthleteClaim } from '@/lib/email';

export const dynamic = 'force-dynamic';

/**
 * POST /api/auth/claim-member  { email }
 *
 * "אני כבר חבר במדרגות" — the member's own way out of a duplicate, with nobody
 * else involved.
 *
 * The story this closes: somebody joined by email months ago, signs in with Strava
 * today, and Strava hands us a numeric id and a display name but no address. The
 * callback matches their roster row across scripts where it can and merges it
 * (migration 097), and an approver can confirm a near match from the queue. What
 * neither can do is act on a name that carries too little signal to be evidence —
 * "Roey Roth" reduces to r·r·t — so that member lands on /pending-approval as a
 * stranger, holding a brand-new empty account, while their real one sits in the
 * roster with all their history in it.
 *
 * They can prove it themselves, though: they control the mailbox their roster row
 * is keyed on. This route takes the address they type, and if it belongs to a
 * member, mails THAT ADDRESS a single-use link (migration 098) which merges the two
 * rows. The typed address is never trusted — it only decides where the proof is
 * sent.
 *
 * ── WHY THE ANSWER IS ALWAYS THE SAME ────────────────────────────────────────────
 * `{ ok: true }` whether or not the address matched anybody. Any signed-in Strava
 * account can call this, so a per-address yes/no would turn it into an oracle for
 * "is this person in the club" — a membership list, one guess at a time. The person
 * who typed their own address correctly gets an email; everybody else gets silence,
 * which is also what they should get.
 */

/** A shell may ask a handful of times an hour. Enough for a typo and a retry; not
 *  enough to walk a list of addresses, and not enough to be a way of mailing
 *  club members. */
const MAX_PER_HOUR = 5;

export async function POST(request: Request) {
  try {
    const auth = await requireSession(request);
    if (!auth.ok) return authError(auth);

    // Only a Strava sign-in that landed on a shell row has anything to claim. A
    // member signed into their real account asking to be merged into another
    // account is the thing this must never do — that direction deletes a real row,
    // and it is not a decision to take from a form.
    if (!auth.user.athleteId || !isSyntheticAuthEmail(auth.user.email)) {
      return NextResponse.json({ error: 'not-a-strava-signin' }, { status: 400 });
    }
    const shellId = auth.user.athleteId;

    const body = (await request.json().catch(() => ({}))) as { email?: string };
    const email = (body.email || '').trim().toLowerCase();
    // Not validation for its own sake: an address that cannot be an address will
    // never match a roster row, so answering early saves the reads.
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: 'bad-email' }, { status: 400 });
    }

    const supabase = createServerClient();

    const { count } = await supabase
      .from('athlete_claims')
      .select('id', { count: 'exact', head: true })
      .eq('shell_athlete_id', shellId)
      .gt('created_at', new Date(Date.now() - 3600_000).toISOString());
    if ((count ?? 0) >= MAX_PER_HOUR) {
      // The one case worth naming: the person is stuck and needs to know to stop
      // trying and ask the coach, rather than typing variations of their address.
      return NextResponse.json({ error: 'too-many' }, { status: 429 });
    }

    // `status` is deliberately not filtered. A member who was invited but never
    // finished — `invited`, because the club's mail could not be delivered — is
    // exactly the person most likely to end up here.
    const { data: matches } = await supabase
      .from('athletes')
      .select('id, name, email')
      .eq('email', email)
      .limit(2);
    const target = (matches || []).find(a => a.id !== shellId && !isSyntheticAuthEmail(a.email));

    if (target) {
      const token = randomBytes(32).toString('hex');
      const { error: insertError } = await supabase.from('athlete_claims').insert({
        token,
        shell_athlete_id: shellId,
        target_athlete_id: target.id,
        sent_to: email,
      });
      if (insertError) {
        // Includes "relation does not exist" until 098 has been pasted into the SQL
        // editor — migrations here are applied by hand. This one does NOT hide
        // behind the uniform answer: the caller is a member who will otherwise
        // wait for an email that was never going to arrive.
        console.error('claim-member: could not record the claim', insertError);
        return NextResponse.json({ error: 'claim-unavailable' }, { status: 503 });
      }
      // The mail is the whole feature, so its failure is reported. Everything else
      // about this route is uniform on purpose; this is not, because a member
      // staring at "check your email" with nothing in their inbox has no way to
      // tell that the sender domain is unverified.
      const sent = await notifyAthleteClaim({
        email,
        token,
        stravaName: auth.user.name || null,
        targetName: target.name || null,
        athleteId: target.id,
      });
      if (!sent.ok) {
        console.error('claim-member: the claim mail did not go out', sent.reason);
        return NextResponse.json({ ok: false, error: 'email-failed', reason: sent.reason ?? null }, { status: 502 });
      }
    }

    // Same answer for "mailed" and "no such member". See the header.
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('claim-member failed:', err);
    return NextResponse.json({ error: 'failed' }, { status: 500 });
  }
}
