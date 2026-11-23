import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { COACH_ID } from '@/lib/constants';
import { authError, requireSession } from '@/lib/auth-session';
import { requireMember } from '@/lib/auth/self-or-staff';

export const dynamic = 'force-dynamic';

/** Staff-only: this is coach-authored content for the whole club. */
async function requireStaff(request: Request) {
  const auth = await requireSession(request);
  if (!auth.ok) return authError(auth);
  if (!auth.user.isStaff) {
    return NextResponse.json({ error: 'Staff access required' }, { status: 403 });
  }
  return null;
}

// GET - List all nutrition plans for the coach.
// Members only (verified JWT). Its one caller is the native staff week screen, which
// sends a bearer token; no web page and nothing public reads it.
export async function GET(request: Request) {
  try {
    const denied = await requireMember(request);
    if (denied) return denied;

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
    const denied = await requireStaff(request);
    if (denied) return denied;

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

// PUT - Edit a nutrition plan in place: { id, week_label?, content? }. Same staff gate as POST.
// The row id survives, unlike the native client's old create-then-delete "edit".
export async function PUT(request: Request) {
  try {
    const denied = await requireStaff(request);
    if (denied) return denied;

    const body = await request.json().catch(() => null);
    const id = body?.id;
    if (typeof id !== 'string' || !id) {
      return NextResponse.json({ error: 'Plan ID is required' }, { status: 400 });
    }
    const patch: Record<string, unknown> = {};
    for (const key of ['week_label', 'content'] as const) {
      if (key in body) {
        if (!body[key]) return NextResponse.json({ error: `${key} must not be empty` }, { status: 400 });
        patch[key] = body[key];
      }
    }
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: 'week_label or content is required' }, { status: 400 });
    }

    const { data: plan, error } = await createServerClient()
      .from('plans')
      .update(patch)
      .eq('id', id)
      .eq('coach_id', COACH_ID)
      .eq('type', 'nutrition')
      .select()
      .maybeSingle();

    if (error) throw error;
    if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 });

    return NextResponse.json({ plan });
  } catch (error) {
    console.error('Failed to update nutrition plan:', error);
    return NextResponse.json(
      { error: 'Failed to update nutrition plan' },
      { status: 500 }
    );
  }
}

// DELETE - Delete a nutrition plan
export async function DELETE(request: Request) {
  try {
    const denied = await requireStaff(request);
    if (denied) return denied;

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
