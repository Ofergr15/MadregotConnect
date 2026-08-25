import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { syncGroupFollows } from '@/lib/follows/group-sync';

export async function POST(req: NextRequest) {
  try {
    const { email, groupId } = await req.json();

    if (!email) {
      return NextResponse.json({ error: 'email is required' }, { status: 400 });
    }

    const supabase = createServerClient();

    const { data: athlete, error: findError } = await supabase
      .from('athletes')
      .select('id, name, email, group_id, approved')
      .eq('email', email.toLowerCase())
      .maybeSingle();

    if (!athlete) {
      return NextResponse.json({ error: 'Athlete not found' }, { status: 404 });
    }

    // Onboarding must NOT self-activate. A public sign-up only becomes 'active'
    // once the coach approves them (/api/admin/approve). Setting status='active'
    // here let unapproved sign-ups appear as full members (workout push, roster,
    // stats). Only block when approval is explicitly false — legacy rows with a
    // null 'approved' stay active for backward compatibility.
    const updates: Record<string, any> = {};
    if (athlete.approved !== false) updates.status = 'active';
    if (groupId) updates.group_id = groupId;

    const { data: updated, error: updateError } = await supabase
      .from('athletes')
      .update(updates)
      .eq('id', athlete.id)
      .select('id, name, email, group_id')
      .single();

    if (updateError) {
      return NextResponse.json({ error: 'Failed to update' }, { status: 500 });
    }

    if (groupId) {
      try {
        await syncGroupFollows(supabase, athlete.id, groupId);
      } catch { /* best-effort — never break the group update itself */ }
    }

    return NextResponse.json({ success: true, athlete: updated });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Internal error' }, { status: 500 });
  }
}
