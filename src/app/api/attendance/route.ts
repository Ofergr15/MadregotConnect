import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

// GET /api/attendance?weekStart=YYYY-MM-DD&day=N
//   &athleteId=…  -> that athlete's own RSVP for the day (or null)
//   &roster=1     -> coach view: everyone attending that day (joined to athlete name/avatar)
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const weekStart = searchParams.get('weekStart');
    const day = searchParams.get('day');
    const athleteId = searchParams.get('athleteId');
    const roster = searchParams.get('roster');

    if (!weekStart || day == null) {
      return NextResponse.json({ error: 'weekStart and day required' }, { status: 400 });
    }
    const supabase = createServerClient();

    if (roster) {
      const { data, error } = await supabase
        .from('workout_attendance')
        .select('athlete_id, attending, group_label, athletes(name, avatar_url, group_id)')
        .eq('week_start_date', weekStart)
        .eq('day_of_week', Number(day));
      if (error) throw error;
      const rows = (data || []).map((r: any) => ({
        athleteId: r.athlete_id,
        attending: r.attending,
        groupLabel: r.group_label,
        name: r.athletes?.name || '',
        avatarUrl: r.athletes?.avatar_url || null,
      }));
      return NextResponse.json({
        attendance: rows,
        goingCount: rows.filter((r) => r.attending).length,
      });
    }

    if (athleteId) {
      const { data } = await supabase
        .from('workout_attendance')
        .select('attending, group_label')
        .eq('week_start_date', weekStart)
        .eq('day_of_week', Number(day))
        .eq('athlete_id', athleteId)
        .maybeSingle();
      return NextResponse.json({
        rsvp: data ? { attending: data.attending, groupLabel: data.group_label } : null,
      });
    }

    return NextResponse.json({ error: 'athleteId or roster required' }, { status: 400 });
  } catch (err: unknown) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

// POST /api/attendance  { athleteId, weekStart, day, attending, groupLabel }
export async function POST(request: Request) {
  try {
    const { athleteId, weekStart, day, attending, groupLabel } = await request.json();
    if (!athleteId || !weekStart || day == null || attending == null) {
      return NextResponse.json({ error: 'athleteId, weekStart, day, attending required' }, { status: 400 });
    }
    const supabase = createServerClient();
    const { error } = await supabase
      .from('workout_attendance')
      .upsert(
        {
          athlete_id: athleteId,
          week_start_date: weekStart,
          day_of_week: Number(day),
          attending: !!attending,
          group_label: groupLabel || null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'athlete_id,week_start_date,day_of_week' },
      );
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
