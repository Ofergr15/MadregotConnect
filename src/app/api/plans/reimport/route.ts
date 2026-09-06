import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { revalidateWeeklyPlans } from '@/lib/plans/cache';
import { parseWorkoutPlan } from '@/lib/ai/parser';
import { COACH_ID } from '@/lib/constants';
import * as fs from 'fs';
import * as path from 'path';
import { authError, requireSession } from '@/lib/auth-session';
import { normalizeParsedWorkouts } from '@/lib/plans/normalize-plan';

const PROGRAM_WEEKS = [
  { file: 'week-28-06-04-07-2026.pdf', weekStart: '2026-06-28' },
  { file: 'week-21-27-06-2026.pdf', weekStart: '2026-06-21' },
  { file: 'week-14-20-06-2026.pdf', weekStart: '2026-06-14' },
  { file: 'week-07-13-06-2026.pdf', weekStart: '2026-06-07' },
  { file: 'week-31-05-06-06-2026.pdf', weekStart: '2026-05-31' },
];

// Staff-only: re-parses bundled program PDFs through Claude (real API spend) and
// overwrites weekly_plans. It has no caller in the app — kept gated rather than
// removed, but it is a deletion candidate.
export async function POST(request: Request) {
  const auth = await requireSession(request);
  if (!auth.ok) return authError(auth);
  if (!auth.user.isStaff) {
    return NextResponse.json({ error: 'Staff access required' }, { status: 403 });
  }

  const { weekStart } = await request.json().catch(() => ({ weekStart: null }));
  const supabase = createServerClient();
  const results: Array<{ week: string; status: string; error?: string }> = [];

  const weeks = weekStart
    ? PROGRAM_WEEKS.filter(w => w.weekStart === weekStart)
    : PROGRAM_WEEKS;

  for (const week of weeks) {
    try {
      const pdfPath = path.join(process.cwd(), 'public', 'plans', 'training-program', week.file);
      if (!fs.existsSync(pdfPath)) {
        results.push({ week: week.weekStart, status: 'file not found' });
        continue;
      }

      const pdfBuffer = fs.readFileSync(pdfPath);
      const base64 = pdfBuffer.toString('base64');

      const parsed = await parseWorkoutPlan({
        imageBase64: base64,
        imageMediaType: 'application/pdf',
      });

      // Delete existing plans for this week
      await supabase
        .from('weekly_plans')
        .delete()
        .eq('coach_id', COACH_ID)
        .eq('week_start_date', week.weekStart);

      // Insert fresh
      const { error } = await supabase
        .from('weekly_plans')
        .insert({
          coach_id: COACH_ID,
          week_start_date: week.weekStart,
          original_input: `Re-imported from: ${week.file}`,
          parsed_workouts: normalizeParsedWorkouts(parsed) as any,
          status: 'pushed',
        });

      if (error) throw error;
      results.push({ week: week.weekStart, status: 'reimported' });
    } catch (e: any) {
      results.push({ week: week.weekStart, status: 'error', error: e.message });
    }
  }

  revalidateWeeklyPlans();
  return NextResponse.json({ results });
}
