import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { authError, requireSession } from '@/lib/auth-session';
import { buildSession, type ActivityRow, type AthleteRow, type AttendanceRow, type GroupRow } from '@/lib/pack-stories/build';

export const dynamic = 'force-dynamic';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function addDays(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// GET /api/pack-stories?date=YYYY-MM-DD
//   -> { date, label, runs } — every run of that day with its pack, laps and GPS trace.
//
// Super user only, decided on the VERIFIED session. The screen is still being
// tried out; nobody else has a door to it, and this answers 403 to anyone who
// finds the URL anyway. It lists every runner's name and route for the day.
export async function GET(request: Request) {
  const auth = await requireSession(request);
  if (!auth.ok) return authError(auth);
  if (!auth.user.isSuperUser) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const date = new URL(request.url).searchParams.get('date') || '';
  if (!DATE.test(date)) return NextResponse.json({ error: 'date must be YYYY-MM-DD' }, { status: 400 });

  try {
    const supabase = createServerClient();
    // Attendance weeks start on Sunday; the day is an offset into the week.
    const dow = new Date(`${date}T12:00:00Z`).getUTCDay();
    const weekStart = addDays(date, -dow);
    // start_time is local wall-clock time stored as +00:00, so a naive day range is the local day.
    const [acts, att, aths, grps] = await Promise.all([
      supabase.from('athlete_activities')
        .select('id, athlete_id, start_time, distance, duration, average_pace, average_hr, laps, gps_points')
        .gte('start_time', `${date}T00:00:00`)
        .lt('start_time', `${addDays(date, 1)}T00:00:00`),
      supabase.from('workout_attendance')
        .select('athlete_id, group_label')
        .eq('week_start_date', weekStart)
        .eq('day_of_week', dow)
        .eq('attending', true),
      supabase.from('athletes').select('id, name, group_id'),
      supabase.from('groups').select('id, name'),
    ]);
    const failed = [acts, att, aths, grps].find(r => r.error);
    if (failed?.error) throw failed.error;

    return NextResponse.json(buildSession(
      date,
      (acts.data || []) as ActivityRow[],
      (att.data || []) as AttendanceRow[],
      (aths.data || []) as AthleteRow[],
      (grps.data || []) as GroupRow[],
    ));
  } catch (err) {
    console.error('[pack-stories] GET failed:', err);
    return NextResponse.json({ error: 'Failed to load the session' }, { status: 500 });
  }
}
