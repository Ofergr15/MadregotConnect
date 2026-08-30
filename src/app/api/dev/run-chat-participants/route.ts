import { NextResponse } from 'next/server';
import { authError, requireSession } from '@/lib/auth-session';
import { createServerClient } from '@/lib/supabase/server';
import {
  ensureAiUser,
  getStreamServerClient,
  resolveCoachStreamUser,
  upsertStreamUsersFromAthletes,
} from '@/lib/stream/server';

export const dynamic = 'force-dynamic';

function roleLabel(role: string) {
  return role === 'coach' || role === 'academy_coach' || role === 'admin' ? 'מאמן' : 'רץ';
}

export async function GET(request: Request) {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not available in production' }, { status: 403 });
  }

  const auth = await requireSession(request);
  if (!auth.ok) return authError(auth);

  const activityId = new URL(request.url).searchParams.get('activityId');
  if (!activityId) {
    return NextResponse.json({ error: 'activityId required' }, { status: 400 });
  }

  try {
    const supabase = createServerClient();
    const { data: activity } = await supabase
      .from('athlete_activities')
      .select('athlete_id')
      .eq('id', activityId)
      .maybeSingle();
    if (!activity) {
      return NextResponse.json({ error: 'Activity not found' }, { status: 404 });
    }

    const { data: runner } = await supabase
      .from('athletes')
      .select('id, name, email, role, avatar_url')
      .eq('id', activity.athlete_id)
      .maybeSingle();
    if (!runner) {
      return NextResponse.json({ error: 'Runner not found' }, { status: 404 });
    }
    if (!auth.user.isStaff && auth.user.athleteId !== runner.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const stream = getStreamServerClient();
    await ensureAiUser(stream);
    const coach = await resolveCoachStreamUser(stream, supabase, runner.id);
    if (!coach) {
      return NextResponse.json({ error: 'Coach not found for runner' }, { status: 404 });
    }
    await upsertStreamUsersFromAthletes(
      stream,
      supabase,
      [runner.id, coach.athleteId].filter(Boolean) as string[],
    );

    const apiKey = process.env.STREAM_API_KEY!;
    return NextResponse.json({
      participants: {
        runner: {
          apiKey,
          userId: runner.id,
          token: stream.createToken(runner.id),
          userName: runner.name || runner.email,
          roleLabel: roleLabel(runner.role || 'runner'),
          isStaff: ['coach', 'academy_coach', 'admin'].includes(runner.role || ''),
          imageUrl: runner.avatar_url || null,
        },
        coach: {
          apiKey,
          userId: coach.streamId,
          token: stream.createToken(coach.streamId),
          userName: coach.name,
          roleLabel: 'מאמן',
          isStaff: true,
          imageUrl: coach.image,
        },
      },
    });
  } catch (error) {
    console.error('GET /api/dev/run-chat-participants error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
