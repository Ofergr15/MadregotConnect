import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { sendPushToSubscriptions, resolveAudience, subscriptionsForAthletes, allAthleteIds } from '@/lib/push';
import { israelNow, getPlanWeekStart } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// External scheduler tick (Supabase pg_cron hits this every ~15 min). All timing
// logic lives here in Israel local time; the scheduler stays a dumb pinger.
// Secured with CRON_SECRET like the other crons.
//
// Reminder stages (config in app_settings.reminder_config, admin-editable):
//  - dayBefore (default Mon/Thu 08:00): push ALL athletes about tomorrow's team workout.
//  - eveningBefore (default Mon/Thu 18:00): push only RSVP NON-responders.
// Team days default Tue(2)/Fri(5); "day before" = teamDay-1. Idempotent per
// (kind, day, week) via a scheduled_notifications ledger row.
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
  const { weekday, hour } = israelNow(now);
  const weekStart = getPlanWeekStart(now);

  // Load config (fall back to defaults if missing).
  const { data: cfgRow } = await supabase.from('app_settings').select('value').eq('key', 'reminder_config').maybeSingle();
  let cfg: { teamDays: number[]; dayBefore: { enabled: boolean; hour: number }; eveningBefore: { enabled: boolean; hour: number } };
  try {
    cfg = JSON.parse(cfgRow?.value || '') || {};
  } catch { cfg = {} as any; }
  const teamDays = cfg.teamDays || [2, 5];
  const dayBefore = cfg.dayBefore || { enabled: true, hour: 8 };
  const eveningBefore = cfg.eveningBefore || { enabled: true, hour: 18 };

  const fired: string[] = [];

  // Has this stage already fired for this (day, week)? Ledger = scheduled_notifications.
  const already = async (tag: string): Promise<boolean> => {
    const { count } = await supabase
      .from('scheduled_notifications')
      .select('id', { count: 'exact', head: true })
      .eq('kind', 'training_before')
      .eq('status', 'sent')
      .eq('url', `#ledger:${tag}`); // stash the idempotency tag in url (unused for these)
    return (count || 0) > 0;
  };
  const markFired = async (tag: string, count: number) => {
    await supabase.from('scheduled_notifications').insert({
      kind: 'training_before',
      title_he: 'reminder', body_he: tag,
      audience_type: 'all', schedule_type: 'now',
      status: 'sent', last_sent_at: new Date().toISOString(), sent_count: count,
      url: `#ledger:${tag}`,
    });
  };

  // For each team day, check if "the day before" is today at the configured hour.
  for (const teamDay of teamDays) {
    const dayBeforeWeekday = (teamDay + 6) % 7; // day before the team day

    // Stage 1 — day before, at dayBefore.hour, to ALL.
    if (dayBefore.enabled && weekday === dayBeforeWeekday && hour === dayBefore.hour) {
      const tag = `dayBefore:${weekStart}:${teamDay}`;
      if (!(await already(tag))) {
        const subs = await resolveAudience('all', null);
        const sent = await sendPushToSubscriptions(subs, {
          title: 'תזכורת אימון 🏃',
          body: 'מחר יש אימון קבוצתי — נתראה!',
          url: '/dashboard',
          tag,
        });
        await markFired(tag, sent);
        fired.push(`${tag} → ${sent}`);
      }
    }

    // Stage 2 — evening before, at eveningBefore.hour, to RSVP NON-responders.
    if (eveningBefore.enabled && weekday === dayBeforeWeekday && hour === eveningBefore.hour) {
      const tag = `eveningBefore:${weekStart}:${teamDay}`;
      if (!(await already(tag))) {
        // Who already answered for that team day this week?
        const { data: answered } = await supabase
          .from('workout_attendance')
          .select('athlete_id')
          .eq('week_start_date', weekStart)
          .eq('day_of_week', teamDay);
        const answeredIds = new Set((answered || []).map((r: { athlete_id: string }) => r.athlete_id));
        const all = await allAthleteIds();
        const nonResponders = all.filter(id => !answeredIds.has(id));
        const subs = await subscriptionsForAthletes(nonResponders);
        const sent = await sendPushToSubscriptions(subs, {
          title: 'מגיעים מחר לאימון? 🏟️',
          body: 'עדכנו אותנו אם אתם מגיעים',
          url: '/dashboard',
          tag,
        });
        await markFired(tag, sent);
        fired.push(`${tag} → ${sent}`);
      }
    }
  }

  // Fold in admin scheduled/recurring notifications so they also get intraday
  // precision (delegate to the existing scanner route).
  let scanned: unknown = null;
  try {
    const { POST: scan } = await import('../notifications/route');
    scanned = await scan(new Request('http://internal/scan', {
      method: 'POST',
      headers: { authorization: `Bearer ${cronSecret || ''}` },
    })).then(r => r.json()).catch(() => null);
  } catch { /* scanner optional */ }

  return NextResponse.json({ ok: true, israel: { weekday, hour }, fired, scanned });
}

export async function GET(request: Request) { return run(request); }
export async function POST(request: Request) { return run(request); }
