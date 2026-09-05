import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { COACH_ID } from '@/lib/constants';
import { groupDisplayName } from '@/lib/utils';
import { paceLevelFromOffset } from '@/lib/groups/pace-level';
import { authError, requireSession } from '@/lib/auth-session';

const DEMO_COACH_ID = COACH_ID;

export const dynamic = 'force-dynamic';

/**
 * Staff gate for the write handlers. GET stays open — half the app reads the
 * group list (Header, tab bar, profile, onboarding, leaderboards) and it holds
 * nothing sensitive; the auth blobs are deliberately mapped to booleans below.
 */
async function requireStaff(request: Request) {
  const auth = await requireSession(request);
  if (!auth.ok) return authError(auth);
  if (!auth.user.isStaff) {
    return NextResponse.json({ error: 'Staff access required' }, { status: 403 });
  }
  return null;
}

// GET - List all groups for the coach with athlete details
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const coachId = searchParams.get('coach_id') || DEMO_COACH_ID;

    const supabase = createServerClient();

    // `garmin_auth` / `strava_auth` are deliberately NOT selected here even
    // though the response needs their nullness. They are ~4 KB and ~0.25 KB of
    // encrypted text per athlete, so joining them made this one query 63.6 KB
    // and ~1040 ms against production — versus 3.7 KB and ~381 ms without them
    // (measured, warm, 3 runs each). All of it was thrown away one map() later
    // to produce two booleans. Since half the app reads this route on every
    // page (Header, tab bar, profile, onboarding, leaderboards), that was ~660
    // ms of dead latency on every screen in the app.
    //
    // The nullness comes from two id-only lookups instead, run in the same
    // Promise.all as the main query, so they cost no extra wall clock (~22 ids
    // each). PostgREST can't express `garmin_auth IS NOT NULL` as a projected
    // column, and the columns are encrypted TEXT rather than jsonb, so there is
    // no cheap sub-path to select either — a filtered id list is the whole
    // trick. The response shape is unchanged.
    //
    // The two lookups are club-wide rather than scoped to this coach's groups,
    // because scoping them would mean waiting for the group ids and giving up
    // the parallelism that makes them free. Only ids already present in the
    // response are ever looked up, so the extra rows are inert — but note that
    // PostgREST caps an unpaginated select at 1000 rows, so if the roster ever
    // passes ~1000 connected athletes these need scoping (or pagination).
    const [groupsRes, garminRes, stravaRes] = await Promise.all([
      supabase
        .from('groups')
        .select(`
          id,
          name,
          pace_profile,
          created_at,
          athletes:athletes(id, name, email, status, data_source)
        `)
        .eq('coach_id', coachId)
        .order('created_at', { ascending: true }),
      supabase.from('athletes').select('id').not('garmin_auth', 'is', null),
      supabase.from('athletes').select('id').not('strava_auth', 'is', null),
    ]);

    const { data: groups, error } = groupsRes;
    if (error) throw error;

    // A failure on either connection lookup degrades to "not connected" rather
    // than failing the whole group list — the badges it drives are advisory.
    const garminIds = new Set((garminRes.data || []).map((a: { id: string }) => a.id));
    const stravaIds = new Set((stravaRes.data || []).map((a: { id: string }) => a.id));

    const transformedGroups = groups?.map(group => {
      const paceProfile = group.pace_profile as any;
      const paceOffsetSeconds = typeof paceProfile === 'object' && paceProfile !== null
        ? (paceProfile.offsetSeconds ?? 0)
        : 0;

      // PUT keeps the stored level in sync with the offset whenever the
      // offset changes without an explicit override, so trusting the stored
      // value here is safe (and lets a deliberate override — same offset
      // bucket, different label — stick).
      const level: 'fast' | 'medium' | 'slow' = paceProfile?.level || paceLevelFromOffset(paceOffsetSeconds);

      const marathonGoal = paceProfile?.marathonGoal || '';

      // Booleans, so we never leak encrypted auth tokens to the client — and
      // now the tokens never leave the database either.
      const athletes = (Array.isArray(group.athletes) ? group.athletes : []).map((a: any) => ({
        id: a.id,
        name: a.name,
        email: a.email,
        status: a.status,
        hasGarmin: garminIds.has(a.id),
        hasStrava: stravaIds.has(a.id),
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
    const denied = await requireStaff(request);
    if (denied) return denied;

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
    const offsetSeconds = paceOffsetSeconds ?? 0;
    const paceProfile = {
      offsetSeconds,
      level: level ?? paceLevelFromOffset(offsetSeconds),
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
    const denied = await requireStaff(request);
    if (denied) return denied;

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
      const nextOffsetSeconds = paceOffsetSeconds ?? existingProfile.offsetSeconds ?? 0;

      updates.pace_profile = {
        offsetSeconds: nextOffsetSeconds,
        // An explicit `level` always wins (deliberate override). Otherwise,
        // if the offset itself changed, recompute from the new offset rather
        // than carrying over a now-stale stored value — that carry-over is
        // exactly what let a group's badge disagree with its own offset
        // indefinitely after an edit.
        level: level ?? (paceOffsetSeconds !== undefined ? paceLevelFromOffset(nextOffsetSeconds) : existingProfile.level ?? 'medium'),
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
    const denied = await requireStaff(request);
    if (denied) return denied;

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
