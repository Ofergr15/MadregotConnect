/**
 * GET /api/dev/strava-athletes
 *
 * Dev-only. Lists athletes that have linked Strava tokens so the Dev bar can
 * one-click re-enter as "your Strava user" after the first OAuth login.
 */
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

export async function GET() {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not available in production' }, { status: 403 });
  }

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  const { data, error } = await admin
    .from('athletes')
    .select('id, name, email, strava_athlete_id, role, approved')
    .not('strava_auth', 'is', null)
    .order('updated_at', { ascending: false })
    .limit(20);

  if (error) {
    // updated_at may be missing on older schemas — retry without order
    const fallback = await admin
      .from('athletes')
      .select('id, name, email, strava_athlete_id, role, approved')
      .not('strava_auth', 'is', null)
      .limit(20);
    if (fallback.error) {
      return NextResponse.json({ error: fallback.error.message }, { status: 500 });
    }
    return NextResponse.json({ athletes: fallback.data ?? [] });
  }

  return NextResponse.json({ athletes: data ?? [] });
}
