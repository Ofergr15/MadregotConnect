import type { SupabaseClient } from '@supabase/supabase-js';
import { createTranslator } from 'next-intl';
import he from '../../../messages/he.json';
import en from '../../../messages/en.json';
import { COACH_ID, isStaffRole } from '@/lib/constants';
import { activityLocalDateStr, activityLocalMinutes, israelNow, israelToday, planWeekStartOf } from '@/lib/utils';
import { isKindMuted } from '@/lib/notifications/prefs';
import type { NotificationLocale } from '@/lib/notifications/locale';
import { notifyAthlete, subscriptionsForAthletes } from '@/lib/push';
import { fetchNight } from '@/lib/wellness/sweep';
import { TRAINEE_V2_FOR_ALL } from '@/lib/trainee/flag';
import { loadLaneReferences } from './book-server';
import { dayCards } from './day-cards';
import { isRunType, shiftDate } from './load';
import { hasActivityLoadsTable, loadDailyRows, loadTestsFor } from './load-server';
import { normalRange, rhrVerdict, sleepVerdict, RANGE_DAYS, type WellnessNight } from './normal-range';
import { academyBoardUrl } from './deep-links';
import { todayForm } from './trainee-today';
import {
  decideMorningReminder, isDue, isolateLtr, isolateNumbers, readReminderPref, reminderCopy, reminderLedgerUrl, targetDateFor,
  type ReminderBody, type ReminderForm, type ReminderLines, type SkipReason,
} from './morning-reminder';

type Db = SupabaseClient<any, any, any>;

/**
 * The morning reminder, sent (trainee-experience-v2 screen 9). The rules are all in
 * `./morning-reminder`; this is the reads and writes around them, called from the 5-minute
 * cron tick next to the test reminders, in the same posture: **every error is swallowed and
 * logged** — a reminder that does not go out is a quiet morning, a tick that throws costs
 * every other job on it.
 *
 * Most ticks nobody is due, and they cost one read (the academy's prefs). For the few who
 * are, one parallel round reads what the decision needs: their own plan rows (`pickPlan`,
 * never another trainee's), what is on the watch, the ledger, today's runs, the nights and
 * the loads. A night the 05:40 UTC wellness sweep has not reached yet is fetched from Garmin
 * for that trainee only — at most MAX_NIGHT_FETCHES a tick, 3 s each — and on any failure
 * the third line is simply left out.
 */

export const LEDGER_KIND = 'academy_morning_ledger';
export const MAX_NIGHT_FETCHES = 10;
export const NIGHT_TIMEOUT_MS = 3000;

const ATHLETE_COLS = 'id, name, role, group_id, notification_prefs';

export interface MorningReminderResult {
  due: number;
  sent: number;
  skipped: Partial<Record<SkipReason, number>>;
}

const MESSAGES: Record<NotificationLocale, unknown> = { he, en };

/** The push copy in one language: next-intl's ICU, `<m>` as a Unicode isolate. */
export function renderReminder(lines: ReminderLines, locale: NotificationLocale): { title: string; body: string } {
  const t = createTranslator({ locale, messages: MESSAGES[locale] as any });
  return reminderCopy(lines, (key, params) => t.markup(key as any, {
    ...params,
    ...(typeof params.title === 'string' ? { title: isolateNumbers(params.title) } : {}),
    m: (c: string) => isolateLtr(c),
  } as any));
}

/** A coach's plan push this recent is "today's": the reminder folds into it. */
export const PLAN_PUSH_MERGE_MS = 24 * 3600 * 1000;

/**
 * The reminder's notification tag (spec §3.7: "deduplicated against the existing day-send
 * push … the reminder merges into it"). When the coach's own "sent to your watch" push for
 * this workout went out in the last day, the reminder takes ITS tag (push-week.ts:
 * `plan-push-<planId | week>`), so the phone replaces that notification with this one —
 * which says the same and more — instead of showing two. Otherwise its own per-day tag.
 */
export function reminderTag(input: {
  athleteId: string;
  workoutDate: string;
  coachPushed: boolean;
  delivery: { plan_id?: string | null } | null;
}): string {
  if (input.coachPushed && input.delivery) {
    return `plan-push-${input.delivery.plan_id || planWeekStartOf(input.workoutDate)}`;
  }
  return `academy-day-${input.athleteId}-${input.workoutDate}`;
}

/**
 * Did a run start on `today` at or before `nowMin` (Israel minutes)? Compared in the
 * wall-clock frame: start_time is the watch's local time stored as if it were UTC, so its
 * UTC parts ARE the Israel clock — set against the real instant, a 05:30 run would read as
 * 08:30 and a 06:00 reminder would still tell the trainee what to run.
 */
export function ranBefore(startTime: string, today: string, nowMin: number): boolean {
  return activityLocalDateStr(startTime) === today && activityLocalMinutes(startTime) <= nowMin;
}

export async function dispatchMorningReminders(db: Db, nowIso: string = new Date().toISOString()): Promise<MorningReminderResult> {
  const result: MorningReminderResult = { due: 0, sent: 0, skipped: {} };
  const skip = (reason: SkipReason) => { result.skipped[reason] = (result.skipped[reason] ?? 0) + 1; };
  try {
    const now = new Date(nowIso);
    const today = israelToday(now);
    const { hour, minute } = israelNow(now);
    const nowMin = hour * 60 + minute;

    const { data: people, error } = await db
      .from('athletes')
      .select(ATHLETE_COLS)
      .eq('is_academy', true)
      .eq('status', 'active');
    if (error) {
      console.error('[morning-reminder] academy read failed:', error.message);
      return result;
    }

    // ── Who is due this tick (no reads beyond the one above) ──
    const due: Array<{ id: string; groupId: string | null; prefs: unknown; target: string }> = [];
    for (const p of (people || []) as any[]) {
      const pref = readReminderPref(p.notification_prefs, TRAINEE_V2_FOR_ALL);
      if (!pref.enabled) { skip('disabled'); continue; }
      if (!isDue(nowMin, pref.time)) continue;
      if (isKindMuted('academy_morning', p.notification_prefs, isStaffRole(p.role), p.role)) { skip('muted'); continue; }
      due.push({ id: String(p.id), groupId: p.group_id ?? null, prefs: p.notification_prefs, target: targetDateFor(pref.time, today) });
    }
    result.due = due.length;
    if (!due.length) return result;

    const ids = due.map(d => d.id);
    const targets = [...new Set(due.map(d => d.target))];
    const weekStarts = [...new Set(targets.map(d => planWeekStartOf(d)))];
    const urls = due.map(d => reminderLedgerUrl(d.id, d.target));

    const [groupPlans, ownPlans, groupsRes, laneRefs, deliveriesRes, ledgerRes, planPushRes, actsRes, nightsRes, testsBy, loads] = await Promise.all([
      db.from('weekly_plans').select('week_start_date, parsed_workouts, status, athlete_id, created_at')
        .eq('coach_id', COACH_ID).is('athlete_id', null).in('week_start_date', weekStarts),
      db.from('weekly_plans').select('week_start_date, parsed_workouts, status, athlete_id, created_at')
        .eq('coach_id', COACH_ID).in('athlete_id', ids).in('week_start_date', weekStarts),
      db.from('groups').select('id, name'),
      loadLaneReferences(db as never),
      db.from('workout_deliveries').select('athlete_id, workout_date, status, plan_id').in('athlete_id', ids).in('workout_date', targets),
      db.from('scheduled_notifications').select('url').eq('kind', LEDGER_KIND).in('url', urls),
      // The coach's own "sent to your watch" push (push-week.ts, kind plan_pushed) of the
      // last day: the reminder then takes its tag, so the phone shows ONE notification.
      db.from('scheduled_notifications').select('audience_id, last_sent_at').eq('kind', 'plan_pushed').in('audience_id', ids)
        .gte('last_sent_at', new Date(now.getTime() - PLAN_PUSH_MERGE_MS).toISOString()),
      db.from('athlete_activities').select('athlete_id, start_time, activity_type')
        .in('athlete_id', ids).gte('start_time', `${shiftDate(today, -1)}T00:00:00Z`),
      db.from('athlete_wellness').select('athlete_id, date, sleep_seconds, resting_hr')
        .in('athlete_id', ids).gte('date', shiftDate(today, -RANGE_DAYS)).lte('date', today),
      loadTestsFor(db, ids),
      // Form only adds the optional "רעננות טובה" line: read from the stored loads, never
      // the in-memory pricing (100 days of laps for everyone due at 06:00 is not a tick's job).
      hasActivityLoadsTable(db).then(ok => (ok ? loadDailyRows(db, ids, shiftDate(today, -400), { today }) : { rows: [], stored: false })),
    ]);

    const planRows = [...((groupPlans.error ? [] : groupPlans.data) || []), ...((ownPlans.error ? [] : ownPlans.data) || [])] as any[];
    const groupNames = new Map<string, string>(((groupsRes.data || []) as any[]).map(g => [g.id, g.name]));
    const sentAlready = new Set(((ledgerRes.error ? [] : ledgerRes.data) || []).map((r: any) => String(r.url)));
    const deliveries = (deliveriesRes.error ? [] : deliveriesRes.data || []) as any[];
    const planPushedTo = new Set(((planPushRes.error ? [] : planPushRes.data) || []).map((r: any) => String(r.audience_id)));
    const acts = (actsRes.error ? [] : actsRes.data || []) as any[];
    const nights = (nightsRes.error ? [] : nightsRes.data || []) as any[];
    let nightFetches = 0;

    for (const person of due) {
      try {
        const onWatch = new Set(deliveries
          .filter(d => d.athlete_id === person.id && d.status === 'success')
          .map(d => String(d.workout_date).slice(0, 10)));
        const ranToday = acts.some(a => a.athlete_id === person.id && isRunType(a.activity_type) && ranBefore(a.start_time, today, nowMin));
        const tests = testsBy[person.id] || [];
        const { cards, planWeeks } = dayCards({
          dates: [person.target],
          athleteId: person.id,
          groupId: person.groupId,
          planRows: planRows.filter(r => !r.athlete_id || r.athlete_id === person.id),
          groupNames,
          laneRefs,
          tests,
          onWatch,
          doneOn: () => false,
        });
        const card = cards[person.target] ?? null;
        const hasPlan = !!planWeeks[planWeekStartOf(person.target)];
        const url = reminderLedgerUrl(person.id, person.target);

        // The body and the form only matter for a day that will be sent.
        let body: ReminderBody | null = null;
        let form: ReminderForm | null = null;
        if (card && hasPlan && !sentAlready.has(url) && !(person.target === today && ranToday)) {
          const mine: WellnessNight[] = nights
            .filter(n => n.athlete_id === person.id)
            .map(n => ({ date: String(n.date).slice(0, 10), sleep_seconds: n.sleep_seconds ?? null, resting_hr: n.resting_hr ?? null }));
          // Only a morning reminder speaks for this morning's body; an evening preview does not.
          if (person.target === today) {
            let night = mine.find(n => n.date === today && (n.sleep_seconds || n.resting_hr)) ?? null;
            if (!night && nightFetches < MAX_NIGHT_FETCHES) {
              nightFetches += 1;
              const fetched = await fetchNight(db, person.id, today, { timeoutMs: NIGHT_TIMEOUT_MS });
              if (fetched) night = { date: today, ...fetched };
            }
            if (night) {
              body = {
                sleep: sleepVerdict(night.sleep_seconds, normalRange(mine, today, 'sleep_seconds')),
                rhr: rhrVerdict(night.resting_hr, normalRange(mine, today, 'resting_hr')),
              };
            }
          }
          // The form of the day announced: an evening preview speaks for tomorrow (today's run in).
          const f = loads.stored && todayForm({ rows: loads.rows.filter(r => r.athleteId === person.id), tests, today, day: card.kind, asOf: person.target });
          if (f && f.status === 'ok') form = { form: f.value, band: f.band };
        }

        const decision = decideMorningReminder({
          pref: readReminderPref(person.prefs, TRAINEE_V2_FOR_ALL),
          nowMin,
          today,
          muted: false,
          hasPlan,
          card,
          alreadySent: sentAlready.has(url),
          ranBeforeSend: ranToday,
          body,
          form,
        });
        if (!decision.send) { skip(decision.reason); continue; }
        // No device can receive it: an inbox-only "reminder" is not a reminder, and must
        // not be counted as sent (the tick used to report a send that reached nobody).
        if (!(await subscriptionsForAthletes([person.id]).catch(() => [{}])).length) { skip('noSubscription'); continue; }

        const delivery = await notifyAthlete({
          athleteId: person.id,
          kind: 'academy_morning',
          category: 'workouts',
          tag: reminderTag({
            athleteId: person.id,
            workoutDate: decision.workoutDate,
            coachPushed: planPushedTo.has(person.id),
            delivery: deliveries.find(d => d.athlete_id === person.id && d.status === 'success'
              && String(d.workout_date).slice(0, 10) === decision.workoutDate) ?? null,
          }),
          url: academyBoardUrl({ open: decision.workoutDate }),
          copy: locale => renderReminder(decision.lines, locale),
        });
        // Written right after the send, so an overlapping tick that read the ledger before
        // this row existed is the only way to a second push — and the tag folds that one
        // into the first on the lock screen.
        const { error: ledgerErr } = await db.from('scheduled_notifications').insert({
          kind: LEDGER_KIND,
          title_he: 'ledger', body_he: url.slice('#ledger:'.length),
          audience_type: 'athlete', audience_id: person.id,
          schedule_type: 'now', status: 'sent',
          last_sent_at: new Date().toISOString(), sent_count: 1,
          url,
        });
        if (ledgerErr) console.error('[morning-reminder] ledger write failed:', ledgerErr.message);
        sentAlready.add(url);
        if (delivery.delivered === 0) skip('notDelivered');
        else result.sent += 1;
      } catch (err) {
        console.error('[morning-reminder] failed for', person.id, err);
      }
    }
  } catch (err) {
    console.error('[morning-reminder] dispatch failed:', err);
  }
  return result;
}
