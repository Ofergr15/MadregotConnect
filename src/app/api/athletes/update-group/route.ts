import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';

export async function POST(req: NextRequest) {
  try {
    const { email, groupId } = await req.json();

    if (!email) {
      return NextResponse.json({ error: 'email is required' }, { status: 400 });
    }

    const supabase = createServerClient();

    const { data: athlete, error: findError } = await supabase
      .from('athletes')
      .select('id, name, email, group_id')
      .eq('email', email.toLowerCase())
      .maybeSingle();

    if (!athlete) {
      return NextResponse.json({ error: 'Athlete not found' }, { status: 404 });
    }

    const updates: Record<string, any> = { status: 'active' };
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

    return NextResponse.json({ success: true, athlete: updated });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Internal error' }, { status: 500 });
  }
}
