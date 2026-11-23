import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { mayActFor, resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import { isFeatureEnabled } from '@/lib/features/server';
import { STRENGTH_TYPE } from '@/lib/activities/kinds';
import { activityLocalDateStr } from '@/lib/utils';

export const dynamic = 'force-dynamic';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_ATHLETES = 60;

/**
 * GET /api/activities/strength/week?athleteIds=a,b&from=YYYY-MM-DD&to=YYYY-MM-DD
 * → { sessions: { [athleteId]: [{ date, durationSec, activityId }] } }
 *
 * The strength sessions in a window, per athlete, for "בוצע" in the week and the coach's
 * yes/no column (lib/activities/strength-adherence.ts applies the planned-day-or-next rule).
 * Durations and dates only — no sets, no weights. SELF-OR-STAFF per athlete: any id the caller
 * may not act for is dropped from the answer, not an error. `to` should reach one day past the
 * last planned day so a Saturday session done on Sunday is seen.
 */
export async function GET(request: Request) {
  try {
    const { denied, caller } = await resolveVerifiedCaller(request);
    if (denied) return denied;
    const p = new URL(request.url).searchParams;
    const from = p.get('from') || '', to = p.get('to') || '';
    if (!DATE.test(from) || !DATE.test(to) || to < from) return NextResponse.json({ error: 'from/to must be YYYY-MM-DD' }, { status: 400 });
    const asked = (p.get('athleteIds') || caller.athleteId || '').split(',').map(s => s.trim()).filter(Boolean);
    const ids = [...new Set(asked)].filter(id => mayActFor(caller, id)).slice(0, MAX_ATHLETES);
    const db = createServerClient();
    if (!ids.length || !(await isFeatureEnabled('strength_training', caller.athleteId, db))) {
      return NextResponse.json({ sessions: {} });
    }
    const { data, error } = await db.from('athlete_activities')
      .select('id, athlete_id, start_time, duration')
      .eq('activity_type', STRENGTH_TYPE)
      .in('athlete_id', ids)
      .gte('start_time', `${from}T00:00:00`)
      .lt('start_time', `${to}T23:59:59.999`);
    if (error) return NextResponse.json({ error: 'read failed', details: error.message }, { status: 500 });
    const sessions: Record<string, Array<{ date: string; durationSec: number; activityId: string }>> = {};
    for (const r of (data || []) as Array<{ id: string; athlete_id: string; start_time: string; duration: number | null }>) {
      (sessions[r.athlete_id] ??= []).push({ date: activityLocalDateStr(r.start_time), durationSec: r.duration ?? 0, activityId: r.id });
    }
    return NextResponse.json({ sessions });
  } catch (err: unknown) {
    console.error('GET /api/activities/strength/week error:', err);
    return NextResponse.json({ error: (err as Error).message || 'Failed' }, { status: 500 });
  }
}
