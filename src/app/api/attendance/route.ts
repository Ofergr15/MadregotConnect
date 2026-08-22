import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { PR_RUN_TYPES } from '@/lib/prs/pr-buckets';

export const dynamic = 'force-dynamic';

// GET /api/attendance?weekStart=YYYY-MM-DD&day=N
//   &athleteId=…    -> that athlete's own RSVP for the day (or null)
//   &roster=1       -> coach view: everyone who RSVP'd that day (name/avatar)
//   &roster=full    -> admin view: EVERY active athlete with their RSVP or null
//                      (so non-responders are surfaced), incl. their squad and
//                      a same-day-activity "confirmed" signal (roadmap #14).
// GET /api/attendance?calendar=1&from=YYYY-MM-DD&to=YYYY-MM-DD
//   -> admin calendar: per-practice-day attendance counts across a range, so a
//      month grid can show who was/ is in each practice at a glance.
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const weekStart = searchParams.get('weekStart');
    const day = searchParams.get('day');
    const athleteId = searchParams.get('athleteId');
    const roster = searchParams.get('roster');

    const supabase = createServerClient();

    // Calendar aggregate: group all RSVPs in [from,to] by their actual date
    // (week_start_date + day_of_week) into per-day going/not-going counts.
    if (searchParams.get('calendar')) {
      const from = searchParams.get('from');
      const to = searchParams.get('to');
      if (!from || !to) {
        return NextResponse.json({ error: 'from and to required' }, { status: 400 });
      }
      // week_start_date is the Sunday; a day up to +6 later can fall in-range, so
      // widen the lower bound by a week and filter by the computed real date.
      const lowerWeek = new Date(from + 'T12:00:00');
      lowerWeek.setDate(lowerWeek.getDate() - 6);
      const lowerStr = lowerWeek.toISOString().split('T')[0];

      const { data, error } = await supabase
        .from('workout_attendance')
        .select('week_start_date, day_of_week, attending')
        .gte('week_start_date', lowerStr)
        .lte('week_start_date', to);
      if (error) throw error;

      // Fold into a map keyed by the practice's real ISO date.
      const days: Record<string, { going: number; notGoing: number; total: number }> = {};
      for (const r of data || []) {
        const d = new Date((r as any).week_start_date + 'T12:00:00');
        d.setDate(d.getDate() + Number((r as any).day_of_week));
        const iso = d.toISOString().split('T')[0];
        if (iso < from || iso > to) continue; // trim the widened lower bound
        const bucket = (days[iso] ||= { going: 0, notGoing: 0, total: 0 });
        bucket.total += 1;
        if ((r as any).attending) bucket.going += 1;
        else bucket.notGoing += 1;
      }
      return NextResponse.json({ days });
    }

    if (!weekStart || day == null) {
      return NextResponse.json({ error: 'weekStart and day required' }, { status: 400 });
    }

    // Admin roster: start from ALL athletes, then attach each one's RSVP (if any)
    // so the view can show "לא ענו" (no-response) as a first-class bucket.
    if (roster === 'full') {
      const [{ data: athletes, error: aErr }, { data: rsvps, error: rErr }] = await Promise.all([
        supabase
          .from('athletes')
          .select('id, name, avatar_url, group_id, groups(name), onboarding_status, approved')
          .order('name'),
        supabase
          .from('workout_attendance')
          .select('athlete_id, attending, group_label')
          .eq('week_start_date', weekStart)
          .eq('day_of_week', Number(day)),
      ]);
      if (aErr) throw aErr;
      if (rErr) throw rErr;
      const byAthlete = new Map(
        (rsvps || []).map((r: any) => [r.athlete_id, r]),
      );

      // Attendance verification (roadmap #14) — an athlete who RSVP'd
      // "attending" is "confirmed" if they have at least one Garmin-synced
      // running activity on the practice's real calendar date. No clock-time
      // window against the practice's actual start time (there's no stored
      // practice schedule to check against — product decision: skip the time
      // window, just require the activity to actually be a run), no separate
      // no-show/walk-in state — just this boolean, computed at read time
      // (never persisted).
      const goingIds = (rsvps || [])
        .filter((r: any) => r.attending)
        .map((r: any) => r.athlete_id);
      const confirmedIds = new Set<string>();
      if (goingIds.length > 0) {
        const practiceDate = new Date(`${weekStart}T12:00:00`);
        practiceDate.setDate(practiceDate.getDate() + Number(day));
        const dateStr = practiceDate.toISOString().split('T')[0];
        const nextDate = new Date(practiceDate);
        nextDate.setDate(nextDate.getDate() + 1);
        const nextDateStr = nextDate.toISOString().split('T')[0];

        const { data: acts, error: actErr } = await supabase
          .from('athlete_activities')
          .select('athlete_id')
          .in('athlete_id', goingIds)
          .in('activity_type', PR_RUN_TYPES)
          .gte('start_time', `${dateStr}T00:00:00`)
          .lt('start_time', `${nextDateStr}T00:00:00`);
        if (actErr) throw actErr;
        for (const a of acts || []) confirmedIds.add((a as any).athlete_id);
      }

      const rows = (athletes || [])
        // active members only (skip pending invites / unapproved)
        .filter((a: any) => a.approved !== false && a.onboarding_status !== 'pending')
        .map((a: any) => {
          const r: any = byAthlete.get(a.id);
          return {
            athleteId: a.id,
            name: a.name || '',
            avatarUrl: a.avatar_url || null,
            squad: a.groups?.name || null, // permanent squad (athletes.group_id → groups.name)
            responded: !!r,
            attending: r ? r.attending : null,
            // Chosen דבוקה for the day; fall back to their permanent squad name.
            groupLabel: r?.group_label || a.groups?.name || null,
            // Only meaningful when attending === true; null otherwise.
            confirmed: r?.attending === true ? confirmedIds.has(a.id) : null,
          };
        });
      return NextResponse.json({
        roster: rows,
        goingCount: rows.filter((r) => r.attending === true).length,
        notGoingCount: rows.filter((r) => r.attending === false).length,
        noResponseCount: rows.filter((r) => !r.responded).length,
        confirmedCount: rows.filter((r) => r.confirmed === true).length,
        total: rows.length,
      });
    }

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
