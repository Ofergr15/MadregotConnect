import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { mayActFor, resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import { ensureMatchedWorkout } from '@/lib/plans/matched-workout';
import { isMissingColumn } from '@/lib/supabase/schema-drift';

export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'private, no-store' };
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: NO_STORE });

/**
 * POST /api/activities/{id}/lane  { lane: 1 | 2 | 3 | null }
 *
 * "I ran with pack N" on one run. The verdict detects the pack itself
 * (lib/plan-execution/ran-lane.ts); this is the runner's own answer and wins over
 * that detection. `null` clears it, handing the run back to detection.
 *
 * Self-or-staff: identity comes from the JWT, the target athlete from the run's own
 * row — a body can name a pack, never a person. Stored on the run's plan match
 * (migration 221), so a run with no match (nothing planned that week) answers 409.
 * 503 while 221 is unapplied, which the client reads as "not available yet".
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { denied, caller } = await resolveVerifiedCaller(request);
    if (denied) return denied;
    if (caller.viewingAsBy) return reply({ error: 'read-only while viewing as' }, 403);
    const { id } = await params;
    if (!/^[0-9a-f-]{36}$/i.test(id)) return reply({ error: 'bad id' }, 400);

    const body = await request.json().catch(() => null) as { lane?: unknown } | null;
    const lane = body?.lane ?? null;
    if (lane !== null && lane !== 1 && lane !== 2 && lane !== 3) {
      return reply({ error: 'lane must be 1, 2, 3 or null' }, 400);
    }

    const supabase = createServerClient();
    const { data: run, error: runError } = await supabase
      .from('athlete_activities').select('athlete_id').eq('id', id).maybeSingle();
    if (runError) throw runError;
    // Same answer for "no such run" and "not yours": a stranger learns nothing.
    if (!run?.athlete_id || !mayActFor(caller, run.athlete_id as string)) {
      return reply({ error: 'Activity not found' }, 404);
    }

    // The match row is where the answer lives; make sure the run has one.
    const matched = await ensureMatchedWorkout(supabase, id, run.athlete_id as string);
    if (!matched) return reply({ error: 'no planned workout for this run' }, 409);

    const { data, error } = await supabase
      .from('activity_plan_matches').update({ ran_lane: lane })
      .eq('activity_id', id).select('activity_id');
    if (error) {
      if (isMissingColumn(error, 'ran_lane')) return reply({ error: 'not available yet' }, 503);
      throw error;
    }
    // Computed in memory only (table missing) — nothing to write onto.
    if (!data?.length) return reply({ error: 'no planned workout for this run' }, 409);
    return reply({ lane });
  } catch (error: any) {
    console.error('Activity lane override error:', error);
    return reply({ error: error?.message || 'Failed to save the pack' }, 500);
  }
}
