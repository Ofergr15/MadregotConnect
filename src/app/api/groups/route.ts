import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { COACH_ID } from '@/lib/constants';
import { groupDisplayName } from '@/lib/utils';

const DEMO_COACH_ID = COACH_ID;

export const dynamic = 'force-dynamic';

// GET - List all groups for the coach with athlete details
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
        athletes:athletes(id, name, email, status, garmin_auth, strava_auth, data_source)
      `)
      .eq('coach_id', coachId)
      .order('created_at', { ascending: true });

    if (error) throw error;

    const transformedGroups = groups?.map(group => {
      const paceProfile = group.pace_profile as any;
      const paceOffsetSeconds = typeof paceProfile === 'object' && paceProfile !== null
        ? (paceProfile.offsetSeconds ?? 0)
        : 0;

      let level: 'fast' | 'medium' | 'slow' = 'medium';
      if (paceOffsetSeconds <= 0) level = 'fast';
      else if (paceOffsetSeconds <= 15) level = 'medium';
      else level = 'slow';

      if (paceProfile?.level) level = paceProfile.level;

      const marathonGoal = paceProfile?.marathonGoal || '';

      // Map to booleans so we never leak encrypted auth tokens to the client.
      const athletes = (Array.isArray(group.athletes) ? group.athletes : []).map((a: any) => ({
        id: a.id,
        name: a.name,
        email: a.email,
        status: a.status,
        hasGarmin: !!a.garmin_auth,
        hasStrava: !!a.strava_auth,
        dataSource: a.data_source || 'garmin',
      }));

      const displayName = groupDisplayName(group.name);

      return {
        id: group.id,
        name: displayName,
        paceOffsetSeconds,
        level,
        marathonGoal,
        athleteCount: athletes.length,
        athlete_count: athletes.length,
        athletes,
        createdAt: group.created_at,
      };
    });

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
    const { name, paceOffsetSeconds, level, marathonGoal } = body;

    if (!name) {
      return NextResponse.json(
        { error: 'Group name is required' },
        { status: 400 }
      );
    }

    // Store pace offset, level, and marathon goal in pace_profile as JSONB
    const paceProfile = {
      offsetSeconds: paceOffsetSeconds ?? 0,
      level: level ?? 'medium',
      marathonGoal: marathonGoal || '',
    };

    const { data: group, error } = await supabase
      .from('groups')
      .insert({
        coach_id: DEMO_COACH_ID,
        name,
        pace_profile: paceProfile,
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
    const { id, name, paceOffsetSeconds, level, marathonGoal } = body;

    if (!id) {
      return NextResponse.json(
        { error: 'Group ID is required' },
        { status: 400 }
      );
    }

    const updates: any = {};
    if (name !== undefined) updates.name = name;

    // Update pace_profile if offset, level, or marathonGoal is provided
    if (paceOffsetSeconds !== undefined || level !== undefined || marathonGoal !== undefined) {
      // Get existing pace_profile to merge
      const { data: existing } = await supabase
        .from('groups')
        .select('pace_profile')
        .eq('id', id)
        .single();

      const existingProfile = (existing?.pace_profile as any) || {};

      updates.pace_profile = {
        offsetSeconds: paceOffsetSeconds ?? existingProfile.offsetSeconds ?? 0,
        level: level ?? existingProfile.level ?? 'medium',
        marathonGoal: marathonGoal !== undefined ? marathonGoal : (existingProfile.marathonGoal || ''),
      };
    }

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
