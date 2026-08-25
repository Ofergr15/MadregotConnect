import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { planTargetForDate } from '@/lib/post-workout';

// GET /api/activities/[id]/plan-match — how this one activity's distance compares
// to that day's planned target (min/max from the published weekly plan), for the
// ActivitySyncEditor's "plan match" card. Deliberately independent of the feed_items
// fetch (and its Supabase-JWT requirement) elsewhere in that sheet — this only reads
// the activity's own row plus the club's plan, so it should render even when the
// feed portion is signed out.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const supabase = createServerClient();
    const { data: activity, error } = await supabase
      .from('athlete_activities')
      .select('start_time, distance')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    if (!activity || !activity.start_time) return NextResponse.json({ matched: false });

    const dateStr = activity.start_time.split('T')[0];
    const target = await planTargetForDate(dateStr);
    if (!target) return NextResponse.json({ matched: false });

    const targetMidKm = (target.min + target.max) / 2;
    if (targetMidKm <= 0) return NextResponse.json({ matched: false });

    const actualKm = (activity.distance || 0) / 1000;
    const pct = Math.round((actualKm / targetMidKm) * 100);

    return NextResponse.json({
      matched: true,
      pct,
      actualKm: Math.round(actualKm * 10) / 10,
      targetKm: Math.round(targetMidKm * 10) / 10,
      type: target.type,
    });
  } catch {
    return NextResponse.json({ matched: false });
  }
}
