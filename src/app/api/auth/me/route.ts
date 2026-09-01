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

    // `is_academy` rides along because academy membership is a flag, not a role:
    // an athlete with role `runner` can be in the academy (and several are), so
    // the nav can't derive their academy entry point from `role` alone. Selected
    // here rather than in its own request because this lookup already runs on
    // every page load.
    let athlete: { id: string; role?: string | null; is_academy?: boolean | null } | null = null;
    const primary = await supabase
      .from('athletes')
      .select('id, role, is_academy')
      .eq('email', lowerEmail)
      .maybeSingle();
    if (primary.error) {
      const fallback = await supabase
        .from('athletes')
        .select('id, role')
        .eq('email', lowerEmail)
        .maybeSingle();
      athlete = fallback.data;
    } else {
      athlete = primary.data;
    }

    if (athlete) {
      // Update last_seen_at
      await supabase.from('athletes').update({ last_seen_at: new Date().toISOString() }).eq('id', athlete.id);
      return NextResponse.json({ role: athlete.role || 'runner', isAcademy: !!athlete.is_academy });
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
