import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { fetchWeeklyVolume } from '@/lib/athletes/weekly-volume';
import { addDaysToDateStr, getActivityWeekStart, israelDateAnchor, israelToday } from '@/lib/utils';
import { weeklyBoard, squadStandings, SHOW_SQUAD_STANDINGS, type BoardMetric } from '@/lib/records/board';
import { readRoster, myPrivacy } from '@/lib/records/server';
import { recordsGate } from '@/lib/records/gate';
import { dayKmOf, parseWeekOffset, type DayKmRow } from '@/lib/records/day-km';
import { fetchAllRows } from '@/lib/supabase/paginate';
import { fetchPeriodTotals, israelMonthRange, parseBoardGroup, parseBoardPeriod, rosterInGroup } from '@/lib/records/period';

export const dynamic = 'force-dynamic';

/**
 * GET /api/records/weekly?metric=km|time — the שיאים tab's weekly board.
 *
 * Member-gated + `records_tab`. Activity week (Monday, fetchWeeklyVolume — never
 * weekly_km_snapshots). Returns the top 5 + the caller's own row, a gap to the one
 * ranked just above, and no rank for the bottom three (lib/records/board.ts).
 * Opted-out runners are not on it; hidden pace does NOT remove anyone here (km and
 * running time are not pace). No plan accuracy, ever.
 *
 * `group=1|2|3` ranks within that pace group (the board is built on the group's roster;
 * opt-outs still filtered by weeklyBoard). `period=month` is the Israel calendar month
 * (periodStart/periodEnd; weekStart/weekEnd are null then). Squad standings stay
 * club-wide and week-only.
 *
 * Week only (b23): `dayKm[7]` — the club's km per day, Monday first — and `myDayKm[7]`
 * for the verified caller (never a caller-supplied id). `weekOffset=-1` reads last
 * activity week instead, so the screen can fall back when this week is still empty.
 */
export async function GET(request: Request) {
  try {
    const { out, caller } = await recordsGate(request);
    if (out) return out;
    const params = new URL(request.url).searchParams;
    const metric: BoardMetric = params.get('metric') === 'time' ? 'time' : 'km';
    const period = parseBoardPeriod(params.get('period'));
    const group = parseBoardGroup(params.get('group'));
    const db = createServerClient();
    const today = israelToday();
    const roster = await readRoster(db, today);
    const ranked = rosterInGroup(roster, group);
    const privacy = myPrivacy(roster.find((p) => p.id === caller.athleteId));

    if (period === 'month') {
      const month = israelMonthRange();
      const totals = await fetchPeriodTotals(db, ranked.map((p) => p.id), month.start, month.endExclusive);
      return NextResponse.json({
        enabled: true,
        period,
        group,
        periodStart: month.start,
        periodEnd: month.end,
        weekStart: null,
        weekEnd: null,
        daysLeft: month.daysLeft,
        ...weeklyBoard(ranked, totals, caller.athleteId, metric),
        squads: null,
        privacy,
      });
    }

    const weekOffset = parseWeekOffset(params.get('weekOffset'));
    const weekStart = addDaysToDateStr(getActivityWeekStart(israelDateAnchor()), 7 * weekOffset);
    const rosterIds = roster.map((p) => p.id);
    const dayRowsP = rosterIds.length
      ? fetchAllRows<DayKmRow>((from, to) => db
        .from('athlete_activities')
        .select('athlete_id, start_time, distance, duration, activity_type')
        .in('athlete_id', rosterIds)
        .gte('start_time', `${weekStart}T00:00:00Z`)
        .lt('start_time', `${addDaysToDateStr(weekStart, 7)}T00:00:00Z`)
        .order('id')
        .range(from, to) as never)
      : Promise.resolve([] as DayKmRow[]);
    const { byAthlete } = await fetchWeeklyVolume(db, { athleteIds: rosterIds, weeks: 1, currentWeekStart: weekStart });
    const totals = new Map([...byAthlete].map(([id, w]) => [id, w[0] ?? { meters: 0, seconds: 0, runs: 0 }]));
    const board = weeklyBoard(ranked, totals, caller.athleteId, metric);
    const weekEnd = addDaysToDateStr(weekStart, 6);
    const daysLeft = Math.max(0, Math.round((Date.parse(`${weekEnd}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86400000));
    const { dayKm, myDayKm } = dayKmOf(await dayRowsP, weekStart, caller.athleteId);
    return NextResponse.json({
      enabled: true,
      period,
      group,
      periodStart: weekStart,
      periodEnd: weekEnd,
      weekStart,
      weekEnd,
      daysLeft,
      weekOffset,
      dayKm,
      myDayKm,
      ...board,
      squads: SHOW_SQUAD_STANDINGS ? squadStandings(roster, totals) : null,
      privacy,
    });
  } catch (err: any) {
    console.error('records/weekly error:', err);
    return NextResponse.json({ error: 'Failed to build the weekly board' }, { status: 500 });
  }
}
