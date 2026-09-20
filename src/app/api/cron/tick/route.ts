import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { sendPushLocalized, resolveAudience, subscriptionsForAthletes, allAthleteIds, persistNotifications, localesForAthletes, notifyAthlete } from '@/lib/push';
import {
  trainingDayBeforeCopy, trainingEveningBeforeCopy, RSVP_ACTION_LABELS, newWeekProgramCopy,
  eventTomorrowCopy, eventClosingCopy, weeklyRecapCopy, surveyNudgeCopy, syncStalledCopy,
  setupSnapshotCopy, snapshotRowCopy,
} from '@/lib/notifications/copy';
import { notifyStaff } from '@/lib/notifications/staff';
import { reconcileResolvedReports } from '@/lib/feedback-notify';
import { computeSetupState } from '@/lib/onboarding/setup-tasks';
import {
  SNAPSHOT_DELAY_MINUTES, SNAPSHOT_LATEST_MINUTES, snapshotChannel, snapshotDue,
  snapshotLedgerTag, snapshotRows, snapshotWorthSending, type SnapshotChannel,
} from '@/lib/onboarding/setup-snapshot';
import { KIT_SIZE_COLUMNS_100, kitSizeSetupInput } from '@/lib/kit-sizes';
import { realEmail } from '@/lib/admin/entry-queue';
import { notifySetupSnapshot } from '@/lib/email';
import { recipientsForKind } from '@/lib/notifications/routing';
import { DEFAULT_NOTIFICATION_LOCALE, type NotificationLocale } from '@/lib/notifications/locale';
import { createAndSendSurvey, notifySurveyNonResponders, rsvpSettlesPaceGroup } from '@/lib/surveys';
import { israelNow, israelToday, getPlanWeekStart, addDaysToDateStr } from '@/lib/utils';
import {
  buildLast7Report, formatReportPace, reportIsEmpty,
  type Last7Report, type ReportActivity,
} from '@/lib/reports/last-7-days';
import { APPROVER_EMAILS } from '@/lib/constants';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * The "has anything synced?" health check — 09:00 Israel, looking back a full
 * day. 09:00 rather than a small hour so the alert arrives when somebody can
 * act on it, and after the morning's runs have had every chance to land: the
 * club trains early, so a quiet 09:00 is genuinely quiet rather than merely
 * early. The window is a day, not an hour, because a Saturday with no runs at
 * all is normal and must not page anyone.
 */
const SYNC_CHECK_HOUR = 9;
const SYNC_STALE_HOURS = 24;

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
  const startedAt = now.getTime();

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
    // The team day's OWN plan-week, not "today"'s — matters whenever the team
    // day is a Sunday: the day-before (today, Saturday) is still in last
    // week's plan-week, but the team day itself starts the next one. Using a
    // single weekStart shared across every teamDay (as this used to) embedded
    // the wrong week in the RSVP action/url for that case, so a tap wrote
    // workout_attendance under a week_start_date the app never shows as answered.
    const teamDayDate = new Date(now);
    teamDayDate.setDate(teamDayDate.getDate() + 1);
    const teamDayWeekStart = getPlanWeekStart(teamDayDate);

    // Stage 1 — day before, at dayBefore.hour, to ALL.
    if (dayBefore.enabled && weekday === dayBeforeWeekday && hour === dayBefore.hour) {
      const tag = `dayBefore:${teamDayWeekStart}:${teamDay}`;
      if (!(await already(tag))) {
        const url = `/dashboard?rsvp=${teamDayWeekStart}:${teamDay}`;
        const subs = await resolveAudience('all', null);
        const build = (locale: NotificationLocale) => trainingDayBeforeCopy(locale, { day: teamDay });
        const { sent, byAthlete } = await sendPushLocalized(subs, (locale) => ({
          ...build(locale), url, tag,
          category: 'workouts',
          actions: [
            { action: 'rsvp_yes', title: RSVP_ACTION_LABELS[locale].yes },
            { action: 'rsvp_no', title: RSVP_ACTION_LABELS[locale].no },
          ],
          rsvp: { weekStart: teamDayWeekStart, day: teamDay },
        }));
        // Persist a real per-athlete row (not just the #ledger: idempotency
        // marker) so this reminder actually shows up in the in-app inbox with
        // a parseable url — GET /api/notifications/inbox excludes #ledger:
        // rows, so without this the inbox's RsvpInlineButtons could never
        // reach a real training_before item no matter how many reminders fired.
        // Localized per recipient for the same reason the push is: these rows
        // ARE the in-app inbox, so a Hebrew row would undo the setting the
        // moment the athlete opened the app.
        const rowLocales = await localesForAthletes([...new Set(subs.map((s) => s.athlete_id))]);
        await persistNotifications(subs.map((s) => ({
          athleteId: s.athlete_id,
          kind: 'training_before',
          ...build(rowLocales.get(s.athlete_id) ?? DEFAULT_NOTIFICATION_LOCALE),
          url,
        })), byAthlete);
        await markFired(tag, sent);
        fired.push(`${tag} → ${sent}`);
      }
    }

    // Stage 2 — evening before, at eveningBefore.hour, to RSVP NON-responders.
    if (eveningBefore.enabled && weekday === dayBeforeWeekday && hour === eveningBefore.hour) {
      const tag = `eveningBefore:${teamDayWeekStart}:${teamDay}`;
      if (!(await already(tag))) {
        // Who already answered for that team day this week? (also grab `attending`
        // so the nudge can tell non-responders how many teammates already confirmed —
        // same query, one extra already-tracked column, no new plumbing.)
        const { data: answered } = await supabase
          .from('workout_attendance')
          .select('athlete_id, attending')
          .eq('week_start_date', teamDayWeekStart)
          .eq('day_of_week', teamDay);
        const answeredRows = answered || [];
        const answeredIds = new Set(answeredRows.map((r: { athlete_id: string }) => r.athlete_id));
        const goingCount = answeredRows.filter((r: { attending: boolean }) => r.attending).length;
        const all = await allAthleteIds();
        const nonResponders = all.filter(id => !answeredIds.has(id));
        const subs = await subscriptionsForAthletes(nonResponders);
        const url = `/dashboard?rsvp=${teamDayWeekStart}:${teamDay}`;
        const build = (locale: NotificationLocale) => trainingEveningBeforeCopy(locale, { day: teamDay, goingCount });
        const { sent, byAthlete } = await sendPushLocalized(subs, (locale) => ({
          ...build(locale), url, tag,
          category: 'workouts',
          actions: [
            { action: 'rsvp_yes', title: RSVP_ACTION_LABELS[locale].yes },
            { action: 'rsvp_no', title: RSVP_ACTION_LABELS[locale].no },
          ],
          rsvp: { weekStart: teamDayWeekStart, day: teamDay },
        }));
        // Non-responders without a subscription still get an inbox row, so their
        // language is looked up from the id list rather than from `subs`.
        const rowLocales = await localesForAthletes(nonResponders);
        await persistNotifications(nonResponders.map((athleteId) => ({
          athleteId,
          kind: 'training_before',
          ...build(rowLocales.get(athleteId) ?? DEFAULT_NOTIFICATION_LOCALE),
          url,
        })), byAthlete);
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
    //
    // "Hasn't answered" is not the same as "has no survey_responses row". The
    // poll asks which pace group you're running with tomorrow, and the home
    // page's RSVP asks the same thing with the same options — so an athlete who
    // tapped a group there at 05:31 was still getting an evening push asking
    // them to answer, which reads as the app not having heard them. Their
    // `workout_attendance` row for this team day counts as the answer.
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
          // An RSVP answers the poll when it actually settled the question: a
          // named group, or a "not coming" (there is no group to ask about).
          // A bare yes from the notification's action button carries no group
          // — `group_label` is null there — so that athlete is still asked.
          const { data: rsvps } = await supabase
            .from('workout_attendance')
            .select('athlete_id, attending, group_label')
            .eq('week_start_date', teamDayWeekStart)
            .eq('day_of_week', teamDay);
          const answeredByRsvp = (rsvps || [])
            .filter(rsvpSettlesPaceGroup)
            .map((r: { athlete_id: string }) => r.athlete_id);

          const sent = await notifySurveyNonResponders({
            surveyId,
            audienceType: 'all',
            copy: (locale) => surveyNudgeCopy(locale, { day: teamDay }),
            tag,
            answeredElsewhere: answeredByRsvp,
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
        // Who gets nagged is configured in Control Room → התראות (routing table,
        // migration 099) — this was the last recipient list in the app resolved by
        // EMAIL ADDRESS, which mails every account a person holds rather than the
        // one they run the club from: the owner's personal address is on
        // APPROVER_EMAILS, so the nag landed on his runner phone as well as the
        // admin account. That list is still the fallback until 099 is applied.
        const routed = await recipientsForKind('program_week_missing');
        let coachIds = routed ?? [];
        if (routed === null) {
          const { data: coaches } = await supabase.from('athletes').select('id').in('email', APPROVER_EMAILS);
          coachIds = (coaches || []).map((c: { id: string }) => c.id);
        }
        const subs = await subscriptionsForAthletes(coachIds);
        const { sent } = await sendPushLocalized(subs, (locale) => ({
          ...newWeekProgramCopy(locale, { dateLabel: upcomingDateLabel, parts }),
          url: '/dashboard/program',
          tag,
          category: 'program',
        }));
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
      const { sent } = await sendPushLocalized(subs, (locale) => ({
        ...eventTomorrowCopy(locale, { name: ev.name, timeLabel, location: ev.location }),
        url: `/dashboard/calendar/${ev.id}`,
        tag,
        category: 'events',
      }));
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
      const { sent } = await sendPushLocalized(subs, (locale) => ({
        ...eventClosingCopy(locale, { name: ev.name }),
        url: `/dashboard/calendar/${ev.id}`,
        tag,
        category: 'events',
      }));
      await markFired(tag, sent);
      fired.push(`${tag} → ${sent}`);
    }
  }

  // Saturday 18:00 IL weekly report: the personalised "your last 7 days" push to
  // every athlete who ran in the window — km, runs, average pace — pointing at the
  // report card on their profile. Idempotent per Saturday via one ledger tag; all
  // per-athlete content is folded from one activities query.
  //
  // It used to be Sunday 19:00 over the Mon–Sun activity week. Moved on his call
  // ("make all 18:00") to Saturday evening, which forces the window to ROLL: the
  // activity week ends on Sunday, so a calendar-week report sent on Saturday would
  // be missing the last day of the week it claims to sum up. `buildLast7Report`
  // takes a trailing seven days ending today instead, which is complete whenever it
  // is sent — and is the same computation the profile card renders, so the push and
  // the screen it links to can never print two different numbers.
  //
  // One consequence, on purpose: this window and the leaderboard's "this week" are
  // no longer the same seven days. A run on Sunday evening lands in next Saturday's
  // report rather than falling out of both.
  if (weekday === 6 && hour === 18) {
    // Anchored to Israel's calendar day so the boundaries don't depend on the
    // gate above happening to fire at an hour where UTC and Israel agree.
    const reportTo = israelToday(now);              // today, the last day of the window
    const reportFrom = addDaysToDateStr(reportTo, -6);
    // One day past the end, so a run started late today is still inside the read.
    const readUntil = addDaysToDateStr(reportTo, 1);
    const tag = `report7:${reportTo}`;
    if (!(await already(tag))) {
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
          .select('athlete_id, activity_type, start_time, distance, duration')
          .in('athlete_id', ids)
          .gte('start_time', reportFrom)
          .lt('start_time', readUntil);
        // Split by athlete and hand each list to the SAME builder the profile card
        // renders from, rather than folding km/pace inline here. The run-type list,
        // the Israel-day bucketing and the distance-weighted pace then exist in one
        // place, so the push and the card it links to cannot drift apart.
        const byAthlete = new Map<string, ReportActivity[]>();
        for (const r of (acts || []) as (ReportActivity & { athlete_id: string })[]) {
          const arr = byAthlete.get(r.athlete_id) || [];
          arr.push(r);
          byAthlete.set(r.athlete_id, arr);
        }
        const per = new Map<string, Last7Report>();
        for (const [athleteId, list] of byAthlete) {
          const report = buildLast7Report(list, reportTo);
          if (!reportIsEmpty(report)) per.set(athleteId, report);
        }
        // Push each runner who ran this week their own report — was a
        // sequential for-loop (one subs query + one full send, awaited one
        // athlete at a time), invisible at a handful of test runners but a
        // real risk of blowing the 60s function timeout at 100+ real ones
        // (and a timed-out run never reaches markFired below, so it'd keep
        // re-attempting a partial send on the next few ticks). One batched
        // subscription query, then every athlete's send runs concurrently.
        const runnerIds = Array.from(per.keys());
        const allSubs = await subscriptionsForAthletes(runnerIds);
        const subsByAthlete = new Map<string, typeof allSubs>();
        for (const s of allSubs) {
          const arr = subsByAthlete.get(s.athlete_id) || [];
          arr.push(s);
          subsByAthlete.set(s.athlete_id, arr);
        }
        const sentCounts = await Promise.all(
          runnerIds.map(async (athleteId) => {
            const report = per.get(athleteId)!;
            const subs = subsByAthlete.get(athleteId) || [];
            if (subs.length === 0) return 0;
            const km = Math.round(report.km * 10) / 10;
            const paceStr = report.paceSeconds ? formatReportPace(report.paceSeconds) : null;
            const { sent } = await sendPushLocalized(subs, (locale) => ({
              ...weeklyRecapCopy(locale, { km, runs: report.runs, pace: paceStr }),
              // The card is on the profile, which is where the same seven days are
              // drawn day by day — the push is the headline, the profile the detail.
              url: '/dashboard/profile',
              tag,
              category: 'achievements',
            }));
            return sent;
          }),
        );
        totalSent = sentCounts.reduce((a, b) => a + b, 0);
      }
      await markFired(tag, totalSent);
      fired.push(`${tag} → ${totalSent}`);
    }
  }

  // Fold in admin scheduled/recurring notifications so they also get intraday
  // ── Health check: has ANYTHING synced? ───────────────────────────────────
  // Not "is Garmin up" — nobody can answer that from here — but the observable
  // consequence, which is the same signal the Control Room shows: zero rows in
  // athlete_activities for a whole day. That state has happened before and was
  // only ever noticed by a person wondering why the feed looked stale, which for
  // a club whose entire input is other systems is far too late.
  //
  // Once daily at 09:00 Israel, gated by its own ledger tag so a re-run of the
  // same hour can't send twice. Deliberately not hourly: a stalled sync is still
  // stalled an hour later and the alert would say the same thing 24 times.
  if (hour === SYNC_CHECK_HOUR) {
    const tag = `sync-stalled-${israelToday(now)}`;
    const { count: alreadySent } = await supabase
      .from('scheduled_notifications')
      .select('id', { count: 'exact', head: true })
      .eq('kind', 'sync_stalled')
      .eq('url', `#ledger:${tag}`);
    if (!alreadySent) {
      const since = new Date(Date.now() - SYNC_STALE_HOURS * 3_600_000).toISOString();
      const { count: recent, error: recentError } = await supabase
        .from('athlete_activities')
        .select('id', { count: 'exact', head: true })
        .gte('created_at', since);
      // Only an actual zero alarms. A query error is unknown, not empty, and
      // "we couldn't check" must never be reported as "nothing arrived".
      if (!recentError && (recent ?? 0) === 0) {
        await notifyStaff({
          kind: 'sync_stalled',
          url: '/dashboard',
          tag,
          category: 'management',
          pushOnly: true,
          copy: (locale) => syncStalledCopy(locale, { hours: SYNC_STALE_HOURS }),
        });
        fired.push(tag);
      }
      // The ledger row goes in either way — it records that the CHECK ran today,
      // not that an alert went out, which is what keeps a healthy day from
      // re-checking on every subsequent tick within the hour.
      await supabase.from('scheduled_notifications').insert({
        kind: 'sync_stalled',
        title_he: 'sync check', body_he: tag,
        audience_type: 'all', schedule_type: 'now',
        status: 'sent', last_sent_at: new Date().toISOString(), sent_count: 0,
        url: `#ledger:${tag}`,
      });
    }
  }

  // ── "Your report was fixed", driven by the state and not by the click ────
  // Runs on every tick, and in steady state that is one indexed query that finds
  // nothing. See lib/feedback-notify.ts: the notification has existed for weeks
  // and had fired twice, because reports get closed by pasted SQL rather than
  // through PATCH /api/feedback. This is what makes the closing itself the
  // trigger, whoever does it and however (9a818a94).
  const resolvedReports = await reconcileResolvedReports(supabase, now);
  if (resolvedReports.sent) fired.push(`reviewResolved → ${resolvedReports.sent}`);

  // ── The 15-minute setup snapshot ─────────────────────────────────────────
  // Runs on every tick (the window is minutes wide, not hours), and is OFF until
  // somebody turns it on — see runSetupSnapshots.
  const setupSnapshot = await runSetupSnapshots(supabase, now);
  if (setupSnapshot.sent) fired.push(`setupSnapshot → ${setupSnapshot.sent}`);

  // precision (delegate to the existing scanner route).
  let scanned: unknown = null;
  try {
    const { POST: scan } = await import('../notifications/route');
    scanned = await scan(new Request('http://internal/scan', {
      method: 'POST',
      headers: { authorization: `Bearer ${cronSecret || ''}` },
    })).then(r => r.json()).catch(() => null);
  } catch { /* scanner optional */ }

  // How close this tick ran to the 60s ceiling. Nothing measured this before, so
  // the timeout risk the weekly-recap comment above worries about was pure
  // speculation — and it matters, because a tick that dies at 60s never reaches
  // markFired, so it re-attempts a partial send on the next few ticks. Vercel's
  // own request duration would cover the whole invocation, but only this number
  // is greppable next to `fired`, which is what says whether a slow tick was slow
  // because it actually sent something or slow for no reason.
  //
  // Almost every tick fires nothing and should be milliseconds; the expensive
  // ones are the Mon/Thu reminder hours and the Sunday recap. Logged always,
  // escalated past 60% so a trend shows up while there is still headroom to act,
  // rather than only once ticks start timing out.
  const durationMs = Date.now() - startedAt;
  const line = { durationMs, israel: { weekday, hour }, fired: fired.length };
  if (durationMs > 0.6 * 60_000) console.warn('[cron/tick] approaching maxDuration', line);
  else console.log('[cron/tick] done', line);

  // Also onto the lock row (migration 085), because the log line above turned out
  // to be unreadable: `vercel logs` only tails live, so there is no history to
  // fetch and the number was correct but invisible. This is the same value stored
  // where it can be queried — and the trend is the point, since a single sample
  // says nothing about whether the Sunday recap is creeping toward the ceiling.
  //
  // Awaited, not fire-and-forget. A serverless function is frozen once it returns
  // a response, so a floating promise here would be killed before the round trip
  // finished and the column would stay NULL on every healthy tick — which is the
  // one value that has to mean "did not finish". One PK-matched UPDATE against a
  // 60s budget is a rounding error; silently losing the metric is not. Swallowed
  // rather than thrown, because a metric must not turn a tick that already sent
  // its notifications into a cron Vercel reports as failed.
  // The error is *returned*, not thrown, so it has to be read — otherwise a
  // database that hasn't had 085 applied yet fails this silently forever.
  const { error: timingError } = await supabase
    .from('cron_tick_locks')
    .update({ duration_ms: durationMs, fired_count: fired.length })
    .eq('tick_at', tickAt);
  if (timingError) console.warn('[cron/tick] could not record timing:', timingError.message);

  return NextResponse.json({ ok: true, israel: { weekday, hour }, fired, resolvedReports, setupSnapshot, scanned, durationMs });
}

// ═════════════════════════════════════════════════════════════════════════════
// THE 15-MINUTE SETUP SNAPSHOT
//
// A quarter of an hour after the app first opened for somebody, send them one
// message listing what is set up and what is not, each item marked. It is how the
// club SAMPLES whether a new member finished the process, without anybody having
// to sit and watch the entry queue.
//
// ⚠️ OFF BY DEFAULT, AND IT HAS TO BE ASKED FOR:
//   INSERT INTO app_settings (key, value) VALUES ('setup_snapshot', 'on');
// Until that row says exactly 'on', this runs in DRY mode: it finds the same
// candidates, computes the same channel and the same numbers, reports all of it
// in the tick's JSON — and sends nothing, and writes no ledger row. That is
// deliberate. This is the first thing in the app that messages a brand-new member
// unprompted, and it should be read in a response body by a person before it is
// read in an inbox by a runner. Flip the row to anything else to stop it again.
//
// Three guarantees, one each from setup-snapshot.ts:
//   · silence for anybody who finished (snapshotWorthSending)
//   · one channel, push or mail, never both (snapshotChannel)
//   · once ever, on a per-athlete ledger row (snapshotLedgerTag)
// ═════════════════════════════════════════════════════════════════════════════

const SNAPSHOT_SETTING_KEY = 'setup_snapshot';

/** Same list the nudge route reads, and for the same reason — see SETUP_COLUMNS there. */
const SNAPSHOT_SETUP_COLUMNS =
  'garmin_auth, strava_auth, data_source, avatar_url, phone, birth_date, gender, shirt_size, shoe_size, group_id, active_shoe_id';

interface SnapshotOutcome {
  athleteId: string;
  name: string | null;
  channel: SnapshotChannel;
  doneCount: number;
  total: number;
  missing: string[];
  /** What actually happened — 'dry' means it was only computed. */
  result: 'sent' | 'emailed' | 'unreachable' | 'dry' | 'already' | 'complete' | 'failed';
}

async function runSetupSnapshots(
  supabase: ReturnType<typeof createServerClient>,
  now: Date,
): Promise<{ mode: 'live' | 'dry' | 'unavailable'; candidates: number; sent: number; outcomes: SnapshotOutcome[] }> {
  const { data: setting } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', SNAPSHOT_SETTING_KEY)
    .maybeSingle();
  const live = (setting?.value || '').trim().toLowerCase() === 'on';
  const mode: 'live' | 'dry' = live ? 'live' : 'dry';

  // The window, not an instant: the tick is every 5 minutes, so 15–25 gives each
  // arrival two chances without ever sending an hour late. See setup-snapshot.ts.
  const openedAfter = new Date(now.getTime() - SNAPSHOT_LATEST_MINUTES * 60_000).toISOString();
  const openedBefore = new Date(now.getTime() - SNAPSHOT_DELAY_MINUTES * 60_000).toISOString();

  // Kit sizes asked for separately (migration 100), like the nudge route: a
  // column that isn't migrated yet must not take the whole stage down with it.
  const base = `id, name, email, approved, first_seen_at, ${SNAPSHOT_SETUP_COLUMNS}`;
  const inWindow = (columns: string) =>
    supabase
      .from('athletes')
      .select(columns)
      .eq('status', 'active')
      .gte('first_seen_at', openedAfter)
      .lte('first_seen_at', openedBefore);

  let { data: rows, error } = await inWindow(`${base}, ${KIT_SIZE_COLUMNS_100}`);
  if (error) ({ data: rows, error } = await inWindow(base));
  // `first_seen_at` itself may not be migrated yet (102). That is not a failure to
  // report as empty — it is "we could not look", and it says so.
  if (error) return { mode: 'unavailable', candidates: 0, sent: 0, outcomes: [] };

  // The select list is built at runtime (the kit-size fallback above), so
  // supabase-js can't type the rows — named here instead of asserted field by field.
  type AthleteRow = Record<string, unknown> & {
    id: string;
    name?: string | null;
    email?: string | null;
    approved?: boolean | null;
    first_seen_at?: string | null;
  };
  const candidates = ((rows || []) as unknown as AthleteRow[]).filter((r) => r.approved !== false);
  const outcomes: SnapshotOutcome[] = [];
  let sent = 0;

  for (const athlete of candidates) {
    const athleteId = athlete.id as string;
    try {
      if (!snapshotDue({ firstSeenAt: athlete.first_seen_at as string | null }, now.getTime())) continue;

      const { count } = await supabase
        .from('push_subscriptions')
        .select('id', { count: 'exact', head: true })
        .eq('athlete_id', athleteId);
      const hasPush = (count ?? 0) > 0;

      const setup = computeSetupState({
        hasGarminAuth: !!athlete.garmin_auth,
        hasStravaAuth: !!athlete.strava_auth,
        dataSource: (athlete.data_source as string) || null,
        avatarUrl: (athlete.avatar_url as string) || null,
        phone: (athlete.phone as string) || null,
        birthDate: (athlete.birth_date as string) || null,
        gender: (athlete.gender as string) || null,
        shirtSize: (athlete.shirt_size as string) || null,
        ...kitSizeSetupInput(athlete as unknown as Record<string, unknown>),
        shoeSize: (athlete.shoe_size as string) || null,
        pushSubscriptions: hasPush ? 1 : 0,
        groupName: athlete.group_id ? 'set' : null,
        hasActiveShoe: !!athlete.active_shoe_id,
      });

      const rowsForMail = snapshotRows(setup);
      const missing = setup.tasks.filter((t) => !t.done).map((t) => t.key as string);
      const address = realEmail(athlete.email as string | null);
      const channel = snapshotChannel({ hasPush, email: address });
      const record = (result: SnapshotOutcome['result']) =>
        outcomes.push({
          athleteId,
          name: (athlete.name as string) || null,
          channel,
          doneCount: setup.doneCount,
          total: setup.totalCount,
          missing,
          result,
        });

      // Finished — say nothing. The one case where the right message is no message.
      if (!snapshotWorthSending(setup)) { record('complete'); continue; }
      if (channel === 'none') { record('unreachable'); continue; }

      const tag = snapshotLedgerTag(athleteId);
      const { count: already } = await supabase
        .from('scheduled_notifications')
        .select('id', { count: 'exact', head: true })
        .eq('kind', 'setup_snapshot')
        .eq('url', `#ledger:${tag}`);
      if ((already || 0) > 0) { record('already'); continue; }

      if (!live) { record('dry'); continue; }

      if (channel === 'push') {
        await notifyAthlete({
          athleteId,
          kind: 'setup_snapshot',
          copy: (locale) => setupSnapshotCopy(locale, {
            name: athlete.name as string,
            doneCount: setup.doneCount,
            total: setup.totalCount,
            gaps: missing,
          }),
          // Straight to the checklist the message is about.
          url: '/dashboard/profile',
          tag: 'setup-snapshot',
        });
        record('sent');
      } else {
        // Hebrew, like every member-facing mail here: the notification-language
        // setting is a push setting, not an inbox one.
        const result = await notifySetupSnapshot({
          email: address as string,
          name: athlete.name as string,
          athleteId,
          doneCount: setup.doneCount,
          total: setup.totalCount,
          rows: rowsForMail.map((r) => ({ ...snapshotRowCopy('he', r), done: r.done })),
        });
        record(result.ok ? 'emailed' : 'failed');
      }

      // The ledger goes in even for a mail Resend refused. This is a "we already
      // reached out about your first quarter of an hour" record, and retrying it
      // on the next tick would be the one thing worse than not sending it: the
      // same stranger's message twice.
      await supabase.from('scheduled_notifications').insert({
        kind: 'setup_snapshot',
        title_he: 'setup snapshot', body_he: tag,
        audience_type: 'athlete', audience_id: athleteId, schedule_type: 'now',
        status: 'sent', last_sent_at: new Date().toISOString(), sent_count: 1,
        url: `#ledger:${tag}`,
      });
      sent += 1;
    } catch (err) {
      console.error('[cron/tick] setup snapshot failed for', athleteId, err);
      outcomes.push({
        athleteId, name: (athlete.name as string) || null, channel: 'none',
        doneCount: 0, total: 0, missing: [], result: 'failed',
      });
    }
  }

  return { mode, candidates: outcomes.length, sent, outcomes };
}

export async function GET(request: Request) { return run(request); }
export async function POST(request: Request) { return run(request); }
