import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireStaff } from '@/lib/auth/self-or-staff';
import { planWeekStartOf, shiftWeekStart } from '@/lib/utils';

export const dynamic = 'force-dynamic';

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/**
 * GET /api/packs/:id/week-summary?week=YYYY-MM-DD — the cron's digest of the pack chat.
 * STAFF ONLY, leaders included in the refusal: items carry pain reports on named members.
 * `week` is normalised to its plan week (Sunday); absent = last week.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const denied = await requireStaff(request);
    if (denied) return denied;
    const raw = new URL(request.url).searchParams.get('week');
    if (raw && !ISO.test(raw)) return NextResponse.json({ error: 'week must be YYYY-MM-DD' }, { status: 400 });
    // Absent = the week that last closed, which is the one the Sunday cron wrote.
    const weekStart = raw ? planWeekStartOf(raw) : shiftWeekStart(planWeekStartOf(), -1);
    const db = createServerClient();
    const { data, error } = await db.from('pack_week_summaries')
      .select('week_start, msg_by_day, items, attendance').eq('pack_id', id).eq('week_start', weekStart).maybeSingle();
    if (error) return NextResponse.json({ summary: null, migrationPending: true });
    return NextResponse.json({
      summary: data ? { weekStart: data.week_start, msgByDay: data.msg_by_day, items: data.items, attendance: data.attendance } : null,
    });
  } catch (err: any) {
    console.error('GET /api/packs/[id]/week-summary error:', err);
    return NextResponse.json({ error: err?.message || 'failed' }, { status: 500 });
  }
}
