import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import { RECORD_KIND } from '@/lib/prs/new-record-alert';

export const dynamic = 'force-dynamic';

/**
 * GET /api/athletes/me/new-record — the newest record the caller broke this week, or
 * nothing. Behind the in-app sheet (NewRecordSheet) that says it once on the next
 * open, for the members without push and the ones who swiped the push away.
 *
 * Read off the notification row notifyNewRecords wrote, so the sheet can only ever
 * announce a record the push announced — one decision about what is news, not two.
 */
const WINDOW_DAYS = 7;

export async function GET(request: Request) {
  const { denied, caller } = await resolveVerifiedCaller(request);
  if (denied) return denied;
  if (!caller.athleteId) return NextResponse.json({ record: null });

  const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString();
  const { data, error } = await createServerClient()
    .from('scheduled_notifications')
    .select('url, title_he, body_he, last_sent_at')
    .eq('audience_id', caller.athleteId)
    .eq('kind', RECORD_KIND)
    .gte('last_sent_at', since)
    .order('last_sent_at', { ascending: false })
    .limit(1);
  const row = !error && data?.[0];
  const m = row ? /\/records\/([a-z0-9]+)\?new=([0-9a-f-]+)/i.exec(row.url ?? '') : null;
  if (!row || !m) return NextResponse.json({ record: null });
  return NextResponse.json({ record: { bucket: m[1], activityId: m[2], url: row.url, sentAt: row.last_sent_at } });
}
