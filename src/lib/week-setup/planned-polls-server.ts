import type { createServerClient } from '@/lib/supabase/server';
import { israelToday } from '@/lib/utils';
import { createAndSendSurvey, dayBeforePushSoon } from '@/lib/surveys';
import { publishClubPost } from '@/lib/publish/server';
import { PLANNED_POLLS_KEY, duePolls, upsertPoll, type PlannedPoll, type PlannedPollStore } from './planned-polls';
import { logWeek, readSetting, writeSetting } from './server';

type Db = ReturnType<typeof createServerClient>;

export const loadPlannedPolls = (supabase: Db) => readSetting<PlannedPollStore>(supabase, PLANNED_POLLS_KEY, {});
export const savePlannedPolls = (supabase: Db, store: PlannedPollStore) => writeSetting(supabase, PLANNED_POLLS_KEY, store);

/**
 * Publish one poll — the screen's "now" and the tick's due ones — exactly as the publish
 * screen does (api/admin/surveys): createAndSendSurvey, riding inside the day-before push when
 * that is soon and the poll is the club's (dayBeforePushSoon), and a feed card when asked.
 */
export async function publishPoll(supabase: Db, week: string, p: PlannedPoll): Promise<string> {
  const joinAt = p.audienceType === 'all' ? await dayBeforePushSoon(supabase).catch(() => null) : null;
  const { survey } = await createAndSendSurvey({
    questionHe: p.question.trim(),
    optionsHe: p.options.map((o) => o.trim()).filter(Boolean),
    audienceType: p.audienceType,
    audienceId: p.audienceType === 'group' ? p.audienceId : null,
    createdBy: p.email || null,
    closesAt: p.closesAt,
    push: true,
    multi: p.multi,
    anonymous: p.anonymous,
    joinAt,
  });
  if (p.feed) await publishClubPost(supabase, { body: p.question.trim(), payload: { surveyId: survey.id } }).catch(() => null);
  await logWeek(supabase, week, { athleteId: p.byId, name: p.by }, 'polls', 'poll_created', p.question.slice(0, 60));
  return survey.id;
}

/** The cron tick's stage: every planned poll whose moment came, out; each marked so it goes once. */
export async function sendDuePolls(supabase: Db, now: Date = new Date()): Promise<number> {
  const store = await loadPlannedPolls(supabase);
  const due = duePolls(store, now.toISOString());
  if (!due.length) return 0;
  let next = store;
  // Marked BEFORE sending: a tick that dies halfway must not send it again five minutes later.
  for (const { week, poll } of due) next = upsertPoll(next, week, { ...poll, publishedAt: now.toISOString() }, israelToday());
  await savePlannedPolls(supabase, next);
  let sent = 0;
  for (const { week, poll } of due) {
    try {
      const surveyId = await publishPoll(supabase, week, poll);
      next = upsertPoll(next, week, { ...poll, publishedAt: now.toISOString(), surveyId }, israelToday());
      sent++;
    } catch (err) {
      console.error('[week-setup] planned poll failed', poll.id, err);
      next = upsertPoll(next, week, { ...poll, publishedAt: now.toISOString(), error: String((err as Error)?.message || err).slice(0, 140) }, israelToday());
    }
  }
  await savePlannedPolls(supabase, next);
  return sent;
}
