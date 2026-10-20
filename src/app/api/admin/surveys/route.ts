import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireApprover } from '@/lib/auth/require-approver';
import { createAndSendSurvey } from '@/lib/surveys';
import { closesAt } from '@/lib/publish/model';
import { MIGRATION_161, pinUntil, readPinChoice } from '@/lib/publish/pin';
import { hasMigration161, pinPost, publishClubPost } from '@/lib/publish/server';

export const dynamic = 'force-dynamic';

// GET /api/admin/surveys — staff-only. Lists surveys newest-first with
// per-option response counts, for the Notification Center's results view.
// It lists who answered what, so it is the approvers' too (it had no gate at all).
export async function GET(request: Request) {
  try {
    const { denied } = await requireApprover(request);
    if (denied) return denied;
    const supabase = createServerClient();
    const { data: surveys, error } = await supabase
      .from('surveys')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) throw error;

    const surveyIds = (surveys || []).map((s) => s.id);
    const { data: responses } = surveyIds.length
      ? await supabase.from('survey_responses').select('survey_id, option_index, athlete_id').in('survey_id', surveyIds)
      : { data: [] };

    const countsBySurvey = new Map<string, number[]>();
    // People, not rows: a survey with more than one answer has a row per answer (161).
    const people = new Map<string, Set<string>>();
    for (const r of responses || []) {
      const who = people.get(r.survey_id) ?? new Set<string>(); who.add(r.athlete_id); people.set(r.survey_id, who);
      const arr = countsBySurvey.get(r.survey_id) || [];
      arr[r.option_index] = (arr[r.option_index] || 0) + 1;
      countsBySurvey.set(r.survey_id, arr);
    }

    const withCounts = (surveys || []).map((s) => ({
      ...s,
      counts: s.options_he.map((_: string, i: number) => countsBySurvey.get(s.id)?.[i] || 0),
      totalResponses: people.get(s.id)?.size ?? 0,
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
    const { denied, email: actorEmail } = await requireApprover(request);
    if (denied) return denied;

    const body = await request.json();
    const { question_he, question_en, options_he, options_en, audience_type, audience_id } = body;
    // From "לפרסם › סקר" (mockup publish, C3): when it closes, whether it pushes, and a card on the feed.
    const closes = body.closes === 'tomorrow' || body.closes === 'week' ? closesAt(body.closes) : null;
    if (!question_he?.trim()) {
      return NextResponse.json({ error: 'question_he is required' }, { status: 400 });
    }
    const cleanOptionsHe = (options_he || []).map((o: string) => o.trim()).filter(Boolean);
    if (cleanOptionsHe.length < 2) {
      return NextResponse.json({ error: 'At least 2 options are required' }, { status: 400 });
    }

    // More than one answer, and pinned to the top (both 161): refused before anything is made.
    const multi = body.multi === true;
    const pin = pinUntil(readPinChoice(body.pin), new Date(), { date: typeof body.pinDate === 'string' ? body.pinDate : null, closesAt: closes });
    if ((multi || pin) && !(await hasMigration161(createServerClient()))) {
      return NextResponse.json({ error: MIGRATION_161 }, { status: 409 });
    }

    const { survey, sent } = await createAndSendSurvey({
      questionHe: question_he,
      questionEn: question_en,
      optionsHe: cleanOptionsHe,
      optionsEn: options_en,
      audienceType: audience_type || 'all',
      audienceId: audience_id,
      createdBy: actorEmail,
      closesAt: closes,
      push: body.push !== false,
      multi,
    });
    // The survey on the feed, to answer in place (FeedCard's SurveyCard reads payload.surveyId).
    let feedItemId: string | null = null;
    if (body.feed === true) {
      feedItemId = await publishClubPost(createServerClient(), { body: question_he.trim(), payload: { surveyId: survey.id } });
      if (pin && feedItemId) await pinPost(createServerClient(), feedItemId, pin);
    }

    return NextResponse.json({ survey, sent, feedItemId });
  } catch (err: unknown) {
    console.error('Failed to create survey:', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
