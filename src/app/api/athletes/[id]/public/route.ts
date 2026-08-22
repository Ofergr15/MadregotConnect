import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import {
  buildPublicProfile,
  type PublicProfileAthleteRow,
  type PublicProfileGroupRow,
} from '@/lib/athletes/public-profile';

export const dynamic = 'force-dynamic';

// GET /api/athletes/[id]/public — the privacy-safe, peer-facing profile.
// Deliberately NOT the same projection as GET /api/athletes/me (owner-only;
// that route selects email/onboarding_status/garmin_auth/strava_auth, which
// must never be exposed to a peer viewing someone else's profile). Only
// selects the columns that are safe for any other club member to see.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const supabase = createServerClient();

    const { data: athlete, error } = await supabase
      .from('athletes')
      .select('id, name, avatar_url, group_id, created_at')
      .eq('id', id)
      .maybeSingle();

    if (error) throw error;
    if (!athlete) {
      return NextResponse.json({ error: 'Athlete not found' }, { status: 404 });
    }

    // groups.id / groups.name confirmed in supabase/schema.sql — a plain
    // lookup by group_id, not an embed (athlete_follows in the sibling
    // /connections route is the one with the double-FK ambiguity; this join
    // is a single, ordinary FK and has no such issue, but a second query
    // keeps this route's shape identical regardless).
    let group: PublicProfileGroupRow | null = null;
    if (athlete.group_id) {
      const { data: groupRow, error: groupError } = await supabase
        .from('groups')
        .select('name')
        .eq('id', athlete.group_id)
        .maybeSingle();
      if (groupError) throw groupError;
      group = groupRow;
    }

    return NextResponse.json(buildPublicProfile(athlete as PublicProfileAthleteRow, group));
  } catch (error) {
    console.error('Failed to fetch public athlete profile:', error);
    return NextResponse.json({ error: 'Failed to fetch public athlete profile' }, { status: 500 });
  }
}
