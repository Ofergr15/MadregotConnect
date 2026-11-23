import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { authError, requireAthlete } from '@/lib/auth-session';
import { mainSourcePatch } from '@/lib/data-sources/native';
import { loadDataSourcesStatus, readSourceRow } from '@/lib/data-sources/server';

export const dynamic = 'force-dynamic';

/**
 * PUT /api/me/data-source { source: 'garmin' | 'strava' } → DataSourcesPayload
 *
 * SELF-ONLY: the athlete is the JWT's; any id in the body is ignored. The staff
 * switch for any athlete stays PATCH /api/admin/athlete-source. 400 for an
 * unknown source, 409 when that provider isn't connected for the caller.
 */
export async function PUT(request: Request) {
  const auth = await requireAthlete(request);
  if (!auth.ok) return authError(auth);
  const body = await request.json().catch(() => ({}));
  const athleteId = auth.user.athleteId;
  try {
    const db = createServerClient();
    const row = await readSourceRow(db, athleteId);
    if (!row) return NextResponse.json({ error: 'athlete not found' }, { status: 404 });
    const r = mainSourcePatch(row, body?.source);
    if ('error' in r) {
      return r.error === 'unknown'
        ? NextResponse.json({ error: 'source must be garmin or strava' }, { status: 400 })
        : NextResponse.json({ error: 'source not connected' }, { status: 409 });
    }
    const { error } = await db.from('athletes').update(r.patch).eq('id', athleteId);
    if (error) throw error;
    const payload = await loadDataSourcesStatus(db, athleteId);
    return NextResponse.json(payload);
  } catch (error: any) {
    console.error('data-source switch failed:', error?.code ?? error?.message);
    return NextResponse.json({ error: 'failed to update' }, { status: 500 });
  }
}
