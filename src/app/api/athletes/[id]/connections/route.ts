import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { buildConnectionsResult, type FollowAthleteRow } from '@/lib/follows/shape';

export const dynamic = 'force-dynamic';

// GET /api/athletes/[id]/connections?viewerId=<optional athlete id>
//
// Two lookups (not a PostgREST embed) on purpose: `athlete_follows` has TWO
// FKs into `athletes` (follower_id, followee_id), so `.select('athletes(...)')`
// is ambiguous and PostgREST rejects it (PGRST201) without an explicit FK
// hint. Fetching the raw id lists first, then a single `.in('id', ...)` batch
// lookup, sidesteps that entirely and stays simple.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const viewerId = searchParams.get('viewerId');

    const supabase = createServerClient();

    const [followerLinks, followingLinks] = await Promise.all([
      supabase.from('athlete_follows').select('follower_id').eq('followee_id', id),
      supabase.from('athlete_follows').select('followee_id').eq('follower_id', id),
    ]);

    if (followerLinks.error) throw followerLinks.error;
    if (followingLinks.error) throw followingLinks.error;

    const followerIds = (followerLinks.data || []).map((row) => row.follower_id as string);
    const followingIds = (followingLinks.data || []).map((row) => row.followee_id as string);
    const allIds = Array.from(new Set([...followerIds, ...followingIds]));

    let athleteRows: FollowAthleteRow[] = [];
    if (allIds.length > 0) {
      const { data, error } = await supabase
        .from('athletes')
        .select('id, name, avatar_url')
        .in('id', allIds);
      if (error) throw error;
      athleteRows = data || [];
    }

    const athleteById = new Map(athleteRows.map((row) => [row.id, row]));
    const followerRows = followerIds
      .map((fid) => athleteById.get(fid))
      .filter((row): row is FollowAthleteRow => !!row);
    const followingRows = followingIds
      .map((fid) => athleteById.get(fid))
      .filter((row): row is FollowAthleteRow => !!row);

    return NextResponse.json(buildConnectionsResult(followerRows, followingRows, viewerId));
  } catch (error) {
    console.error('Failed to fetch athlete connections:', error);
    return NextResponse.json({ error: 'Failed to fetch athlete connections' }, { status: 500 });
  }
}
