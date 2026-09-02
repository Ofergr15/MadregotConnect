import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { resolveVerifiedCaller } from '@/lib/auth/self-or-staff';

export const dynamic = 'force-dynamic';

// GET /api/athletes/discover
// Roadmap #21, Phase 6 — Member Discovery. The Follow system (migration 060)
// only ever had two entry points: a teammate's own profile page, or names
// already showing up in the feed/leaderboards — there was no way to browse
// or search for someone you don't already see elsewhere. This is the full
// roster (minus the viewer themself), each row flagged with whether the
// viewer already follows them, for a search-as-you-type list client-side —
// the club is small enough (~20s of athletes) that filtering client-side
// beats a query round trip per keystroke.
//
// The viewer used to arrive as `?viewerId=<id>`, unverified — so this returned
// the club roster to anyone, and passing somebody else's id returned THEIR
// follow graph (who they follow is not the caller's business). It's the session's
// athleteId now, which is also why the parameter is gone rather than just
// checked: there is nothing left for a caller to legitimately say here.
interface AthleteRow {
  id: string;
  name: string;
  avatar_url: string | null;
  group_id: string | null;
  status: string;
  discoverable?: boolean;
}

export async function GET(request: Request) {
  try {
    const { denied, caller } = await resolveVerifiedCaller(request);
    if (denied) return denied;
    // A staff account with no `athletes` row has no follow graph and isn't in
    // the roster it would be browsing — an empty list is the honest answer, and
    // it keeps the `.eq('follower_id', null)` query below from ever being built.
    if (!caller.athleteId) return NextResponse.json({ athletes: [] });
    const viewerId = caller.athleteId;

    const supabase = createServerClient();

    // discoverable (migration 069) may not be applied yet in every
    // environment — degrade to the pre-069 column set instead of 500ing the
    // whole route, same tolerance as /api/athletes/me.
    let athletesRes = await supabase
      .from('athletes')
      .select('id, name, avatar_url, group_id, status, discoverable')
      .eq('status', 'active')
      .eq('discoverable', true)
      .returns<AthleteRow[]>();
    if (athletesRes.error?.code === '42703' || athletesRes.error?.code === 'PGRST204') {
      athletesRes = await supabase
        .from('athletes')
        .select('id, name, avatar_url, group_id, status')
        .eq('status', 'active')
        .returns<AthleteRow[]>();
    }
    const [groupsRes, followingRes] = await Promise.all([
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
