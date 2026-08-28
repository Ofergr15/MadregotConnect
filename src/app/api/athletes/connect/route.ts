import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { encrypt } from '@/lib/encryption';
import { COACH_ID } from '@/lib/constants';
import { syncClubFollows } from '@/lib/follows/club-sync';

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
      .select('id, group_id, approved')
      .eq('email', email.toLowerCase())
      .maybeSingle();

    // The pace group is OPTIONAL at sign-up — a new athlete may register without
    // one, and the coach assigns/adjusts it later. (group_id is nullable.)

    if (existing) {
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
