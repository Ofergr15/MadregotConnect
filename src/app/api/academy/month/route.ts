import { NextResponse } from 'next/server';
import { israelToday } from '@/lib/utils';
import { createServerClient } from '@/lib/supabase/server';
import { requireCallerForAthlete } from '@/lib/auth/self-or-staff';
import { mayCoach } from '@/lib/academy/pairing-server';
import { computeAcademyWeekAdherence } from '@/lib/academy/report';
import { boardRow, monthDates, monthDays, monthSummary, type MonthBoardPayload } from '@/lib/academy/board';
import { loadRaceDate } from '@/lib/academy/load-server';
import { weekStartOf } from '@/lib/academy/pmc';
import { shiftDate } from '@/lib/academy/load';

export const dynamic = 'force-dynamic';

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * GET /api/academy/month?athleteId=…&month=YYYY-MM — the month board (trainee-experience-v2
 * screen 3): every day of the month with the colour of its session, the race day, and the
 * line under the grid, counted from the grid (lib/academy/board.ts).
 *
 * Graded week by week with `computeAcademyWeekAdherence` and `boardRow`, exactly as the
 * week board grades its rows, so a day is the same colour in both. The weekly ⚡ bars
 * under the grid come from /api/academy/load, not from here.
 *
 * WHO: `mayCoach` — the trainee, their coaches, the manager.
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const athleteId = searchParams.get('athleteId') || '';
    const today = israelToday();
    const asked = searchParams.get('month');
    if (!athleteId) return NextResponse.json({ error: 'athleteId is required' }, { status: 400 });
    if (asked && !MONTH.test(asked)) return NextResponse.json({ error: 'month must be YYYY-MM' }, { status: 400 });
    const month = asked || today.slice(0, 7);

    const { denied, caller } = await requireCallerForAthlete(request, athleteId);
    if (denied) return denied;
    if (!(await mayCoach(caller, athleteId))) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }

    // The Sunday weeks the month touches (4 to 6), graded in parallel.
    const dates = monthDates(month);
    const weeks: string[] = [];
    for (let w = weekStartOf(dates[0]); w <= dates[dates.length - 1]; w = shiftDate(w, 7)) weeks.push(w);
    const supabase = createServerClient();
    const [reports, raceDate] = await Promise.all([
      Promise.all(weeks.map(weekStart => computeAcademyWeekAdherence({ weekStart, onlyAthleteId: athleteId }))),
      loadRaceDate(supabase, athleteId),
    ]);

    const sessions = reports
      .flatMap(r => r.athletes[0]?.week.workouts ?? [])
      .filter(row => row.date.startsWith(month))
      .map((row) => {
        const graded = boardRow(row, today);
        return { date: row.date, color: graded.compliance.color, actualM: graded.actualM };
      });
    const days = monthDays({ month, today, sessions, raceDate });
    const body: MonthBoardPayload = {
      month,
      today,
      days: days.map(({ date, color, race, today: isToday }) => ({ date, color, race, today: isToday })),
      summary: monthSummary(days),
    };
    return NextResponse.json(body);
  } catch (error) {
    console.error('academy month error:', error);
    return NextResponse.json({ error: 'Failed to load the month' }, { status: 500 });
  }
}
