import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireStaff } from '@/lib/auth/self-or-staff';
import { isMissingColumn } from '@/lib/supabase/schema-drift';
import { fetchAllRows } from '@/lib/supabase/paginate';
import { localesForAthletes } from '@/lib/push';
import { DEFAULT_NOTIFICATION_LOCALE } from '@/lib/notifications/locale';
import { classifyGarminHealth, garminReconnectPrompt, type GarminHealthRow } from '@/lib/garmin/connection-health';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/garmin-health — staff-only. Which active members' Garmin credential
 * Garmin has refused (reconnect needed) or has gone quiet for 14+ days.
 *
 *   { ready, counts: {ok, stale, failed, unknown}, failed: [...], stale: [...] }
 *
 * Each `failed` entry carries `prompt`, the reconnect push/in-app payload in the
 * member's language — built, never sent. `garmin_auth` is read only as "is it
 * set?" and reduced to a boolean before anything else sees the row.
 * `ready: false` until migration 101's stamps exist.
 */
type Row = { id: string; name: string | null; garmin_auth: unknown; garmin_last_sync_at: string | null; garmin_auth_failed_at: string | null };

export async function GET(request: Request) {
  const denied = await requireStaff(request);
  if (denied) return denied;
  const db = createServerClient();

  let rows: Row[];
  try {
    rows = await fetchAllRows<Row>((from, to) =>
      db.from('athletes')
        .select('id, name, garmin_auth, garmin_last_sync_at, garmin_auth_failed_at')
        .eq('status', 'active')
        .not('garmin_auth', 'is', null)
        .order('id')
        .range(from, to));
  } catch (err) {
    if (isMissingColumn(err, 'garmin_')) return NextResponse.json({ ready: false }, { headers: { 'Cache-Control': 'private, no-store' } });
    console.error('[admin/garmin-health] read failed:', err);
    return NextResponse.json({ error: 'Failed to read connections' }, { status: 500 });
  }

  const input: GarminHealthRow[] = rows.map((r) => ({
    id: r.id,
    name: r.name,
    hasAuth: r.garmin_auth != null && r.garmin_auth !== '',
    garmin_last_sync_at: r.garmin_last_sync_at,
    garmin_auth_failed_at: r.garmin_auth_failed_at,
  }));
  const { counts, failed, stale } = classifyGarminHealth(input);
  const locales = failed.length ? await localesForAthletes(failed.map((f) => f.athleteId)) : new Map();

  return NextResponse.json(
    {
      ready: true,
      counts,
      failed: failed.map((f) => ({ ...f, prompt: garminReconnectPrompt(locales.get(f.athleteId) ?? DEFAULT_NOTIFICATION_LOCALE) })),
      stale,
    },
    { headers: { 'Cache-Control': 'private, no-store' } },
  );
}
