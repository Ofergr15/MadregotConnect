import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { authError, requireAthlete } from '@/lib/auth-session';
import { runSyncRequest } from '@/app/api/garmin/sync-activities/route';
import { runStravaSyncRequest } from '@/app/api/strava/sync-activities/route';
import { syncNowRetryAfter } from '@/lib/data-sources/native';
import { loadDataSourcesStatus, readSourceRow } from '@/lib/data-sources/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** Per-instance; the DB stamps below cover a cold instance. */
const lastManual = new Map<string, number>();

/**
 * POST /api/me/data-sources/sync — "סנכרון עכשיו". Self-only (JWT), one a minute.
 * Runs the caller's own Garmin and/or Strava sync in-process (the same functions
 * the per-athlete routes and crons use) and answers with the fresh status plus
 * `syncError` per provider when one failed for a reason other than auth — that is
 * what the screen shows as "Garmin לא זמין כרגע".
 */
export async function POST(request: Request) {
  const auth = await requireAthlete(request);
  if (!auth.ok) return authError(auth);
  const athleteId = auth.user.athleteId;
  const db = createServerClient();
  const row = await readSourceRow(db, athleteId).catch(() => null);
  if (!row) return NextResponse.json({ error: 'athlete not found' }, { status: 404 });

  const now = Date.now();
  const retryAfter = syncNowRetryAfter(lastManual.get(athleteId), [row.garmin_last_sync_at, row.strava_last_sync_at], now);
  if (retryAfter > 0) {
    return NextResponse.json({ error: 'rate_limited', retryAfter }, { status: 429, headers: { 'Retry-After': String(retryAfter) } });
  }
  lastManual.set(athleteId, now);

  const internal = (body: object) =>
    new Request('http://internal/sync', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
  const run = async (fn: (r: Request) => Promise<Response>): Promise<{ synced: number; error: string | null }> => {
    try {
      const res = await fn(internal({ athleteId }));
      const json: any = await res.json().catch(() => ({}));
      const mine = Array.isArray(json?.results) ? json.results.find((r: any) => r?.athleteId === athleteId) : null;
      const err = !res.ok ? `http_${res.status}` : mine?.error ? 'provider_error' : null;
      return { synced: Number(mine?.synced ?? json?.synced ?? 0) || 0, error: err };
    } catch {
      return { synced: 0, error: 'provider_error' };
    }
  };

  const [garmin, strava] = await Promise.all([
    row.garmin_auth ? run(runSyncRequest) : Promise.resolve(null),
    row.strava_auth ? run(runStravaSyncRequest) : Promise.resolve(null),
  ]);
  return NextResponse.json({
    ok: true,
    garmin,
    strava,
    status: await loadDataSourcesStatus(db, athleteId),
  });
}
