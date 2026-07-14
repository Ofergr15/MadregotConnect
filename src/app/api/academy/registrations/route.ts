import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { COACH_ID } from '@/lib/constants';

export const dynamic = 'force-dynamic';

/**
 * GET /api/academy/registrations — academy applicants and their full intake.
 * Defaults to those awaiting approval; ?all=1 returns every academy registrant.
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const all = searchParams.get('all') === '1';

    const supabase = createServerClient();
    // Guarded select — phone/academy_intake/is_academy may be unmigrated.
    let rows: any[] = [];
    const primary = await supabase
      .from('athletes')
      .select('id, name, email, phone, status, approved, onboarding_status, is_academy, academy_intake, garmin_auth, created_at')
      .eq('coach_id', COACH_ID)
      .order('created_at', { ascending: false });

    if (primary.error) {
      return NextResponse.json({ registrations: [] });
    }
    rows = (primary.data || []).filter((a: any) => a.is_academy);
    if (!all) rows = rows.filter((a: any) => a.approved === false);

    const registrations = rows.map((a: any) => ({
      id: a.id,
      name: a.name,
      email: a.email,
      phone: a.phone || null,
      approved: a.approved !== false,
      hasGarmin: !!a.garmin_auth,
      onboardingStatus: a.onboarding_status || null,
      intake: a.academy_intake || null,
      createdAt: a.created_at,
    }));

    return NextResponse.json({ registrations });
  } catch (error: any) {
    console.error('Academy registrations error:', error);
    return NextResponse.json({ registrations: [] });
  }
}
