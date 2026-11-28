import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { fetchAllRows } from '@/lib/supabase/paginate';
import { WEEKLY_PLANS_TAG } from '@/lib/plans/cache';
import { COACH_ID } from '@/lib/constants';
import { requireMember } from '@/lib/auth/self-or-staff';

export const dynamic = 'force-dynamic';

/**
 * Distinct week_start_dates that have an AI-parsed `weekly_plans` row — used
 * by the Program page to add weeks to its picker that have structured plan
 * data but no `program_weeks` PDF row (the two tables are populated by
 * separate flows and can drift out of sync with each other).
 */
export async function GET(request: Request) {
  try {
    const denied = await requireMember(request);
    if (denied) return denied;

    const supabase = createServerClient({ revalidateSeconds: 300, cacheTags: [WEEKLY_PLANS_TAG] });
    // Paged (task 194): one row per club week AND per academy trainee week, so the
    // coach's rows pass 1000 — and past the cap the OLDEST weeks vanished from the picker.
    const data = await fetchAllRows<{ week_start_date: string }>((from, to) => supabase
      .from('weekly_plans')
      .select('week_start_date')
      .eq('coach_id', COACH_ID)
      .order('week_start_date', { ascending: false })
      .order('id')
      .range(from, to))
      // As before: a failed read is an empty picker, not a 500.
      .catch((err) => { console.error('Plan weeks read failed:', err); return [] as Array<{ week_start_date: string }>; });
    const weekStarts = [...new Set(data.map((r) => r.week_start_date))];
    return NextResponse.json({ weekStarts });
  } catch (error) {
    console.error('Plan weeks error:', error);
    return NextResponse.json({ error: 'Failed to fetch weeks' }, { status: 500 });
  }
}
