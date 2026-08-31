import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { encrypt } from '@/lib/encryption';
import { COACH_ID } from '@/lib/constants';
import { syncClubFollows } from '@/lib/follows/club-sync';
import { mayActFor, resolveVerifiedCaller } from '@/lib/auth/self-or-staff';

/**
 * Public sign-up / invite redemption. Deliberately NOT session-gated as a
 * whole: it runs before the athlete has an account to hold a session, so
 * requiring one would make joining the club impossible. Three paths, and only
 * one of them needed narrowing:
 *
 *  - With `inviteToken` — the token IS the credential. Unguessable, scoped to
 *    exactly one row, 404s when it doesn't match. Left open.
 *  - Token-less, no such email — an INSERT of a fresh row (status 'invited',
 *    approved false). Can't touch anyone else. Left open.
 *  - Token-less, email already on file — an UPDATE of that row, which is the
 *    one that needed gating (see `gateEstablishedMember`).
 *
 * In all three, approval (/api/admin/approve) and not this route is what admits
 * anyone to the club.
 */

/**
 * The token-less update path, narrowed to the state onboarding is actually in.
 *
 * That branch overwrites `name`, `group_id` and `garmin_auth` on whatever row
 * matches the email in the body — and the email is just a string the caller
 * picks. Ungated, a POST naming an existing member could repoint their Garmin
 * credentials at another account, which doesn't lock them out so much as start
 * feeding a stranger's runs into their training history.
 *
 * Open only while the row is not yet `active`: that's the state resolve-role
 * creates for a brand-new sign-up (resolve-role/route.ts:170) and the only one
 * /join/onboard is ever reached in. An already-active row means a signed-in
 * member — the in-app "connect Garmin" button on the profile page — who can
 * therefore be asked for their session.
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
    const { inviteToken, garminAuth, name, email, groupId } = await req.json();

    const supabase = createServerClient();
    const encryptedAuth = garminAuth
      ? (typeof garminAuth === 'string' ? garminAuth : encrypt(garminAuth))
      : null;

    // If inviteToken provided, update existing athlete record
    if (inviteToken) {
      const { data: athlete, error: findError } = await supabase
        .from('athletes')
        .select('id, approved')
        .eq('invite_token', inviteToken)
        .single();

      if (findError || !athlete) {
        return NextResponse.json(
          { error: 'Invalid or expired invite link' },
          { status: 404 }
        );
      }

      // Connecting a watch does not grant access — only coach approval flips a
      // user to 'active' (/api/admin/approve). Academy join links are issued
      // AFTER approval (approved=true) so they stay active here; a not-yet-
      // approved invite waits in the pending queue. Gate on explicit false so
      // legacy rows with a null 'approved' keep working.
      const updateData: Record<string, any> = {
        onboarding_status: encryptedAuth ? 'garmin_authed' : 'google_authed',
      };
      if (athlete.approved !== false) updateData.status = 'active';
      if (encryptedAuth) {
        updateData.garmin_auth = encryptedAuth;
        updateData.garmin_authed_at = new Date().toISOString();
      }
      if (name) updateData.name = name;
      if (email) updateData.email = email.toLowerCase().trim();
      if (groupId) updateData.group_id = groupId;

      const { data: updated, error: updateError } = await supabase
        .from('athletes')
        .update(updateData)
        .eq('id', athlete.id)
        .select('id, name, email, group_id')
        .single();

      if (updateError) {
        return NextResponse.json({ error: 'Failed to save connection' }, { status: 500 });
      }

      try {
        await syncClubFollows(supabase, athlete.id);
      } catch { /* best-effort — never break the connect flow itself */ }

      try {
        const { notifyAdminNewUser } = await import('@/lib/email');
        await notifyAdminNewUser({ name: updated?.name || email, email: updated?.email || email, onboardingStatus: updateData.onboarding_status, hasGarmin: !!encryptedAuth });
      } catch {}

      return NextResponse.json({ success: true, athlete: updated });
    }

    // No token — create new athlete (onboard flow from main page sign-in)
    if (!name || !email) {
      return NextResponse.json({ error: 'name and email are required' }, { status: 400 });
    }

    // Check if athlete already exists by email
    const { data: existing } = await supabase
      .from('athletes')
      .select('id, group_id, approved, status')
      .eq('email', email.toLowerCase())
      .maybeSingle();

    // The pace group is OPTIONAL at sign-up — a new athlete may register without
    // one, and the coach assigns/adjusts it later. (group_id is nullable.)

    if (existing) {
      if (existing.status === 'active') {
        const denied = await gateEstablishedMember(req, existing.id);
        if (denied) return denied;
      }

      const updatePayload: Record<string, any> = {
        name,
        onboarding_status: encryptedAuth ? 'garmin_authed' : 'google_authed',
        ...(groupId ? { group_id: groupId } : {}),
      };
      // Self-onboarding must not activate an unapproved user — coach approval
      // owns the active flip. Legacy rows (approved null) keep going active.
      if (existing.approved !== false) updatePayload.status = 'active';
      if (encryptedAuth) {
        updatePayload.garmin_auth = encryptedAuth;
        updatePayload.garmin_authed_at = new Date().toISOString();
      }

      const { data: updated, error: updateError } = await supabase
        .from('athletes')
        .update(updatePayload)
        .eq('id', existing.id)
        .select('id, name, email, group_id')
        .single();

      if (updateError) {
        return NextResponse.json({ error: 'Failed to save connection' }, { status: 500 });
      }

      try {
        await syncClubFollows(supabase, existing.id);
      } catch { /* best-effort — never break the connect flow itself */ }

      try {
        const { notifyAdminNewUser } = await import('@/lib/email');
        await notifyAdminNewUser({ name: updated?.name || email, email: updated?.email || email, onboardingStatus: updatePayload.onboarding_status, hasGarmin: !!encryptedAuth });
      } catch {}

      return NextResponse.json({ success: true, athlete: updated });
    }

    // Create new athlete — a brand-new public sign-up. Start pending (not
    // 'active') and unapproved; the coach approves in Settings, which flips
    // status to 'active'. Previously this inserted status='active', letting
    // self-registrants bypass approval entirely.
    const insertPayload: Record<string, any> = {
      coach_id: COACH_ID,
      name,
      email: email.toLowerCase(),
      status: 'invited',
      approved: false,
      onboarding_status: encryptedAuth ? 'garmin_authed' : 'google_authed',
      ...(groupId ? { group_id: groupId } : {}),
    };
    if (encryptedAuth) {
      insertPayload.garmin_auth = encryptedAuth;
      insertPayload.garmin_authed_at = new Date().toISOString();
    }

    const { data: created, error: createError } = await supabase
      .from('athletes')
      .insert(insertPayload)
      .select('id, name, email, group_id')
      .single();

    if (createError) {
      return NextResponse.json({ error: 'Failed to create athlete' }, { status: 500 });
    }

    try {
      await syncClubFollows(supabase, created.id);
    } catch { /* best-effort — never break the connect flow itself */ }

    try {
      const { notifyAdminNewUser } = await import('@/lib/email');
      await notifyAdminNewUser({ name, email, onboardingStatus: insertPayload.onboarding_status, hasGarmin: !!encryptedAuth });
    } catch {}

    return NextResponse.json({ success: true, athlete: created });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Internal error' },
      { status: 500 }
    );
  }
}
