import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';

/**
 * POST /api/plans - Create a new weekly plan
 * Body: { coach_id, week_start_date, original_input, parsed_workouts, status, athlete_id? }
 * athlete_id (optional) scopes the plan to a single academy athlete; omit for a
 * group-wide plan.
 */
export async function POST(req: NextRequest) {
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
      parsed_workouts,
      status,
    };
    // Only include athlete_id when targeting an individual athlete, so group-plan
    // saves keep working on DBs where the column hasn't been migrated yet.
    if (athlete_id) insertRow.athlete_id = athlete_id;

    const { data, error } = await supabase
      .from('weekly_plans')
      .insert(insertRow)
      .select()
      .single();

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
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const coach_id = searchParams.get('coach_id');
    const athlete_id = searchParams.get('athlete_id');

    if (!coach_id) {
      return NextResponse.json(
        { error: 'coach_id is required' },
        { status: 400 }
      );
    }

    const supabase = createServerClient();

    const runQuery = (scoped: boolean) => {
      let q = supabase
        .from('weekly_plans')
        .select('*')
        .eq('coach_id', coach_id)
        .order('week_start_date', { ascending: false });
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
    if (parsed_workouts) updates.parsed_workouts = parsed_workouts;

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
