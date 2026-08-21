import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { COACH_ID } from '@/lib/constants';

/**
 * Distinct week_start_dates that have an AI-parsed `weekly_plans` row — used
 * by the Program page to add weeks to its picker that have structured plan
 * data but no `program_weeks` PDF row (the two tables are populated by
 * separate flows and can drift out of sync with each other).
 */
export async function GET() {
  try {
    const supabase = createServerClient({ revalidateSeconds: 300 });
    const { data } = await supabase
      .from('weekly_plans')
      .select('week_start_date')
      .eq('coach_id', COACH_ID)
      .order('week_start_date', { ascending: false });
    const weekStarts = [...new Set((data || []).map((r: { week_start_date: string }) => r.week_start_date))];
    return NextResponse.json({ weekStarts });
  } catch (error) {
    console.error('Plan weeks error:', error);
    return NextResponse.json({ error: 'Failed to fetch weeks' }, { status: 500 });
  }
}
