import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { COACH_ID } from '@/lib/constants';

const DEMO_COACH_ID = COACH_ID;

// GET - List all groups for the coach with athlete counts
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const coachId = searchParams.get('coach_id') || DEMO_COACH_ID;

    const supabase = createServerClient();

    const { data: groups, error } = await supabase
      .from('groups')
      .select(`
        id,
        name,
        pace_profile,
        created_at,
        athletes:athletes(count)
      `)
      .eq('coach_id', coachId)
      .order('created_at', { ascending: false });

    if (error) throw error;

    // Transform data to include athlete count
    const transformedGroups = groups?.map(group => ({
      id: group.id,
      name: group.name,
      paceProfile: group.pace_profile,
      athleteCount: group.athletes?.[0]?.count || 0,
      athlete_count: group.athletes?.[0]?.count || 0, // Also include snake_case for compatibility
      createdAt: group.created_at,
    }));

    return NextResponse.json({ groups: transformedGroups || [] });
  } catch (error) {
    console.error('Failed to fetch groups:', error);
    return NextResponse.json(
      { error: 'Failed to fetch groups' },
      { status: 500 }
    );
  }
}

// POST - Create a new group
export async function POST(request: Request) {
  try {
    const supabase = createServerClient();
    const body = await request.json();
    const { name, paceProfile } = body;

    if (!name) {
      return NextResponse.json(
        { error: 'Group name is required' },
        { status: 400 }
      );
    }

    // Use default pace profile if not provided
    const defaultPaceProfile = {
      easy: { min: 330, max: 390 },
      threshold: { min: 270, max: 290 },
      interval: { min: 240, max: 260 },
      tempo: { min: 280, max: 300 },
      sprint: { min: 200, max: 230 },
      marathon_pace: { min: 290, max: 310 },
    };

    const { data: group, error } = await supabase
      .from('groups')
      .insert({
        coach_id: DEMO_COACH_ID,
        name,
        pace_profile: paceProfile || defaultPaceProfile,
      })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ group });
  } catch (error) {
    console.error('Failed to create group:', error);
    return NextResponse.json(
      { error: 'Failed to create group' },
      { status: 500 }
    );
  }
}

// PUT - Update a group
export async function PUT(request: Request) {
  try {
    const supabase = createServerClient();
    const body = await request.json();
    const { id, name, paceProfile } = body;

    if (!id) {
      return NextResponse.json(
        { error: 'Group ID is required' },
        { status: 400 }
      );
    }

    const updates: any = {};
    if (name) updates.name = name;
    if (paceProfile) updates.pace_profile = paceProfile;

    const { data: group, error } = await supabase
      .from('groups')
      .update(updates)
      .eq('id', id)
      .eq('coach_id', DEMO_COACH_ID)
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ group });
  } catch (error) {
    console.error('Failed to update group:', error);
    return NextResponse.json(
      { error: 'Failed to update group' },
      { status: 500 }
    );
  }
}

// DELETE - Delete a group
export async function DELETE(request: Request) {
  try {
    const supabase = createServerClient();
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json(
        { error: 'Group ID is required' },
        { status: 400 }
      );
    }

    const { error } = await supabase
      .from('groups')
      .delete()
      .eq('id', id)
      .eq('coach_id', DEMO_COACH_ID);

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to delete group:', error);
    return NextResponse.json(
      { error: 'Failed to delete group' },
      { status: 500 }
    );
  }
}
