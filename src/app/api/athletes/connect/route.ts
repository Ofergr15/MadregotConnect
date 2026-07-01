import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { encrypt } from '@/lib/encryption';
import { COACH_ID } from '@/lib/constants';

export async function POST(req: NextRequest) {
  try {
    const { inviteToken, garminAuth, name, email, groupId } = await req.json();

    if (!garminAuth) {
      return NextResponse.json(
        { error: 'garminAuth is required' },
        { status: 400 }
      );
    }

    const supabase = createServerClient();
    const encryptedAuth = typeof garminAuth === 'string' ? garminAuth : encrypt(garminAuth);

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
        garmin_auth: encryptedAuth,
        status: 'active',
        onboarding_status: 'garmin_authed',
        garmin_authed_at: new Date().toISOString(),
      };
      if (name) updateData.name = name;
      if (email) updateData.email = email;
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

      return NextResponse.json({ success: true, athlete: updated });
    }

    // No token — create new athlete (onboard flow from main page sign-in)
    if (!name || !email) {
      return NextResponse.json({ error: 'name and email are required' }, { status: 400 });
    }

    // Check if athlete already exists by email
    const { data: existing } = await supabase
      .from('athletes')
      .select('id')
      .eq('email', email.toLowerCase())
      .maybeSingle();

    if (existing) {
      const { data: updated, error: updateError } = await supabase
        .from('athletes')
        .update({
          garmin_auth: encryptedAuth,
          status: 'active',
          name,
          onboarding_status: 'garmin_authed',
          garmin_authed_at: new Date().toISOString(),
          ...(groupId ? { group_id: groupId } : {}),
        })
        .eq('id', existing.id)
        .select('id, name, email, group_id')
        .single();

      if (updateError) {
        return NextResponse.json({ error: 'Failed to save connection' }, { status: 500 });
      }
      return NextResponse.json({ success: true, athlete: updated });
    }

    // Create new athlete
    const { data: created, error: createError } = await supabase
      .from('athletes')
      .insert({
        coach_id: COACH_ID,
        name,
        email: email.toLowerCase(),
        garmin_auth: encryptedAuth,
        status: 'active',
        onboarding_status: 'garmin_authed',
        garmin_authed_at: new Date().toISOString(),
        ...(groupId ? { group_id: groupId } : {}),
      })
      .select('id, name, email, group_id')
      .single();

    if (createError) {
      return NextResponse.json({ error: 'Failed to create athlete' }, { status: 500 });
    }

    return NextResponse.json({ success: true, athlete: created });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Internal error' },
      { status: 500 }
    );
  }
}
