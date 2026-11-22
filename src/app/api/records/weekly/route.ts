import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { fetchWeeklyVolume } from '@/lib/athletes/weekly-volume';
import { getActivityWeekStart, israelDateAnchor, israelToday } from '@/lib/utils';
import { weeklyBoard, squadStandings, SHOW_SQUAD_STANDINGS, type BoardMetric } from '@/lib/records/board';
import { readRoster, myPrivacy } from '@/lib/records/server';
import { recordsGate } from '@/lib/records/gate';

export const dynamic = 'force-dynamic';

/**
 * GET /api/records/weekly?metric=km|time — the שיאים tab's weekly board.
 *
 * Member-gated + `records_tab`. Activity week (Monday, fetchWeeklyVolume — never
 * weekly_km_snapshots). Returns the top 5 + the caller's own row, a gap to the one
 * ranked just above, and no rank for the bottom three (lib/records/board.ts).
 * Opted-out runners are not on it; hidden pace does NOT remove anyone here (km and
 * running time are not pace). No plan accuracy, ever.
 */
export async function GET(request: Request) {
  try {
    const { out, caller } = await recordsGate(request);
    if (out) return out;
    const metric: BoardMetric = new URL(request.url).searchParams.get('metric') === 'time' ? 'time' : 'km';
    const db = createServerClient();
    const today = israelToday();
    const weekStart = getActivityWeekStart(israelDateAnchor());
    const roster = await readRoster(db, today);
    const { byAthlete } = await fetchWeeklyVolume(db, { athleteIds: roster.map((p) => p.id), weeks: 1, currentWeekStart: weekStart });
    const totals = new Map([...byAthlete].map(([id, w]) => [id, w[0] ?? { meters: 0, seconds: 0, runs: 0 }]));
    const board = weeklyBoard(roster, totals, caller.athleteId, metric);
    const end = new Date(`${weekStart}T12:00:00Z`); end.setUTCDate(end.getUTCDate() + 6);
    const daysLeft = Math.max(0, Math.round((end.getTime() - Date.parse(`${today}T12:00:00Z`)) / 86400000));
    return NextResponse.json({
      enabled: true,
      weekStart,
      weekEnd: end.toISOString().slice(0, 10),
      daysLeft,
      ...board,
      squads: SHOW_SQUAD_STANDINGS ? squadStandings(roster, totals) : null,
      privacy: myPrivacy(roster.find((p) => p.id === caller.athleteId)),
    });
  } catch (err: any) {
    console.error('records/weekly error:', err);
    return NextResponse.json({ error: err.message || 'Failed to build the weekly board' }, { status: 500 });
  }
}
