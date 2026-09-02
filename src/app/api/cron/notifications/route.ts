import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { sendPushLocalized, resolveAudience } from '@/lib/push';
import { pickBilingual } from '@/lib/notifications/copy';

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
      // Recurring notifications reuse the same `notif-${n.id}` tag on every
      // fire (one-time ones only ever send once), so each new occurrence
      // REPLACES the prior one on the lock screen — set renotify so that
      // replacement still alerts the athlete instead of silently swapping it.
      // Each recipient gets the column they can read, falling back to
      // whichever one the admin actually filled in.
      const { sent } = await sendPushLocalized(subs, (locale) => ({
        title: pickBilingual(locale, { he: n.title_he, en: n.title_en }) || 'Madregot',
        body: pickBilingual(locale, { he: n.body_he, en: n.body_en }),
        url: n.url,
        tag: `notif-${n.id}`,
        renotify: n.schedule_type === 'recurring',
        // Same category as the "send now" path (api/notifications/route.ts)
        // — scheduled/recurring broadcasts are the same feature, just on a
        // timer, and shouldn't be forced-on while their immediate sibling
        // is mutable.
        category: 'news',
        ...(n.image_url ? { icon: n.image_url, image: n.image_url } : {}),
      }));

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
