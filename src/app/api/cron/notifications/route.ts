import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { sendPushToSubscriptions, resolveAudience } from '@/lib/push';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Advance a recurring next_run_at by its interval. Returns a new ISO timestamp.
function advance(current: string, interval: number, unit: string): string {
  const d = new Date(current);
  const days = unit === 'week' ? interval * 7 : interval;
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}

/**
 * Notification Center scanner. Runs on a Vercel Cron (daily 06:00 UTC — the
 * Hobby plan only allows once-daily crons): finds notifications whose
 * next_run_at has passed, sends them to their audience, then advances recurring
 * ones / marks one-time ones sent. Secured with CRON_SECRET like the other crons.
 * NOTE: "send now" delivers immediately from the API route, not via this cron;
 * only scheduled / recurring sends wait for the daily tick.
 */
async function run(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = request.headers.get('authorization');
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  const supabase = createServerClient();
  const nowIso = new Date().toISOString();

  const { data: due, error } = await supabase
    .from('scheduled_notifications')
    .select('*')
    .eq('status', 'scheduled')
    .lte('next_run_at', nowIso);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const results: Array<{ id: string; sent: number }> = [];

  for (const n of due || []) {
    try {
      const subs = await resolveAudience(n.audience_type, n.audience_id);
      // Prefer Hebrew (app default); fall back to English if only that was filled.
      const title = n.title_he || n.title_en || 'Madregot';
      const body = n.body_he || n.body_en || '';
      const sent = await sendPushToSubscriptions(subs, { title, body, url: n.url, tag: `notif-${n.id}` });

      if (n.schedule_type === 'recurring' && n.recur_interval && n.recur_unit) {
        await supabase
          .from('scheduled_notifications')
          .update({
            next_run_at: advance(n.next_run_at, n.recur_interval, n.recur_unit),
            last_sent_at: nowIso,
            sent_count: (n.sent_count || 0) + sent,
            updated_at: nowIso,
          })
          .eq('id', n.id);
      } else {
        await supabase
          .from('scheduled_notifications')
          .update({
            status: 'sent',
            last_sent_at: nowIso,
            sent_count: (n.sent_count || 0) + sent,
            updated_at: nowIso,
          })
          .eq('id', n.id);
      }
      results.push({ id: n.id, sent });
    } catch (e: unknown) {
      // Don't let one bad notification block the rest.
      console.error('[cron/notifications] failed for', n.id, (e as Error).message);
    }
  }

  return NextResponse.json({ ok: true, processed: results.length, results });
}

export async function GET(request: Request) {
  return run(request);
}
export async function POST(request: Request) {
  return run(request);
}
