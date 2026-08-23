import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

// GET /api/surveys/[id]?athleteId=… — the survey's question/options plus
// whether this athlete already answered (and what they picked, so the
// answer screen can show their existing choice instead of re-asking).
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const athleteId = request.nextUrl.searchParams.get('athleteId');

    const supabase = createServerClient();
    const { data: survey, error } = await supabase.from('surveys').select('*').eq('id', id).maybeSingle();
    if (error) throw error;
    if (!survey) return NextResponse.json({ error: 'Survey not found' }, { status: 404 });

    let myResponse: number | null = null;
    if (athleteId) {
      const { data: resp } = await supabase
        .from('survey_responses')
        .select('option_index')
        .eq('survey_id', id)
        .eq('athlete_id', athleteId)
        .maybeSingle();
      myResponse = resp?.option_index ?? null;
    }

    return NextResponse.json({ survey, myResponse });
  } catch (err: unknown) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
