import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { COACH_ID } from '@/lib/constants';

// GET - List all nutrition plans for the coach
export async function GET(request: Request) {
  try {
    const supabase = createServerClient();

    const { data: plans, error } = await supabase
      .from('plans')
      .select('*')
      .eq('coach_id', COACH_ID)
      .eq('type', 'nutrition')
      .order('created_at', { ascending: false });

    if (error) throw error;

    return NextResponse.json({ plans: plans || [] });
  } catch (error) {
    console.error('Failed to fetch nutrition plans:', error);
    return NextResponse.json(
      { error: 'Failed to fetch nutrition plans' },
      { status: 500 }
    );
  }
}

// POST - Create a new nutrition plan
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
        type: 'nutrition',
        week_label,
        content,
      })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ plan });
  } catch (error) {
    console.error('Failed to create nutrition plan:', error);
    return NextResponse.json(
      { error: 'Failed to create nutrition plan' },
      { status: 500 }
    );
  }
}

// DELETE - Delete a nutrition plan
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
      .eq('type', 'nutrition');

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to delete nutrition plan:', error);
    return NextResponse.json(
      { error: 'Failed to delete nutrition plan' },
      { status: 500 }
    );
  }
}
