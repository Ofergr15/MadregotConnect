import type { SupabaseClient } from '@supabase/supabase-js';
import { israelNow, israelToday } from '@/lib/utils';
import { notifyAthlete } from '@/lib/push';
import { painFollowupCopy, painNoCheckinCopy } from '@/lib/notifications/copy';
import { isFeatureEnabled } from '@/lib/features/server';
import { PAIN_AREA_HE, followupDue, pickOneFollowupPerRunner, type PainArea, type Trend } from './pain';
import { painRecipientIds } from './pain-server';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, any, any>;

/**
 * The 09:00 Israel pass over open pain reports (cron/tick). Asks the runner
 * (`pain_followup`, deep link to the check-in screen) on the cadence in
 * lib/feedback/pain.ts, one question per runner per day; after 14 days it stops
 * asking the runner and tells their coaches once (`pain_no_checkin`). An athlete
 * whose feature was switched off since is skipped — no questions about a screen
 * they can no longer open. Returns how many were asked / escalated.
 */
export async function runPainFollowups(db: Db, now: Date = new Date()): Promise<{ asked: number; escalated: number }> {
  const hour = israelNow(now).hour;
  const today = israelToday(now);
  const { data, error } = await db.from('pain_reports')
    .select('id, athlete_id, area, status, created_at, last_followup_on, escalated_at').eq('status', 'open').limit(500);
  if (error || !data?.length) return { asked: 0, escalated: 0 };
  const rows = data as Array<{ id: string; athlete_id: string; area: string; status: 'open'; created_at: string; last_followup_on: string | null; escalated_at: string | null }>;
  const { data: cks } = await db.from('pain_checkins').select('report_id, trend, created_at').in('report_id', rows.map((r) => r.id)).order('created_at');
  const lastTrend = new Map<string, Trend>();
  for (const c of (cks || []) as Array<{ report_id: string; trend: Trend }>) lastTrend.set(c.report_id, c.trend);

  const ask: Array<{ id: string; athleteId: string; createdAt: string; area: string }> = [];
  const escalate: typeof ask = [];
  for (const r of rows) {
    const action = followupDue({
      status: r.status, createdOn: israelToday(new Date(r.created_at)), lastAskedOn: r.last_followup_on,
      lastTrend: lastTrend.get(r.id) ?? null, escalated: !!r.escalated_at,
    }, today, hour);
    const item = { id: r.id, athleteId: r.athlete_id, createdAt: r.created_at, area: r.area };
    if (action === 'ask') ask.push(item);
    else if (action === 'escalate') escalate.push(item);
  }

  let asked = 0;
  for (const r of pickOneFollowupPerRunner(ask)) {
    if (!(await isFeatureEnabled('feedback_pain', r.athleteId, db))) continue;
    const area = PAIN_AREA_HE[r.area as PainArea] ?? r.area;
    await notifyAthlete({
      athleteId: r.athleteId, kind: 'pain_followup', url: `/me/pain/${r.id}/checkin`, tag: `pain-followup-${r.id}`,
      category: 'workouts', copy: (locale) => painFollowupCopy(locale, { area }),
    }).catch(() => null);
    // Every due report of this runner is marked asked today, so a second one doesn't ask tomorrow instead.
    await db.from('pain_reports').update({ last_followup_on: today }).in('id', ask.filter((a) => a.athleteId === r.athleteId).map((a) => a.id));
    asked++;
  }

  let escalated = 0;
  for (const r of escalate) {
    const [{ ids }, { data: a }] = await Promise.all([
      painRecipientIds(db, r.athleteId),
      db.from('athletes').select('name').eq('id', r.athleteId).maybeSingle(),
    ]);
    const area = PAIN_AREA_HE[r.area as PainArea] ?? r.area;
    await Promise.all(ids.map((id) => notifyAthlete({
      athleteId: id, kind: 'pain_no_checkin', url: `/coach/pain/${r.id}`, tag: `pain-nocheckin-${r.id}`,
      category: 'management', actorAthleteId: r.athleteId,
      copy: (locale) => painNoCheckinCopy(locale, { athleteName: a?.name || 'רץ/ה', area }),
    }).catch(() => null)));
    await db.from('pain_reports').update({ escalated_at: now.toISOString() }).eq('id', r.id);
    escalated++;
  }
  return { asked, escalated };
}
