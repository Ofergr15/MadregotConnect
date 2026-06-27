import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { COACH_ID } from '@/lib/constants';

// GET - List all training plans for the coach
export async function GET(request: Request) {
  try {
    const supabase = createServerClient();

    const { data: plans, error } = await supabase
      .from('plans')
      .select('*')
      .eq('coach_id', COACH_ID)
      .eq('type', 'training')
      .order('created_at', { ascending: false });

    if (error) throw error;

    return NextResponse.json({ plans: plans || [] });
  } catch (error) {
    console.error('Failed to fetch training plans:', error);
    return NextResponse.json(
      { error: 'Failed to fetch training plans' },
      { status: 500 }
    );
  }
}

// POST - Create a new training plan
export async function POST(request: Request) {
  try {
    const supabase = createServerClient();
    const body = await request.json();
    const { week_label, content } = body;

    if (!week_label || !content) {
      return NextResponse.json(
        { error: 'Week label and content are required' },
        { status: 400 }
      );
    }

    const { data: plan, error } = await supabase
      .from('plans')
      .insert({
        coach_id: COACH_ID,
        type: 'training',
        week_label,
        content,
      })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ plan });
  } catch (error) {
    console.error('Failed to create training plan:', error);
    return NextResponse.json(
      { error: 'Failed to create training plan' },
      { status: 500 }
    );
  }
}

// DELETE - Delete a training plan
export async function DELETE(request: Request) {
  try {
    const supabase = createServerClient();
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json(
        { error: 'Plan ID is required' },
        { status: 400 }
      );
    }

    const { error } = await supabase
      .from('plans')
      .delete()
      .eq('id', id)
      .eq('coach_id', COACH_ID)
      .eq('type', 'training');

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to delete training plan:', error);
    return NextResponse.json(
      { error: 'Failed to delete training plan' },
      { status: 500 }
    );
  }
}
