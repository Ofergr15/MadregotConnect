import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { mayActFor, resolveVerifiedCaller } from '@/lib/auth/self-or-staff';

export const dynamic = 'force-dynamic';

// POST /api/surveys/[id]/respond  { athleteId, optionIndex }
// Upserts so re-answering changes the athlete's existing response instead
// of erroring on the survey_id+athlete_id unique constraint.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { athleteId, optionIndex } = body;

    if (!athleteId) return NextResponse.json({ error: 'athleteId is required' }, { status: 400 });
    if (typeof optionIndex !== 'number' || optionIndex < 0) {
      return NextResponse.json({ error: 'optionIndex is required' }, { status: 400 });
    }

    // Verified session, so a response can't be stuffed into the poll under
    // another athlete's id by forging a header.
    const { denied, caller } = await resolveVerifiedCaller(request);
    if (denied) return denied;
    if (!mayActFor(caller, athleteId)) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }

    const supabase = createServerClient();
    const { data: survey, error: surveyError } = await supabase.from('surveys').select('options_he, closes_at').eq('id', id).maybeSingle();
    if (surveyError) throw surveyError;
    if (!survey) return NextResponse.json({ error: 'Survey not found' }, { status: 404 });
    if (optionIndex >= survey.options_he.length) {
      return NextResponse.json({ error: 'Invalid option' }, { status: 400 });
    }
    if (survey.closes_at && new Date(survey.closes_at) < new Date()) {
      return NextResponse.json({ error: 'This survey is closed' }, { status: 400 });
    }

    const { error } = await supabase
      .from('survey_responses')
      .upsert({ survey_id: id, athlete_id: athleteId, option_index: optionIndex }, { onConflict: 'survey_id,athlete_id' });
    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
