import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { evaluateHealth } from '@/lib/health/evaluate';

/**
 * Public health probe for an uptime checker (docs/uptime-check.md). Unlike /api/ping, this one
 * DOES touch the database: it answers "is the app working", not "is the server reachable".
 *
 * Reads three timestamps (latest cron tick, latest Garmin and Strava sync stamp) and returns only
 * their ages — no ids, no error text. 200 when ok or degraded (the site works, a job is late),
 * 503 when the database is unreachable, so a plain HTTP-status monitor alerts on the real outage
 * and a keyword monitor on `"status":"degraded"` can catch the late jobs.
 */
export const dynamic = 'force-dynamic';

type Row<K extends string> = Record<K, string | null>;

async function latest<K extends string>(
  query: PromiseLike<{ data: Row<K>[] | null; error: unknown }>,
  key: K,
): Promise<{ ok: boolean; at: string | null }> {
  const { data, error } = await query;
  if (error) return { ok: false, at: null };
  return { ok: true, at: data?.[0]?.[key] ?? null };
}

export async function GET() {
  let dbReachable = false;
  let tick: string | null = null;
  let garmin: string | null = null;
  let strava: string | null = null;
  try {
    const supabase = createServerClient();
    const [t, g, s] = await Promise.all([
      latest(supabase.from('cron_tick_locks').select('tick_at').order('tick_at', { ascending: false }).limit(1), 'tick_at'),
      latest(
        supabase.from('athletes').select('garmin_last_sync_at').not('garmin_last_sync_at', 'is', null)
          .order('garmin_last_sync_at', { ascending: false }).limit(1),
        'garmin_last_sync_at',
      ),
      latest(
        supabase.from('athletes').select('strava_last_sync_at').not('strava_last_sync_at', 'is', null)
          .order('strava_last_sync_at', { ascending: false }).limit(1),
        'strava_last_sync_at',
      ),
    ]);
    dbReachable = t.ok || g.ok || s.ok;
    tick = t.at;
    garmin = g.at;
    strava = s.at;
  } catch {
    dbReachable = false;
  }
  const report = evaluateHealth({ now: new Date(), dbReachable, lastTickAt: tick, lastGarminSyncAt: garmin, lastStravaSyncAt: strava });
  return NextResponse.json(report, {
    status: report.status === 'down' ? 503 : 200,
    headers: { 'Cache-Control': 'no-store' },
  });
}
