import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import {
  buildPublicProfile,
  type PublicProfileAthleteRow,
  type PublicProfileGroupRow,
  type PublicProfileBandRow,
  type PublicProfileCoachRow,
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
      .select(
        'id, name, avatar_url, group_id, created_at, role, is_core_runner, is_academy, academy_band_id, academy_coach_id',
      )
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

    // The academy band (דבוקה) and the personal coach — looked up ONLY for an
    // academy trainee. Two extra round trips that a regular member never pays,
    // and the shaping drops both anyway for a non-academy athlete, so querying
    // them unconditionally would be work spent on a field guaranteed to be null.
    let band: PublicProfileBandRow | null = null;
    let coach: PublicProfileCoachRow | null = null;
    if (athlete.is_academy) {
      if (athlete.academy_band_id) {
        const { data: bandRow } = await supabase
          .from('academy_bands')
          .select('band_number, name, goal')
          .eq('id', athlete.academy_band_id)
          .maybeSingle();
        band = bandRow;
      }
      if (athlete.academy_coach_id) {
        // Name only. The coach is another athlete row, and everything else on it
        // is as private as the one this route is already being careful about.
        const { data: coachRow } = await supabase
          .from('athletes')
          .select('name')
          .eq('id', athlete.academy_coach_id)
          .maybeSingle();
        coach = coachRow;
      }
    }

    return NextResponse.json(
      buildPublicProfile(athlete as PublicProfileAthleteRow, group, band, coach),
    );
  } catch (error) {
    console.error('Failed to fetch public athlete profile:', error);
    return NextResponse.json({ error: 'Failed to fetch public athlete profile' }, { status: 500 });
  }
}
