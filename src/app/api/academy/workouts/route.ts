import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { COACH_ID } from '@/lib/constants';

export const dynamic = 'force-dynamic';

/**
 * Academy workout library — reusable single-workout templates.
 * GET    → list the coach's saved workouts (newest first)
 * POST   → save a workout { name, workout }  (workout = ParsedWorkout JSON)
 * DELETE → remove one  ?id=xxx
 */
export async function GET() {
  try {
    const supabase = createServerClient();
    const { data, error } = await supabase
      .from('academy_workouts')
      .select('id, name, workout, created_at')
      .eq('coach_id', COACH_ID)
      .order('created_at', { ascending: false });

    // Table may not be migrated yet → return an empty library rather than erroring.
    if (error) return NextResponse.json({ workouts: [] });
    return NextResponse.json({ workouts: data || [] });
  } catch (error: any) {
    console.error('Academy workouts GET error:', error);
    return NextResponse.json({ workouts: [] });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { name, workout } = body;
    if (!name || !workout) {
      return NextResponse.json({ error: 'name and workout are required' }, { status: 400 });
    }

    const supabase = createServerClient();
    const { data, error } = await supabase
      .from('academy_workouts')
      .insert({ coach_id: COACH_ID, name, workout })
      .select('id, name, workout, created_at')
      .single();

    if (error) {
      console.error('Academy workouts POST error:', error);
      return NextResponse.json({ error: 'Failed to save workout', details: error.message }, { status: 500 });
    }
    return NextResponse.json({ workout: data }, { status: 201 });
  } catch (error: any) {
    console.error('Academy workouts POST error:', error);
    return NextResponse.json({ error: error.message || 'Failed to save workout' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

    const supabase = createServerClient();
    const { error } = await supabase
      .from('academy_workouts')
      .delete()
      .eq('id', id)
      .eq('coach_id', COACH_ID);

    if (error) {
      console.error('Academy workouts DELETE error:', error);
      return NextResponse.json({ error: 'Failed to delete workout' }, { status: 500 });
    }
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Academy workouts DELETE error:', error);
    return NextResponse.json({ error: error.message || 'Failed to delete workout' }, { status: 500 });
  }
}
