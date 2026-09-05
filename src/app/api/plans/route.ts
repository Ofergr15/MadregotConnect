import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireSession, authError } from '@/lib/auth-session';
import { normalizeParsedWorkouts } from '@/lib/plans/normalize-plan';

/**
 * POST /api/plans - Create a new weekly plan
 * Body: { coach_id, week_start_date, original_input, parsed_workouts, status, athlete_id? }
 * athlete_id (optional) scopes the plan to a single academy athlete; omit for a
 * group-wide plan.
 */
export async function POST(req: NextRequest) {
  const auth = await requireSession(req);
  if (!auth.ok) return authError(auth);
  if (!auth.user.isStaff) {
    return NextResponse.json({ error: 'Staff access required' }, { status: 403 });
  }

  try {
    const body = await req.json();
    const { coach_id, week_start_date, original_input, parsed_workouts, status = 'draft', athlete_id } = body;

    if (!coach_id || !week_start_date || !parsed_workouts) {
      return NextResponse.json(
        { error: 'coach_id, week_start_date, and parsed_workouts are required' },
        { status: 400 }
      );
    }

    const supabase = createServerClient();

    const insertRow: Record<string, unknown> = {
      coach_id,
      week_start_date,
      original_input: original_input || null,
      // Stamp the matcher hints (workoutKey / expectedDistanceM / partIndex) on
      // the way in. Without this the planner's own saves produced plans that
      // activity-matcher.ts rejects outright, so nothing an athlete ran could
      // ever be attributed to the workout it was run for.
      parsed_workouts: normalizeParsedWorkouts(parsed_workouts),
      status,
    };
    // Only include athlete_id when targeting an individual athlete, so group-plan
    // saves keep working on DBs where the column hasn't been migrated yet.
    if (athlete_id) insertRow.athlete_id = athlete_id;

    // No DB-level uniqueness on (coach_id, week_start_date[, athlete_id]) — two
    // near-simultaneous creates for the same week (e.g. the same coach open in
    // two tabs, both saving right after a 30-180s AI parse) would otherwise
    // insert two rows and leave one an invisible orphan. Check-then-update
    // instead of a blind insert closes that window without needing a
    // migration; still update (not truly atomic), but the realistic race is
    // "minutes apart", not "same millisecond".
    let existingQuery = supabase
      .from('weekly_plans')
      .select('id')
      .eq('coach_id', coach_id)
      .eq('week_start_date', week_start_date);
    existingQuery = athlete_id ? existingQuery.eq('athlete_id', athlete_id) : existingQuery.is('athlete_id', null);
    const { data: existing, error: existingError } = await existingQuery.maybeSingle();

    let data, error;
    if (!existingError && existing) {
      ({ data, error } = await supabase
        .from('weekly_plans')
        .update(insertRow)
        .eq('id', existing.id)
        .select()
        .single());
    } else {
      ({ data, error } = await supabase
        .from('weekly_plans')
        .insert(insertRow)
        .select()
        .single());
    }

    if (error) {
      console.error('Error creating plan:', error);
      return NextResponse.json(
        { error: 'Failed to create plan', details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ plan: data }, { status: 201 });
  } catch (error: any) {
    console.error('Create plan error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to create plan' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/plans - List plans for a coach
 * Query: ?coach_id=xxx            → group-wide plans (athlete_id IS NULL)
 *        ?coach_id=xxx&athlete_id=yyy → an individual academy athlete's plans
 *        &week_start_date=YYYY-MM-DD  → just that week
 *
 * `week_start_date` is a narrowing-only filter and every caller passes it.
 * `parsed_workouts` is ~22 KB per week, so the unfiltered list was a 245 KB
 * response that grew with every week of the season — and all four call sites
 * did the same thing with it: `.find(p => p.week_start_date === weekStart)`,
 * i.e. threw away all but one row. Left optional so an old cached client (or a
 * future consumer that genuinely wants the season) still gets the full list.
 */
export async function GET(req: NextRequest) {
  const auth = await requireSession(req);
  if (!auth.ok) return authError(auth);
  if (!auth.user.isStaff) {
    return NextResponse.json({ error: 'Staff access required' }, { status: 403 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const coach_id = searchParams.get('coach_id');
    const athlete_id = searchParams.get('athlete_id');
    const week_start_date = searchParams.get('week_start_date');

    if (!coach_id) {
      return NextResponse.json(
        { error: 'coach_id is required' },
        { status: 400 }
      );
    }

    const supabase = createServerClient();

    // Explicit columns, not `select('*')`. `parsed_workouts` has to stay — the
    // planner picks the current week out of this list and AcademyPlanComposer
    // imports the group lane from it — but `original_input` is the coach's raw
    // pasted prompt, and no consumer of this list has ever read it: it's
    // declared on `SavedPlanSummary` and never referenced. On a season's worth
    // of weeks that was the bulk of a ~439 KB response, downloaded every time
    // the planner mounts.
    const runQuery = (scoped: boolean) => {
      let q = supabase
        .from('weekly_plans')
        // `athlete_id` is filtered on below but NOT projected, on purpose: the
        // fallback under this exists for a database where that column hasn't
        // been migrated yet, and naming it in the select list would make the
        // fallback query fail for the same reason as the scoped one — taking the
        // planner down entirely instead of degrading to the unscoped list.
        .select('id, coach_id, week_start_date, status, created_at, parsed_workouts')
        .eq('coach_id', coach_id)
        .order('week_start_date', { ascending: false });
      // Applied outside the `scoped` branch: this column predates athlete_id, so
      // narrowing by week must survive the unmigrated-DB fallback too.
      if (week_start_date) q = q.eq('week_start_date', week_start_date);
      if (scoped) {
        // Individual-athlete plans, or the group list (excludes per-athlete rows).
        q = athlete_id ? q.eq('athlete_id', athlete_id) : q.is('athlete_id', null);
      }
      return q;
    };

    // Scope by athlete_id; if the column doesn't exist yet, fall back to the
    // unscoped list so the planner keeps working before the migration is applied.
    let { data, error } = await runQuery(true);
    if (error) {
      const fallback = await runQuery(false);
      data = fallback.data;
      error = fallback.error;
    }

    if (error) {
      console.error('Error fetching plans:', error);
      return NextResponse.json(
        { error: 'Failed to fetch plans', details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ plans: data });
  } catch (error: any) {
    console.error('Fetch plans error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch plans' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/plans - Delete a plan
 * Body: { plan_id }
 */
export async function DELETE(req: NextRequest) {
  const auth = await requireSession(req);
  if (!auth.ok) return authError(auth);
  if (!auth.user.isStaff) {
    return NextResponse.json({ error: 'Staff access required' }, { status: 403 });
  }

  try {
    const body = await req.json();
    const { plan_id } = body;

    if (!plan_id) {
      return NextResponse.json(
        { error: 'plan_id is required' },
        { status: 400 }
      );
    }

    const supabase = createServerClient();

    const { error } = await supabase
      .from('weekly_plans')
      .delete()
      .eq('id', plan_id);

    if (error) {
      console.error('Error deleting plan:', error);
      return NextResponse.json(
        { error: 'Failed to delete plan', details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Delete plan error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to delete plan' },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/plans - Update a plan's status and/or workouts
 * Body: { plan_id, status?, parsed_workouts? }
 */
export async function PUT(req: NextRequest) {
  const auth = await requireSession(req);
  if (!auth.ok) return authError(auth);
  if (!auth.user.isStaff) {
    return NextResponse.json({ error: 'Staff access required' }, { status: 403 });
  }

  try {
    const body = await req.json();
    const { plan_id, status, parsed_workouts } = body;

    if (!plan_id) {
      return NextResponse.json(
        { error: 'plan_id is required' },
        { status: 400 }
      );
    }

    if (!status && !parsed_workouts) {
      return NextResponse.json(
        { error: 'At least one of status or parsed_workouts is required' },
        { status: 400 }
      );
    }

    const supabase = createServerClient();

    const updates: Record<string, unknown> = {};
    if (status) updates.status = status;
    // Same normalization as POST — an edit must not strip the matcher hints.
    if (parsed_workouts) updates.parsed_workouts = normalizeParsedWorkouts(parsed_workouts);

    const { data, error } = await supabase
      .from('weekly_plans')
      .update(updates)
      .eq('id', plan_id)
      .select()
      .single();

    if (error) {
      console.error('Error updating plan:', error);
      return NextResponse.json(
        { error: 'Failed to update plan', details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ plan: data });
  } catch (error: any) {
    console.error('Update plan error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to update plan' },
      { status: 500 }
    );
  }
}
