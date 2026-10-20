import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { sendPushLocalized, resolveAudience } from '@/lib/push';
import { pickBilingual } from '@/lib/notifications/copy';
import { publishAnnouncement } from '@/lib/feed/announce';
import { ACADEMY_REMINDER_KINDS } from '@/lib/academy/testReminders';
import { cronPaused } from '@/lib/cron-pause';
import { nextRecurrence } from '@/lib/notifications/scheduling';
import { REMINDER_KIND } from '@/lib/survey-reminders';
import { notifySurveyNonResponders } from '@/lib/surveys';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Notification Center scanner. Vercel Cron runs it every minute (vercel.json), and it is
 * the only thing that does — the 5-minute tick used to call it too, and at 06:00 UTC the
 * two ran at once over the same rows. Finds notifications whose next_run_at has passed,
 * CLAIMS each one (moves it on, `WHERE` it still has the next_run_at it was read with), and
 * sends only what it claimed: two overlapping runs can no longer both send the same row.
 * A recurring row moves to its next run in Israel's wall clock, past any it missed.
 * "Send now" delivers from the API route and never waits for this.
 */
async function run(request: Request) {
  if (await cronPaused()) return NextResponse.json({ paused: true });
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = request.headers.get('authorization');
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  const supabase = createServerClient();
  const nowIso = new Date().toISOString();

  // Academy test reminders are deliberately NOT ours. They live in this table (migration 112
  // chose that over a second reminder engine), but this scanner sends every due row it finds,
  // unconditionally — which is right for a broadcast and wrong for the follow-up reminder, whose
  // whole content is "we have no result for your test". That one has to be checked against the
  // invitation first, because sending it to somebody who ran the test is the message this
  // product cannot take back. So `dispatchDueTestReminders` owns those two kinds (it runs from
  // five-minute tick) and they are skipped here: two scanners
  // over the same rows would race to send the same push twice.
  const { data: due, error } = await supabase
    .from('scheduled_notifications')
    .select('*')
    .eq('status', 'scheduled')
    .not('kind', 'in', `(${ACADEMY_REMINDER_KINDS.join(',')})`)
    .lte('next_run_at', nowIso);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const results: Array<{ id: string; sent: number }> = [];

  for (const n of due || []) {
    try {
      // Claim first. The update only matches while the row still has the next_run_at we
      // read, so whichever run gets here second matches nothing and sends nothing.
      const recurring = n.schedule_type === 'recurring' && n.recur_interval && n.recur_unit;
      // A poll's reminder ends 'silent', not 'sent': it went only to whoever had not answered,
      // so it must not land in everybody's inbox (which lists 'sent' rows by audience).
      const reminder = n.kind === REMINDER_KIND;
      const claim = recurring
        ? { next_run_at: nextRecurrence(n.next_run_at, n.recur_interval, n.recur_unit, Date.now()), last_sent_at: nowIso, updated_at: nowIso }
        : { status: reminder ? 'silent' : 'sent', last_sent_at: nowIso, updated_at: nowIso };
      const { data: won } = await supabase
        .from('scheduled_notifications')
        .update(claim)
        .eq('id', n.id)
        .eq('status', 'scheduled')
        .eq('next_run_at', n.next_run_at)
        .select('id');
      if (!won || won.length === 0) continue;

      // A poll's reminder (lib/survey-reminders): only to the people who still haven't
      // answered, and nothing once the poll has closed.
      if (reminder) {
        const sent = n.survey_id ? await surveyReminder(supabase, n) : 0;
        await supabase.from('scheduled_notifications').update({ sent_count: sent }).eq('id', n.id);
        results.push({ id: n.id, sent });
        continue;
      }

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
      await supabase
        .from('scheduled_notifications')
        .update({ sent_count: (n.sent_count || 0) + sent })
        .eq('id', n.id);
      // Same feed trace the send-now path leaves. Recurring reminders are
      // filtered out inside publishAnnouncement, not here, so the two callers
      // cannot disagree about what counts as an announcement.
      await publishAnnouncement(supabase, n, nowIso);
      results.push({ id: n.id, sent });
    } catch (e: unknown) {
      // Don't let one bad notification block the rest. A claimed row that failed to
      // send is not retried: a missed push is better than the same one twice.
      console.error('[cron/notifications] failed for', n.id, (e as Error).message);
    }
  }

  return NextResponse.json({ ok: true, processed: results.length, results });
}

async function surveyReminder(supabase: ReturnType<typeof createServerClient>, n: { survey_id: string; audience_type: string; audience_id: string | null; title_he: string; body_he: string; id: string }): Promise<number> {
  const { data: survey } = await supabase.from('surveys').select('closes_at').eq('id', n.survey_id).maybeSingle();
  const closes = (survey as { closes_at?: string | null } | null)?.closes_at;
  if (!survey || (closes && Date.parse(closes) <= Date.now())) return 0;
  return notifySurveyNonResponders({
    surveyId: n.survey_id,
    audienceType: n.audience_type,
    audienceId: n.audience_id,
    copy: () => ({ title: n.title_he, body: n.body_he }),
    tag: `survey-reminder-${n.id}`,
  });
}

export async function GET(request: Request) {
  return run(request);
}
export async function POST(request: Request) {
  return run(request);
}
