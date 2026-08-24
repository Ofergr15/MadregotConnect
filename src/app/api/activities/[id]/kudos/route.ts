import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { notifyAthlete } from '@/lib/push';

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
            title: `${who} נתן/ה לך קודוס על הריצה! 👍`,
            body: 'לחצו לצפייה',
            url: `/dashboard/activities?kudos=${id}`,
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
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { athleteId } = await request.json();
    if (!athleteId) return NextResponse.json({ error: 'athleteId required' }, { status: 400 });

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
