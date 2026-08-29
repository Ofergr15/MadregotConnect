import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { parseWorkoutPlan } from '@/lib/ai/parser';
import * as fs from 'fs';
import * as path from 'path';
import { authError, requireSession } from '@/lib/auth-session';

// Parsing the program PDF runs Opus 4.8 vision + adaptive thinking (30–180s).
// Same reasoning as /api/parse-workout — give it room so the function isn't
// killed mid-call. Pinned to the Pro-plan ceiling.
export const maxDuration = 300;

/**
 * POST /api/plans/sync-from-program
 * Body: { week_start_date: 'YYYY-MM-DD' }
 *
 * Bridges the Program page and the Planner: looks up the training PDF uploaded
 * for the given week (program_weeks.training_pdf_url), fetches it, parses it with
 * the vision model, and returns the parsed plan in the same shape the planner's
 * /api/parse-workout returns. It does NOT write to weekly_plans — the client owns
 * the save (so it can confirm before overwriting an existing plan).
 */
export async function POST(req: NextRequest) {
  try {
    // Staff-only: another Claude-parsing entry point, so an open handler was
    // unauthenticated spend on the club's API budget.
    const auth = await requireSession(req);
    if (!auth.ok) return authError(auth);
    if (!auth.user.isStaff) {
      return NextResponse.json({ error: 'Staff access required' }, { status: 403 });
    }

    const { week_start_date } = await req.json();

    if (!week_start_date) {
      return NextResponse.json({ error: 'week_start_date is required' }, { status: 400 });
    }

    const supabase = createServerClient();

    const { data: programWeek, error: lookupError } = await supabase
      .from('program_weeks')
      .select('training_pdf_url, date_range')
      .eq('week_start_date', week_start_date)
      .maybeSingle();

    if (lookupError) {
      return NextResponse.json(
        { error: 'Could not look up the program for this week.', details: lookupError.message },
        { status: 500 }
      );
    }

    if (!programWeek?.training_pdf_url) {
      return NextResponse.json(
        {
          error: 'No training program uploaded for this week yet. Add it on the Program page first.',
          code: 'no_program',
        },
        { status: 404 }
      );
    }

    // The PDF URL can be a Supabase Storage public URL (https://…) or a legacy
    // path served from /public (starts with "/plans/…"). Load the bytes either way.
    const url = programWeek.training_pdf_url as string;
    let pdfBase64: string;

    if (/^https?:\/\//i.test(url)) {
      const resp = await fetch(url);
      if (!resp.ok) {
        return NextResponse.json(
          { error: `Could not download the program PDF (HTTP ${resp.status}).` },
          { status: 502 }
        );
      }
      const buf = Buffer.from(await resp.arrayBuffer());
      pdfBase64 = buf.toString('base64');
    } else {
      const pdfPath = path.join(process.cwd(), 'public', url.replace(/^\//, ''));
      if (!fs.existsSync(pdfPath)) {
        return NextResponse.json(
          { error: 'The program PDF file is missing on the server.' },
          { status: 404 }
        );
      }
      pdfBase64 = fs.readFileSync(pdfPath).toString('base64');
    }

    const parsed = await parseWorkoutPlan({
      imageBase64: pdfBase64,
      imageMediaType: 'application/pdf',
    });

    return NextResponse.json({ ...parsed, dateRange: programWeek.date_range ?? null });
  } catch (error: any) {
    console.error('Sync-from-program error:', error);

    const rawMessage: string = error?.message || '';
    if (/credit balance is too low/i.test(rawMessage)) {
      return NextResponse.json(
        {
          error:
            'AI parsing is temporarily unavailable — the Anthropic API account is out of credits. Add credits in the Anthropic console (Plans & Billing), then try again.',
          code: 'insufficient_credits',
        },
        { status: 402 }
      );
    }

    return NextResponse.json(
      { error: rawMessage || 'Failed to sync from program' },
      { status: 500 }
    );
  }
}
