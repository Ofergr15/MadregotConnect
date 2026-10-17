import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import { mayCoach } from '@/lib/academy/pairing-server';
import { GOALS_TABLE } from '@/lib/academy/goal-server';
import { isMissingColumn } from '@/lib/supabase/schema-drift';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /api/academy/goal/result — the race has been run (mockup G5, "איך היה?"):
 * `{ athleteId, resultSec, activityId? }`. The official time, and the watch run it came from
 * when the trainee confirmed that one. Same gate as the goal itself. Migration 148: before it
 * the columns are not there, and the route says so (503) instead of pretending to save.
 */
export async function POST(request: Request) {
  try {
    const { denied, caller } = await resolveVerifiedCaller(request);
    if (denied) return denied;
    const body = await request.json().catch(() => ({}));
    const athleteId = typeof body.athleteId === 'string' && body.athleteId ? body.athleteId : caller.athleteId || '';
    if (!athleteId) return NextResponse.json({ error: 'athleteId is required' }, { status: 400 });
    if (!(await mayCoach(caller, athleteId))) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const resultSec = Math.round(Number(body.resultSec));
    if (!Number.isFinite(resultSec) || resultSec < 600 || resultSec > 172_800) {
      return NextResponse.json({ error: 'Invalid result', fields: ['resultSec'] }, { status: 400 });
    }
    const activityId = typeof body.activityId === 'string' && UUID_RE.test(body.activityId) ? body.activityId : null;

    const supabase = createServerClient();
    const { data, error } = await supabase
      .from(GOALS_TABLE)
      .update({ result_sec: resultSec, result_activity_id: activityId, result_at: new Date().toISOString(), updated_by: caller.athleteId })
      .eq('athlete_id', athleteId)
      .select('athlete_id')
      .maybeSingle();
    if (error && isMissingColumn(error)) return NextResponse.json({ error: 'Results are not set up yet (migration 148)', columnsMissing: true }, { status: 503 });
    if (error) throw error;
    if (!data) return NextResponse.json({ error: 'No goal to record a result for' }, { status: 404 });
    return NextResponse.json({ athleteId, resultSec, activityId });
  } catch (err) {
    console.error('POST /api/academy/goal/result error:', err);
    return NextResponse.json({ error: 'Failed to save' }, { status: 500 });
  }
}
