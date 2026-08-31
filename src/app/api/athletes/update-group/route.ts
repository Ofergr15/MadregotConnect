import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { syncClubFollows } from '@/lib/follows/club-sync';
import { mayActFor, resolveVerifiedCaller } from '@/lib/auth/self-or-staff';

/**
 * Sets an athlete's pace group during sign-up. Deliberately NOT session-gated,
 * because its one caller — src/app/join/onboard/page.tsx:97 — runs before the
 * athlete has a session (that page signs out on purpose).
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
    const { email, groupId } = await req.json();

    if (!email) {
      return NextResponse.json({ error: 'email is required' }, { status: 400 });
    }

    const supabase = createServerClient();

    const { data: athlete, error: findError } = await supabase
      .from('athletes')
      .select('id, name, email, group_id, approved, status')
      .eq('email', email.toLowerCase())
      .maybeSingle();

    if (!athlete) {
      return NextResponse.json({ error: 'Athlete not found' }, { status: 404 });
    }

    if (athlete.status === 'active') {
      const denied = await gateEstablishedMember(req, athlete.id);
      if (denied) return denied;
    }

    // Onboarding must NOT self-activate. A public sign-up only becomes 'active'
    // once the coach approves them (/api/admin/approve). Setting status='active'
    // here let unapproved sign-ups appear as full members (workout push, roster,
    // stats). Only block when approval is explicitly false — legacy rows with a
    // null 'approved' stay active for backward compatibility.
    const updates: Record<string, any> = {};
    if (athlete.approved !== false) updates.status = 'active';
    if (groupId) updates.group_id = groupId;

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
    return NextResponse.json({ error: error.message || 'Internal error' }, { status: 500 });
  }
}
