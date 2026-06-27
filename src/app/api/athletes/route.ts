import { NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { createServerClient } from '@/lib/supabase/server';
import { COACH_ID } from '@/lib/constants';

const DEMO_COACH_ID = COACH_ID;

// GET - List all athletes for the coach
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const coachId = searchParams.get('coach_id') || DEMO_COACH_ID;

    const supabase = createServerClient();

    const { data: athletes, error } = await supabase
      .from('athletes')
      .select(`
        id,
        name,
        email,
        status,
        created_at,
        garmin_auth,
        group_id,
        groups (
          name
        )
      `)
      .eq('coach_id', coachId)
      .order('created_at', { ascending: false });

    if (error) throw error;

    // Transform data to include group name and last synced
    const transformedAthletes = athletes?.map(athlete => ({
      id: athlete.id,
      name: athlete.name,
      email: athlete.email,
      status: athlete.status,
      groupName: (athlete.groups as any)?.name || null,
      groupId: athlete.group_id,
      group_id: athlete.group_id, // Also include snake_case for compatibility
      lastSynced: athlete.garmin_auth ? new Date().toISOString() : null,
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
    const { name, email } = body;

    if (!name || !email) {
      return NextResponse.json(
        { error: 'Name and email are required' },
        { status: 400 }
      );
    }

    const inviteToken = randomBytes(16).toString('hex');

    // Create athlete record with invited status
    const { data: athlete, error } = await supabase
      .from('athletes')
      .insert({
        coach_id: DEMO_COACH_ID,
        name,
        email,
        status: 'invited',
        invite_token: inviteToken,
      })
      .select()
      .single();

    if (error) throw error;

    // Generate invite link
    const inviteLink = `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/invite/${inviteToken}`;

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
