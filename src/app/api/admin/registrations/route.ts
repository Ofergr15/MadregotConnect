import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { canApprove } from '@/lib/constants';
import { authError, requireSession } from '@/lib/auth-session';
import { groupDisplayName } from '@/lib/utils';
import {
  isSyntheticAuthEmail,
  rankAthleteCandidates,
  type CandidateConfidence,
  type IdentityRow,
} from '@/lib/auth/athlete-identity';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * GET /api/admin/registrations — the approval queue behind /dashboard/registrations.
 * `?status=pending|approved|rejected|member|all` (default: pending).
 *
 * 'member' is a submission from somebody who already had an account (migration 089).
 * It is a record, not a task: it never has approved_by/rejected_by set and there is
 * nothing to do to it. It shows up under `all`, which is what the screen's second
 * tab asks for, so no filtering change was needed here.
 *
 * Gated on canApprove(), not merely on having a session. This returns a list of
 * strangers' email addresses; any signed-in member could otherwise read it, and
 * "who applied to the club and was turned down" is not club-wide information.
 */
export async function GET(request: Request) {
  try {
    const auth = await requireSession(request);
    if (!auth.ok) return authError(auth);
    if (!canApprove(auth.user.email)) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }

    const status = new URL(request.url).searchParams.get('status') || 'pending';
    const supabase = createServerClient();

    let query = supabase
      .from('signup_requests')
      .select('id, email, group_id, status, created_at, approved_at, approved_by, rejected_at, rejected_by, athlete_id, invite_token')
      // Oldest first for the queue: whoever has been waiting longest is the one
      // to deal with. (An approved/rejected list is nicer newest-first, so it is
      // reversed below rather than ordered twice in SQL.)
      .order('created_at', { ascending: true });

    if (status !== 'all') query = query.eq('status', status);

    const { data: rows, error } = await query;
    if (error) {
      // The table only exists once 083 has been pasted into the SQL editor —
      // migrations here are applied by hand. Say so plainly instead of 500ing,
      // so the page can show the reason rather than "failed to load".
      if (error.code === '42P01') {
        return NextResponse.json(
          { requests: [], migrated: false, error: 'signup_requests table missing (run supabase/migrations/083_signup_requests.sql)' },
          { status: 200 },
        );
      }
      throw error;
    }

    // One read for the group names rather than a nested select: the FK alias for
    // `groups` differs between environments here, and a bad embed fails the whole
    // request (same reason /api/onboarding reads groups separately).
    const groupIds = [...new Set((rows || []).map(r => r.group_id).filter(Boolean))] as string[];
    const names = new Map<string, string>();
    if (groupIds.length) {
      const { data: groups } = await supabase.from('groups').select('id, name').in('id', groupIds);
      for (const g of groups || []) names.set(g.id, groupDisplayName(g.name));
    }

    // ── WHERE DID THEY GET TO? ────────────────────────────────────────────────
    //
    // Approving is not the end of anything: it sends a link, and the person then
    // has to open it, give their name and connect Strava. Until this join existed
    // the screen went quiet at exactly that point — an approved row looked
    // identical whether the mail bounced, whether they never opened it, or whether
    // they finished an hour ago. Which is the one thing an approver needs to know
    // the morning after sending thirty of them.
    //
    // Matched by athlete_id, falling back to the email: rows approved before the
    // approve route started stamping athlete_id (and 'member' records) have none.
    const athleteIds = [...new Set((rows || []).map(r => r.athlete_id).filter(Boolean))] as string[];
    const emails = [...new Set((rows || []).map(r => r.email).filter(Boolean))] as string[];
    type AthleteState = {
      id: string;
      status: string | null;
      name: string | null;
      hasStrava: boolean;
      hasGarmin: boolean;
      onboardingStatus: string | null;
      lastSeenAt: string | null;
      /** Synthetic (strava_<id>@…) means the app invented it: nobody placed this person. */
      email: string | null;
    };
    const byId = new Map<string, AthleteState>();
    const byEmail = new Map<string, AthleteState>();
    if (athleteIds.length || emails.length) {
      // `.or()` rather than two round trips. Never select the credentials
      // themselves — `strava_auth`/`garmin_auth` are encrypted at rest and a
      // boolean is all this screen can use.
      const filters: string[] = [];
      if (athleteIds.length) filters.push(`id.in.(${athleteIds.join(',')})`);
      if (emails.length) filters.push(`email.in.(${emails.map(e => `"${e}"`).join(',')})`);
      const { data: athletes } = await supabase
        .from('athletes')
        .select('id, email, name, status, strava_athlete_id, strava_auth, garmin_auth, onboarding_status, last_seen_at')
        .or(filters.join(','));
      for (const a of athletes || []) {
        const state: AthleteState = {
          id: a.id,
          status: a.status ?? null,
          name: a.name ?? null,
          hasStrava: !!a.strava_auth || !!a.strava_athlete_id,
          hasGarmin: !!a.garmin_auth,
          onboardingStatus: a.onboarding_status ?? null,
          lastSeenAt: a.last_seen_at ?? null,
          email: a.email ?? null,
        };
        byId.set(a.id, state);
        if (a.email) byEmail.set(String(a.email).toLowerCase(), state);
      }
    }

    /**
     * The five faces of a row, in the order they happen. 'pending', 'rejected'
     * and 'member' are just the request's own status; the two that needed deriving
     * sit between "approved" and "in the club":
     *
     *   'emailed'   — the link went out and nothing has happened since. Nobody has
     *                 opened it, or it never arrived (see the approve route's
     *                 `emailed`) — which is why this bucket is the one to watch.
     *   'connected' — they opened it and got part way: a name, a group, a Garmin
     *                 credential. Not active, so Strava is still missing, and
     *                 Strava is the app's only sign-in door. STUCK, in other words.
     *   'done'      — active. Strava is linked and they can get in.
     */
    const stageOf = (r: { status: string; athlete_id: string | null; email: string }): string => {
      if (r.status !== 'approved') return r.status;
      const a = (r.athlete_id ? byId.get(r.athlete_id) : null) || byEmail.get(r.email.toLowerCase());
      if (!a) return 'emailed';
      if (a.status === 'active') return 'done';
      if (a.hasStrava) return 'done';
      if (a.hasGarmin || a.onboardingStatus) return 'connected';
      return 'emailed';
    };

    // ── "ISN'T THIS SOMEBODY WE ALREADY HAVE?" ────────────────────────────────
    //
    // A Strava sign-in the app could not place lands in this queue holding a
    // synthetic address, and approving it as new is what produces a second row for
    // a member who is already in the club — six times so far. The callback now
    // matches across scripts by itself and merges what it recognises, so anything
    // that still reaches this queue is a name it could NOT read with certainty:
    // "Roey Roth" against "רועי רוט" carries three consonants and that is not
    // enough to act on alone.
    //
    // It is enough to show a person, though. So the queue offers the roster rows
    // that look like this sign-in and lets the approver decide.
    //
    // ⚠️ This used to ask the two STRICT matchers for a single suggestion, and that
    // is how the fifth duplicate got through on 2026-09-08. `Roy Roth` carries only
    // three consonants, so `athleteNameKeys` returns [] and BOTH strict matchers
    // bail — the queue showed no hint whatsoever next to `רועי רוט`, who was sitting
    // one row away with twelve years of history, and the row was approved 35 seconds
    // after it arrived. The floor those matchers apply is correct for them (it is
    // what stops "Dan Levi" being merged into "Din Lavi") and wrong here, where
    // nothing is merged without a person pressing a button. `rankAthleteCandidates`
    // is the floor-free, display-only counterpart — see its header.
    //
    // `confidence` carries which kind of answer each one is, because they carry very
    // different weight: exact (same consonant skeleton), near (one edit away — a
    // plausible transliteration), weak (a shared surname, or one name inside the
    // other). The screen says so rather than presenting a lead as a fact.
    const unplaced = (rows || []).filter(r => {
      const a = (r.athlete_id ? byId.get(r.athlete_id) : null) || byEmail.get(String(r.email).toLowerCase());
      return !!a && isSyntheticAuthEmail(a.email);
    });
    type Candidate = { id: string; name: string | null; confidence: CandidateConfidence };
    const candidates = new Map<string, Candidate[]>();
    if (unplaced.length) {
      const { data: rosterRows } = await supabase
        .from('athletes')
        .select('id, name, email, role, status, created_at, strava_athlete_id');
      const roster = (rosterRows || []) as unknown as IdentityRow[];
      for (const r of unplaced) {
        const a = (r.athlete_id ? byId.get(r.athlete_id) : null) || byEmail.get(String(r.email).toLowerCase());
        if (!a) continue;
        // Exclude the shell itself, or it suggests the person to themselves.
        const others = roster.filter(row => row.id !== a.id);
        candidates.set(
          r.id,
          rankAthleteCandidates(others, a.name).map(c => ({
            id: c.row.id,
            name: c.row.name ?? null,
            confidence: c.confidence,
          })),
        );
      }
    }

    const requests = (rows || []).map(r => {
      const athlete = (r.athlete_id ? byId.get(r.athlete_id) : null) || byEmail.get(String(r.email).toLowerCase()) || null;
      return {
        id: r.id,
        email: r.email,
        groupId: r.group_id,
        groupName: r.group_id ? names.get(r.group_id) || null : null,
        status: r.status,
        createdAt: r.created_at,
        approvedAt: r.approved_at,
        approvedBy: r.approved_by,
        rejectedAt: r.rejected_at,
        rejectedBy: r.rejected_by,
        athleteId: r.athlete_id,
        stage: stageOf(r),
        // The name they typed at /join, once they have. Until then the athlete row
        // carries placeholderNameFromEmail(), so this is not proof of anything —
        // `stage` is. It is here because a person is easier to recognise by name.
        athleteName: athlete?.name || null,
        hasStrava: !!athlete?.hasStrava,
        hasGarmin: !!athlete?.hasGarmin,
        lastSeenAt: athlete?.lastSeenAt || null,
        // The invite link, so a failed email is recoverable from this screen
        // instead of from the SQL editor. It IS a credential (see /api/join/groups)
        // — this route is already canApprove-gated, and it must not travel further.
        inviteToken: r.invite_token || null,
        // ── Set only for a sign-in the app could not place on the roster itself ──
        //
        // `unplaced` is the fact, and it is deliberately separate from having a
        // candidate: a synthetic sign-in with NOTHING resembling it on the roster is
        // the case the screen most needs to be explicit about, because it looks
        // identical to an ordinary stranger and approving it is irreversible-ish.
        // An empty array used to be indistinguishable from "not a Strava sign-in".
        unplaced: candidates.has(r.id),
        matchCandidates: candidates.get(r.id) || [],
      };
    });

    return NextResponse.json({
      requests: status === 'pending' ? requests : requests.reverse(),
      migrated: true,
    });
  } catch (err) {
    console.error('Failed to load signup requests:', err);
    return NextResponse.json({ error: 'Failed to load registrations' }, { status: 500 });
  }
}
