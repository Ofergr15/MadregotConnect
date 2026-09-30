import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { mayActFor, resolveVerifiedCaller } from '@/lib/auth/self-or-staff';

export const dynamic = 'force-dynamic';

interface SurveyResult {
  optionIndex: number;
  /** In the order they answered. */
  people: Array<{ id: string; name: string }>;
}

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
    let results: SurveyResult[] | null = null;
    if (athleteId) {
      // Identity from the verified session, not the `x-user-email` header this
      // used to trust. A caller with no valid session still gets the survey
      // itself — the page is opened straight from a push notification, and a
      // stale session shouldn't make it look like the survey doesn't exist —
      // they just don't get anybody's answer back. A caller who IS signed in
      // but is asking about someone else is refused outright.
      const { denied, caller } = await resolveVerifiedCaller(request);
      if (denied) return NextResponse.json({ survey, myResponse: null });
      if (!mayActFor(caller, athleteId)) {
        return NextResponse.json({ error: 'forbidden' }, { status: 403 });
      }
      const { data: resp } = await supabase
        .from('survey_responses')
        .select('option_index')
        .eq('survey_id', id)
        .eq('athlete_id', athleteId)
        .maybeSingle();
      myResponse = resp?.option_index ?? null;

      // WHO PICKED WHAT (feedback #91: "who is coming tomorrow and in which pack —
      // it'd be nice to see the results and who voted for which pack"). A signed-in
      // caller only, never the no-session path above, and the super user only until
      // rollout, when it becomes any signed-in member: the survey goes to the whole
      // club and asks who is coming, so the answer is the club's. Active athletes
      // only, so a runner the club hasn't approved yet isn't listed (#77).
      if (caller.isSuperUser) {
        const { data: rows } = await supabase
          .from('survey_responses')
          .select('option_index, created_at, athletes!inner(id, name, status)')
          .eq('survey_id', id)
          .eq('athletes.status', 'active')
          .order('created_at');
        results = (survey.options_he as string[]).map((_, i) => ({
          optionIndex: i,
          people: (rows || [])
            .filter((r: any) => r.option_index === i)
            .map((r: any) => ({ id: r.athletes.id as string, name: (r.athletes.name as string) || '' })),
        }));
      }
    }

    return NextResponse.json({ survey, myResponse, results });
  } catch (err: unknown) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
