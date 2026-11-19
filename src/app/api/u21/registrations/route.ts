import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { resolveVerifiedCaller } from '@/lib/auth/self-or-staff';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * GET /api/u21/registrations — read-only list for the U21 admin view.
 * Admin-only (same gate as /api/admin/notifications): these are minors' names and
 * guardian details, not club-wide information. Columns are the list's, not the intake.
 */
export async function GET(request: Request) {
  try {
    const { denied, caller } = await resolveVerifiedCaller(request);
    if (denied) return denied;
    if (!caller.isSuperUser && caller.role !== 'admin') {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }
    const supabase = createServerClient();
    const { data, error } = await supabase
      .from('u21_registrations')
      .select('id, first_name, last_name, age_band, track, red_flag, status, created_at')
      .order('created_at', { ascending: false })
      .limit(500);
    if (error) {
      // Migration 180 not applied yet → an empty list with a hint, not a broken screen.
      if (error.code === '42P01' || error.code === 'PGRST205') return NextResponse.json({ data: [], ready: false });
      return NextResponse.json({ error: 'Could not load', details: error.message }, { status: 500 });
    }
    return NextResponse.json({ data: data ?? [], ready: true });
  } catch (error: any) {
    console.error('u21 registrations failed', error);
    return NextResponse.json({ error: error.message || 'Server error' }, { status: 500 });
  }
}
