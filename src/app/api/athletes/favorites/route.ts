import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireAthlete, authError } from '@/lib/auth-session';

export const dynamic = 'force-dynamic';

/**
 * The caller's own favourites list (ff8d932e).
 *
 * ── THE OWNER IS NEVER A PARAMETER ──────────────────────────────────────────
 * Every handler here takes the list owner from `requireAthlete`, i.e. from the
 * verified session JWT, and there is deliberately no `athleteId` for the OWNER
 * anywhere in a query string or a body. That is the whole security surface of
 * this route: with an owner param, one forged call would let anybody read whose
 * runs anybody else cares about, or edit somebody else's list. Compare
 * /api/athletes/follow, which does take a `followerId` and therefore has to gate
 * it on every verb — one fewer parameter is one fewer thing to get wrong.
 *
 * A favourite is PRIVATE. It never appears on the favourited athlete's profile,
 * never changes a count, and never fires a push — unlike a follow, which is
 * visible to the other person. So there is no read path here for anybody else's
 * list, not even for staff.
 *
 * The rows are only ever "the ids in my list"; the names come from /api/groups,
 * the roster every member already has.
 */

/** A private list, not a social graph — no reason for it to be unbounded. */
const MAX_FAVORITES = 30;

// GET /api/athletes/favorites → { athleteIds: string[] }
// Ids only. The caller already has the roster (/api/groups) and joining names in
// here would mean this route decided what a member may see about a teammate,
// which is a question that already has one answer somewhere else.
export async function GET(request: Request) {
  const auth = await requireAthlete(request);
  if (!auth.ok) return authError(auth);

  try {
    const supabase = createServerClient();
    const { data, error } = await supabase
      .from('athlete_favorites')
      .select('favorite_athlete_id')
      .eq('athlete_id', auth.user.athleteId)
      .order('created_at', { ascending: true });

    if (error) throw error;
    return NextResponse.json({ athleteIds: (data || []).map((r: { favorite_athlete_id: string }) => r.favorite_athlete_id) });
  } catch (err: unknown) {
    console.error('Favorites fetch error:', err);
    return NextResponse.json({ error: 'Failed to load favorites' }, { status: 500 });
  }
}

// POST /api/athletes/favorites { athleteId } → { favorited: true }
// Idempotent: favouriting somebody already on the list is a no-op rather than an
// error, so a double tap on a slow connection needs no special case in the UI.
export async function POST(request: Request) {
  const auth = await requireAthlete(request);
  if (!auth.ok) return authError(auth);

  try {
    const body = await request.json().catch(() => ({}));
    const target = typeof body.athleteId === 'string' ? body.athleteId.trim() : '';
    if (!target) return NextResponse.json({ error: 'athleteId is required' }, { status: 400 });
    // Also a CHECK constraint — refused here so the caller gets a reason rather
    // than a 500 out of Postgres.
    if (target === auth.user.athleteId) {
      return NextResponse.json({ error: 'Cannot favorite yourself' }, { status: 400 });
    }

    const supabase = createServerClient();

    const { count, error: countError } = await supabase
      .from('athlete_favorites')
      .select('id', { count: 'exact', head: true })
      .eq('athlete_id', auth.user.athleteId);
    if (countError) throw countError;
    if ((count || 0) >= MAX_FAVORITES) {
      return NextResponse.json({ error: `Favorites are limited to ${MAX_FAVORITES}` }, { status: 409 });
    }

    const { error } = await supabase
      .from('athlete_favorites')
      .upsert(
        { athlete_id: auth.user.athleteId, favorite_athlete_id: target },
        { onConflict: 'athlete_id,favorite_athlete_id', ignoreDuplicates: true },
      );
    if (error) throw error;

    return NextResponse.json({ favorited: true });
  } catch (err: unknown) {
    console.error('Favorite add error:', err);
    return NextResponse.json({ error: 'Failed to update favorites' }, { status: 500 });
  }
}

// DELETE /api/athletes/favorites?athleteId=<id> → { favorited: false }
// Idempotent in the same way: removing something that isn't there succeeds.
export async function DELETE(request: Request) {
  const auth = await requireAthlete(request);
  if (!auth.ok) return authError(auth);

  try {
    const target = (new URL(request.url).searchParams.get('athleteId') || '').trim();
    if (!target) return NextResponse.json({ error: 'athleteId is required' }, { status: 400 });

    const supabase = createServerClient();
    const { error } = await supabase
      .from('athlete_favorites')
      .delete()
      .eq('athlete_id', auth.user.athleteId)
      .eq('favorite_athlete_id', target);
    if (error) throw error;

    return NextResponse.json({ favorited: false });
  } catch (err: unknown) {
    console.error('Favorite remove error:', err);
    return NextResponse.json({ error: 'Failed to update favorites' }, { status: 500 });
  }
}
