import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { authError, requireAthlete } from '@/lib/auth-session';
import { loadDataSourcesStatus } from '@/lib/data-sources/server';

export const dynamic = 'force-dynamic';

/**
 * GET /api/me/data-sources — the native "watch & data sources" status.
 *
 * SELF-ONLY: the athlete is the JWT's, there is no id parameter to forge.
 * Booleans, states and timestamps only — never `garmin_auth`/`strava_auth`, never
 * the Garmin email. Shape: `DataSourcesPayload` in lib/data-sources/native.ts.
 */
export async function GET(request: Request) {
  const auth = await requireAthlete(request);
  if (!auth.ok) return authError(auth);
  try {
    const payload = await loadDataSourcesStatus(createServerClient(), auth.user.athleteId);
    if (!payload) return NextResponse.json({ error: 'athlete not found' }, { status: 404 });
    return NextResponse.json(payload);
  } catch (error: any) {
    console.error('data-sources status failed:', error?.code ?? error?.message);
    return NextResponse.json({ error: 'failed to load' }, { status: 500 });
  }
}
