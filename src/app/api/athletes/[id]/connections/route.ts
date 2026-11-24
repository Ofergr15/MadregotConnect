import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import { viewerForPreview } from '@/lib/auth/member-preview';
import { seesPending } from '@/lib/auth/pending-athletes';
import { testAccountIds, hiddenTestAccountsFor } from '@/lib/athletes/test-accounts';
import { buildConnectionsResult, type FollowAthleteRow } from '@/lib/follows/shape';

export const dynamic = 'force-dynamic';

// GET /api/athletes/[id]/connections
//
// Members only. The viewer — whose follow state comes back — is the signed-in
// caller; it used to be a `?viewerId=` anyone could set to anyone. The param is
// still sent by old clients and ignored. Runners still waiting for approval are
// left out of both lists, and their own lists read as not there (#77, #86),
// except to themselves and to staff.
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
    const { denied, caller } = await resolveVerifiedCaller(request);
    if (denied) return denied;
    // `?as=member` ("how teammates see me"): the same lists, decided for a plain
    // teammate — no follow state, no pending or test accounts (lib/auth/member-preview.ts).
    const preview = viewerForPreview(caller, id, new URL(request.url).searchParams);
    if (preview.error) return preview.error;
    const viewer = preview.viewer;
    const viewerId = viewer.athleteId;

    const supabase = createServerClient();

    // The pending check and both follow lists need only the id: one round trip, and
    // the check is still decided before anything is returned (lab 2026-10-17).
    const [{ data: target }, followerLinks, followingLinks] = await Promise.all([
      supabase.from('athletes').select('approved').eq('id', id).maybeSingle(),
      supabase.from('athlete_follows').select('follower_id').eq('followee_id', id),
      supabase.from('athlete_follows').select('followee_id').eq('follower_id', id),
    ]);
    const hiddenTest = hiddenTestAccountsFor(await testAccountIds(supabase), viewer);
    if (hiddenTest.has(id) || ((target as { approved?: boolean | null } | null)?.approved === false && !seesPending(viewer, id))) {
      return NextResponse.json({ error: 'Athlete not found' }, { status: 404 });
    }

    if (followerLinks.error) throw followerLinks.error;
    if (followingLinks.error) throw followingLinks.error;

    const followerIds = (followerLinks.data || []).map((row) => row.follower_id as string);
    const followingIds = (followingLinks.data || []).map((row) => row.followee_id as string);
    const allIds = Array.from(new Set([...followerIds, ...followingIds]));

    let athleteRows: FollowAthleteRow[] = [];
    if (allIds.length > 0) {
      const { data, error } = await supabase
        .from('athletes')
        .select('id, name, avatar_url, approved')
        .in('id', allIds);
      if (error) throw error;
      athleteRows = ((data || []) as Array<FollowAthleteRow & { approved?: boolean | null }>)
        .filter(row => !hiddenTest.has(row.id) && (row.approved !== false || seesPending(viewer, row.id)))
        .map(({ approved: _approved, ...row }) => row);
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
