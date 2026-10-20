import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import { COACH_ID } from '@/lib/constants';
import { israelToday } from '@/lib/utils';
import { mayCoach } from '@/lib/academy/pairing-server';
import { loadTestState } from '@/lib/academy/test-state';
import { loadCoachRows } from '@/lib/academy/me-reads';
import { loadGoal } from '@/lib/academy/goal-server';

export const dynamic = 'force-dynamic';

/**
 * GET /api/academy/tests/entry?athleteId=… — what the trainee's "חסר לנו הטסט האחרון שלך" card
 * (mockup academy-existing-trainees, phone 4) needs: the test state (none / waiting / 2000 only
 * / old / ok), the coach the entry is sent to, and the goal row under it.
 *
 * Self, the manager or their coach. `show` is the one decision: the card stands on the home
 * while there is no usable test, says "ממתין לאישור" while one waits, and is gone once a test
 * counts — the test state is read live, so approval flips it with no other write.
 */
export async function GET(request: Request) {
  try {
    const { denied, caller } = await resolveVerifiedCaller(request);
    if (denied) return denied;
    const athleteId = new URL(request.url).searchParams.get('athleteId') || caller.athleteId || '';
    if (!athleteId) return NextResponse.json({ error: 'athleteId is required' }, { status: 400 });
    if (!(await mayCoach(caller, athleteId))) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const supabase = createServerClient();
    const { data: me } = await supabase
      .from('athletes')
      .select('id, is_academy, academy_coach_id')
      .eq('id', athleteId)
      .eq('coach_id', COACH_ID)
      .maybeSingle();
    if (!me?.is_academy) return NextResponse.json({ isMember: false, show: 'none' });

    const [test, coaches, goal, invited] = await Promise.all([
      loadTestState(supabase, athleteId, israelToday()),
      loadCoachRows(supabase, athleteId, me.academy_coach_id ?? null),
      loadGoal(supabase, athleteId),
      hasOpenInvitation(supabase, athleteId),
    ]);
    // An open invitation already asks for this test (launch N35): "חסר לנו הטסט האחרון שלך"
    // next to it was the same request twice, in two different words.
    const show = test.kind === 'pending' ? 'pending'
      : invited ? 'none'
        : test.kind === 'none' || test.kind === 'otherProtocol' || test.kind === 'baseline' || (test.kind === 'ok' && test.old) ? 'missing'
          : 'none';
    return NextResponse.json({
      isMember: true,
      show,
      test,
      coach: coaches.data[0] ? { name: coaches.data[0].name } : null,
      goal: goal.goal,
      goalSource: goal.source,
      goalsStored: goal.stored,
    });
  } catch (err) {
    console.error('GET /api/academy/tests/entry error:', err);
    return NextResponse.json({ error: 'Failed to load' }, { status: 500 });
  }
}

async function hasOpenInvitation(supabase: ReturnType<typeof createServerClient>, athleteId: string): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from('academy_test_invitations')
      .select('id')
      .eq('athlete_id', athleteId)
      .in('status', ['proposed', 'confirmed', 'other'])
      .limit(1);
    return !error && Array.isArray(data) && data.length > 0;
  } catch {
    return false;
  }
}
