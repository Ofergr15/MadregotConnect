import { NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';
import { createServerClient } from '@/lib/supabase/server';
import { authError, requireSession } from '@/lib/auth-session';
import { COACH_ID } from '@/lib/constants';
import { pdfGlyphs } from '@/lib/plans/verify/pdf-glyphs';
import { verifyPlan } from '@/lib/plans/verify/compare';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const DATE = /^\d{4}-\d{2}-\d{2}$/;

// GET /api/plans/verify?week=YYYY-MM-DD → { report, planSavedAt, pdfUrl }
//
// The week's saved plan checked against its own program PDF, number by number,
// per day and per pace group (lib/plans/verify/compare.ts). No AI: the PDF's
// text layer is the second, independent reading. Staff only. Read-only and
// advisory for now — it reports, it does not block publishing.
export async function GET(request: Request) {
  const auth = await requireSession(request);
  if (!auth.ok) return authError(auth);
  if (!auth.user.isStaff && !auth.user.isSuperUser) return NextResponse.json({ error: 'Staff access required' }, { status: 403 });

  const week = new URL(request.url).searchParams.get('week') || '';
  if (!DATE.test(week)) return NextResponse.json({ error: 'week must be YYYY-MM-DD' }, { status: 400 });

  try {
    const supabase = createServerClient();
    const [pw, plan] = await Promise.all([
      supabase.from('program_weeks').select('training_pdf_url').eq('week_start_date', week).maybeSingle(),
      supabase.from('weekly_plans').select('parsed_workouts, created_at')
        .eq('coach_id', COACH_ID).eq('week_start_date', week).is('athlete_id', null)
        .order('created_at', { ascending: false }).limit(1).maybeSingle(),
    ]);
    if (pw.error) throw pw.error;
    if (plan.error) throw plan.error;
    const url = pw.data?.training_pdf_url as string | undefined;
    if (!url) return NextResponse.json({ error: 'No program PDF for this week', code: 'no_pdf' }, { status: 404 });
    if (!plan.data) return NextResponse.json({ error: 'No saved plan for this week', code: 'no_plan' }, { status: 404 });

    // Same two places a program PDF can live as in /api/plans/sync-from-program.
    let bytes: Uint8Array;
    if (/^https?:\/\//i.test(url)) {
      const resp = await fetch(url);
      if (!resp.ok) return NextResponse.json({ error: `Could not download the program PDF (HTTP ${resp.status})` }, { status: 502 });
      bytes = new Uint8Array(await resp.arrayBuffer());
    } else {
      const file = path.join(process.cwd(), 'public', url.replace(/^\//, ''));
      if (!fs.existsSync(file)) return NextResponse.json({ error: 'The program PDF file is missing on the server' }, { status: 404 });
      bytes = new Uint8Array(fs.readFileSync(file));
    }

    const report = verifyPlan(await pdfGlyphs(bytes), plan.data.parsed_workouts);
    return NextResponse.json({ report, planSavedAt: plan.data.created_at, pdfUrl: url });
  } catch (err) {
    console.error('[plans/verify] failed:', err);
    return NextResponse.json({ error: 'Verification failed' }, { status: 500 });
  }
}
