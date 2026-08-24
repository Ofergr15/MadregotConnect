import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { canApprove } from '@/lib/constants';
import { createAndSendSurvey } from '@/lib/surveys';

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

    const { survey, sent } = await createAndSendSurvey({
      questionHe: question_he,
      questionEn: question_en,
      optionsHe: cleanOptionsHe,
      optionsEn: options_en,
      audienceType: audience_type || 'all',
      audienceId: audience_id,
      createdBy: actorEmail,
    });

    return NextResponse.json({ survey, sent });
  } catch (err: unknown) {
    console.error('Failed to create survey:', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
