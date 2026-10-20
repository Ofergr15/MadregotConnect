import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { mayActFor, resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import { nextAnswers } from '@/lib/publish/pin';

export const dynamic = 'force-dynamic';

// POST /api/surveys/[id]/respond  { athleteId, optionIndex } -> { success, answers }
// One answer: the tap replaces the athlete's answer. A survey with more than one
// answer (surveys.multi_answer, migration 161): the tap adds or removes that option.
// Written as delete-the-dropped + insert-the-new, which is right under both the old
// unique (survey, athlete) and 160's (survey, athlete, option).
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
    const { data: survey, error: surveyError } = await supabase.from('surveys').select('*').eq('id', id).maybeSingle();
    if (surveyError) throw surveyError;
    if (!survey) return NextResponse.json({ error: 'Survey not found' }, { status: 404 });
    if (optionIndex >= survey.options_he.length) {
      return NextResponse.json({ error: 'Invalid option' }, { status: 400 });
    }
    if (survey.closes_at && new Date(survey.closes_at) < new Date()) {
      return NextResponse.json({ error: 'This survey is closed' }, { status: 400 });
    }

    const { data: mine, error: mineError } = await supabase
      .from('survey_responses').select('option_index').eq('survey_id', id).eq('athlete_id', athleteId);
    if (mineError) throw mineError;
    const current = ((mine || []) as Array<{ option_index: number }>).map((r) => r.option_index);
    const next = nextAnswers(current, optionIndex, survey.multi_answer === true);
    const drop = current.filter((x) => !next.includes(x));
    const add = next.filter((x) => !current.includes(x));
    if (drop.length) {
      const { error } = await supabase.from('survey_responses').delete().eq('survey_id', id).eq('athlete_id', athleteId).in('option_index', drop);
      if (error) throw error;
    }
    if (add.length) {
      const { error } = await supabase.from('survey_responses').insert(add.map((i) => ({ survey_id: id, athlete_id: athleteId, option_index: i })));
      if (error) throw error;
    }

    return NextResponse.json({ success: true, answers: next });
  } catch (err: unknown) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
