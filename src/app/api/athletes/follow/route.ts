import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { notifyAthlete } from '@/lib/push';

export const dynamic = 'force-dynamic';

// POST /api/athletes/follow { followerId, followeeId }
// Asymmetric, instant follow (no approval — same trust model as clicking
// Follow on a public Strava profile; this is a closed club, not a public
// platform, so there's no private-account concept to gate on). Idempotent:
// a repeat call for an already-following pair is a no-op, not an error, so
// the UI never has to special-case a double-tap or a stale button state.
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const { followerId, followeeId } = body as { followerId?: string; followeeId?: string };

    if (!followerId || !followeeId) {
      return NextResponse.json({ error: 'followerId and followeeId are required' }, { status: 400 });
    }
    if (followerId === followeeId) {
      return NextResponse.json({ error: 'Cannot follow yourself' }, { status: 400 });
    }

    const supabase = createServerClient();
    // ignoreDuplicates + select(): a genuinely new follow returns the inserted
    // row; an already-following repeat call returns nothing — that distinction
    // is exactly "should this notify" (never re-notify for the same pair).
    const { data, error } = await supabase
      .from('athlete_follows')
      .upsert({ follower_id: followerId, followee_id: followeeId }, { onConflict: 'follower_id,followee_id', ignoreDuplicates: true })
      .select('follower_id');

    if (error) throw error;

    if ((data || []).length > 0) {
      // New follow — let the followee know. Best-effort, never blocks the follow.
      try {
        const { data: follower } = await supabase.from('athletes').select('name, avatar_url').eq('id', followerId).maybeSingle();
        const who = follower?.name?.trim() || 'מישהו';
        await notifyAthlete({
          athleteId: followeeId,
          kind: 'follow',
          actorAthleteId: followerId,
          title: `${who} התחיל/ה לעקוב אחריך 👋`,
          body: 'היכנסו לפרופיל שלכם כדי לראות',
          url: '/dashboard/profile',
          tag: `follow-${followerId}-${followeeId}`,
          category: 'teammates',
          ...(follower?.avatar_url ? { icon: follower.avatar_url } : {}),
        });
      } catch { /* best-effort */ }
    }

    return NextResponse.json({ following: true });
  } catch (error) {
    console.error('Failed to follow athlete:', error);
    return NextResponse.json({ error: 'Failed to follow athlete' }, { status: 500 });
  }
}

// DELETE /api/athletes/follow { followerId, followeeId }
// Unfollow. Also idempotent — deleting a non-existent row is not an error.
export async function DELETE(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const { followerId, followeeId } = body as { followerId?: string; followeeId?: string };

    if (!followerId || !followeeId) {
      return NextResponse.json({ error: 'followerId and followeeId are required' }, { status: 400 });
    }

    const supabase = createServerClient();
    const { error } = await supabase
      .from('athlete_follows')
      .delete()
      .eq('follower_id', followerId)
      .eq('followee_id', followeeId);

    if (error) throw error;

    return NextResponse.json({ following: false });
  } catch (error) {
    console.error('Failed to unfollow athlete:', error);
    return NextResponse.json({ error: 'Failed to unfollow athlete' }, { status: 500 });
  }
}
