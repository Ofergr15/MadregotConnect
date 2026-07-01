import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { notifyUserApproved, notifyAdminUserApproved } from '@/lib/email';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const supabase = createServerClient();
    const { athleteId, approverEmail } = await req.json();

    if (!athleteId) {
      return NextResponse.json({ error: 'athleteId is required' }, { status: 400 });
    }

    const { data: athlete, error: findError } = await supabase
      .from('athletes')
      .select('id, name, email, approved')
      .eq('id', athleteId)
      .single();

    if (findError || !athlete) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    if (athlete.approved) {
      return NextResponse.json({ message: 'Already approved' });
    }

    const { error: updateError } = await supabase
      .from('athletes')
      .update({
        approved: true,
        approved_at: new Date().toISOString(),
        approved_by: approverEmail || null,
        status: 'active',
      })
      .eq('id', athleteId);

    if (updateError) throw updateError;

    try {
      await notifyUserApproved({ name: athlete.name, email: athlete.email });
      if (approverEmail) {
        await notifyAdminUserApproved({ email: approverEmail }, { name: athlete.name, email: athlete.email });
      }
    } catch (emailErr) {
      console.error('Email notification failed:', emailErr);
    }

    return NextResponse.json({ success: true, athlete: { id: athlete.id, email: athlete.email, approved: true } });
  } catch (error) {
    console.error('Failed to approve user:', error);
    return NextResponse.json({ error: 'Failed to approve user' }, { status: 500 });
  }
}
