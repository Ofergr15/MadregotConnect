import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { syncClubFollows } from '@/lib/follows/club-sync';
import { mayActFor, resolveVerifiedCaller } from '@/lib/auth/self-or-staff';

/**
 * Sets an athlete's pace group during sign-up. Session-gated since 2026-11-22: its
 * sign-up caller, /join/onboard, runs AFTER a Supabase sign-in (/auth/resolve) and sends
 * its bearer; the page signs out only on its own done/back buttons. (The note below
 * predates that and describes the earlier narrowing.)
 *
 * It is narrowed instead. The athlete is looked up by an `email` taken straight
 * from a query string, so ungated this was an open write on any member's row:
 * a POST naming someone else's address moved them to another pace group, which
 * silently changes the paces prescribed by every workout they're given.
 *
 * The narrowing is that the open path only covers the state onboarding is
 * actually in. /auth/resolve only routes to /join/onboard for a row its final
 * branch just created with `status: 'invited'` (resolve-role/route.ts:170) — an
 * existing athlete is sent to /dashboard or /pending-approval instead, never
 * here. So an already-`active` row means this isn't first-time onboarding, and
 * that case now requires a verified self-or-staff caller. Nothing is lost:
 * staff change `group_id` through /api/athletes (route.ts:209).
 */
async function gateEstablishedMember(req: Request, athleteId: string): Promise<Response | null> {
  const { denied, caller } = await resolveVerifiedCaller(req);
  if (denied) return denied;
  if (!mayActFor(caller, athleteId)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  return null;
}

export async function POST(req: NextRequest) {
  try {
    const { email, groupId, weekStartDay } = await req.json();

    if (!email) {
      return NextResponse.json({ error: 'email is required' }, { status: 400 });
    }

    // Authenticate first: an anonymous caller learns nothing, not even whether the address exists.
    const { denied: unverified, caller } = await resolveVerifiedCaller(req);
    if (unverified) return unverified;
    const ownEmail = (caller.email || '').toLowerCase().trim();
    const ownsAddress = !!ownEmail && ownEmail === String(email).toLowerCase().trim();

    const supabase = createServerClient();

    const { data: athlete, error: findError } = await supabase
      .from('athletes')
      .select('id, name, email, group_id, approved, status')
      .eq('email', email.toLowerCase())
      .maybeSingle();

    if (!athlete) {
      // Only the owner of the address hears "not found"; anyone else gets the same 403 as for
      // someone else's row.
      return ownsAddress
        ? NextResponse.json({ error: 'Athlete not found' }, { status: 404 })
        : NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }

    if (athlete.status === 'active') {
      const denied = await gateEstablishedMember(req, athlete.id);
      if (denied) return denied;
    } else {
      // A not-yet-active row (2026-11-22): a verified session that OWNS the address, is
      // already linked to the row, or is staff. Before, any caller could regroup a pending
      // applicant — and activate an approved-null one — by naming an email. /join/onboard
      // (reached after a Supabase sign-in) sends its bearer; same rule as
      // /api/athletes/connect (bcce5059).
      if (!ownsAddress && caller.athleteId !== athlete.id && !mayActFor(caller, athlete.id)) {
        return NextResponse.json({ error: 'forbidden' }, { status: 403 });
      }
    }

    // Onboarding must NOT self-activate. A public sign-up only becomes 'active'
    // once the coach approves them (/api/admin/approve). Setting status='active'
    // here let unapproved sign-ups appear as full members (workout push, roster,
    // stats). Only block when approval is explicitly false — legacy rows with a
    // null 'approved' stay active for backward compatibility.
    const updates: Record<string, any> = {};
    if (athlete.approved !== false) updates.status = 'active';
    if (groupId) updates.group_id = groupId;
    // The member's own week boundary, chosen on the same sign-up screen as the
    // pace group (migration 119). Written here rather than left to a later visit to
    // the profile, because it decides how every weekly number they are shown from
    // now on is cut. Checked against 0/1 rather than coerced, so a junk body leaves
    // the column alone instead of writing a day nobody picked. Not a new surface:
    // same row, same gate.
    if (weekStartDay === 0 || weekStartDay === 1) updates.week_start_day = weekStartDay;

    const { data: updated, error: updateError } = await supabase
      .from('athletes')
      .update(updates)
      .eq('id', athlete.id)
      .select('id, name, email, group_id')
      .single();

    if (updateError) {
      return NextResponse.json({ error: 'Failed to update' }, { status: 500 });
    }

    try {
      await syncClubFollows(supabase, athlete.id);
    } catch { /* best-effort — never break the group update itself */ }

    return NextResponse.json({ success: true, athlete: updated });
  } catch (error: any) {
    console.error('[api/athletes/update-group]', error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
