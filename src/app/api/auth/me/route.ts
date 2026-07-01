import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: Request) {
  try {
    const supabase = createServerClient();

    const email = request.headers.get('x-user-email');

    if (!email) {
      return NextResponse.json({ error: 'No user email' }, { status: 401 });
    }

    const lowerEmail = email.toLowerCase();

    const { data: athlete } = await supabase
      .from('athletes')
      .select('id, role')
      .eq('email', lowerEmail)
      .maybeSingle();

    if (athlete) {
      // Update last_seen_at
      await supabase.from('athletes').update({ last_seen_at: new Date().toISOString() }).eq('id', athlete.id);
      return NextResponse.json({ role: athlete.role || 'runner' });
    }

    // Fallback: check coaches table for backwards compatibility
    const { data: coach } = await supabase
      .from('coaches')
      .select('id, role')
      .eq('email', lowerEmail)
      .maybeSingle();

    if (coach) {
      return NextResponse.json({ role: coach.role || 'coach' });
    }

    return NextResponse.json({ role: 'viewer' });
  } catch (error) {
    console.error('Failed to resolve user role:', error);
    return NextResponse.json({ error: 'Failed to resolve role' }, { status: 500 });
  }
}
