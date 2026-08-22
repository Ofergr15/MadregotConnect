import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

// GET /api/athletes/discover?viewerId=<id>
// Roadmap #21, Phase 6 — Member Discovery. The Follow system (migration 060)
// only ever had two entry points: a teammate's own profile page, or names
// already showing up in the feed/leaderboards — there was no way to browse
// or search for someone you don't already see elsewhere. This is the full
// roster (minus the viewer themself), each row flagged with whether the
// viewer already follows them, for a search-as-you-type list client-side —
// the club is small enough (~20s of athletes) that filtering client-side
// beats a query round trip per keystroke.
interface AthleteRow {
  id: string;
  name: string;
  avatar_url: string | null;
  group_id: string | null;
  status: string;
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const viewerId = searchParams.get('viewerId');
    if (!viewerId) {
      return NextResponse.json({ error: 'viewerId required' }, { status: 400 });
    }

    const supabase = createServerClient();

    const [athletesRes, groupsRes, followingRes] = await Promise.all([
      supabase.from('athletes').select('id, name, avatar_url, group_id, status').eq('status', 'active'),
      supabase.from('groups').select('id, name'),
      supabase.from('athlete_follows').select('followee_id').eq('follower_id', viewerId),
    ]);
    if (athletesRes.error) throw athletesRes.error;
    if (groupsRes.error) throw groupsRes.error;
    if (followingRes.error) throw followingRes.error;

    const groupNameById = new Map(
      ((groupsRes.data || []) as Array<{ id: string; name: string }>).map((g) => [g.id, g.name]),
    );
    const followingIds = new Set(
      ((followingRes.data || []) as Array<{ followee_id: string }>).map((f) => f.followee_id),
    );

    const athletes = ((athletesRes.data || []) as AthleteRow[])
      .filter((a) => a.id !== viewerId)
      .map((a) => ({
        id: a.id,
        name: a.name,
        avatarUrl: a.avatar_url || null,
        groupName: a.group_id ? groupNameById.get(a.group_id) || null : null,
        isFollowing: followingIds.has(a.id),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return NextResponse.json({ athletes });
  } catch (error) {
    console.error('Failed to fetch discoverable athletes:', error);
    return NextResponse.json({ error: 'Failed to fetch athletes' }, { status: 500 });
  }
}
