import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { sendPushToSubscriptions, resolveAudience, subscriptionsForAthletes, allAthleteIds } from '@/lib/push';
import { createAndSendSurvey, notifySurveyNonResponders } from '@/lib/surveys';
import { israelNow, getPlanWeekStart, getActivityWeekStart } from '@/lib/utils';
import { APPROVER_EMAILS } from '@/lib/constants';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// 0=Sun..6=Sat, matching israelNow()/getDay(). Used to make reminder copy name
// the actual day instead of a generic "tomorrow" (same convention as
// practice-attendance/page.tsx and NotificationCenter.tsx).
const DAY_NAMES = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

/** Format seconds-per-km as m:ss (e.g. 312 -> "5:12"), for the weekly recap. */
function formatPace(secPerKm: number): string {
  let m = Math.floor(secPerKm / 60);
  let s = Math.round(secPerKm % 60);
  if (s === 60) { m += 1; s = 0; }
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// External scheduler tick (Vercel Cron hits this every 5 min — see vercel.json;
// that interval is also the delivery-precision ceiling for scheduled/recurring
// notifications, since it's the only thing scanning for due ones). All timing
// logic lives here in Israel local time; the scheduler stays a dumb pinger.
// Secured with CRON_SECRET like the other crons.
//
// Reminder stages (config in app_settings.reminder_config, admin-editable):
//  - dayBefore (default Mon/Thu 08:00): push ALL athletes about tomorrow's team workout.
//  - eveningBefore (default Mon/Thu 18:00): push only RSVP NON-responders.
//  - paceSurvey / paceSurveyNudge (same two hours): a real pace-group Survey,
//    per-day content from recurring_survey_templates (migration 073,
//    admin-editable) — only for team days that have an active row.
// Team days default Tue(2)/Fri(5); "day before" = teamDay-1. Idempotent per
// (kind, day, week) via a scheduled_notifications ledger row.
// Also: Saturday 20:00 plan-rollover push, and Sunday 19:00 personalized weekly
// recap push (per-runner km + runs for the week that just ended).
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

  // Atomic overlap guard (migration 074) — Vercel Cron doesn't guarantee
  // mutual exclusion between invocations, so if one tick runs long (more
  // likely as the athlete count grows), the next one could start before it
  // finishes and double-fire every stage below. A single INSERT with a
  // UNIQUE constraint is race-safe even if two invocations start in the same
  // instant, unlike a separate read-then-write check. Rounds to the 5-minute
  // grid Vercel actually schedules on (vercel.json: */5 * * * *).
  const tickAt = new Date(Math.floor(now.getTime() / 300_000) * 300_000).toISOString();
  const { error: lockError } = await supabase.from('cron_tick_locks').insert({ tick_at: tickAt });
  if (lockError && lockError.code === '23505') {
    return NextResponse.json({ ok: true, skipped: 'duplicate tick', tickAt });
  }
  // Any other lock error (e.g. table not migrated yet) — don't block the
  // tick over a missing safety net, just proceed without it.
  // Best-effort cleanup of old lock rows — never blocks the actual tick.
  supabase.from('cron_tick_locks').delete().lt('tick_at', new Date(now.getTime() - 2 * 86_400_000).toISOString()).then(() => {}, () => {});

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
        const dayName = DAY_NAMES[teamDay];
        const subs = await resolveAudience('all', null);
        const sent = await sendPushToSubscriptions(subs, {
          title: `תזכורת אימון ליום ${dayName} 🏃`,
          body: `מחר, יום ${dayName}, אימון קבוצתי — נתראה!`,
          url: '/dashboard',
          tag,
          category: 'workouts',
        });
        await markFired(tag, sent);
        fired.push(`${tag} → ${sent}`);
      }
    }

    // Stage 2 — evening before, at eveningBefore.hour, to RSVP NON-responders.
    if (eveningBefore.enabled && weekday === dayBeforeWeekday && hour === eveningBefore.hour) {
      const tag = `eveningBefore:${weekStart}:${teamDay}`;
      if (!(await already(tag))) {
        // Who already answered for that team day this week? (also grab `attending`
        // so the nudge can tell non-responders how many teammates already confirmed —
        // same query, one extra already-tracked column, no new plumbing.)
        const { data: answered } = await supabase
          .from('workout_attendance')
          .select('athlete_id, attending')
          .eq('week_start_date', weekStart)
          .eq('day_of_week', teamDay);
        const answeredRows = answered || [];
        const answeredIds = new Set(answeredRows.map((r: { athlete_id: string }) => r.athlete_id));
        const goingCount = answeredRows.filter((r: { attending: boolean }) => r.attending).length;
        const all = await allAthleteIds();
        const nonResponders = all.filter(id => !answeredIds.has(id));
        const subs = await subscriptionsForAthletes(nonResponders);
        const dayName = DAY_NAMES[teamDay];
        const rsvpPhrase = goingCount === 1 ? 'חבר אחד כבר אישר הגעה' : `${goingCount} חברים כבר אישרו הגעה`;
        const body = goingCount > 0
          ? `${rsvpPhrase} לאימון יום ${dayName} — ומה איתך?`
          : `עדכנו אותנו אם אתם מגיעים לאימון יום ${dayName}`;
        const sent = await sendPushToSubscriptions(subs, {
          title: 'מגיעים מחר לאימון? 🏟️',
          body,
          url: '/dashboard',
          tag,
          category: 'workouts',
        });
        await markFired(tag, sent);
        fired.push(`${tag} → ${sent}`);
      }
    }

    // Recurring pace-group poll template for this team day — a real editable
    // row (recurring_survey_templates, migration 073), not hardcoded, so
    // Tuesday and Friday can each be changed independently from the admin UI
    // without a code deploy. Absent/inactive row = no poll for that day.
    const { data: surveyTplRow } = await supabase
      .from('recurring_survey_templates')
      .select('question_he, question_en, options_he, options_en')
      .eq('day_of_week', teamDay)
      .eq('active', true)
      .maybeSingle();
    const surveyTpl = surveyTplRow
      ? { questionHe: surveyTplRow.question_he, questionEn: surveyTplRow.question_en, optionsHe: surveyTplRow.options_he, optionsEn: surveyTplRow.options_en }
      : null;

    // Stage 3 — pace-group poll, day before, at dayBefore.hour, to ALL. A
    // genuinely fresh Survey each week (never the plain reminder text) so
    // last week's answers can't carry over. The real survey id gets stashed
    // in this ledger row's body_he (reusing the same #ledger:<tag> shape as
    // markFired, just with real payload instead of the tag itself) so Stage
    // 4 can find it later today.
    if (surveyTpl && dayBefore.enabled && weekday === dayBeforeWeekday && hour === dayBefore.hour) {
      const tag = `paceSurvey:${weekStart}:${teamDay}`;
      if (!(await already(tag))) {
        const { survey, sent } = await createAndSendSurvey({
          questionHe: surveyTpl.questionHe,
          questionEn: surveyTpl.questionEn,
          optionsHe: surveyTpl.optionsHe,
          optionsEn: surveyTpl.optionsEn,
          audienceType: 'all',
          createdBy: 'cron',
        });
        await supabase.from('scheduled_notifications').insert({
          kind: 'training_before', title_he: 'reminder', body_he: survey.id,
          audience_type: 'all', schedule_type: 'now',
          status: 'sent', last_sent_at: new Date().toISOString(), sent_count: sent,
          url: `#ledger:${tag}`,
        });
        fired.push(`${tag} → survey ${survey.id}, sent ${sent}`);
      }
    }

    // Stage 4 — evening before, at eveningBefore.hour, nudge whoever hasn't
    // answered the pace-group poll created in Stage 3 yet.
    if (surveyTpl && eveningBefore.enabled && weekday === dayBeforeWeekday && hour === eveningBefore.hour) {
      const tag = `paceSurveyNudge:${weekStart}:${teamDay}`;
      if (!(await already(tag))) {
        const morningTag = `paceSurvey:${weekStart}:${teamDay}`;
        const { data: ledgerRow } = await supabase
          .from('scheduled_notifications')
          .select('body_he')
          .eq('url', `#ledger:${morningTag}`)
          .maybeSingle();
        const surveyId = ledgerRow?.body_he;
        if (surveyId) {
          const dayName = DAY_NAMES[teamDay];
          const sent = await notifySurveyNonResponders({
            surveyId,
            audienceType: 'all',
            title: 'עוד לא ענית על הדבוקות? 🏃',
            body: `בחרו דבוקה לאימון יום ${dayName} לפני שהזמן נגמר`,
            tag,
          });
          await markFired(tag, sent);
          fired.push(`${tag} → ${sent}`);
        } else {
          // Morning poll never fired (e.g. dayBefore disabled that week) —
          // mark done anyway so this doesn't keep re-checking every 5 min.
          await markFired(tag, 0);
        }
      }
    }
  }

  // Saturday 20:00 IL weekly rollover: archive past program weeks + push coaches
  // to upload the upcoming week's plans, showing which are missing.
  if (weekday === 6 && hour === 20) {
    // Upcoming week = the Sunday right after this Saturday.
    const upcomingSunday = new Date(now);
    upcomingSunday.setDate(upcomingSunday.getDate() + 1);
    const upcomingWeek = getPlanWeekStart(upcomingSunday); // Sunday YYYY-MM-DD
    const tag = `rollover:${upcomingWeek}`;
    if (!(await already(tag))) {
      // Archive everything before the upcoming week (reversible flag; nothing deleted).
      await supabase.from('program_weeks').update({ archived: true }).lt('week_start_date', upcomingWeek);

      // Which plans exist for the upcoming week?
      const { data: pw } = await supabase
        .from('program_weeks')
        .select('training_pdf_url, nutrition_pdf_url')
        .eq('week_start_date', upcomingWeek)
        .maybeSingle();
      const hasTraining = !!pw?.training_pdf_url;
      const hasNutrition = !!pw?.nutrition_pdf_url;

      if (!hasTraining || !hasNutrition) {
        // Build a "what's missing" body: training ✅/❌ · nutrition ✅/❌.
        const parts = [
          `אימונים ${hasTraining ? '✅' : '❌'}`,
          `תזונה ${hasNutrition ? '✅' : '❌'}`,
        ];
        // Upcoming week's date (DD.MM), so the nag names the actual week instead
        // of a generic "new week" — upcomingWeek is already computed above.
        const [, upMM, upDD] = upcomingWeek.split('-');
        const upcomingDateLabel = `${upDD}.${upMM}`;
        // Coaches = approver accounts.
        const { data: coaches } = await supabase.from('athletes').select('id').in('email', APPROVER_EMAILS);
        const coachIds = (coaches || []).map((c: { id: string }) => c.id);
        const subs = await subscriptionsForAthletes(coachIds);
        const sent = await sendPushToSubscriptions(subs, {
          title: `שבוע חדש מתחיל (${upcomingDateLabel}) 📅`,
          body: `העלו את התוכניות לשבוע ${upcomingDateLabel}: ${parts.join(' · ')}`,
          url: '/dashboard/program',
          tag,
          category: 'program',
        });
        await markFired(tag, sent);
        fired.push(`${tag} → ${sent} (training:${hasTraining} nutrition:${hasNutrition})`);
      } else {
        // Both present — just record the rollover ran (no nag).
        await markFired(tag, 0);
        fired.push(`${tag} → both plans present`);
      }
    }
  }

  // Daily 09:00 IL: remind athletes REGISTERED for an event happening
  // tomorrow (races, camps, lectures, social events, etc. from the Calendar —
  // migration 055). One push per event per athlete, idempotent per
  // (event, date) via the same ledger. Cancelled registrations are excluded.
  if (hour === 9) {
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowDate = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;
    const { data: upcomingEvents } = await supabase
      .from('events')
      .select('id, name, kind, location, start_time')
      .eq('date', tomorrowDate);

    for (const ev of (upcomingEvents || []) as any[]) {
      const tag = `eventReminder:${ev.id}:${tomorrowDate}`;
      if (await already(tag)) continue;

      const { data: regs } = await supabase
        .from('event_registrations')
        .select('athlete_id')
        .eq('event_id', ev.id)
        .in('status', ['registered', 'waitlisted']);
      const athleteIds = (regs || []).map((r: { athlete_id: string }) => r.athlete_id);
      if (athleteIds.length === 0) { await markFired(tag, 0); continue; }

      const subs = await subscriptionsForAthletes(athleteIds);
      const timeLabel = ev.start_time ? ` בשעה ${String(ev.start_time).slice(0, 5)}` : '';
      const sent = await sendPushToSubscriptions(subs, {
        title: `מחר: ${ev.name} 🗓️`,
        body: `נרשמת ל${ev.name}${timeLabel}${ev.location ? ` · ${ev.location}` : ''}. בהצלחה!`,
        url: `/dashboard/calendar/${ev.id}`,
        tag,
        category: 'events',
      });
      await markFired(tag, sent);
      fired.push(`${tag} → ${sent}`);
    }
  }

  // Daily 09:00 IL: remind athletes NOT YET registered that an event's
  // registration_deadline is tomorrow — the opposite audience of the
  // event-tomorrow reminder above (that one's for people already signed up;
  // this one's a last call for people who aren't). Optional field — most
  // events have no separate deadline from the event date itself, so this
  // is a no-op for them.
  if (hour === 9) {
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowDate = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;
    const { data: closingEvents } = await supabase
      .from('events')
      .select('id, name')
      .eq('registration_deadline', tomorrowDate);

    for (const ev of (closingEvents || []) as any[]) {
      const tag = `regDeadline:${ev.id}:${tomorrowDate}`;
      if (await already(tag)) continue;

      const { data: regs } = await supabase
        .from('event_registrations')
        .select('athlete_id')
        .eq('event_id', ev.id)
        .in('status', ['registered', 'waitlisted']);
      const registeredIds = new Set((regs || []).map((r: { athlete_id: string }) => r.athlete_id));
      const allIds = await allAthleteIds();
      const notRegisteredIds = allIds.filter((id) => !registeredIds.has(id));
      if (notRegisteredIds.length === 0) { await markFired(tag, 0); continue; }

      const subs = await subscriptionsForAthletes(notRegisteredIds);
      const sent = await sendPushToSubscriptions(subs, {
        title: `ההרשמה נסגרת מחר: ${ev.name} ⏰`,
        body: `אם מתכננים להשתתף ב${ev.name}, זו ההזדמנות האחרונה להירשם.`,
        url: `/dashboard/calendar/${ev.id}`,
        tag,
        category: 'events',
      });
      await markFired(tag, sent);
      fired.push(`${tag} → ${sent}`);
    }
  }

  // Sunday 19:00 IL weekly recap: personalized "your week" push to each runner
  // who ran LAST activity-week (Sun–Sat) — km + runs. Idempotent per activity
  // week via one ledger tag; per-athlete content computed from one activities
  // query. Runs only, both Garmin + Strava (same table).
  //
  // Activity weeks now start Sunday (changed 2026-08-21 from Monday), so firing
  // on Sunday evening means `now` already sits in the NEW week that just
  // started today — the week being recapped is the previous one. Bound the
  // query on both ends (start of last week ≤ x < start of this week) so it
  // can't bleed into today's activities, which belong to the new week.
  if (weekday === 0 && hour === 19) {
    const thisWeekStart = getActivityWeekStart(now); // today — the new week that just started
    const recapWeekStart = getActivityWeekStart(new Date(now.getTime() - 7 * 86400_000)); // last week, being recapped
    const tag = `recap:${recapWeekStart}`;
    if (!(await already(tag))) {
      const RUN_TYPES = ['running', 'trail_running', 'treadmill_running', 'track_running', 'virtual_run'];
      // Active athletes (id → push targets resolved later).
      const { data: athletes } = await supabase
        .from('athletes')
        .select('id')
        .eq('status', 'active');
      const ids = (athletes || []).map((a: { id: string }) => a.id);
      let totalSent = 0;
      if (ids.length > 0) {
        const { data: acts } = await supabase
          .from('athlete_activities')
          .select('athlete_id, activity_type, distance, duration')
          .in('athlete_id', ids)
          .gte('start_time', recapWeekStart)
          .lt('start_time', thisWeekStart);
        // Fold per athlete: km + runs + total seconds (runs only). Total seconds
        // (not per-activity average_pace) so the weekly pace is a true distance-
        // weighted average, not an average of averages.
        const per = new Map<string, { km: number; runs: number; sec: number }>();
        for (const r of (acts || []) as any[]) {
          if (!(r.distance > 0) || (r.activity_type && !RUN_TYPES.includes(r.activity_type))) continue;
          const b = per.get(r.athlete_id) || { km: 0, runs: 0, sec: 0 };
          b.km += r.distance / 1000; b.runs += 1; b.sec += (r.duration || 0);
          per.set(r.athlete_id, b);
        }
        // Push each runner who ran this week their own recap.
        for (const [athleteId, s] of per.entries()) {
          if (s.runs === 0) continue;
          const km = Math.round(s.km * 10) / 10;
          const runsLabel = s.runs === 1 ? 'ריצה' : 'ריצות';
          const paceStr = s.sec > 0 && s.km > 0 ? formatPace(s.sec / s.km) : null;
          const body = paceStr
            ? `השבוע רצת ${km} ק״מ ב-${s.runs} ${runsLabel}, בקצב ממוצע של ${paceStr} לק״מ. כל הכבוד!`
            : `השבוע רצת ${km} ק״מ ב-${s.runs} ${runsLabel}. כל הכבוד!`;
          const subs = await subscriptionsForAthletes([athleteId]);
          if (subs.length === 0) continue;
          const sent = await sendPushToSubscriptions(subs, {
            title: 'הסיכום השבועי שלך 🏅',
            body,
            url: '/dashboard',
            tag,
            category: 'achievements',
          });
          totalSent += sent;
        }
      }
      await markFired(tag, totalSent);
      fired.push(`${tag} → ${totalSent}`);
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
