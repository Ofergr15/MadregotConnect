import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { subscriptionsForAthletes, sendPushToSubscriptions } from '@/lib/push';
import { israelNow, getPlanWeekStart } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Early-morning workout detection. On team-workout days, from ~06:30 Israel
// through the morning, pull fresh Garmin activities (the daily sync runs at
// ~06:00 IL — too early for morning workouts) and, the moment a NEW activity
// lands, push the athlete a teaser: "new workout detected — analyzing, more
// info soon." Fires AT MOST ONCE per activity via the scheduled_notifications
// ledger. Safe to ping every ~5-15 min (idempotent + window-gated).
//
// Secured with CRON_SECRET like the other crons.
const RUN_TYPES = ['running', 'trail_running', 'treadmill_running', 'track_running', 'virtual_run', 'street_running', 'indoor_running'];

// Hebrew label per run sub-type, so the "new workout detected" teaser can name
// the actual activity instead of a generic "workout". Anything outside this map
// (shouldn't happen — RUN_TYPES already filters upstream) falls back to 'ריצה'.
const RUN_TYPE_LABELS: Record<string, string> = {
  running: 'ריצה',
  trail_running: 'ריצת שטח',
  treadmill_running: 'ריצת הליכון',
  track_running: 'ריצת מסלול',
  virtual_run: 'ריצה וירטואלית',
  street_running: 'ריצת רחוב',
  indoor_running: 'ריצה באולם',
};

// Morning window (Israel): start at 06:30, keep watching until 12:00 so late
// risers / long runs are still caught. Outside it, do nothing.
const START_HOUR = 6;
const START_MIN = 30;
const END_HOUR = 12;

async function run(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = request.headers.get('authorization');
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  const supabase = createServerClient();
  const now = new Date();
  const { weekday, hour, minute } = israelNow(now);

  // Non-production dry-run hook: ?dry=1 opens the gates and sends to NO devices,
  // so the detection + ledger path can be verified without pushing real athletes.
  const url = new URL(request.url);
  const dryRun = url.searchParams.get('dry') === '1' && process.env.NODE_ENV !== 'production';

  // Gate 1: team-workout day? (reminder_config.teamDays, 0=Sun..6=Sat)
  const { data: cfgRow } = await supabase.from('app_settings').select('value').eq('key', 'reminder_config').maybeSingle();
  let teamDays: number[] = [2, 5];
  try { const cfg = JSON.parse(cfgRow?.value || ''); if (Array.isArray(cfg?.teamDays)) teamDays = cfg.teamDays; } catch { /* default */ }
  if (!dryRun && !teamDays.includes(weekday)) {
    return NextResponse.json({ ok: true, skipped: 'not a team day', israel: { weekday, hour, minute } });
  }

  // Gate 2: inside the morning window?
  const beforeStart = hour < START_HOUR || (hour === START_HOUR && minute < START_MIN);
  if (!dryRun && (beforeStart || hour >= END_HOUR)) {
    return NextResponse.json({ ok: true, skipped: 'outside morning window', israel: { weekday, hour, minute } });
  }

  // 1) Pull fresh Garmin activities now (suppress the sync's own feedback nudge —
  //    we send the morning teaser instead). Reuse the existing sync handler.
  //    Skipped in dry-run so a test never triggers a live Garmin fetch.
  let synced: unknown = null;
  if (!dryRun) {
    try {
      const { POST: syncPost } = await import('../../garmin/sync-activities/route');
      synced = await syncPost(new Request('http://internal/sync', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ suppressPush: true }),
      })).then(r => r.json()).catch(() => null);
    } catch { /* sync best-effort — we still scan the DB below */ }
  }

  // 2) Ledger helpers — at-most-once per activity, namespaced by kind+tag.
  const already = async (tag: string): Promise<boolean> => {
    const { count } = await supabase
      .from('scheduled_notifications')
      .select('id', { count: 'exact', head: true })
      .eq('kind', 'workout_detected')
      .eq('url', `#ledger:${tag}`);
    return (count || 0) > 0;
  };
  const markFired = async (tag: string, count: number) => {
    await supabase.from('scheduled_notifications').insert({
      kind: 'workout_detected',
      title_he: 'workout detected', body_he: tag,
      audience_type: 'athlete', schedule_type: 'now',
      status: 'sent', last_sent_at: new Date().toISOString(), sent_count: count,
      url: `#ledger:${tag}`,
    });
  };

  // 3) Find TODAY's run activities (Israel local date) that haven't been teased.
  //    start_time is a TIMESTAMPTZ storing Garmin's local wall-clock; scope to a
  //    generous UTC window around today, then confirm the local date.
  const weekStart = getPlanWeekStart(now); // for context only
  const todayStr = new Date(now.getTime()).toISOString().split('T')[0];
  const lowerUTC = new Date(now.getTime() - 18 * 3600_000).toISOString(); // ~today morning back-margin
  const { data: acts } = await supabase
    .from('athlete_activities')
    .select('garmin_activity_id, athlete_id, activity_type, start_time, activity_name')
    .gte('start_time', lowerUTC)
    .order('start_time', { ascending: false });

  const fired: string[] = [];
  for (const a of (acts || []) as Array<{ garmin_activity_id: number; athlete_id: string; activity_type: string | null; start_time: string; activity_name: string | null }>) {
    if (a.activity_type && !RUN_TYPES.includes(a.activity_type)) continue;
    // Only today's activities (Israel local date via the stored wall-clock).
    if ((a.start_time || '').split('T')[0] !== todayStr) continue;
    const tag = `newActivity:${a.garmin_activity_id}`;
    if (await already(tag)) continue;

    const subs = dryRun ? [] : await subscriptionsForAthletes([a.athlete_id]);
    let sent = 0;
    if (subs.length > 0) {
      // Concrete detail already in scope: the detected sub-type + local start
      // time (start_time stores Garmin's own wall-clock, same read as todayStr
      // above — no timezone math needed).
      const label = (a.activity_type && RUN_TYPE_LABELS[a.activity_type]) || 'ריצה';
      const timeStr = (a.start_time || '').split('T')[1]?.slice(0, 5) || '';
      sent = await sendPushToSubscriptions(subs, {
        title: `🏃 זוהה אימון: ${label}`,
        body: timeStr
          ? `מנתחים את הנתונים מ-${timeStr} — נשתף עוד מידע בקרוב`
          : 'מנתחים את הנתונים — נשתף עוד מידע בקרוב',
        url: `/dashboard/feedback?activity=${a.garmin_activity_id}`,
        tag: `workout-detected-${a.garmin_activity_id}`,
        category: 'workouts',
      });
    }
    // Mark fired even when there were no subscriptions, so we never re-scan it.
    // In dry-run, don't write the ledger (keep the test repeatable / non-mutating).
    if (!dryRun) await markFired(tag, sent);
    fired.push(`${a.garmin_activity_id} → ${sent}${dryRun ? ' (dry)' : ''}`);
  }

  return NextResponse.json({ ok: true, israel: { weekday, hour, minute }, weekStart, synced, fired });
}

export async function GET(request: Request) { return run(request); }
export async function POST(request: Request) { return run(request); }
