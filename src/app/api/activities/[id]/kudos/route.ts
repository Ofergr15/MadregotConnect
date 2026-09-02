import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { notifyAthlete } from '@/lib/push';
import { kudosCopy } from '@/lib/notifications/copy';
import { mayActFor, resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import { ACTION_TOKEN_HEADER, kudosScope, verifyActionToken } from '@/lib/auth/action-token';

export const dynamic = 'force-dynamic';

// GET /api/activities/[id]/kudos?athleteId=… — kudos count, whether the
// caller already gave it, and who gave it (name + avatar, capped) so the UI
// can render a Strava-style "Tal and 3 others gave kudos" avatar row.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const athleteId = new URL(request.url).searchParams.get('athleteId');
    const supabase = createServerClient();

    const { data, error } = await supabase
      .from('activity_kudos')
      .select('athlete_id, athlete:athlete_id ( name, avatar_url )')
      .eq('activity_id', id)
      .order('created_at', { ascending: false })
      .limit(20)
      .returns<Array<{ athlete_id: string; athlete: { name: string; avatar_url: string | null } | null }>>();
    if (error) {
      if (error.code === 'PGRST205') return NextResponse.json({ count: 0, givenByMe: false, givers: [] });
      throw error;
    }

    const givers = (data || []).map((r) => ({ name: r.athlete?.name || 'מישהו', avatarUrl: r.athlete?.avatar_url || null }));
    return NextResponse.json({
      count: givers.length,
      givenByMe: !!athleteId && (data || []).some((r) => r.athlete_id === athleteId),
      givers,
    });
  } catch (err: unknown) {
    return NextResponse.json({ error: (err as Error).message, count: 0, givenByMe: false, givers: [] }, { status: 500 });
  }
}

// POST /api/activities/[id]/kudos { athleteId } — give kudos. Idempotent: a
// repeat call is a no-op, not an error. Notifies the activity's owner on a
// genuinely new kudos only (never re-notifies for the same pair).
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { athleteId } = await request.json();
    if (!athleteId) return NextResponse.json({ error: 'athleteId required' }, { status: 400 });

    // This route took the giver's identity straight from the body with no check
    // at all, so anyone could give kudos as anybody — which also fired a push at
    // the activity's owner naming whoever the caller claimed to be.
    //
    // Two legitimate callers, same split as /api/attendance: the in-app button
    // (verified session) and the 👍 button on a push notification, which runs in
    // the service worker and can't reach a session — that one carries a token
    // scoped to this athlete and this activity.
    const token = request.headers.get(ACTION_TOKEN_HEADER);
    if (!verifyActionToken(token, athleteId, kudosScope(id))) {
      const { denied, caller } = await resolveVerifiedCaller(request);
      if (denied) return denied;
      if (!mayActFor(caller, athleteId)) {
        return NextResponse.json({ error: 'forbidden' }, { status: 403 });
      }
    }

    const supabase = createServerClient();
    const { data, error } = await supabase
      .from('activity_kudos')
      .upsert({ activity_id: id, athlete_id: athleteId }, { onConflict: 'activity_id,athlete_id', ignoreDuplicates: true })
      .select('id');
    if (error) throw error;

    if ((data || []).length > 0) {
      // Genuinely new — tell the activity's owner. Best-effort, never blocks the kudos itself.
      try {
        const { data: activity } = await supabase
          .from('athlete_activities')
          .select('athlete_id')
          .eq('id', id)
          .maybeSingle();
        if (activity && activity.athlete_id !== athleteId) {
          const { data: giver } = await supabase.from('athletes').select('name, avatar_url').eq('id', athleteId).maybeSingle();
          const who = giver?.name?.trim() || 'מישהו';
          await notifyAthlete({
            athleteId: activity.athlete_id,
            kind: 'kudos',
            actorAthleteId: athleteId,
            copy: (locale) => kudosCopy(locale, { name: who }),
            // The club feed focused on the run that got the kudos — see the
            // same link in notifyTeammatesOfActivity. /dashboard/activities
            // cannot show it: it filters to the viewer's own activities.
            url: `/feed?activity=${id}`,
            tag: `kudos-${id}-${athleteId}`,
            category: 'teammates',
            ...(giver?.avatar_url ? { icon: giver.avatar_url } : {}),
          });
        }
      } catch { /* best-effort */ }
    }

    return NextResponse.json({ given: true });
  } catch (err: unknown) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

// DELETE /api/activities/[id]/kudos { athleteId } — un-kudos. Idempotent.
// Session-only, deliberately: no notification carries an un-kudos button, so
// there is no service-worker caller to accommodate here. Ungated, this removed
// anyone's reaction on anyone's activity.
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { athleteId } = await request.json();
    if (!athleteId) return NextResponse.json({ error: 'athleteId required' }, { status: 400 });

    const { denied, caller } = await resolveVerifiedCaller(request);
    if (denied) return denied;
    if (!mayActFor(caller, athleteId)) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }

    const supabase = createServerClient();
    const { error } = await supabase
      .from('activity_kudos')
      .delete()
      .eq('activity_id', id)
      .eq('athlete_id', athleteId);
    if (error) throw error;

    return NextResponse.json({ given: false });
  } catch (err: unknown) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
