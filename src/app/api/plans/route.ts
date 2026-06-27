import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';

/**
 * POST /api/plans - Create a new weekly plan
 * Body: { coach_id, week_start_date, original_input, parsed_workouts, status }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { coach_id, week_start_date, original_input, parsed_workouts, status = 'draft' } = body;

    if (!coach_id || !week_start_date || !parsed_workouts) {
      return NextResponse.json(
        { error: 'coach_id, week_start_date, and parsed_workouts are required' },
        { status: 400 }
      );
    }

    const supabase = createServerClient();

    const { data, error } = await supabase
      .from('weekly_plans')
      .insert({
        coach_id,
        week_start_date,
        original_input: original_input || null,
        parsed_workouts,
        status,
      })
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
 * Query: ?coach_id=xxx
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const coach_id = searchParams.get('coach_id');

    if (!coach_id) {
      return NextResponse.json(
        { error: 'coach_id is required' },
        { status: 400 }
      );
    }

    const supabase = createServerClient();

    const { data, error } = await supabase
      .from('weekly_plans')
      .select('*')
      .eq('coach_id', coach_id)
      .order('week_start_date', { ascending: false });

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
