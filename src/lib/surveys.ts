import { createServerClient } from '@/lib/supabase/server';
import { sendPushLocalized, resolveAudience, subscriptionsForAthletes } from '@/lib/push';
import { COACH_ID } from '@/lib/constants';
import { CLUB_ACCOUNT_ROLE } from '@/lib/notifications/prefs';
import { REMINDER_KIND, type PlannedReminder } from '@/lib/survey-reminders';
import { getPlanWeekStart, israelNow, israelToday } from '@/lib/utils';
import { overrideFor, OVERRIDES_KEY, type OverrideStore } from '@/lib/week-setup/model';
import { isMissingColumn } from '@/lib/publish/pin';
import { israelWallToUtc } from '@/lib/notifications/scheduling';
import { pickBilingual, SURVEY_PROMPT_BODY, type PushCopy } from '@/lib/notifications/copy';
import type { NotificationLocale } from '@/lib/notifications/locale';

/**
 * Create a survey + its announcing scheduled_notifications row + send the
 * push, in one call — the exact same three steps POST /api/admin/surveys
 * performs for a manual send, extracted so the cron-driven recurring pace-
 * group polls (see cron/tick) can create a genuinely fresh survey each week
 * without duplicating this logic.
 */
export async function createAndSendSurvey(opts: {
  questionHe: string;
  questionEn?: string | null;
  optionsHe: string[];
  optionsEn?: string[] | null;
  audienceType: string;
  audienceId?: string | null;
  createdBy?: string | null;
  /** false: create the poll without its own push (the caller's push asks it). */
  push?: boolean;
  /** ISO; null = open until somebody closes it. */
  closesAt?: string | null;
  /** More than one answer per person (migration 161). */
  multi?: boolean;
  /** Names hidden from the members (migration 164). Off = everybody sees who chose what. */
  anonymous?: boolean;
  /**
   * The day-before push ("מגיעים מחר?") goes out at this instant, soon: the poll's push rides
   * inside it instead of going alone (cron/tick Stage 1 claims it). If that push never goes,
   * the poll's own push goes an hour later, so it is never lost.
   */
  joinAt?: string | null;
}): Promise<{ survey: { id: string; [key: string]: unknown }; sent: number; joined?: boolean }> {
  const supabase = createServerClient();
  const cleanOptionsHe = opts.optionsHe.map((o) => o.trim()).filter(Boolean);
  const joining = opts.push !== false && !!opts.joinAt && (opts.audienceType || 'all') === 'all';

  const { data: survey, error: surveyError } = await supabase
    .from('surveys')
    .insert({
      question_he: opts.questionHe.trim(),
      question_en: opts.questionEn?.trim() || null,
      options_he: cleanOptionsHe,
      options_en: (opts.optionsEn || []).map((o) => o.trim()).filter(Boolean) || null,
      audience_type: opts.audienceType || 'all',
      audience_id: opts.audienceType === 'all' || opts.audienceType === 'academy' ? null : opts.audienceId || null,
      created_by: opts.createdBy || null,
      ...(opts.closesAt ? { closes_at: opts.closesAt } : {}),
      ...(opts.multi ? { multi_answer: true } : {}),
      ...(opts.anonymous ? { anonymous: true } : {}),
    })
    .select()
    .single();
  if (surveyError) throw surveyError;

  const { data: notifRow, error: notifError } = await supabase
    .from('scheduled_notifications')
    .insert({
      kind: 'survey',
      survey_id: survey.id,
      title_he: opts.questionHe.trim(),
      body_he: 'לחצו לענות על הסקר',
      title_en: opts.questionEn?.trim() || null,
      body_en: opts.questionEn?.trim() ? 'Tap to answer the survey' : null,
      url: `/dashboard/surveys/${survey.id}`,
      audience_type: opts.audienceType || 'all',
      audience_id: opts.audienceType === 'all' || opts.audienceType === 'academy' ? null : opts.audienceId || null,
      schedule_type: 'now',
      next_run_at: new Date().toISOString(),
      // A poll without its own push is born 'silent'. Inserting it 'scheduled' and
      // marking it afterwards lost a race every time: /api/cron/notifications sends
      // every due 'scheduled' row once a minute, so the "no push" poll went to the
      // whole club anyway (sent 21, 2026-10-19 08:00) — a second notification beside
      // the day-before push asking the same thing (feedback #130).
      status: opts.push === false ? 'silent' : 'scheduled',
      ...(opts.push === false ? { last_sent_at: new Date().toISOString(), sent_count: 0 } : {}),
      // Joined: due an hour after the day-before push, which claims it before then.
      ...(joining ? { next_run_at: new Date(Date.parse(opts.joinAt!) + JOIN_FALLBACK_MS).toISOString(), schedule_type: 'once_at' } : {}),
      created_by: opts.createdBy || null,
    })
    .select()
    .single();
  if (notifError) throw notifError;

  // 'silent' (above), not 'sent': nothing sends it, and the inbox, which lists
  // 'sent' rows, doesn't show it either. The poll itself is untouched.
  if (opts.push === false) return { survey, sent: 0 };
  if (joining) return { survey, sent: 0, joined: true };

  const subs = await resolveAudience(notifRow.audience_type, notifRow.audience_id);
  // The question is authored once but stored in both languages, so each
  // recipient gets the column they can actually read (falling back to the
  // filled-in one when the author skipped a translation).
  const { sent } = await sendPushLocalized(subs, (locale) => ({
    title: pickBilingual(locale, { he: notifRow.title_he, en: notifRow.title_en }),
    body: pickBilingual(locale, { he: notifRow.body_he, en: notifRow.body_en }) || SURVEY_PROMPT_BODY[locale],
    url: notifRow.url,
    tag: `survey-${survey.id}`,
    category: 'news',
  }));
  await supabase
    .from('scheduled_notifications')
    .update({ status: 'sent', last_sent_at: new Date().toISOString(), sent_count: sent })
    .eq('id', notifRow.id);

  return { survey, sent };
}

/**
 * Does this `workout_attendance` row already answer the pace-group poll?
 *
 * The two ask the same question — which דבוקה tomorrow — so an RSVP that named a
 * group has answered it, and so has a "not coming": there is no group to ask
 * about. What does NOT count is a bare yes, which is what the RSVP button on a
 * push notification sends (no page, no group picker, so `group_label` is null).
 * That athlete is coming and hasn't said with whom, which is exactly who the
 * evening nudge is for.
 */
export function rsvpSettlesPaceGroup(row: { attending: boolean; group_label?: string | null }): boolean {
  return !row.attending || !!row.group_label;
}

/**
 * Nudge athletes in a survey's audience who haven't responded yet — the
 * survey equivalent of cron/tick's RSVP-non-responder nudge. Never re-asks
 * anyone who already answered.
 */
export async function notifySurveyNonResponders(opts: {
  surveyId: string;
  audienceType: string;
  audienceId?: string | null;
  /** Nudge wording, resolved per recipient — see notifyAthlete's copy option. */
  copy: (locale: NotificationLocale) => PushCopy;
  tag: string;
  /**
   * Athletes to treat as having answered even with no `survey_responses` row —
   * because they answered the same question somewhere else. The recurring
   * pace-group poll asks what the home page's RSVP already asks (which group are
   * you running with tomorrow), and an athlete who picked a group there was still
   * being nudged in the evening to answer "again"; see cron/tick Stage 4.
   */
  answeredElsewhere?: Iterable<string>;
}): Promise<number> {
  const supabase = createServerClient();
  const { data: responded } = await supabase.from('survey_responses').select('athlete_id').eq('survey_id', opts.surveyId);
  const respondedIds = new Set((responded || []).map((r: { athlete_id: string }) => r.athlete_id));
  for (const id of opts.answeredElsewhere || []) respondedIds.add(id);

  const candidateIds = await surveyAudienceIds(supabase, opts.audienceType, opts.audienceId);
  const nonResponders = candidateIds.filter((id) => !respondedIds.has(id));
  if (nonResponders.length === 0) return 0;

  const subs = await subscriptionsForAthletes(nonResponders);
  const { sent } = await sendPushLocalized(subs, (locale) => ({
    ...opts.copy(locale),
    url: `/dashboard/surveys/${opts.surveyId}`,
    tag: opts.tag,
    category: 'news',
  }));
  return sent;
}

// ── the audience, the reminders, the day-before push ─────────────────────────────

type Db = ReturnType<typeof createServerClient>;

/**
 * Who a poll asks: the club's active members (not the club's own admin account), one pack,
 * the academy, or one person. "Hasn't answered" and "remind" are both counted from this.
 */
export async function surveyAudienceIds(supabase: Db, audienceType: string, audienceId?: string | null): Promise<string[]> {
  if (audienceType === 'athlete' && audienceId) return [audienceId];
  let q = supabase.from('athletes').select('id').eq('coach_id', COACH_ID).eq('status', 'active').or(`role.is.null,role.neq.${CLUB_ACCOUNT_ROLE}`);
  if (audienceType === 'group' && audienceId) q = q.eq('group_id', audienceId);
  else if (audienceType === 'academy') q = q.eq('is_academy', true);
  const { data } = await q;
  return ((data || []) as Array<{ id: string }>).map((a) => a.id);
}

/** The reminders a poll was published with, as rows the minute cron sends (lib/survey-reminders). */
export async function scheduleSurveyReminders(supabase: Db, survey: { id: string; question_he: string; audience_type: string; audience_id: string | null }, planned: PlannedReminder[], createdBy: string | null): Promise<number> {
  const rows = planned.filter((r) => !r.skip).map((r) => ({
    kind: REMINDER_KIND,
    survey_id: survey.id,
    title_he: survey.question_he,
    body_he: 'עוד לא ענית — לחצו לענות',
    title_en: null,
    body_en: null,
    url: `/dashboard/surveys/${survey.id}`,
    audience_type: survey.audience_type,
    audience_id: survey.audience_id,
    schedule_type: 'once_at',
    scheduled_at: r.at,
    next_run_at: r.at,
    status: 'scheduled',
    created_by: createdBy,
  }));
  if (!rows.length) return 0;
  const { error } = await supabase.from('scheduled_notifications').insert(rows);
  if (error) throw error;
  return rows.length;
}

/** A poll closed early (or reopened with another close): its reminders still to come are off. */
export async function cancelSurveyReminders(supabase: Db, surveyId: string): Promise<void> {
  await supabase.from('scheduled_notifications').update({ status: 'cancelled', updated_at: new Date().toISOString() })
    .eq('survey_id', surveyId).eq('kind', REMINDER_KIND).eq('status', 'scheduled');
}

/** Is migration 164 (surveys.anonymous) in this database? */
export async function hasMigration164(supabase: Db): Promise<boolean> {
  const { error } = await supabase.from('surveys').select('anonymous').limit(1);
  if (!error) return true;
  if (isMissingColumn(error)) return false;
  throw error;
}
export { MIGRATION_164 } from '@/lib/survey-messages';

/** How long after the day-before push a joined poll still waits before it goes on its own. */
export const JOIN_FALLBACK_MS = 60 * 60_000;
/** Join only a push that is this close: a poll published at 06:00 does not wait for noon. */
export const JOIN_WITHIN_MS = 3 * 60 * 60_000;

/**
 * When today's day-before push ("מגיעים מחר?", cron/tick Stage 1) goes out, if it is still
 * to come within JOIN_WITHIN_MS — so a poll published now rides inside it (one push a day,
 * mockup polls-proposal). Null: no such push today, it already went, or it is hours away.
 */
export async function dayBeforePushSoon(supabase: Db, now: Date = new Date()): Promise<string | null> {
  const { data: cfgRow } = await supabase.from('app_settings').select('value').eq('key', 'reminder_config').maybeSingle();
  let cfg: { teamDays?: number[]; dayBefore?: { enabled: boolean; hour: number } } = {};
  try { cfg = JSON.parse((cfgRow as { value?: string } | null)?.value || '') || {}; } catch { cfg = {}; }
  const teamDays = cfg.teamDays || [2, 5];
  const dayBefore = cfg.dayBefore || { enabled: true, hour: 8 };
  if (!dayBefore.enabled) return null;
  const { weekday, hour } = israelNow(now);
  const teamDay = teamDays.find((d) => (d + 6) % 7 === weekday);
  if (teamDay === undefined) return null;
  const tomorrow = new Date(now.getTime() + 86_400_000);
  // Read here rather than through lib/week-setup/server, which imports this file.
  let overrides: OverrideStore = {};
  try {
    const { data: o } = await supabase.from('app_settings').select('value').eq('key', OVERRIDES_KEY).maybeSingle();
    const v = (o as { value?: unknown } | null)?.value;
    overrides = (typeof v === 'string' ? JSON.parse(v) : v) || {};
  } catch { overrides = {}; }
  const ov = overrideFor(overrides, getPlanWeekStart(tomorrow), 'dayBefore', teamDay);
  if (ov?.off) return null;
  const at = ov?.hour ?? dayBefore.hour;
  if (at <= hour) return null;
  const [y, m, d] = israelToday(now).split('-').map(Number);
  const ms = israelWallToUtc(y, m, d, at, 0);
  return ms - now.getTime() <= JOIN_WITHIN_MS ? new Date(ms).toISOString() : null;
}

/**
 * Stage 1's side of the join: the polls waiting to ride in this push, claimed (so the
 * fallback never sends them too) and returned for the push's text. Club-wide polls only —
 * the day-before push goes to everybody.
 */
export async function claimJoinedPolls(supabase: Db, now: Date = new Date()): Promise<Array<{ id: string; question: string }>> {
  const nowIso = now.toISOString();
  const { data } = await supabase.from('scheduled_notifications')
    .update({ status: 'sent', last_sent_at: nowIso, updated_at: nowIso })
    .eq('kind', 'survey').eq('status', 'scheduled').eq('audience_type', 'all')
    .gt('next_run_at', nowIso).lte('next_run_at', new Date(now.getTime() + JOIN_FALLBACK_MS + 5 * 60_000).toISOString())
    .select('id, title_he');
  return ((data || []) as Array<{ id: string; title_he: string }>).map((r) => ({ id: r.id, question: r.title_he }));
}

export interface WeekPoll {
  id: string;
  question: string;
  closesAt: string | null;
  open: boolean;
  answered: number;
  /** How many the poll asks — its audience's active members. */
  asked: number;
}

/**
 * The polls of a week, for "תחילת שבוע": every staff poll open at some point in it
 * (the retired weekly pack polls, created by the cron, are left out), with how many answered.
 */
export async function pollsOfWeek(supabase: Db, weekStart: string, weekEnd: string, now: Date = new Date()): Promise<WeekPoll[]> {
  const { data } = await supabase.from('surveys').select('id, question_he, closes_at, created_at, created_by, audience_type, audience_id')
    .lte('created_at', `${weekEnd}T23:59:59+03:00`).or(`closes_at.is.null,closes_at.gte.${weekStart}T00:00:00+03:00`)
    .order('created_at', { ascending: false }).limit(20);
  const rows = ((data || []) as Array<{ id: string; question_he: string; closes_at: string | null; created_at: string; created_by: string | null; audience_type: string; audience_id: string | null }>)
    .filter((r) => r.created_by !== 'cron' && (r.closes_at || r.created_at >= `${weekStart}`));
  if (!rows.length) return [];
  const [{ data: resp }, { data: people }] = await Promise.all([
    supabase.from('survey_responses').select('survey_id, athlete_id').in('survey_id', rows.map((r) => r.id)),
    supabase.from('athletes').select('id, group_id, is_academy').eq('coach_id', COACH_ID).eq('status', 'active').or(`role.is.null,role.neq.${CLUB_ACCOUNT_ROLE}`),
  ]);
  const who = new Map<string, Set<string>>();
  for (const r of (resp || []) as Array<{ survey_id: string; athlete_id: string }>) {
    const s = who.get(r.survey_id) ?? new Set<string>(); s.add(r.athlete_id); who.set(r.survey_id, s);
  }
  const members = (people || []) as Array<{ id: string; group_id: string | null; is_academy: boolean | null }>;
  const asked = (t: string, id: string | null) => (t === 'group' ? members.filter((m) => m.group_id === id).length
    : t === 'academy' ? members.filter((m) => m.is_academy).length : t === 'athlete' ? 1 : members.length);
  return rows.map((r) => ({
    id: r.id, question: r.question_he, closesAt: r.closes_at,
    open: !r.closes_at || Date.parse(r.closes_at) > now.getTime(),
    answered: who.get(r.id)?.size ?? 0, asked: asked(r.audience_type, r.audience_id),
  }));
}
