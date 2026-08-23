import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { canApprove } from '@/lib/constants';
import { sendPushToSubscriptions, resolveAudience } from '@/lib/push';

export const dynamic = 'force-dynamic';

// GET /api/admin/surveys — staff-only. Lists surveys newest-first with
// per-option response counts, for the Notification Center's results view.
export async function GET() {
  try {
    const supabase = createServerClient();
    const { data: surveys, error } = await supabase
      .from('surveys')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) throw error;

    const surveyIds = (surveys || []).map((s) => s.id);
    const { data: responses } = surveyIds.length
      ? await supabase.from('survey_responses').select('survey_id, option_index').in('survey_id', surveyIds)
      : { data: [] };

    const countsBySurvey = new Map<string, number[]>();
    for (const r of responses || []) {
      const arr = countsBySurvey.get(r.survey_id) || [];
      arr[r.option_index] = (arr[r.option_index] || 0) + 1;
      countsBySurvey.set(r.survey_id, arr);
    }

    const withCounts = (surveys || []).map((s) => ({
      ...s,
      counts: s.options_he.map((_: string, i: number) => countsBySurvey.get(s.id)?.[i] || 0),
      totalResponses: (countsBySurvey.get(s.id) || []).reduce((a, b) => a + (b || 0), 0),
    }));

    return NextResponse.json({ surveys: withCounts });
  } catch (err: unknown) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

// POST /api/admin/surveys — staff-only create + send immediately (surveys
// are always "now", unlike scheduled_notifications — a delayed survey isn't
// a case anyone asked for, and it'd add a second cron-scanning path for one
// notification kind). Creates the survey row, then a linked
// scheduled_notifications row (kind='survey') so it shows in the same
// Notification Center list as every other notification, then pushes.
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { actorEmail, question_he, question_en, options_he, options_en, audience_type, audience_id } = body;

    if (!canApprove(actorEmail)) {
      return NextResponse.json({ error: 'Not authorized to send surveys.' }, { status: 403 });
    }
    if (!question_he?.trim()) {
      return NextResponse.json({ error: 'question_he is required' }, { status: 400 });
    }
    const cleanOptionsHe = (options_he || []).map((o: string) => o.trim()).filter(Boolean);
    if (cleanOptionsHe.length < 2) {
      return NextResponse.json({ error: 'At least 2 options are required' }, { status: 400 });
    }

    const supabase = createServerClient();
    const { data: survey, error: surveyError } = await supabase
      .from('surveys')
      .insert({
        question_he: question_he.trim(),
        question_en: question_en?.trim() || null,
        options_he: cleanOptionsHe,
        options_en: (options_en || []).map((o: string) => o.trim()).filter(Boolean) || null,
        audience_type: audience_type || 'all',
        audience_id: audience_type === 'all' ? null : audience_id || null,
        created_by: actorEmail,
      })
      .select()
      .single();
    if (surveyError) throw surveyError;

    const { data: notifRow, error: notifError } = await supabase
      .from('scheduled_notifications')
      .insert({
        kind: 'survey',
        survey_id: survey.id,
        title_he: question_he.trim(),
        body_he: 'לחצו לענות על הסקר',
        title_en: question_en?.trim() || null,
        body_en: question_en?.trim() ? 'Tap to answer the survey' : null,
        url: `/dashboard/surveys/${survey.id}`,
        audience_type: audience_type || 'all',
        audience_id: audience_type === 'all' ? null : audience_id || null,
        schedule_type: 'now',
        next_run_at: new Date().toISOString(),
        status: 'scheduled',
        created_by: actorEmail,
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

    return NextResponse.json({ survey, sent });
  } catch (err: unknown) {
    console.error('Failed to create survey:', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
