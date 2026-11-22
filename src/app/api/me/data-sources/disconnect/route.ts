import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { authError, requireAthlete } from '@/lib/auth-session';
import { decrypt } from '@/lib/encryption';
import { israelToday } from '@/lib/utils';
import { getValidStravaToken } from '@/lib/strava/enrich';
import { disconnectPatch, type DisconnectProvider } from '@/lib/data-sources/native';
import { disconnectCounts, loadDataSourcesStatus, readSourceRow } from '@/lib/data-sources/server';

export const dynamic = 'force-dynamic';

/**
 * GET  /api/me/data-sources/disconnect → { runsKept, workoutsOnWatch } for the sheet.
 * POST /api/me/data-sources/disconnect { provider: 'garmin' | 'strava' }
 *
 * Self-only (JWT). The credential is UPDATEd to NULL and read back — a flag is
 * not a disconnect. Activities are kept. Strava is also told (`oauth/deauthorize`)
 * so the app stops appearing in the member's Strava settings; a failure there does
 * not block the local erase, which is the part we control.
 * Apple Health has nothing server-side: the device stops its observers.
 */
export async function GET(request: Request) {
  const auth = await requireAthlete(request);
  if (!auth.ok) return authError(auth);
  const counts = await disconnectCounts(createServerClient(), auth.user.athleteId, israelToday());
  return NextResponse.json(counts);
}

export async function POST(request: Request) {
  const auth = await requireAthlete(request);
  if (!auth.ok) return authError(auth);
  const body = await request.json().catch(() => ({}));
  const provider = body?.provider as DisconnectProvider;
  if (provider !== 'garmin' && provider !== 'strava') {
    return NextResponse.json({ error: 'provider must be garmin or strava' }, { status: 400 });
  }
  const athleteId = auth.user.athleteId;
  const db = createServerClient();
  const row = await readSourceRow(db, athleteId).catch(() => null);
  if (!row) return NextResponse.json({ error: 'athlete not found' }, { status: 404 });

  let stravaDeauthorized: boolean | null = null;
  if (provider === 'strava' && row.strava_auth) {
    try {
      const token = await getValidStravaToken(db as any, athleteId, decrypt(row.strava_auth) as any);
      if (token) {
        const res = await fetch('https://www.strava.com/oauth/deauthorize', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        });
        stravaDeauthorized = res.ok;
      } else {
        stravaDeauthorized = false;
      }
    } catch {
      stravaDeauthorized = false;
    }
  }

  const counts = await disconnectCounts(db, athleteId, israelToday());
  const { error } = await db.from('athletes').update(disconnectPatch(provider, row)).eq('id', athleteId);
  if (error) {
    console.error('data-sources disconnect failed:', error.code);
    return NextResponse.json({ error: 'failed to disconnect' }, { status: 500 });
  }
  const after = await readSourceRow(db, athleteId);
  const erased = provider === 'garmin' ? !after?.garmin_auth : !after?.strava_auth;
  if (!erased) return NextResponse.json({ error: 'credential still present' }, { status: 500 });

  return NextResponse.json({ ok: true, ...counts, stravaDeauthorized, status: await loadDataSourcesStatus(db, athleteId) });
}
