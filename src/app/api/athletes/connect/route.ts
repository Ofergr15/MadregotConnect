import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { encrypt } from '@/lib/encryption';
import { COACH_ID } from '@/lib/constants';

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
        .select('id')
        .eq('invite_token', inviteToken)
        .single();

      if (findError || !athlete) {
        return NextResponse.json(
          { error: 'Invalid or expired invite link' },
          { status: 404 }
        );
      }

      const updateData: Record<string, any> = {
        status: 'active',
        onboarding_status: encryptedAuth ? 'garmin_authed' : 'google_authed',
      };
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
      .select('id, group_id')
      .eq('email', email.toLowerCase())
      .maybeSingle();

    // Every athlete must belong to a group. Require it unless the athlete already
    // has one (returning user just re-connecting Garmin).
    if (!groupId && !existing?.group_id) {
      return NextResponse.json({ error: 'A pace group is required' }, { status: 400 });
    }

    if (existing) {
      const updatePayload: Record<string, any> = {
        status: 'active',
        name,
        onboarding_status: encryptedAuth ? 'garmin_authed' : 'google_authed',
        ...(groupId ? { group_id: groupId } : {}),
      };
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
        const { notifyAdminNewUser } = await import('@/lib/email');
        await notifyAdminNewUser({ name: updated?.name || email, email: updated?.email || email, onboardingStatus: updatePayload.onboarding_status, hasGarmin: !!encryptedAuth });
      } catch {}

      return NextResponse.json({ success: true, athlete: updated });
    }

    // Create new athlete
    const insertPayload: Record<string, any> = {
      coach_id: COACH_ID,
      name,
      email: email.toLowerCase(),
      status: 'active',
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
