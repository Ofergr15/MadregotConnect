import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { parseWorkoutPlan } from '@/lib/ai/parser';
import { COACH_ID } from '@/lib/constants';
import * as fs from 'fs';
import * as path from 'path';

const PROGRAM_WEEKS = [
  { dateRange: '28.06 – 04.07', file: 'week-28-06-04-07-2026.pdf', weekStart: '2026-06-28' },
  { dateRange: '21.06 – 27.06', file: 'week-21-27-06-2026.pdf', weekStart: '2026-06-21' },
  { dateRange: '14.06 – 20.06', file: 'week-14-20-06-2026.pdf', weekStart: '2026-06-14' },
  { dateRange: '07.06 – 13.06', file: 'week-07-13-06-2026.pdf', weekStart: '2026-06-07' },
  { dateRange: '31.05 – 06.06', file: 'week-31-05-06-06-2026.pdf', weekStart: '2026-05-31' },
];

export async function POST() {
  const supabase = createServerClient();
  const results: Array<{ week: string; status: string; error?: string }> = [];

  for (const week of PROGRAM_WEEKS) {
    try {
      const { data: existing } = await supabase
        .from('weekly_plans')
        .select('id')
        .eq('coach_id', COACH_ID)
        .eq('week_start_date', week.weekStart)
        .maybeSingle();

      if (existing) {
        results.push({ week: week.dateRange, status: 'skipped (already exists)' });
        continue;
      }

      const pdfPath = path.join(process.cwd(), 'public', 'plans', 'training-program', week.file);
      if (!fs.existsSync(pdfPath)) {
        results.push({ week: week.dateRange, status: 'skipped (file not found)' });
        continue;
      }

      const pdfBuffer = fs.readFileSync(pdfPath);
      const base64 = pdfBuffer.toString('base64');

      const parsed = await parseWorkoutPlan({
        imageBase64: base64,
        imageMediaType: 'application/pdf',
      });

      const { error } = await supabase
        .from('weekly_plans')
        .insert({
          coach_id: COACH_ID,
          week_start_date: week.weekStart,
          original_input: `Imported from program: ${week.file}`,
          parsed_workouts: parsed as any,
          status: 'pushed',
        });

      if (error) throw error;
      results.push({ week: week.dateRange, status: 'imported', });
    } catch (e: any) {
      results.push({ week: week.dateRange, status: 'error', error: e.message });
    }
  }

  return NextResponse.json({ results });
}
