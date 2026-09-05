import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { loadAcademySettings } from '@/lib/academy/settings-server';
import { mayActFor, resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import { resolveExecutionSummaries, resolveExecutionVerdict } from '@/lib/plan-execution/resolve';

export const dynamic = 'force-dynamic';

/**
 * How many runs one batch call may ask about. A feed page is 20 items and the
 * activities screen shows a week, so this is generous — it's here so a hand-made
 * request can't turn one round trip into a thousand plan lookups.
 */
const MAX_BATCH = 60;

/**
 * GET /api/plan-execution
 *
 *   ?activityId=<uuid>   one run, in full: metric rows + per-rep pace verdicts
 *   ?ids=<uuid,uuid,…>   many runs, score + direction only (the feed's rings)
 *
 * ── Who may see a score ──────────────────────────────────────────────────────
 * Your own runs, and staff (admin/coach/academy_coach) see everyone's. That is
 * NARROWER than the rest of a run: any club member may already open any member's
 * route, splits and charts (see /api/activities/details). A grade is a different
 * thing from a stat — "you ran 4% slower than your coach asked" is between the
 * runner and their coach — so it gets the tighter gate, and the ring simply
 * isn't rendered for a teammate's card.
 *
 * Ids the caller may not see are omitted rather than rejected: the feed asks
 * about a whole page in one call, and one teammate's run in the list must not
 * fail the other nineteen.
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const activityId = searchParams.get('activityId');
    const ids = (searchParams.get('ids') || '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean);

    if (!activityId && ids.length === 0) {
      return NextResponse.json({ error: 'activityId or ids is required' }, { status: 400 });
    }

    const { denied, caller } = await resolveVerifiedCaller(request);
    if (denied) return denied;

    const supabase = createServerClient();
    // The club's adherence tolerances — the same ±15% / ±5 s/km the academy
    // compliance screens grade against, so one run never scores two ways.
    const { tolerances } = await loadAcademySettings();

    if (activityId) {
      const { data: row, error } = await supabase
        .from('athlete_activities')
        .select('athlete_id')
        .eq('id', activityId)
        .maybeSingle();
      if (error) throw error;
      if (!row) return NextResponse.json({ error: 'not found' }, { status: 404 });
      if (!mayActFor(caller, row.athlete_id)) {
        return NextResponse.json({ error: 'forbidden' }, { status: 403 });
      }

      const verdict = await resolveExecutionVerdict(supabase, activityId, tolerances);
      if (!verdict) return NextResponse.json({ error: 'not found' }, { status: 404 });
      return NextResponse.json({ verdict });
    }

    const requested = ids.slice(0, MAX_BATCH);
    let allowed = requested;
    if (!caller.isSuperUser && !caller.isStaff) {
      // A runner may only ask about their own. Resolved by asking the DB which of
      // these rows are theirs rather than trusting the caller to have filtered —
      // the client does filter, and this is what makes that an optimisation
      // rather than the access check.
      if (!caller.athleteId) return NextResponse.json({ summaries: [] });
      const { data: mine, error } = await supabase
        .from('athlete_activities')
        .select('id')
        .eq('athlete_id', caller.athleteId)
        .in('id', requested);
      if (error) throw error;
      allowed = (mine || []).map((row) => row.id);
    }

    const summaries = await resolveExecutionSummaries(supabase, allowed, tolerances);
    return NextResponse.json({ summaries });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to grade execution';
    console.error('Plan execution error:', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
