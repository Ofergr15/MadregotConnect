import { createServerClient } from '@/lib/supabase/server';
import { sendPushToSubscriptions, resolveAudience, subscriptionsForAthletes, allAthleteIds } from '@/lib/push';

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
}): Promise<{ survey: { id: string; [key: string]: unknown }; sent: number }> {
  const supabase = createServerClient();
  const cleanOptionsHe = opts.optionsHe.map((o) => o.trim()).filter(Boolean);

  const { data: survey, error: surveyError } = await supabase
    .from('surveys')
    .insert({
      question_he: opts.questionHe.trim(),
      question_en: opts.questionEn?.trim() || null,
      options_he: cleanOptionsHe,
      options_en: (opts.optionsEn || []).map((o) => o.trim()).filter(Boolean) || null,
      audience_type: opts.audienceType || 'all',
      audience_id: opts.audienceType === 'all' ? null : opts.audienceId || null,
      created_by: opts.createdBy || null,
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
      audience_id: opts.audienceType === 'all' ? null : opts.audienceId || null,
      schedule_type: 'now',
      next_run_at: new Date().toISOString(),
      status: 'scheduled',
      created_by: opts.createdBy || null,
    })
    .select()
    .single();
  if (notifError) throw notifError;

  const subs = await resolveAudience(notifRow.audience_type, notifRow.audience_id);
  const sent = await sendPushToSubscriptions(subs, {
    title: notifRow.title_he,
    body: notifRow.body_he,
    url: notifRow.url,
    tag: `survey-${survey.id}`,
    category: 'news',
  });
  await supabase
    .from('scheduled_notifications')
    .update({ status: 'sent', last_sent_at: new Date().toISOString(), sent_count: sent })
    .eq('id', notifRow.id);

  return { survey, sent };
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
  title: string;
  body: string;
  tag: string;
}): Promise<number> {
  const supabase = createServerClient();
  const { data: responded } = await supabase.from('survey_responses').select('athlete_id').eq('survey_id', opts.surveyId);
  const respondedIds = new Set((responded || []).map((r: { athlete_id: string }) => r.athlete_id));

  let candidateIds: string[] = [];
  if (opts.audienceType === 'athlete' && opts.audienceId) {
    candidateIds = [opts.audienceId];
  } else if (opts.audienceType === 'group' && opts.audienceId) {
    const { data } = await supabase.from('athletes').select('id').eq('group_id', opts.audienceId);
    candidateIds = (data || []).map((a: { id: string }) => a.id);
  } else {
    candidateIds = await allAthleteIds();
  }
  const nonResponders = candidateIds.filter((id) => !respondedIds.has(id));
  if (nonResponders.length === 0) return 0;

  const subs = await subscriptionsForAthletes(nonResponders);
  return sendPushToSubscriptions(subs, {
    title: opts.title,
    body: opts.body,
    url: `/dashboard/surveys/${opts.surveyId}`,
    tag: opts.tag,
    category: 'news',
  });
}
