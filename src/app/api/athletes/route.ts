import { NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { createServerClient } from '@/lib/supabase/server';
import { COACH_ID, isProtectedEmail } from '@/lib/constants';

const DEMO_COACH_ID = COACH_ID;

// GET - List all athletes for the coach
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const coachId = searchParams.get('coach_id') || DEMO_COACH_ID;

    const supabase = createServerClient();

    let athletes: any[] | null = null;
    let error: any = null;

    const result = await supabase
      .from('athletes')
      .select(`
        id, name, email, status, created_at, garmin_auth, strava_auth, data_source, strava_enabled, onboarding_status, group_id,
        groups (name)
      `)
      .eq('coach_id', coachId)
      .order('created_at', { ascending: false });

    if (result.error) {
      const fallback = await supabase
        .from('athletes')
        .select(`id, name, email, status, created_at, garmin_auth, group_id, groups (name)`)
        .eq('coach_id', coachId)
        .order('created_at', { ascending: false });
      athletes = fallback.data;
      error = fallback.error;
    } else {
      athletes = result.data;
      error = null;
    }

    if (error) throw error;

    // Transform data to include group name and last synced
    const transformedAthletes = athletes?.map(athlete => ({
      id: athlete.id,
      name: athlete.name,
      email: athlete.email,
      status: athlete.status,
      groupName: (() => {
        const raw = (athlete.groups as any)?.name || null;
        if (!raw) return null;
        const n = raw.toLowerCase();
        if (n.includes('group a') || n.includes('sub 2:30')) return 'Group 1';
        if (n.includes('group b') || n.includes('sub 2:35')) return 'Group 2';
        if (n.includes('group c') || n.includes('sub 2:45')) return 'Group 3';
        return raw;
      })(),
      groupId: athlete.group_id,
      group_id: athlete.group_id,
      dataSource: (athlete as any).data_source || 'garmin',
      hasGarmin: !!athlete.garmin_auth,
      hasStrava: !!(athlete as any).strava_auth,
      stravaEnabled: !!(athlete as any).strava_enabled,
      onboardingStatus: (athlete as any).onboarding_status || null,
      lastSynced: athlete.garmin_auth || (athlete as any).strava_auth ? new Date().toISOString() : null,
      createdAt: athlete.created_at,
    }));

    return NextResponse.json({ athletes: transformedAthletes || [] });
  } catch (error) {
    console.error('Failed to fetch athletes:', error);
    return NextResponse.json(
      { error: 'Failed to fetch athletes' },
      { status: 500 }
    );
  }
}

// POST - Create a new athlete invitation
export async function POST(request: Request) {
  try {
    const supabase = createServerClient();
    const body = await request.json();
    const { name, email, publicLink } = body;

    // Public link mode — generate a reusable token without creating an athlete record
    if (publicLink) {
      const inviteToken = randomBytes(16).toString('hex');

      // Store as a placeholder athlete entry so the token is valid when someone joins
      const { error } = await supabase
        .from('athletes')
        .insert({
          coach_id: DEMO_COACH_ID,
          name: 'Public Invite',
          email: `public-${inviteToken}@invite.madregot.app`,
          status: 'invited',
          invite_token: inviteToken,
        });

      if (error) throw error;

      const inviteLink = `${process.env.NEXT_PUBLIC_APP_URL || 'https://madregot-connect.vercel.app'}/join/${inviteToken}`;
      return NextResponse.json({ inviteLink });
    }

    if (!name || !email) {
      return NextResponse.json(
        { error: 'Name and email are required' },
        { status: 400 }
      );
    }

    const inviteToken = randomBytes(16).toString('hex');

    // Create athlete record with invited status. Store email normalized
    // (lowercase+trim) so it always matches the Google sign-in email later —
    // otherwise the user is treated as new and asked to re-register.
    const { data: athlete, error } = await supabase
      .from('athletes')
      .insert({
        coach_id: DEMO_COACH_ID,
        name,
        email: email.toLowerCase().trim(),
        status: 'invited',
        invite_token: inviteToken,
      })
      .select()
      .single();

    if (error) throw error;

    // Generate invite link
    const inviteLink = `${process.env.NEXT_PUBLIC_APP_URL || 'https://madregot-connect.vercel.app'}/join/${inviteToken}`;

    return NextResponse.json({
      athlete,
      inviteLink,
    });
  } catch (error) {
    console.error('Failed to create athlete invitation:', error);
    return NextResponse.json(
      { error: 'Failed to create invitation' },
      { status: 500 }
    );
  }
}

// PUT - Update athlete (group, status, etc.)
export async function PUT(request: Request) {
  try {
    const supabase = createServerClient();
    const body = await request.json();
    const { id, groupId, status } = body;

    if (!id) {
      return NextResponse.json(
        { error: 'Athlete ID is required' },
        { status: 400 }
      );
    }

    const updates: Record<string, any> = {};
    if (groupId !== undefined) updates.group_id = groupId;
    if (status) updates.status = status;

    const { data: athlete, error } = await supabase
      .from('athletes')
      .update(updates)
      .eq('id', id)
      .eq('coach_id', DEMO_COACH_ID)
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ athlete });
  } catch (error) {
    console.error('Failed to update athlete:', error);
    return NextResponse.json(
      { error: 'Failed to update athlete' },
      { status: 500 }
    );
  }
}

// DELETE - Remove an athlete
export async function DELETE(request: Request) {
  try {
    const supabase = createServerClient();
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json(
        { error: 'Athlete ID is required' },
        { status: 400 }
      );
    }

    // Never allow deleting a protected account (e.g. the club/admin account).
    const { data: target } = await supabase
      .from('athletes')
      .select('email')
      .eq('id', id)
      .eq('coach_id', DEMO_COACH_ID)
      .maybeSingle();

    if (isProtectedEmail(target?.email)) {
      return NextResponse.json(
        { error: 'This account is protected and cannot be deleted.' },
        { status: 403 }
      );
    }

    const { error } = await supabase
      .from('athletes')
      .delete()
      .eq('id', id)
      .eq('coach_id', DEMO_COACH_ID);

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to delete athlete:', error);
    return NextResponse.json(
      { error: 'Failed to delete athlete' },
      { status: 500 }
    );
  }
}
