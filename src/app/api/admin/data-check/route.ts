import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireStaff } from '@/lib/auth/self-or-staff';
import { isMissingColumn } from '@/lib/supabase/schema-drift';
import { activityLocalDateStr, addDaysToDateStr, israelToday } from '@/lib/utils';
import { buildDataCheck, type ProviderState } from '@/lib/admin/data-check';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/data-check?athleteId= — staff-only (b23 "data check").
 *
 * `{ days14: [{date, state}], checks: [...], headline, lastActivityDate }` from
 * athlete_activities and the Garmin/Strava connection state. Staff-only because it
 * reads one named member's connection health and activity days.
 *
 * The credentials (`garmin_auth`, `strava_auth`) are read ONLY to answer "connected?"
 * and are reduced to a boolean here, before anything else touches the row. The response
 * is built from buildDataCheck's output alone — the row never reaches it.
 */
const BASE = 'id, garmin_auth, strava_auth, strava_athlete_id';
const HEALTH = 'garmin_last_sync_at, garmin_auth_failed_at, strava_last_sync_at, strava_auth_failed_at';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: Request) {
  const denied = await requireStaff(request);
  if (denied) return denied;
  const athleteId = new URL(request.url).searchParams.get('athleteId') || '';
  if (!UUID.test(athleteId)) return NextResponse.json({ error: 'athleteId is required' }, { status: 400 });

  try {
    const db = createServerClient();
    const today = israelToday();
    const from = addDaysToDateStr(today, -13);

    let res = await db.from('athletes').select(`${BASE}, ${HEALTH}`).eq('id', athleteId).maybeSingle();
    // Migration 101 not pasted: connection state without the health stamps.
    if (res.error && isMissingColumn(res.error, 'garmin_last_sync_at')) {
      res = await db.from('athletes').select(BASE).eq('id', athleteId).maybeSingle() as typeof res;
    }
    if (res.error) {
      console.error('[admin/data-check] athlete read failed:', res.error);
      return NextResponse.json({ error: 'Failed to read athlete' }, { status: 500 });
    }
    if (!res.data) return NextResponse.json({ error: 'Athlete not found' }, { status: 404 });
    const row = res.data as Record<string, unknown>;
    const ts = (k: string) => (typeof row[k] === 'string' ? (row[k] as string) : null);
    const garmin: ProviderState = { connected: !!row.garmin_auth, lastSyncAt: ts('garmin_last_sync_at'), authFailedAt: ts('garmin_auth_failed_at') };
    const strava: ProviderState = {
      connected: !!row.strava_auth || row.strava_athlete_id != null,
      lastSyncAt: ts('strava_last_sync_at'),
      authFailedAt: ts('strava_auth_failed_at'),
    };

    // A run late on day 14's eve can be stored one UTC day either side; widen and let
    // the local date decide (start_time is wall clock — CLAUDE.md).
    const acts = await db.from('athlete_activities')
      .select('start_time')
      .eq('athlete_id', athleteId)
      .gte('start_time', `${addDaysToDateStr(from, -1)}T00:00:00Z`)
      .lt('start_time', `${addDaysToDateStr(today, 2)}T00:00:00Z`)
      .limit(1000);
    if (acts.error) {
      console.error('[admin/data-check] activities read failed:', acts.error);
      return NextResponse.json({ error: 'Failed to read activities' }, { status: 500 });
    }
    const activityDates = ((acts.data || []) as Array<{ start_time: string }>)
      .map((a) => activityLocalDateStr(a.start_time))
      .filter((d) => d >= from && d <= today);

    const result = buildDataCheck({ today, activityDates, garmin, strava });
    return NextResponse.json({
      athleteId,
      ...result,
      connections: {
        garmin: { connected: garmin.connected, lastSyncAt: garmin.lastSyncAt, authFailedAt: garmin.authFailedAt },
        strava: { connected: strava.connected, lastSyncAt: strava.lastSyncAt, authFailedAt: strava.authFailedAt },
      },
    });
  } catch (err) {
    console.error('[admin/data-check] failed:', err);
    return NextResponse.json({ error: 'Failed to build the data check' }, { status: 500 });
  }
}
