import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { resolveVerifiedCaller } from '@/lib/auth/self-or-staff';

export const dynamic = 'force-dynamic';

// GET /api/surveys/open — the polls waiting for the caller: open, in their audience (the
// club, their pack, the academy or them), and not answered yet. The home's "סקר פתוח מחכה
// לך" line (mockup polls-proposal, 10-20). The retired weekly pack polls are left out.
export async function GET(request: Request) {
  const { denied, caller } = await resolveVerifiedCaller(request);
  if (denied) return denied;
  const me = caller.athleteId;
  if (!me) return NextResponse.json({ polls: [] });
  const db = createServerClient();
  try {
    const nowIso = new Date().toISOString();
    const [{ data: who }, { data: open }] = await Promise.all([
      db.from('athletes').select('group_id, is_academy').eq('id', me).maybeSingle(),
      db.from('surveys').select('id, question_he, closes_at, audience_type, audience_id, created_by, created_at')
        .or(`closes_at.is.null,closes_at.gt.${nowIso}`).gte('created_at', new Date(Date.now() - 30 * 86_400_000).toISOString())
        .order('created_at', { ascending: false }).limit(20),
    ]);
    const a = (who || {}) as { group_id?: string | null; is_academy?: boolean | null };
    const mine = ((open || []) as Array<{ id: string; question_he: string; closes_at: string | null; audience_type: string; audience_id: string | null; created_by: string | null }>)
      .filter((s) => s.created_by !== 'cron')
      .filter((s) => s.audience_type === 'all' || (s.audience_type === 'group' && s.audience_id === a.group_id)
        || (s.audience_type === 'academy' && a.is_academy) || (s.audience_type === 'athlete' && s.audience_id === me));
    if (!mine.length) return NextResponse.json({ polls: [] });
    const { data: done } = await db.from('survey_responses').select('survey_id').eq('athlete_id', me).in('survey_id', mine.map((s) => s.id));
    const answered = new Set(((done || []) as Array<{ survey_id: string }>).map((r) => r.survey_id));
    return NextResponse.json({
      polls: mine.filter((s) => !answered.has(s.id)).slice(0, 3).map((s) => ({ id: s.id, question: s.question_he, closesAt: s.closes_at })),
    }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (err) {
    console.error('[surveys/open] failed:', err);
    return NextResponse.json({ polls: [] });
  }
}
